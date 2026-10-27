import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ModelRequestGuardError, type AssistantToolCall } from "../apps/local-guest/src/assistant/assistant-model.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";

test("AC6: classifier guard failures and quota refusals emit separate metadata-only outcomes once", async () => {
  for (const failure of ["malformed", "outage", "quota"] as const) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
    const diagnostics: AssistantDiagnosticEvent[] = [];
    try {
      const runtime = new AssistantRuntime(environment, { generate: async () => { throw new Error("Planner cannot run"); } }, {
        onDiagnostic: (event) => diagnostics.push(event),
        scopeClassifier: { assess: async () => {
          if (failure === "quota") throw new ModelRequestGuardError("quota_denied");
          if (failure === "outage") throw new Error("PRIVATE_GUARD_FAILURE_CANARY");
          return { invalid: "PRIVATE_GUARD_FAILURE_CANARY" };
        } },
      });
      const result = await runtime.handleTurn(`metrics-${failure}`, "PRIVATE_GUEST_INPUT_CANARY");
      assert.equal(result.ok, true);
      const events = environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1");
      assert.deepEqual(events.map((event) => event.outcome), [failure === "quota" ? "quota_refusal" : "guard_failure"]);
      assert.ok(events.every((event) => typeof event.elapsedMs === "number" && Number.isSafeInteger(event.elapsedMs) && event.elapsedMs >= 0));
      assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|guestId|tenantId|prompt|reply/);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0]?.round, 0);
      assert.equal(diagnostics[0]?.succeeded, false);
      assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_|message|prompt|reply/);
    } finally { environment.close(); }
  }
});

test("Date provenance failures expose a closed diagnostic class without the rejected date or guest text", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new AssistantRuntime(environment, { generate: async () => ({ toolCalls: [
    { id: "date-probe", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-09-10", nights: 4, guests: 2 } },
  ] }) }, { onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: { assess: async () => ({
    scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null },
  }) } });
  try {
    const result = await runtime.handleTurn("date-diagnostic", "PRIVATE_GUEST_CANARY Find Ikoyi stays for four nights and two guests");
    // ADR 0106 (date authority, this change): a rejected planner date is an in-scope dated clarification, not a failed turn.
    assert.equal(result.ok, true);
    assert.equal(result.controlOutcome, "tool_denial");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.datesClarification]);
    assert.ok(diagnostics.some((event) => event.errorClass === "AssistantDateProvenanceError"));
    assert.doesNotMatch(JSON.stringify(diagnostics), /2026-09-10|PRIVATE_GUEST_CANARY/);
  } finally { environment.close(); }
});

const inScopeAssessment = { scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
  slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } } as const;
const searchCall: AssistantToolCall = { id: "metrics-search", name: "search_stays",
  args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } };

test("Reply plan rejections record one closed reason on the final-text and post-tool paths without model text", async () => {
  const canary = "PRIVATE_PLAN_CANARY";
  const finalTextCases: readonly (readonly [string, string])[] = [
    ["empty_text", ""],
    ["not_json", `${canary} not json`],
    ["not_object", "[]"],
    ["invalid_shape", JSON.stringify({ kind: "show_results" })],
    ["unknown_kind", JSON.stringify({ kind: canary, references: [] })],
    ["invalid_references", JSON.stringify({ kind: "show_results", references: [1] })],
    ["reference_not_in_results", JSON.stringify({ kind: "show_results", references: [canary] })],
  ];
  for (const [expected, text] of finalTextCases) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
    const diagnostics: AssistantDiagnosticEvent[] = [];
    try {
      const runtime = new AssistantRuntime(environment, { generate: async () => ({ text }) }, {
        onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: { assess: async () => inScopeAssessment },
      });
      const result = await runtime.handleTurn(`plan-final-${expected}`, "Show me options");
      assert.equal(result.ok, true, expected);
      assert.deepEqual(diagnostics.filter((event) => event.replyPlanRejectionReason !== undefined).map((event) => event.replyPlanRejectionReason), [expected]);
      assert.doesNotMatch(JSON.stringify({ result, diagnostics }), new RegExp(canary), expected);
    } finally { environment.close(); }
  }

  // Post-tool path: the planner keeps calling tools until the bounded rounds end, then the forced final plan is rejected.
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const runtime = new AssistantRuntime(environment, { generate: async (request) => (request.tools ?? []).length === 0
      ? { text: JSON.stringify({ kind: "show_results", references: [canary] }) }
      : { toolCalls: [searchCall] } }, {
      onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: { assess: async () => inScopeAssessment },
    });
    const result = await runtime.handleTurn("plan-post-tool", "Show me options");
    assert.equal(result.ok, true);
    const rejected = diagnostics.filter((event) => event.replyPlanRejectionReason !== undefined);
    assert.deepEqual(rejected.map((event) => event.replyPlanRejectionReason), ["reference_not_in_results"]);
    assert.equal(rejected[0]?.round, MAX_ASSISTANT_TOOL_ROUNDS + 1);
    assert.doesNotMatch(JSON.stringify({ result, diagnostics }), new RegExp(canary));
  } finally { environment.close(); }
});


