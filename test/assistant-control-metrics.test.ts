import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ModelRequestGuardError, type AssistantToolCall } from "../apps/local-guest/src/assistant/assistant-model.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

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
    assert.equal(result.ok, false);
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

