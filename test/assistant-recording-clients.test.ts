import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse, AssistantToolDefinition } from "../apps/local-guest/src/assistant/assistant-model.js";
import {
  AssistantReplayDivergenceError,
  RecordingModelClient,
  ReplayModelClient,
  assertLocalFixtureDatabase,
  neutralRequest,
  type RecordedExchange,
} from "../apps/local-guest/src/assistant/assistant-recording.js";
import { RECORDINGS_DIRECTORY } from "./helpers/assistant-recordings.js";
import { DEFAULT_LOCAL_GUEST_CONFIG } from "../apps/local-guest/src/fixture.js";
import { credentialFindings, isInsideOrSame } from "../scripts/record-assistant-journey.js";

// Unit tests for the recording and replay clients (issue 03), with the record script's refusal (AC4).

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SEARCH_TOOL: AssistantToolDefinition = {
  name: "search_stays",
  description: "Search stays.",
  category: "read",
  parametersSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false },
};
const SYSTEM_MARKER = "SYSTEM-INSTRUCTION-MARKER-DO-NOT-RECORD";
const RAW_MARKER = "RAW-PROVIDER-STEP-MARKER-DO-NOT-RECORD";

/** A provider stand-in that returns a reply with a raw provider step attached, as a real adapter does. */
function providerReturning(text: string): AssistantModelClient {
  return {
    generate: async (): Promise<AssistantModelResponse> => ({
      text,
      rawStep: { provider: RAW_MARKER },
      usage: { promptTokens: 12, completionTokens: 3 },
      finishReason: "stop",
    }),
  };
}

function requestWith(history: AssistantModelRequest["history"], tools: readonly AssistantToolDefinition[] = [SEARCH_TOOL]): AssistantModelRequest {
  return { systemInstruction: SYSTEM_MARKER, tools, history };
}

test("A recording stores only provider-neutral request and response fields, and contains no rawStep, system instruction or credential.", async () => {
  const recorder = new RecordingModelClient(providerReturning("Here are the results."));
  await recorder.generate(requestWith([
    { role: "user", text: "Find a stay in Ikoyi" },
    { role: "assistant", text: "Checking.", rawStep: { provider: RAW_MARKER } },
    { role: "tool_calls", calls: [{ id: "c1", name: "search_stays", args: { city: "Lagos" } }], rawStep: { provider: RAW_MARKER } },
    { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: { resultCount: 1 } }] },
  ]));
  const serialised = JSON.stringify(recorder.exchanges);
  assert.doesNotMatch(serialised, /rawStep|RAW-PROVIDER-STEP|SYSTEM-INSTRUCTION|systemInstruction|apiKey|api_key|authorization|bearer/i);
  const exchange = recorder.exchanges[0]!;
  assert.deepEqual(Object.keys(exchange).sort(), ["request", "response"]);
  assert.deepEqual(Object.keys(exchange.request).sort(), ["history", "toolNames"]);
  assert.deepEqual(exchange.request.toolNames, ["search_stays"]);
  assert.deepEqual(Object.keys(exchange.response).sort(), ["finishReason", "text", "usage"]);

  // Every committed recording keeps the same neutral shape and no secret-like field.
  const committed = readdirSync(RECORDINGS_DIRECTORY).filter((file) => file.endsWith(".json"));
  assert.equal(committed.length, 4, "the four named journeys are committed");
  for (const file of committed) {
    const text = readFileSync(join(RECORDINGS_DIRECTORY, file), "utf8");
    assert.doesNotMatch(text, /rawStep|systemInstruction|apiKey|api_key|authorization|bearer|LLM_API_KEY/i, `${file} holds no raw step, instruction or credential`);
    const parsed = JSON.parse(text) as { exchanges: RecordedExchange[] };
    for (const item of parsed.exchanges) {
      assert.deepEqual(Object.keys(item).sort(), ["request", "response"], `${file}: exchange keys`);
      assert.ok(Object.keys(item.request).every((key) => ["toolNames", "structuredOutputName", "history"].includes(key)), `${file}: request keys`);
      assert.ok(Object.keys(item.response).every((key) => ["text", "toolCalls", "finishReason", "usage"].includes(key)), `${file}: response keys`);
    }
  }
});

