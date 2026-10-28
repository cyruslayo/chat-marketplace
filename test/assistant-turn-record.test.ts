import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantTurnRecord } from "../apps/local-guest/src/assistant/assistant-turn-record.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";

// Issue 05: one allow-listed turn record per assistant turn, with OTel GenAI names. Every turn runs with the assistant
// runtime enabled, through a new application over the same store (a cold restore, as each Worker request builds one),
// on the staging-like clock (27 Oct 2026) with a staging-like guest (no seeded phone or email).

const STAGING_DEMO_CHECK_IN = "2026-12-20";
const MODEL_NAME = "openai/gpt-6-luna";
const THREAD = "g-7e57a0000101";
const USER_TEXT = "Find stays in Old Ikoyi";
const VALID_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };
const REPLY_TEXT = JSON.stringify({ kind: "clarify_stay", references: [] });
const CANARY_GUEST = "Ada Lovelace ada.lovelace@example.com +234 801 234 5678";
const CANARY_TOOL = "canary-tool-7f3a";
const CANARY_REPLY = "canary-reply-9d21";

/** The closed allow-list of record keys (issue 05). A record may carry only these keys. */
const ALLOWED_KEYS = [
  "assistant.control_outcome",
  "assistant.duration_ms",
  "assistant.failure_class",
  "assistant.planner_calls",
  "assistant.stop_reason",
  "assistant.tool_calls",
  "assistant.turn_id",
  "assistant.unknown_tool_calls",
  "error.type",
  "event",
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "assistant.tool_names",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
];

function searchResponse(usage?: { promptTokens: number; completionTokens: number }): AssistantModelResponse {
  return { toolCalls: [{ id: "call-search", name: "search_stays", args: VALID_SEARCH }], ...(usage ? { usage } : {}) };
}

function replyResponse(usage?: { promptTokens: number; completionTokens: number }): AssistantModelResponse {
  return { text: REPLY_TEXT, ...(usage ? { usage } : {}), finishReason: "stop" };
}

interface Harness {
  readonly environment: LocalGuestEnvironment;
  readonly records: AssistantTurnRecord[];
  readonly clock: SteppedClock;
  app: LocalGuestApp;
  runtime: ShortletAssistantRuntime;
  close(): void;
}

function wire(environment: LocalGuestEnvironment, model: RecordingTurnModel, records: AssistantTurnRecord[], options: { readonly maxInputCharacters?: number; readonly onTurnRecord?: (record: AssistantTurnRecord) => void } = {}) {
  const runtime = new ShortletAssistantRuntime(environment, model, {
    modelName: MODEL_NAME,
    onTurnRecord: options.onTurnRecord ?? ((record) => records.push(record)),
    ...(options.maxInputCharacters === undefined ? {} : { maxInputCharacters: options.maxInputCharacters }),
  });
  return { runtime, app: new LocalGuestApp(environment, { assistantRuntime: runtime }) };
}

function openHarness(model: RecordingTurnModel, options: { readonly maxInputCharacters?: number } = {}): Harness {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: clock.now,
    demoCheckIn: STAGING_DEMO_CHECK_IN,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const records: AssistantTurnRecord[] = [];
  const first = wire(environment, model, records, options);
  return { environment, records, clock, ...first, close: () => environment.close() };
}

/** A cold restore: a new runtime and application over the same store, built before the next event. */
function restore(harness: Harness, model: RecordingTurnModel, options: { readonly maxInputCharacters?: number } = {}): void {
  const next = wire(harness.environment, model, harness.records, options);
  harness.runtime = next.runtime;
  harness.app = next.app;
}

