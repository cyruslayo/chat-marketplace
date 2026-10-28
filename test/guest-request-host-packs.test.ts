import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createGuestRequestHandler, type GuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { CapturedResponse } from "./helpers/http-like.js";
import { createFakeHttpRequest, createFakeHttpResponse } from "./helpers/http-like.js";
import { withProviderAttemptHook } from "./helpers/assistant-attempt-model.js";
import { STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";

/**
 * Host coverage (ADR 0099 section 6, issue 04 follow-up). Each concierge mode that guest-server.ts builds a runtime for runs one
 * Shortlet turn through createGuestRequestHandler. A host that drops the Shortlet pack fails here: the search tool is not offered.
 * The modes use the scripted model (no provider, no secrets). The session-scoped turn goes through the per-session runtime, the
 * other through the default application.
 */

const DEMO_CHECK_IN = "2026-12-20";
const TURN_TEXT = "Find stays in Old Ikoyi for 4 nights for 2 guests";

async function send(handler: GuestRequestHandler, method: string, url: string, headers: Record<string, string> = {}, body?: unknown): Promise<CapturedResponse> {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const request = createFakeHttpRequest({
    method,
    url,
    headers: bytes === undefined ? headers : { ...headers, "content-type": "application/json", "content-length": String(bytes.length) },
    ...(bytes === undefined ? {} : { body: bytes }),
  });
  const { response, finished } = createFakeHttpResponse();
  const handled = handler.handle(request, response);
  const captured = await Promise.race([finished, handled.then(() => finished)]);
  await handled;
  return captured;
}

function jsonBody(captured: CapturedResponse): { ok?: boolean; surfaces?: { surfaceId: string }[]; controlOutcome?: string } {
  return JSON.parse(captured.body.toString("utf8")) as { ok?: boolean; surfaces?: { surfaceId: string }[]; controlOutcome?: string };
}

for (const conciergeMode of ["assistant-offline", "openai-compatible", "gemini"] as const) {
  test(`a ${conciergeMode} host runs a Shortlet search on the anonymous path (the default application's runtime)`, async () => {
    const environment = LocalGuestEnvironment.openNode({
      databasePath: ":memory:",
      clock: new SteppedClock(STAGING_LIKE_START).now,
      demoCheckIn: DEMO_CHECK_IN,
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
    });
    const handler = createGuestRequestHandler({
      environment,
      conciergeMode,
      modelClient: withProviderAttemptHook(new ScriptedAssistantModel()),
    });
    try {
      const captured = await send(handler, "POST", "/api/turn", {}, { threadId: `g-${randomUUID()}`, text: TURN_TEXT });
      assert.equal(captured.statusCode, 200);
      const body = jsonBody(captured);
      assert.equal(body.ok, true, captured.body.toString("utf8").slice(0, 400));
      assert.match(body.surfaces?.[0]?.surfaceId ?? "", /:discovery:/, captured.body.toString("utf8").slice(0, 700));
    } finally { environment.close(); }
  });

  test(`a ${conciergeMode} host runs a Shortlet search for a session-scoped guest (the per-session runtime)`, async () => {
    const environment = LocalGuestEnvironment.openNode({
      databasePath: ":memory:",
      clock: new SteppedClock(STAGING_LIKE_START).now,
      demoCheckIn: DEMO_CHECK_IN,
      initialGuestPhoneNumber: null,
      initialGuestContactEmail: null,
    });
    const handler = createGuestRequestHandler({
      environment,
      conciergeMode,
      modelClient: withProviderAttemptHook(new ScriptedAssistantModel()),
      sessionScopedGuestPrincipals: true,
      sessionRuntimeIdleMs: 60_000,
    });
    try {
      const home = await send(handler, "GET", "/");
      const setCookie = home.headers.find((header) => header.name.toLowerCase() === "set-cookie")?.value ?? "";
      const cookie = setCookie.split(";")[0] ?? "";
      assert.match(cookie, /=/, "the home page issues a browser session cookie");
      const captured = await send(handler, "POST", "/api/turn", { cookie }, { threadId: `g-${randomUUID()}`, text: TURN_TEXT });
      assert.equal(captured.statusCode, 200);
      const body = jsonBody(captured);
      assert.equal(body.ok, true, captured.body.toString("utf8").slice(0, 400));
      assert.match(body.surfaces?.[0]?.surfaceId ?? "", /:discovery:/, captured.body.toString("utf8").slice(0, 700));
    } finally { environment.close(); }
  });
}
