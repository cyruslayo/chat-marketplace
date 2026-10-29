import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { SERVER_TURN_MAX_MS } from "../apps/local-guest/src/turn-budget.js";
import {
  AssistantRuntime,
  DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS,
  DEFAULT_ASSISTANT_TURN_DEADLINE_MS,
  type AssistantDiagnosticEvent,
  type AssistantRuntimeOptions,
} from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock, threadSnapshot } from "./helpers/assistant-turn-model.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";

// On the staging-like clock the fixture's demo check-in is set inside the booking horizon; a null check-in resolves to it.
const STAGING_DEMO_CHECK_IN = "2026-12-20";
const VALID_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };
const REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
const SEARCH: AssistantModelResponse = { toolCalls: [{ id: "call-stop-search", name: "search_stays", args: VALID_SEARCH }] };
const USER_TEXT = "Find stays in Old Ikoyi";

/** The exact `turn_stop` event a planner turn must emit once: nothing else, in this shape. */
function stop(round: number, stopReason: string, succeeded: boolean) {
  return { stage: "turn_stop", round, succeeded, stopReason };
}

function stopEvents(diagnostics: readonly AssistantDiagnosticEvent[]) {
  return diagnostics.filter((event) => event.stage === "turn_stop");
}

/**
 * A staging-like guest (no seeded phone or email, as shortlet-pilot-do.ts starts it) on the staging-like clock. The runtime
 * and the application are built over the store the way a Worker request builds them (a cold restore), so every turn here
 * runs on a restored application. No stop-reason test needs the seeded default guest: the turn-stop contract does not
 * depend on contact details, and the staging guest is the one the browser actually meets.
 */
function openTurnRuntime(model: RecordingTurnModel, clock: SteppedClock, options: AssistantRuntimeOptions = {}) {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: clock.now,
    demoCheckIn: STAGING_DEMO_CHECK_IN,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new ShortletAssistantRuntime(environment, model, { ...options, onDiagnostic: (event) => diagnostics.push(event) });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime });
  return { environment, runtime, app, diagnostics };
}

test("A turn the model answers without tool calls reports stop reason `reply`.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const model = new RecordingTurnModel(() => REPLY);
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock);
  try {
    const response = await runtime.handleTurn("stop-reply", USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(response.stopReason, "reply");
    assert.equal(model.plannerRequests.length, 1);
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "reply", true)]);
  } finally { environment.close(); }

  // A reply after a tool round is still a reply: the tool calls do not make the turn a round limit.
  const withToolRound = new RecordingTurnModel((_request, index) => index === 0 ? SEARCH : REPLY);
  const second = openTurnRuntime(withToolRound, new SteppedClock(STAGING_LIKE_START));
  try {
    const response = await second.runtime.handleTurn("stop-reply-after-tool", USER_TEXT);
    assert.equal(response.stopReason, "reply");
    assert.equal(withToolRound.plannerRequests.length, 2);
    assert.deepEqual(stopEvents(second.diagnostics), [stop(2, "reply", true)]);
  } finally { second.environment.close(); }
});

test("A turn that reaches the round cap reports stop reason `round_limit` and makes exactly one summary call with no tools.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // Every planner request offers tools and asks for a search, so only the summary call can end the turn.
  const model = new RecordingTurnModel((request) => request.tools.length === 0 ? REPLY : SEARCH);
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock);
  try {
    const response = await runtime.handleTurn("stop-round-limit", USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(response.stopReason, "round_limit");
    const planner = model.plannerRequests;
    assert.equal(planner.length, MAX_ASSISTANT_TOOL_ROUNDS + 1);
    assert.equal(planner.filter((request) => request.tools.length === 0).length, 1, "exactly one summary call carries no tools");
    assert.equal(planner.at(-1)?.tools.length, 0, "the tool-free call is the summary, made last");
    assert.deepEqual(stopEvents(diagnostics), [stop(MAX_ASSISTANT_TOOL_ROUNDS + 1, "round_limit", true)]);
  } finally { environment.close(); }
});

test("The summary call after the round cap is made with the configured model-call timeout.", async () => {
  const configured = 7_000;
  const clock = new SteppedClock(STAGING_LIKE_START);
  const model = new RecordingTurnModel((request) => request.tools.length === 0 ? REPLY : SEARCH);
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { modelCallTimeoutMs: configured });
  try {
    const response = await runtime.handleTurn("stop-summary-timeout", USER_TEXT);
    assert.equal(response.stopReason, "round_limit");
    const summary = model.plannerRequests.at(-1) as AssistantModelRequest;
    assert.equal(summary.tools.length, 0);
    assert.equal(summary.timeoutMs, configured, "the summary call takes the configured timeout, not the adapter default");
    assert.ok(model.plannerRequests.every((request) => request.timeoutMs === configured), "planner calls take the same configured timeout");
    assert.deepEqual(stopEvents(diagnostics), [stop(MAX_ASSISTANT_TOOL_ROUNDS + 1, "round_limit", true)]);
  } finally { environment.close(); }
});