test("A local quota refusal after a tool round trip is a non-model failure with no provider text", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const runtime = new AssistantRuntime(environment, { generate: async (request) => (request.tools ?? []).length === 0
      ? (() => { throw new ModelRequestGuardError("quota_denied"); })()
      : { toolCalls: [searchCall] } }, {
      onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: { assess: async () => inScopeAssessment },
    });
    const result = await runtime.handleTurn("quota-round-trip", "Find stays in Old Ikoyi");
    assert.equal(result.ok, true);
    const failure = diagnostics.find((event) => event.stage === "function_result_round_trip" && !event.succeeded);
    assert.equal(failure?.errorClass, "ModelRequestGuardError");
    assert.equal(failure?.failureClass, "QUOTA_REFUSED");
    assert.doesNotMatch(JSON.stringify(diagnostics), /quota_denied|PRIVATE_/);
  } finally { environment.close(); }
});

test("Other local guard stops keep their existing diagnostic classes", async () => {
  for (const code of ["quota_unavailable", "deadline_exceeded"] as const) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
    const diagnostics: AssistantDiagnosticEvent[] = [];
    try {
      const runtime = new AssistantRuntime(environment, { generate: async () => { throw new ModelRequestGuardError(code); } }, {
        onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: { assess: async () => inScopeAssessment },
      });
      await runtime.handleTurn(`guard-${code}`, "Find stays in Old Ikoyi");
      const failure = diagnostics.find((event) => !event.succeeded);
      assert.equal(failure?.errorClass, "ModelRequestGuardError", code);
      assert.equal(failure?.failureClass, "MODEL_SELECTION_FAILURE", code);
    } finally { environment.close(); }
  }
});

test("AC6 retry: classifier retry telemetry is metadata-only and separate from the control outcome count", async () => {
  const { ScriptedClassifierModel, TRAILING_TEXT_CLASSIFIER_TEXT, VALID_CLASSIFIER_TEXT } = await import("./helpers/scope-classifier-retry-fixtures.js");
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const model = new ScriptedClassifierModel([{ response: { text: `${TRAILING_TEXT_CLASSIFIER_TEXT} PRIVATE_RETRY_METRICS_CANARY` } }, { response: { text: VALID_CLASSIFIER_TEXT } }]);
    const runtime = new AssistantRuntime(environment, model, { onDiagnostic: (event) => diagnostics.push(event) });
    const result = await runtime.handleTurn("metrics-retry", "PRIVATE_RETRY_INPUT_CANARY Find a stay");
    assert.equal(result.controlOutcome, "successful_model_handling");
    const retry = environment.telemetry.events().filter((event) => event.type === "assistant.classifier.retry.v1");
    assert.equal(retry.length, 1);
    // The telemetry store adds its own recordedAt timestamp; the retry fields themselves must be exactly the closed set.
    const { recordedAt: _recordedAt, ...closed } = retry[0] ?? {};
    assert.deepEqual(Object.keys(closed).sort(), ["classifierAttempts", "classifierRetryResult", "firstAttemptScopeFailureReason", "recovered", "type"]);
    assert.deepEqual(closed, { type: "assistant.classifier.retry.v1", classifierAttempts: 2, classifierRetryResult: "recovered", firstAttemptScopeFailureReason: "invalid_json_trailing_text", recovered: true });
    const outcomes = environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1");
    assert.deepEqual(outcomes.map((event) => event.outcome), ["successful_model_handling"]);
    assert.doesNotMatch(JSON.stringify({ retry, outcomes, diagnostics }), /PRIVATE_/);
  } finally { environment.close(); }
});
