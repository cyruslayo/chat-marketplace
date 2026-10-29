import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGuestRequestHandler, type GuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import { writeAssistantTurnRecord } from "../apps/local-guest/src/assistant/assistant-turn-record.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import { bootstrapLocalPilot, localPilotPaths } from "../apps/pilot/src/local-pilot.js";
import type { AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantTurnRecord } from "../apps/local-guest/src/assistant/assistant-turn-record.js";
import { createFakeHttpRequest, createFakeHttpResponse } from "./helpers/http-like.js";
import { postJson } from "./helpers/guest-journey.js";
import { productionFixture } from "./helpers/pilot-fixture.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

// Issue 05, host paths: every host that serves assistant traffic passes the turn-record sink, so a real turn writes one
// `assistant.turn.v1` line. Each host is driven through its own entry point with the assistant runtime enabled.

const REPLY = { text: JSON.stringify({ kind: "clarify_stay", references: [] }), finishReason: "stop" as const };
const TURN_EVENT = "assistant.turn.v1";
const PUBLIC_ORIGIN = "https://pilot.example.com";
const LOCAL_PILOT_PORT = 3098;

/** Attempt-aware, as the production adapters are: the quota guard reserves each provider attempt before it starts. */
class ReplyModel extends RecordingTurnModel {
  readonly supportsProviderAttemptReservation = true as const;

  override async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    await request.beforeProviderAttempt?.();
    return super.generate(request);
  }
}

function replyModel(): RecordingTurnModel {
  return new ReplyModel(() => REPLY);
}

/** Captures the `assistant.turn.v1` lines a host writes through `console.log`, the way Workers Logs receives them. */
async function captureTurnLines<T>(run: () => Promise<T>): Promise<{ result: T; records: AssistantTurnRecord[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  try {
    const result = await run();
    const records = lines
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === TURN_EVENT) as unknown as AssistantTurnRecord[];
    return { result, records };
  } finally {
    console.log = original;
  }
}

function environmentFor(clock: SteppedClock): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: clock.now,
    demoCheckIn: "2026-12-20",
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
}

/** One POST /api/turn through a handler, the way node:http delivers it (the same fake the guest handler tests use). */
async function postTurn(handler: GuestRequestHandler, threadId: string, text: string, cookie?: string) {
  const body = Buffer.from(JSON.stringify({ threadId, text }));
  const request = createFakeHttpRequest({
    method: "POST",
    url: "/api/turn",
    headers: { "content-type": "application/json", "content-length": String(body.length), origin: PUBLIC_ORIGIN, ...(cookie ? { cookie } : {}) },
    body,
  });
  const { response, finished } = createFakeHttpResponse();
  const handled = handler.handle(request, response);
  await Promise.race([finished, handled.then(() => finished)]);
  await handled;
  return finished;
}

async function sessionCookie(handler: GuestRequestHandler): Promise<string> {
  const request = createFakeHttpRequest({ method: "GET", url: "/", headers: { origin: PUBLIC_ORIGIN } });
  const { response, finished } = createFakeHttpResponse();
  const handled = handler.handle(request, response);
  await Promise.race([finished, handled.then(() => finished)]);
  await handled;
  const captured = await finished;
  const setCookie = captured.headers.find((header) => header.name.toLowerCase() === "set-cookie")?.value;
  return setCookie?.split(";", 1)[0] ?? "";
}

test("AC1 host: the offline assistant construction site passes the turn-record sink, and the record names the configured model.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const environment = environmentFor(clock);
  try {
    const handler = createGuestRequestHandler({
      environment,
      conciergeMode: "assistant-offline",
      modelClient: replyModel(),
      assistantModelName: "offline-test-model",
      production: false,
      fixtureRoutes: false,
      publicOrigin: PUBLIC_ORIGIN,
      onAssistantTurn: writeAssistantTurnRecord,
    });
    const { result, records } = await captureTurnLines(async () => postTurn(handler, "g-7e57a0000201", "Hello"));
    assert.equal(result.statusCode, 200);
    assert.equal(records.length, 1, "one record for the one turn");
    assert.equal(records[0]?.["gen_ai.request.model"], "offline-test-model");
  } finally { environment.close(); }
});

test("AC1 host: the provider construction site passes the turn-record sink, and the record names the configured model.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const environment = environmentFor(clock);
  try {
    const handler = createGuestRequestHandler({
      environment,
      conciergeMode: "openai-compatible",
      modelClient: replyModel(),
      assistantModelName: "provider-test-model",
      production: false,
      fixtureRoutes: false,
      publicOrigin: PUBLIC_ORIGIN,
      onAssistantTurn: writeAssistantTurnRecord,
    });
    const { result, records } = await captureTurnLines(async () => postTurn(handler, "g-7e57a0000202", "Hello"));
    assert.equal(result.statusCode, 200);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.["gen_ai.request.model"], "provider-test-model");
  } finally { environment.close(); }
});