test("A turn that passes the turn deadline before any application operation reports `turn_deadline`, starts no further model call and leaves the thread unchanged.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // The scope stage spends 2 s against a 1 s turn deadline, so the planner must never be called.
  const model = new RecordingTurnModel(() => REPLY, () => clock.advance(2_000));
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 1_000 });
  try {
    const before = threadSnapshot(runtime.getThread("stop-deadline-before"));
    const response = await runtime.handleTurn("stop-deadline-before", USER_TEXT);
    assert.equal(response.ok, false);
    assert.equal(response.code, "CONCIERGE_UNAVAILABLE");
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(model.plannerRequests.length, 0, "no planner request starts after the deadline");
    assert.equal(diagnostics.filter((event) => event.stage === "application_operation").length, 0);
    assert.equal(threadSnapshot(runtime.getThread("stop-deadline-before")), before);
    // Round 0: the deadline fired before the first planner call.
    assert.deepEqual(stopEvents(diagnostics), [stop(0, "turn_deadline", false)]);
  } finally { environment.close(); }
});

test("A turn that passes the turn deadline after an application operation keeps that operation's state and surfaces.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // The first planner request spends 2 s and then asks for a search; the search runs. The second request must never start.
  const model = new RecordingTurnModel((_request, index) => {
    if (index === 0) {
      clock.advance(2_000);
      return SEARCH;
    }
    return REPLY;
  });
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 1_000 });
  try {
    const response = await runtime.handleTurn("stop-deadline-after", USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(model.plannerRequests.length, 1, "no planner request starts after the deadline");
    assert.equal(diagnostics.filter((event) => event.stage === "application_operation" && event.succeeded).length, 1);
    assert.ok(response.surfaces?.length, "the operation's surface is returned through the projected-operation fallback");
    const thread = runtime.getThread("stop-deadline-after");
    assert.equal(thread.activeSurfaces.get("discovery"), response.surfaces?.[0]?.surfaceId, "the operation's surface is committed to the thread");
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "turn_deadline", false)]);
  } finally { environment.close(); }
});

test("A turn that passes the turn deadline after an operation with no surface takes the rollback path and leaves the thread unchanged.", async () => {
  // Decision (issue 02 Comments): the projected-operation fallback needs a surface, so a read-only operation with none
  // rolls back exactly as a provider failure does.
  const clock = new SteppedClock(STAGING_LIKE_START);
  const model = new RecordingTurnModel((_request, index) => {
    if (index === 0) {
      clock.advance(2_000);
      return { toolCalls: [{ id: "call-stop-status", name: "get_booking_status", args: {} }] };
    }
    return REPLY;
  });
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 1_000 });
  try {
    const before = threadSnapshot(runtime.getThread("stop-deadline-no-surface"));
    const response = await runtime.handleTurn("stop-deadline-no-surface", "Am I booked?");
    assert.equal(response.ok, false);
    assert.equal(response.code, "CONCIERGE_UNAVAILABLE");
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(model.plannerRequests.length, 1, "no planner request starts after the deadline");
    assert.equal(diagnostics.filter((event) => event.stage === "application_operation" && event.succeeded).length, 1, "the read ran before the deadline");
    assert.equal(threadSnapshot(runtime.getThread("stop-deadline-no-surface")), before);
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "turn_deadline", false)]);
  } finally { environment.close(); }
});

test("A turn that passes the turn deadline before the summary call starts no summary call and reports `turn_deadline`.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // The last planner round takes 2 s against a 1 s deadline, so the post-cap summary call must not start.
  const model = new RecordingTurnModel((request, index) => {
    if (index === MAX_ASSISTANT_TOOL_ROUNDS - 1) clock.advance(2_000);
    return request.tools.length === 0 ? REPLY : SEARCH;
  });
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 1_000 });
  try {
    const response = await runtime.handleTurn("stop-deadline-summary", USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(model.plannerRequests.length, MAX_ASSISTANT_TOOL_ROUNDS, "no summary request starts after the deadline");
    assert.ok(model.plannerRequests.every((request) => request.tools.length > 0), "every request made was a planner round");
    assert.ok(response.surfaces?.length, "the last round's operation keeps its surface");
    assert.deepEqual(stopEvents(diagnostics), [stop(MAX_ASSISTANT_TOOL_ROUNDS, "turn_deadline", false)]);
  } finally { environment.close(); }
});