test("Each turn record uses the OTel GenAI names for operation, model, token usage, tool name and error type where the turn has the value, and only allow-listed keys.", async () => {
  const model = new RecordingTurnModel((_request, index) => index === 0
    ? searchResponse({ promptTokens: 120, completionTokens: 30 })
    : replyResponse({ promptTokens: 40, completionTokens: 10 }));
  const harness = openHarness(model);
  try {
    const response = await harness.app.handleTurn(THREAD, USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(harness.records.length, 1);
    const [record] = harness.records as [AssistantTurnRecord];
    assert.equal(record.event, "assistant.turn.v1");
    assert.equal(record["gen_ai.operation.name"], "chat");
    assert.equal(record["gen_ai.request.model"], MODEL_NAME);
    assert.equal(record["gen_ai.usage.input_tokens"], 160, "the two planner calls' input tokens are summed");
    assert.equal(record["gen_ai.usage.output_tokens"], 40, "the two planner calls' output tokens are summed");
    assert.deepEqual(record["assistant.tool_names"], ["search_stays"]);
    assert.equal(record["assistant.stop_reason"], "reply");
    assert.equal(record["assistant.planner_calls"], 2);
    assert.equal(record["assistant.tool_calls"], 1);
    assert.equal("error.type" in record, false, "a successful turn has no error type");
    assert.deepEqual(Object.keys(record).filter((key) => !ALLOWED_KEYS.includes(key)), [], "no key outside the allow-list");
  } finally { harness.close(); }

  // error.type carries the closed refusal code when the planner fails, and nothing from the error message.
  const failing = new RecordingTurnModel(() => { throw new Error(`provider leaked ${CANARY_TOOL}`); });
  const second = openHarness(failing);
  try {
    const response = await second.app.handleTurn("g-7e57a0000102", USER_TEXT);
    assert.equal(response.ok, false);
    assert.equal(second.records.length, 1);
    const [record] = second.records as [AssistantTurnRecord];
    assert.equal(record["error.type"], response.ok ? undefined : response.code);
    assert.equal(record["assistant.stop_reason"], "error");
    assert.equal(JSON.stringify(record).includes(CANARY_TOOL), false, "the error message never reaches the record");
  } finally { second.close(); }
});

test("A turn record contains only allow-listed fields: personal data in guest text, tool arguments, tool results and replies never appears.", async () => {
  const model = new RecordingTurnModel((_request, index) => index === 0
    ? { toolCalls: [{ id: "call-canary", name: "search_stays", args: { ...VALID_SEARCH, note: `${CANARY_TOOL} ${CANARY_GUEST}` } }] }
    : { text: `${CANARY_REPLY} ${CANARY_GUEST}`, finishReason: "stop" });
  const harness = openHarness(model);
  try {
    await harness.app.handleTurn(THREAD, `${USER_TEXT}. ${CANARY_GUEST}`);
    assert.equal(harness.records.length, 1);
    const serialised = JSON.stringify(harness.records);
    for (const canary of [CANARY_TOOL, CANARY_REPLY, "ada.lovelace@example.com", "801 234 5678", "Ada Lovelace"]) {
      assert.equal(serialised.includes(canary), false, `the record never contains ${canary}`);
    }
    for (const key of Object.keys(harness.records[0] as object)) assert.ok(ALLOWED_KEYS.includes(key), `${key} is on the allow-list`);
  } finally { harness.close(); }
});

test("Each turn writes exactly one record, including a turn refused before the planner loop and a turn whose planner fails.", async () => {
  const model = new RecordingTurnModel((_request, index) => index === 0 ? searchResponse() : replyResponse());
  const harness = openHarness(model, { maxInputCharacters: 24 });
  try {
    // Refused before the planner loop: the text is longer than the configured input bound.
    const refused = await harness.app.handleTurn(THREAD, "Find stays in Old Ikoyi for four nights");
    assert.equal(harness.records.length, 1, "a turn refused before the planner loop writes one record");
    assert.equal(harness.records[0]?.["assistant.planner_calls"], 0);
    assert.ok(harness.records[0]?.["assistant.control_outcome"], "the refusal carries its closed control outcome");
    assert.notEqual(refused.ok, undefined);

    // A normal turn after a cold restore writes its own record.
    restore(harness, model);
    await harness.app.handleTurn("g-7e57a0000103", "Hi");
    assert.equal(harness.records.length, 2, "one record per turn across a cold restore");
  } finally { harness.close(); }

  const failing = new RecordingTurnModel(() => { throw new Error("provider down"); });
  const planned = openHarness(failing);
  try {
    await planned.app.handleTurn("g-7e57a0000104", USER_TEXT);
    assert.equal(planned.records.length, 1, "a turn whose planner fails writes exactly one record");
    assert.equal(planned.records[0]?.["assistant.stop_reason"], "error");
  } finally { planned.close(); }
});

test("Each record carries a fresh run id (UUID v4) distinct on every turn and never equal to a thread, booking, payment, guest or session id.", async () => {
  const model = new RecordingTurnModel((_request, index) => index % 2 === 0 ? searchResponse() : replyResponse());
  const harness = openHarness(model);
  try {
    await harness.app.handleTurn(THREAD, USER_TEXT);
    await harness.app.handleTurn(THREAD, "Show me another stay");
    const [first, second] = harness.records;
    assert.equal(harness.records.length, 2);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(first?.["assistant.turn_id"] ?? "", uuid);
    assert.match(second?.["assistant.turn_id"] ?? "", uuid);
    assert.notEqual(first?.["assistant.turn_id"], second?.["assistant.turn_id"], "each turn has its own run id");
    const domainIds = [THREAD, harness.environment.config.guestId, harness.environment.config.tenantId];
    for (const record of harness.records) {
      assert.equal(domainIds.includes(record["assistant.turn_id"]), false, "the run id is not a thread, guest or tenant id");
    }
  } finally { harness.close(); }
});

test("A sink that throws never changes the turn's response, and the failure is counted on the drop counter.", async () => {
  const model = new RecordingTurnModel((_request, index) => index === 0 ? searchResponse() : replyResponse());
  const plain = openHarness(model);
  const throwing = openHarness(new RecordingTurnModel((_request, index) => index === 0 ? searchResponse() : replyResponse()));
  try {
    const expected = await plain.app.handleTurn(THREAD, USER_TEXT);
    const sinkThrows = wire(throwing.environment, new RecordingTurnModel((_request, index) => index === 0 ? searchResponse() : replyResponse()), [], {
      onTurnRecord: () => { throw new Error("sink unavailable"); },
    });
    const actual = await sinkThrows.app.handleTurn(THREAD, USER_TEXT);
    assert.deepEqual(actual, expected, "the turn's response is unchanged by a failing sink");
    assert.equal(sinkThrows.runtime.turnRecordDropCount, 1, "the failed record is counted, not lost silently");
  } finally { plain.close(); throwing.close(); }
});

test("Token usage is the sum of the planner calls that reported usage, and is absent when no call reported usage.", async () => {
  const withUsage = openHarness(new RecordingTurnModel((_request, index) => index === 0
    ? searchResponse({ promptTokens: 100, completionTokens: 7 })
    : replyResponse()));
  try {
    await withUsage.app.handleTurn(THREAD, USER_TEXT);
    const [record] = withUsage.records as [AssistantTurnRecord];
    assert.equal(record["gen_ai.usage.input_tokens"], 100, "only the call that reported usage is counted");
    assert.equal(record["gen_ai.usage.output_tokens"], 7);
  } finally { withUsage.close(); }

  const withoutUsage = openHarness(new RecordingTurnModel((_request, index) => index === 0 ? searchResponse() : replyResponse()));
  try {
    await withoutUsage.app.handleTurn(THREAD, USER_TEXT);
    const [record] = withoutUsage.records as [AssistantTurnRecord];
    assert.equal("gen_ai.usage.input_tokens" in record, false, "no usage is reported when no call supplied it");
    assert.equal("gen_ai.usage.output_tokens" in record, false);
  } finally { withoutUsage.close(); }
});

test("A tool name the planner proposes that no pack registers is counted and never written to the record.", async () => {
  const unknown = `shell-${CANARY_TOOL}`;
  const model = new RecordingTurnModel((_request, index) => index === 0
    ? { toolCalls: [{ id: "call-unknown", name: unknown, args: {} }] }
    : replyResponse());
  const harness = openHarness(model);
  try {
    await harness.app.handleTurn(THREAD, USER_TEXT);
    const [record] = harness.records as [AssistantTurnRecord];
    assert.equal(record["assistant.unknown_tool_calls"], 1);
    assert.equal(JSON.stringify(record).includes(unknown), false, "an unregistered tool name is not written");
    assert.equal("assistant.tool_names" in record, false, "no registered tool was proposed");
  } finally { harness.close(); }
});

/** An environment whose clock is `clock`, so a test can make the clock fail on a chosen call. */
function openWithClock(clock: () => Date, model: RecordingTurnModel): { environment: LocalGuestEnvironment; records: AssistantTurnRecord[]; app: LocalGuestApp; runtime: ShortletAssistantRuntime; close(): void } {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock,
    demoCheckIn: STAGING_DEMO_CHECK_IN,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const records: AssistantTurnRecord[] = [];
  const wired = wire(environment, model, records);
  return { environment, records, ...wired, close: () => environment.close() };
}

test("A sink that returns a rejected promise is counted as a drop: the answer is unchanged and no unhandled rejection is raised.", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const plan = (_request: unknown, index: number): AssistantModelResponse => (index === 0 ? searchResponse() : replyResponse());
  const plain = openHarness(new RecordingTurnModel(plan));
  const rejecting = openWithClock(new SteppedClock(STAGING_LIKE_START).now, new RecordingTurnModel(plan));
  try {
    const expected = await plain.app.handleTurn(THREAD, USER_TEXT);
    const rejectingRuntime = new ShortletAssistantRuntime(rejecting.environment, new RecordingTurnModel(plan), {
      modelName: MODEL_NAME,
      onTurnRecord: async () => { throw new Error("canary-sink-rejection"); },
    });
    const actual = await new LocalGuestApp(rejecting.environment, { assistantRuntime: rejectingRuntime }).handleTurn(THREAD, USER_TEXT);
    assert.deepEqual(actual, expected, "the answer is unchanged by a sink that rejects");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejectingRuntime.turnRecordDropCount, 1, "the rejected record is counted once");
    assert.deepEqual(unhandled, [], "a rejected sink promise is handled, never an unhandled rejection");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    plain.close();
    rejecting.close();
  }
});