test("Replay fails with an error naming the step when the runtime's request diverges from the recording.", async () => {
  // Record two exchanges: a search, then a reply to the tool result.
  const recorder = new RecordingModelClient(providerReturning("Reply one."));
  await recorder.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }]));
  await recorder.generate(requestWith([
    { role: "user", text: "Find a stay in Ikoyi" },
    { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: {} }] },
  ]));
  const exchanges = recorder.exchanges;

  // The matching sequence replays in order.
  const matching = new ReplayModelClient(exchanges);
  await matching.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }]));
  await matching.generate(requestWith([
    { role: "user", text: "Find a stay in Ikoyi" },
    { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: {} }] },
  ]));
  assert.equal(matching.remaining, 0);
  matching.assertFaithful();

  // A different tool offered at step 1 fails and names that step.
  const toolDiverges = new ReplayModelClient(exchanges);
  await toolDiverges.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }]));
  const otherTool: AssistantToolDefinition = { ...SEARCH_TOOL, name: "get_booking_status" };
  await assert.rejects(
    toolDiverges.generate(requestWith([
      { role: "user", text: "Find a stay in Ikoyi" },
      { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: {} }] },
    ], [otherTool])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 1 && /step 2/.test(error.message) && /tools offered differ/.test(error.message),
  );

  // A history whose tool-call names differ fails at the step where they first differ.
  const historyDiverges = new ReplayModelClient(exchanges);
  await assert.rejects(
    historyDiverges.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }, { role: "tool_calls", calls: [{ id: "c9", name: "compare_stays", args: {} }] }])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 0 && /step 1/.test(error.message),
  );

  // A call after the recording ends names the step it could not answer.
  const exhausted = new ReplayModelClient(exchanges.slice(0, 1));
  await exhausted.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }]));
  await assert.rejects(
    exhausted.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 1 && /after the recording ended/.test(error.message),
  );

  // A runtime that catches the divergence still cannot pass: the first divergence is kept and rethrown.
  assert.throws(() => toolDiverges.assertFaithful(), (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 1);
});

test("The record script refuses to run against anything other than the local fixture database.", async () => {
  // The guard accepts the in-memory fixture and the default local guest fixture file, and nothing else.
  const fixturePath = DEFAULT_LOCAL_GUEST_CONFIG.databasePath;
  assert.doesNotThrow(() => assertLocalFixtureDatabase(":memory:", fixturePath));
  assert.doesNotThrow(() => assertLocalFixtureDatabase(fixturePath, fixturePath));
  for (const refused of ["staging.sqlite", "/var/lib/shortlet/production.sqlite", ".scratch/local-guest/other.sqlite", ""]) {
    assert.throws(() => assertLocalFixtureDatabase(refused, fixturePath), /Recording refused: .* is not the local fixture database/);
  }

  // The script itself stops before it opens a database or writes a recording.
  const directory = mkdtempSync(join(tmpdir(), "record-refusal-"));
  try {
    const refusedDatabase = join(directory, "refused-recording.sqlite");
    const outcome = await new Promise<{ code: number | null; stderr: string }>((done) => {
      execFile(process.execPath, [
        "--import", "tsx", join(REPOSITORY_ROOT, "scripts", "record-assistant-journey.ts"),
        "missing-information-clarification", "--database", refusedDatabase, "--out", directory,
      ], { cwd: REPOSITORY_ROOT, timeout: 120_000 }, (error, _stdout, stderr) => {
        done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr: String(stderr) });
      });
    });
    assert.notEqual(outcome.code, 0, "the script exits with a failure");
    assert.match(outcome.stderr, /Recording refused/);
    assert.equal(existsSync(refusedDatabase), false, "no database file is created");
    assert.equal(readdirSync(directory).filter((file) => file.endsWith(".json")).length, 0, "no recording is written");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ReplayModelClient answers with neutral fields only and asks the attempt hook before each answer.", async () => {
  const recorder = new RecordingModelClient(providerReturning("Hello."));
  await recorder.generate(requestWith([{ role: "user", text: "Hi" }]));
  const replay = new ReplayModelClient(recorder.exchanges);
  let hooked = 0;
  const response = await replay.generate({ ...requestWith([{ role: "user", text: "Hi" }]), beforeProviderAttempt: async () => { hooked++; } });
  assert.equal(response.text, "Hello.");
  assert.equal("rawStep" in response, false, "a replayed response never carries a raw provider step");
  assert.equal(hooked, 1);
  assert.equal(replay.supportsProviderAttemptReservation, true);
  assert.deepEqual(neutralRequest(requestWith([{ role: "user", text: "Hi" }])).toolNames, ["search_stays"]);
});

test("Replay comparison fails when only tool-call arguments or tool-result payloads change.", async () => {
  const recorder = new RecordingModelClient(providerReturning("Reply."));
  await recorder.generate(requestWith([
    { role: "user", text: "Find a stay" },
    { role: "tool_calls", calls: [{ id: "c1", name: "search_stays", args: { city: "Lagos" } }] },
  ]));
  await recorder.generate(requestWith([
    { role: "user", text: "Find a stay" },
    { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: { resultCount: 1 } }] },
  ]));
  const [argsRecorded, resultRecorded] = recorder.exchanges;
  const argsReplay = new ReplayModelClient([argsRecorded!]);
  await assert.rejects(
    argsReplay.generate(requestWith([
      { role: "user", text: "Find a stay" },
      { role: "tool_calls", calls: [{ id: "c1", name: "search_stays", args: { city: "Abuja" } }] },
    ])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 0,
  );
  const resultReplay = new ReplayModelClient([resultRecorded!]);
  await assert.rejects(
    resultReplay.generate(requestWith([
      { role: "user", text: "Find a stay" },
      { role: "tool_results", results: [{ callId: "c1", name: "search_stays", result: { resultCount: 2 } }] },
    ])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 0,
  );
});