test("A provider failure reports stop reason `error` with its existing failure class.", async () => {
  // classifyFailure keys on the error's constructor name, so this mirrors a provider transport error by name.
  class APIConnectionError extends Error {}
  const clock = new SteppedClock(STAGING_LIKE_START);
  const model = new RecordingTurnModel(() => { throw new APIConnectionError("connection reset"); });
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock);
  try {
    const response = await runtime.handleTurn("stop-provider-error", USER_TEXT);
    assert.equal(response.ok, false);
    assert.equal(response.code, "CONCIERGE_UNAVAILABLE");
    assert.equal(response.stopReason, "error");
    assert.ok(diagnostics.some((event) => event.stage === "provider_request" && !event.succeeded && event.failureClass === "PROVIDER_TRANSPORT_FAILURE"));
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "error", false)]);
  } finally { environment.close(); }
});

test("A planner date the guest did not give reports stop reason `tool_denial` with a dated clarification and no task state change.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // The planner proposes a check-in the guest never wrote (the text has no date), so the date is rejected.
  const proposed: AssistantModelResponse = { toolCalls: [{ id: "call-stop-denial", name: "search_stays", args: { ...VALID_SEARCH, checkIn: "2026-12-20" } }] };
  const model = new RecordingTurnModel((_request, index) => index === 0 ? proposed : REPLY);
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock);
  try {
    const thread = runtime.getThread("stop-tool-denial");
    const taskStateBefore = JSON.stringify(thread.taskState);
    const response = await runtime.handleTurn("stop-tool-denial", USER_TEXT);
    assert.equal(response.ok, true, "a rejected planner date is a clarification, not a failure");
    assert.equal(response.controlOutcome, "tool_denial");
    assert.equal(response.stopReason, "tool_denial");
    assert.equal(response.messages?.length, 1);
    assert.equal(model.plannerRequests.length, 1, "the turn ends at the rejected call");
    assert.equal(JSON.stringify(runtime.getThread("stop-tool-denial").taskState), taskStateBefore, "no task state is committed");
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "tool_denial", true)]);
  } finally { environment.close(); }
});

test("A planner call that starts near the turn deadline receives a timeout clamped to the time left, and no call ends after the budget.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const turnStart = clock.now().getTime();
  const calls: { readonly startedAt: number; readonly timeoutMs: number | undefined }[] = [];
  // Each request spends 2 s against a 10 s turn budget and the default 20 s call timeout, so each call's timeout is the time left.
  const model = new RecordingTurnModel((request) => {
    calls.push({ startedAt: clock.now().getTime(), timeoutMs: request.timeoutMs });
    clock.advance(2_000);
    return request.tools.length === 0 ? REPLY : SEARCH;
  });
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 10_000 });
  try {
    const response = await runtime.handleTurn("stop-clamped-timeout", USER_TEXT);
    assert.equal(response.stopReason, "round_limit");
    assert.deepEqual(calls.map((call) => call.timeoutMs), [10_000, 8_000, 6_000, 4_000, 2_000], "each call takes the time left in the budget");
    assert.ok(calls.every((call) => call.startedAt + (call.timeoutMs ?? Infinity) <= turnStart + 10_000), "no call can end after the turn budget");
    assert.deepEqual(stopEvents(diagnostics), [stop(MAX_ASSISTANT_TOOL_ROUNDS + 1, "round_limit", true)]);
  } finally { environment.close(); }
});

test("A planner call with less than the minimum viable timeout left is not started and reports `turn_deadline`.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // 500 ms left is under the 1 000 ms minimum viable timeout (the lower runtime bound), so no planner request starts.
  const model = new RecordingTurnModel(() => REPLY, () => clock.advance(9_500));
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock, { turnDeadlineMs: 10_000 });
  try {
    const response = await runtime.handleTurn("stop-minimum-timeout", USER_TEXT);
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(model.plannerRequests.length, 0);
    assert.deepEqual(stopEvents(diagnostics), [stop(0, "turn_deadline", false)]);
  } finally { environment.close(); }
});

test("A rejected date after a successful operation returns the operation's surfaces with stop reason `tool_denial` and controlOutcome `rejected_plan_fallback`.", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  // The second planner request proposes a check-in the guest never wrote, after the first search has run and left a card.
  const proposed: AssistantModelResponse = { toolCalls: [{ id: "call-denial-after-search", name: "search_stays", args: { ...VALID_SEARCH, checkIn: "2026-12-27" } }] };
  const model = new RecordingTurnModel((_request, index) => index === 0 ? SEARCH : proposed);
  const { environment, runtime, diagnostics } = openTurnRuntime(model, clock);
  try {
    const response = await runtime.handleTurn("stop-denial-after-search", USER_TEXT);
    assert.equal(response.ok, true);
    assert.equal(response.controlOutcome, "rejected_plan_fallback");
    assert.equal(response.stopReason, "tool_denial");
    assert.ok(response.surfaces?.[0]?.surfaceId.includes(":discovery:"), "the first search's card is returned");
    assert.equal(runtime.getThread("stop-denial-after-search").activeSurfaces.get("discovery"), response.surfaces?.[0]?.surfaceId, "the card is committed");
    assert.equal(diagnostics.filter((event) => event.stage === "application_operation" && event.succeeded).length, 1, "only the first search ran");
    assert.deepEqual(stopEvents(diagnostics), [stop(2, "tool_denial", true)]);
  } finally { environment.close(); }
});