test("A usage count a provider reports as a non-count value is treated as absent, and its text never reaches the record.", async () => {
  const canary = "canary-usage-5b1e";
  const model = new RecordingTurnModel((_request, index) => index === 0
    ? { toolCalls: [{ id: "call-usage", name: "search_stays", args: VALID_SEARCH }], usage: { promptTokens: 100, completionTokens: 7 } }
    : { text: REPLY_TEXT, finishReason: "stop", usage: { promptTokens: -3, completionTokens: canary } } as unknown as AssistantModelResponse);
  const harness = openHarness(model);
  try {
    await harness.app.handleTurn(THREAD, USER_TEXT);
    const [record] = harness.records as [AssistantTurnRecord];
    assert.equal(record["gen_ai.usage.input_tokens"], 100, "a negative count is dropped; the valid count stays");
    assert.equal(record["gen_ai.usage.output_tokens"], 7, "a string count is dropped; the valid count stays");
    assert.equal(JSON.stringify(record).includes(canary), false, "the canary usage never reaches the record");
  } finally { harness.close(); }

  const onlyInvalid = openHarness(new RecordingTurnModel(() => ({ text: REPLY_TEXT, finishReason: "stop", usage: { promptTokens: -3, completionTokens: canary } } as unknown as AssistantModelResponse)));
  try {
    await onlyInvalid.app.handleTurn(THREAD, USER_TEXT);
    const [record] = onlyInvalid.records as [AssistantTurnRecord];
    assert.equal("gen_ai.usage.input_tokens" in record, false, "no valid count means no count is written, never zero");
    assert.equal("gen_ai.usage.output_tokens" in record, false);
  } finally { onlyInvalid.close(); }
});