test("Replay comparison fails on a same-length history whose text differs.", async () => {
  const recorder = new RecordingModelClient(providerReturning("Reply."));
  await recorder.generate(requestWith([{ role: "user", text: "Find a stay in Ikoyi" }]));
  const replay = new ReplayModelClient(recorder.exchanges);
  // "Ikoyi" and "Yaba" are both five characters: only the text differs, not the length or the roles.
  await assert.rejects(
    replay.generate(requestWith([{ role: "user", text: "Find a stay in Yaba" }])),
    (error: unknown) => error instanceof AssistantReplayDivergenceError && error.step === 0 && /history roles, text/.test(error.message),
  );
  assert.equal(replay.remaining, 1, "a diverged call does not consume the recorded step");
});

test("The record script refuses a recording whose text carries credential-like content, and names only the pattern.", () => {
  assert.deepEqual(credentialFindings('{"turns":[{"messages":["Hello"]}]}'), []);
  assert.deepEqual(credentialFindings('{"header":"Bearer abcdefghijklmnop"}'), ["bearer token"]);
  assert.deepEqual(credentialFindings('{"header":"Authorization: none"}'), ["authorization header"]);
  const configured = "configured-key-value-123";
  assert.deepEqual(credentialFindings(`{"note":"${configured}"}`, [configured]), ["configured provider key value"]);
  // The finding is a pattern name; the matched text itself is never returned.
  assert.ok(credentialFindings('{"x":"sk-abcdefghijk"}').every((name) => !name.includes("sk-")));
});

test("Live recording needs an explicit --out directory outside test/fixtures, and never overwrites committed recordings.", async () => {
  const directory = mkdtempSync(join(tmpdir(), "live-out-refusal-"));
  const run = (args: string[]) => new Promise<{ code: number | null; stderr: string }>((done) => {
    execFile(process.execPath, ["--import", "tsx", join(REPOSITORY_ROOT, "scripts", "record-assistant-journey.ts"), ...args], { cwd: REPOSITORY_ROOT, timeout: 120_000, env: { ...process.env, ASSISTANT_RECORD_LIVE: "1" } }, (error, _stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr: String(stderr) });
    });
  });
  try {
    const missing = await run(["missing-information-clarification"]);
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /needs an explicit --out directory/);
    const inside = await run(["missing-information-clarification", "--out", RECORDINGS_DIRECTORY]);
    assert.notEqual(inside.code, 0);
    assert.match(inside.stderr, /outside test[\/]fixtures/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Live recording refuses an --out inside test/fixtures, including a name such as ..x, a subdirectory and a junction into it.", async () => {
  const fixtures = resolve(RECORDINGS_DIRECTORY, "..");
  // Name-level checks: `..x` is a name inside the fixtures, not a step out of them.
  assert.equal(isInsideOrSame(join(fixtures, "..x"), fixtures), true);
  assert.equal(isInsideOrSame(join(fixtures, "assistant-recordings"), fixtures), true);
  assert.equal(isInsideOrSame(fixtures, fixtures), true);
  assert.equal(isInsideOrSame(resolve(fixtures, ".."), fixtures), false);
  assert.equal(isInsideOrSame(join(fixtures, "..", "elsewhere"), fixtures), false);

  const directory = mkdtempSync(join(tmpdir(), "live-out-junction-"));
  const junction = join(directory, "into-fixtures");
  symlinkSync(fixtures, junction, "junction");
  const run = (out: string) => new Promise<{ code: number | null; stderr: string }>((done) => {
    execFile(process.execPath, ["--import", "tsx", join(REPOSITORY_ROOT, "scripts", "record-assistant-journey.ts"), "missing-information-clarification", "--out", out], { cwd: REPOSITORY_ROOT, timeout: 120_000, env: { ...process.env, ASSISTANT_RECORD_LIVE: "1" } }, (error, _stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr: String(stderr) });
    });
  });
  try {
    for (const out of [join(fixtures, "..x"), join(fixtures, "assistant-recordings"), fixtures, junction, join(junction, "nested")]) {
      const outcome = await run(out);
      assert.notEqual(outcome.code, 0, `refused: ${out}`);
      assert.match(outcome.stderr, /outside test[\/]fixtures/, `named refusal for ${out}`);
    }
  } finally {
    rmdirSync(junction);
    rmSync(directory, { recursive: true, force: true });
  }
});
