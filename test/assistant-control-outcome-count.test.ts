import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ModelRequestGuardError, type AssistantModelClient, type AssistantToolCall } from "../apps/local-guest/src/assistant/assistant-model.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

const inScopeAssessment = { scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
  slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } } as const;
const searchCall: AssistantToolCall = { id: "count-search", name: "search_stays",
  args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } };

test("Each turn records exactly one control outcome, equal to the outcome it returns", async () => {
  const neverCalled = async (): Promise<never> => { throw new Error("Planner must not run for this turn"); };
  let scriptedCalls = 0;
  const cases: readonly { readonly expected: string; readonly assess: () => Promise<unknown>; readonly generate: AssistantModelClient["generate"] }[] = [
    { expected: "guard_failure", assess: async () => { throw new Error("PRIVATE_OUTAGE_CANARY"); }, generate: neverCalled },
    { expected: "quota_refusal", assess: async () => { throw new ModelRequestGuardError("quota_denied"); }, generate: neverCalled },
    { expected: "scope_redirect", assess: async () => ({ ...inScopeAssessment, scope: "out_of_scope", intents: [], reasonCode: "outside" }), generate: neverCalled },
    { expected: "rejected_plan_fallback", assess: async () => inScopeAssessment, generate: async () => ({ text: "not json" }) },
    { expected: "successful_model_handling", assess: async () => inScopeAssessment,
      generate: async () => ({ text: JSON.stringify({ kind: "clarify_stay", references: [] }) }) },
    { expected: "support_guidance", assess: async () => inScopeAssessment,
      generate: async () => ({ text: JSON.stringify({ kind: "support_guidance", references: [] }) }) },
    { expected: "tool_denial", assess: async () => inScopeAssessment, generate: async () => {
      scriptedCalls++;
      return scriptedCalls === 1 ? { toolCalls: [{ id: "denied", name: "not_a_tool", args: {} }] }
        : { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
    } },
    { expected: "rejected_plan_fallback", assess: async () => inScopeAssessment, generate: async () => {
      scriptedCalls++;
      if (scriptedCalls === 1) return { toolCalls: [searchCall] };
      throw new Error("PRIVATE_PROVIDER_CANARY");
    } },
  ];
  for (const [index, scenario] of cases.entries()) {
    scriptedCalls = 0;
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
    try {
      const runtime = new AssistantRuntime(environment, { generate: scenario.generate }, { scopeClassifier: { assess: scenario.assess } });
      const result = await runtime.handleTurn(`one-outcome-${index}`, "A benign request");
      const counted = environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1").map((event) => event.outcome);
      assert.equal(result.controlOutcome, scenario.expected, scenario.expected);
      assert.deepEqual(counted, [scenario.expected], scenario.expected);
    } finally { environment.close(); }
  }
});