/**
 * A clock that can be armed after the environment opens (opening reads the clock too). Once armed, every read is counted, and a
 * read fails when `fails(call)` is true, with `message` as the error text.
 */
function armableClock(fails: (call: number) => boolean, message: string): { now: () => Date; arm: () => void } {
  const base = new SteppedClock(STAGING_LIKE_START);
  let armed = false;
  let calls = 0;
  return {
    now: (): Date => {
      if (!armed) return base.now();
      calls += 1;
      if (fails(calls)) throw new Error(message);
      return base.now();
    },
    arm: () => { armed = true; },
  };
}

test("A turn whose clock fails after the run starts still writes exactly one record: runtime_exception, no stop reason and no message.", async () => {
  const canary = "canary-clock-2c9a";
  // The first read after arming starts the run; from the second read on, every read throws, so the turn fails in its own body.
  const clock = armableClock((call) => call >= 2, canary);
  const harness = openWithClock(clock.now, new RecordingTurnModel(() => replyResponse()));
  try {
    clock.arm();
    await assert.rejects(harness.app.handleTurn(THREAD, USER_TEXT));
    assert.equal(harness.records.length, 1, "a thrown turn writes exactly one record");
    const [record] = harness.records as [AssistantTurnRecord];
    assert.equal(record["error.type"], "runtime_exception");
    assert.equal("assistant.stop_reason" in record, false, "a thrown turn has no stop reason");
    assert.equal(JSON.stringify(record).includes(canary), false, "the thrown message never reaches the record");
  } finally { harness.close(); }
});

test("A clock that fails on the first read never changes the answer: the turn answers as it does with a working clock.", async () => {
  const working = openHarness(new RecordingTurnModel(() => replyResponse()));
  const clock = armableClock((call) => call === 1, "canary-first-clock");
  const failingFirst = openWithClock(clock.now, new RecordingTurnModel(() => replyResponse()));
  try {
    const expected = await working.app.handleTurn(THREAD, USER_TEXT);
    clock.arm();
    const actual = await failingFirst.app.handleTurn(THREAD, USER_TEXT);
    assert.deepEqual(actual, expected, "a failing run-start clock never changes the answer");
    assert.equal(failingFirst.records.length, 1, "the turn still writes its record");
  } finally { working.close(); failingFirst.close(); }
});

test("error.type is a closed set: a refusal code outside it is written as other_refusal, and THREAD_BUSY and CONCIERGE_UNAVAILABLE are kept.", async () => {
  const { AssistantTurnRun } = await import("../apps/local-guest/src/assistant/assistant-turn-record.js");
  const run = new AssistantTurnRun({ runId: "00000000-0000-4000-8000-000000000001", startedAtMs: 0, forward: () => undefined, isRegisteredTool: () => false });
  const typed = (code: string) => run.toRecord({ output: { ok: false, code }, threw: false, endedAtMs: 0 })["error.type"];
  assert.equal(typed("canary-refusal-code-7e"), "other_refusal", "an unknown code is never written as is");
  assert.equal(typed("THREAD_BUSY"), "THREAD_BUSY");
  assert.equal(typed("CONCIERGE_UNAVAILABLE"), "CONCIERGE_UNAVAILABLE");
  assert.equal(typed("STALE_SURFACE"), "STALE_SURFACE");
});