test("AC1 host: the session-scoped construction site passes the turn-record sink to each session runtime.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const environment = environmentFor(clock);
  try {
    const handler = createGuestRequestHandler({
      environment,
      conciergeMode: "openai-compatible",
      modelClient: replyModel(),
      assistantModelName: "session-test-model",
      production: false,
      fixtureRoutes: false,
      publicOrigin: PUBLIC_ORIGIN,
      onAssistantTurn: writeAssistantTurnRecord,
      sessionScopedGuestPrincipals: true,
    });
    const cookie = await sessionCookie(handler);
    const { result, records } = await captureTurnLines(async () => postTurn(handler, "g-7e57a0000203", "Hello", cookie));
    assert.equal(result.statusCode, 200);
    assert.equal(records.length, 1, "the session runtime writes one record for its turn");
    assert.equal(records[0]?.["gen_ai.request.model"], "session-test-model");
  } finally { environment.close(); }
});

test("AC1 host: the Node pilot passes the turn-record sink, and the record names the configured concierge model.", async () => {
  const configured = await productionFixture({ environment: { CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "gemini-offline-key" } });
  try {
    const server = startPilotServer({ port: 0, configuration: configured.configuration, paystackClient: configured.paystack, modelClient: replyModel() });
    try {
      const port = await server.listen();
      const base = `http://127.0.0.1:${port}`;
      const page = await fetch(`${base}/`);
      const cookie = (page.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
      const { result, records } = await captureTurnLines(async () => postJson(base, "/api/turn", cookie, { threadId: "g-7e57a0000204", text: "Hello" }));
      assert.equal(result.status, 200);
      assert.equal(records.length, 1, "the pilot writes one record for the turn");
      assert.equal(records[0]?.["gen_ai.request.model"], configured.configuration.concierge.primary?.model);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(configured.directory, { recursive: true, force: true });
  }
});

test("AC1 host: the local pilot passes the turn-record sink to its assistant runtime.", async () => {
  const directory = mkdtempSync(join(tmpdir(), "turn-record-local-pilot-"));
  const previousMode = process.env.CONCIERGE_MODE;
  process.env.CONCIERGE_MODE = "assistant-offline";
  try {
    const paths = localPilotPaths(directory);
    bootstrapLocalPilot(paths);
    const server = startLocalPilotServer({ port: LOCAL_PILOT_PORT, paths });
    try {
      await server.listen();
      const base = `http://127.0.0.1:${LOCAL_PILOT_PORT}`;
      const page = await fetch(`${base}/`);
      const cookie = (page.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
      const { result, records } = await captureTurnLines(async () => postJson(base, "/api/turn", cookie, { threadId: "g-7e57a0000205", text: "Hello" }, base));
      assert.equal(result.status, 200);
      assert.equal(records.length, 1, "the local pilot writes one record for the turn");
      assert.equal(records[0]?.["gen_ai.operation.name"], "chat");
    } finally {
      await server.close();
    }
  } finally {
    if (previousMode === undefined) delete process.env.CONCIERGE_MODE; else process.env.CONCIERGE_MODE = previousMode;
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The text of the first `createGuestRequestHandler({ ... })` call in a host source file (its options object, to the matching close). */
function handlerCallSource(path: string): string {
  const source = readFileSync(join(process.cwd(), path), "utf8");
  const start = source.indexOf("createGuestRequestHandler({");
  assert.ok(start >= 0, `${path} calls createGuestRequestHandler`);
  let depth = 0;
  for (let index = start + "createGuestRequestHandler".length; index < source.length; index += 1) {
    if (source[index] === "(" || source[index] === "{") depth += 1;
    if (source[index] === ")" || source[index] === "}") {
      depth -= 1;
      if (depth === 0 && source[index] === ")") return source.slice(start, index + 1);
    }
  }
  assert.fail(`${path}: the createGuestRequestHandler call is not closed`);
}

test("AC1 host contract: the Durable Object host passes onAssistantTurn and assistantModelName to createGuestRequestHandler.", () => {
  const call = handlerCallSource("apps/cloudflare/src/shortlet-pilot-do.ts");
  assert.match(call, /\bonAssistantTurn:\s*writeAssistantTurnRecord\b/, "the Durable Object writes each turn record");
  assert.match(call, /\bassistantModelName:\s*configuration\.concierge\.primary\?\.model\b/, "the record names the configured primary model");
});

test("AC1 host contract: the local demo CLI passes onAssistantTurn to its guest server.", () => {
  const source = readFileSync(join(process.cwd(), "apps/local-guest/src/cli-start.ts"), "utf8");
  assert.match(source, /startLocalGuestServer\(\{[^}]*\bonAssistantTurn:\s*writeAssistantTurnRecord\b/s, "the local demo writes turn records too");
});
