import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  AssistantRuntime,
  DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS,
  DEFAULT_ASSISTANT_TURN_DEADLINE_MS,
  type AssistantDiagnosticEvent,
  type AssistantRuntimeOptions,
} from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock, threadSnapshot } from "./helpers/assistant-turn-model.js";

// On the staging-like clock the fixture's demo check-in is set inside the booking horizon; a null check-in resolves to it.
const STAGING_DEMO_CHECK_IN = "2026-12-20";
const VALID_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };
const REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
const SEARCH: AssistantModelResponse = { toolCalls: [{ id: "call-stop-search", name: "search_stays", args: VALID_SEARCH }] };
const USER_TEXT = "Find stays in Old Ikoyi";

function openTurnRuntime(model: RecordingTurnModel, clock: SteppedClock, options: AssistantRuntimeOptions = {}) {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: clock.now, demoCheckIn: STAGING_DEMO_CHECK_IN });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new AssistantRuntime(environment, model, { ...options, onDiagnostic: (event) => diagnostics.push(event) });
  return { environment, runtime, diagnostics };
}

function stopEvents(diagnostics: readonly AssistantDiagnosticEvent[]) {
  return diagnostics.filter((event) => event.stage === "turn_stop");
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
    assert.deepEqual(stopEvents(diagnostics).map((event) => [event.stopReason, event.succeeded]), [["reply", true]]);
  } finally { environment.close(); }

  // A reply after a tool round is still a reply: the tool calls do not make the turn a round limit.
  const withToolRound = new RecordingTurnModel((_request, index) => index === 0 ? SEARCH : REPLY);
  const second = openTurnRuntime(withToolRound, new SteppedClock(STAGING_LIKE_START));
  try {
    const response = await second.runtime.handleTurn("stop-reply-after-tool", USER_TEXT);
    assert.equal(response.stopReason, "reply");
    assert.equal(withToolRound.plannerRequests.length, 2);
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
    assert.deepEqual(stopEvents(diagnostics).map((event) => event.stopReason), ["round_limit"]);
  } finally { environment.close(); }
});

test("The summary call after the round cap is made with the configured model-call timeout.", async () => {
  const configured = 7_000;
  const clock = new SteppedClock(STAGING_LIKE_START);
  const model = new RecordingTurnModel((request) => request.tools.length === 0 ? REPLY : SEARCH);
  const { environment, runtime } = openTurnRuntime(model, clock, { modelCallTimeoutMs: configured });
  try {
    const response = await runtime.handleTurn("stop-summary-timeout", USER_TEXT);
    assert.equal(response.stopReason, "round_limit");
    const summary = model.plannerRequests.at(-1) as AssistantModelRequest;
    assert.equal(summary.tools.length, 0);
    assert.equal(summary.timeoutMs, configured, "the summary call takes the configured timeout, not the adapter default");
    assert.ok(model.plannerRequests.every((request) => request.timeoutMs === configured), "planner calls take the same configured timeout");
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
    assert.deepEqual(stopEvents(diagnostics).map((event) => [event.stopReason, event.succeeded]), [["turn_deadline", false]]);
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
    assert.deepEqual(stopEvents(diagnostics).map((event) => [event.stopReason, event.succeeded]), [["error", false]]);
  } finally { environment.close(); }
});

test("The model-call timeout and turn deadline default to 20 000 ms and 120 000 ms and can be overridden through runtime options.", async () => {
  assert.equal(DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS, 20_000);
  assert.equal(DEFAULT_ASSISTANT_TURN_DEADLINE_MS, 120_000);

  // Defaults: a planner request takes 20 s, and a turn 119 s long still completes.
  const defaultModel = new RecordingTurnModel(() => REPLY);
  const defaults = openTurnRuntime(defaultModel, new SteppedClock(STAGING_LIKE_START));
  try {
    const response = await defaults.runtime.handleTurn("stop-defaults", USER_TEXT);
    assert.equal(defaultModel.plannerRequests[0]?.timeoutMs, 20_000);
    assert.equal(response.stopReason, "reply");
  } finally { defaults.environment.close(); }

  const slowScope = new SteppedClock(STAGING_LIKE_START);
  const slowModel = new RecordingTurnModel(() => REPLY, () => slowScope.advance(119_000));
  const within = openTurnRuntime(slowModel, slowScope);
  try {
    assert.equal((await within.runtime.handleTurn("stop-default-119", USER_TEXT)).stopReason, "reply");
  } finally { within.environment.close(); }

  // A turn that reaches 121 s stops at the default deadline.
  const pastScope = new SteppedClock(STAGING_LIKE_START);
  const pastModel = new RecordingTurnModel(() => REPLY, () => pastScope.advance(121_000));
  const past = openTurnRuntime(pastModel, pastScope);
  try {
    assert.equal((await past.runtime.handleTurn("stop-default-121", USER_TEXT)).stopReason, "turn_deadline");
    assert.equal(pastModel.plannerRequests.length, 0);
  } finally { past.environment.close(); }

  // Overrides: both values are taken from the options.
  const overrideModel = new RecordingTurnModel(() => REPLY);
  const overridden = openTurnRuntime(overrideModel, new SteppedClock(STAGING_LIKE_START), { modelCallTimeoutMs: 5_000 });
  try {
    await overridden.runtime.handleTurn("stop-override-timeout", USER_TEXT);
    assert.equal(overrideModel.plannerRequests[0]?.timeoutMs, 5_000);
  } finally { overridden.environment.close(); }

  const shortDeadlineClock = new SteppedClock(STAGING_LIKE_START);
  const shortDeadline = openTurnRuntime(new RecordingTurnModel(() => REPLY, () => shortDeadlineClock.advance(600)), shortDeadlineClock, { turnDeadlineMs: 500 });
  try {
    assert.equal((await shortDeadline.runtime.handleTurn("stop-override-deadline", USER_TEXT)).stopReason, "turn_deadline");
  } finally { shortDeadline.environment.close(); }

  // Failure paths: non-positive or fractional limits are rejected at construction.
  for (const invalid of [{ modelCallTimeoutMs: 0 }, { modelCallTimeoutMs: 1.5 }, { turnDeadlineMs: -1 }]) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: new SteppedClock(STAGING_LIKE_START).now });
    try {
      assert.throws(() => new AssistantRuntime(environment, new RecordingTurnModel(() => REPLY), invalid));
    } finally { environment.close(); }
  }
});