test("The model-call timeout and turn deadline default to 20 000 ms and SERVER_TURN_MAX_MS (168 000 ms) and can be overridden through runtime options.", async () => {
  assert.equal(DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS, 20_000);
  assert.equal(SERVER_TURN_MAX_MS, 168_000);
  assert.equal(DEFAULT_ASSISTANT_TURN_DEADLINE_MS, SERVER_TURN_MAX_MS);

  // Defaults: a planner request takes 20 s, and a turn one second short of the deadline still completes.
  const defaultModel = new RecordingTurnModel(() => REPLY);
  const defaults = openTurnRuntime(defaultModel, new SteppedClock(STAGING_LIKE_START));
  try {
    const response = await defaults.runtime.handleTurn("stop-defaults", USER_TEXT);
    assert.equal(defaultModel.plannerRequests[0]?.timeoutMs, 20_000);
    assert.equal(response.stopReason, "reply");
    assert.deepEqual(stopEvents(defaults.diagnostics), [stop(1, "reply", true)]);
  } finally { defaults.environment.close(); }

  const slowScope = new SteppedClock(STAGING_LIKE_START);
  const slowModel = new RecordingTurnModel(() => REPLY, () => slowScope.advance(SERVER_TURN_MAX_MS - 1_000));
  const within = openTurnRuntime(slowModel, slowScope);
  try {
    const response = await within.runtime.handleTurn("stop-default-119", USER_TEXT);
    assert.equal(response.stopReason, "reply");
    assert.deepEqual(stopEvents(within.diagnostics), [stop(1, "reply", true)]);
  } finally { within.environment.close(); }

  // A turn one second past the deadline stops before the first planner call.
  const pastScope = new SteppedClock(STAGING_LIKE_START);
  const pastModel = new RecordingTurnModel(() => REPLY, () => pastScope.advance(SERVER_TURN_MAX_MS + 1_000));
  const past = openTurnRuntime(pastModel, pastScope);
  try {
    const response = await past.runtime.handleTurn("stop-default-121", USER_TEXT);
    assert.equal(response.stopReason, "turn_deadline");
    assert.equal(pastModel.plannerRequests.length, 0);
    assert.deepEqual(stopEvents(past.diagnostics), [stop(0, "turn_deadline", false)]);
  } finally { past.environment.close(); }

  // Overrides: both values are taken from the options.
  const overrideModel = new RecordingTurnModel(() => REPLY);
  const overridden = openTurnRuntime(overrideModel, new SteppedClock(STAGING_LIKE_START), { modelCallTimeoutMs: 5_000 });
  try {
    await overridden.runtime.handleTurn("stop-override-timeout", USER_TEXT);
    assert.equal(overrideModel.plannerRequests[0]?.timeoutMs, 5_000);
  } finally { overridden.environment.close(); }

  const shortDeadlineClock = new SteppedClock(STAGING_LIKE_START);
  const shortDeadline = openTurnRuntime(new RecordingTurnModel(() => REPLY, () => shortDeadlineClock.advance(1_500)), shortDeadlineClock, { turnDeadlineMs: 1_000 });
  try {
    const response = await shortDeadline.runtime.handleTurn("stop-override-deadline", USER_TEXT);
    assert.equal(response.stopReason, "turn_deadline");
    assert.deepEqual(stopEvents(shortDeadline.diagnostics), [stop(0, "turn_deadline", false)]);
  } finally { shortDeadline.environment.close(); }

  // Failure paths: limits outside 1 000 to 300 000 ms, and non-integers, are rejected at construction.
  for (const invalid of [{ modelCallTimeoutMs: 0 }, { modelCallTimeoutMs: 999 }, { modelCallTimeoutMs: 300_001 }, { modelCallTimeoutMs: 1.5 }, { turnDeadlineMs: -1 }, { turnDeadlineMs: 999 }, { turnDeadlineMs: 300_001 }]) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: new SteppedClock(STAGING_LIKE_START).now });
    try {
      assert.throws(() => new ShortletAssistantRuntime(environment, new RecordingTurnModel(() => REPLY), invalid), /between 1000 and 300000/);
    } finally { environment.close(); }
  }
});
