import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelRequest, AssistantModelResponse, AssistantToolCall } from "../apps/local-guest/src/assistant/assistant-model.js";
import { SHORTLET_PROMPT_SECTION } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";

const searchCall: AssistantToolCall = { id: "ref-search", name: "search_stays",
  args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 } };
const detailsCall: AssistantToolCall = { id: "ref-details", name: "get_unit_details", args: { stayRef: "stay-1" } };
const searchOnlyScope = { assess: async () => ({ scope: "in_scope" as const, risk: "ordinary" as const, intents: ["search" as const],
  slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null }, reasonCode: "supported" as const }) };

/** Scripted planner: `calls` supplies one tool-call step per round; `plan` is the typed reply once the rounds run out. */
function scriptedPlanner(calls: readonly AssistantToolCall[], plan: unknown, requests: AssistantModelRequest[] = []) {
  return {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      requests.push(request);
      const priorToolResults = request.history.filter((step) => step.role === "tool_results").length;
      const call = calls[priorToolResults];
      if (call) return { toolCalls: [call] };
      return { text: typeof plan === "string" ? plan : JSON.stringify(plan) };
    },
  };
}

async function runTurn(id: string, planner: ReturnType<typeof scriptedPlanner>, scope = approvedTestScope) {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  try {
    const runtime = new AssistantRuntime(environment, planner, { onDiagnostic: (event) => diagnostics.push(event), scopeClassifier: scope });
    const result = await runtime.handleTurn(id, "Find me a stay in Old Ikoyi for four nights");
    return { result, diagnostics, messages: result.messages ?? [] };
  } finally { environment.close(); }
}

const rejections = (diagnostics: readonly AssistantDiagnosticEvent[]) => diagnostics
  .filter((event) => event.replyPlanRejectionReason !== undefined).map((event) => event.replyPlanRejectionReason);

test("Planner instructions name tool results as the only reference vocabulary", () => {
  assert.match(SHORTLET_PROMPT_SECTION, /`references` lists only the names of the tools whose results the reply reports/);
  assert.match(SHORTLET_PROMPT_SECTION, /stay-1 (?:belongs|belong) only in tool arguments/);
  assert.doesNotMatch(SHORTLET_PROMPT_SECTION, /Use conversational stay references like stay-1, stay-2\./);
});

test("A reply plan citing a stay reference instead of a tool name is rejected once and still renders", async () => {
  const { result, diagnostics } = await runTurn("refs-stay", scriptedPlanner([searchCall], { kind: "show_results", references: ["stay-1"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), ["reference_not_in_results"]);
  assert.equal(result.controlOutcome, "rejected_plan_fallback");
});

test("A reply plan may cite search_stays after a search then details turn", async () => {
  const { result, diagnostics } = await runTurn("refs-two-rounds-search",
    scriptedPlanner([searchCall, detailsCall], { kind: "show_results", references: ["search_stays"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), []);
  assert.equal(result.controlOutcome, "successful_model_handling");
});

test("A reply plan may cite get_unit_details from the latest round after a search then details turn", async () => {
  const { result, diagnostics } = await runTurn("refs-two-rounds-details",
    scriptedPlanner([searchCall, detailsCall], { kind: "show_details", references: ["get_unit_details"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), []);
  assert.equal(result.controlOutcome, "successful_model_handling");
});

test("A reply plan may not cite a tool whose call was denied", async () => {
  // The scope allows search only, so the prepare_request_draft call is denied and its name never reaches the results.
  const denied: AssistantToolCall = { id: "ref-denied", name: "prepare_request_draft", args: {} };
  const { result, diagnostics } = await runTurn("refs-denied",
    scriptedPlanner([denied], { kind: "show_results", references: ["prepare_request_draft"] }), searchOnlyScope);
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), ["reference_not_in_results"]);
});

test("A reply plan may not cite a tool whose call returned an error result", async () => {
  // Malformed arguments produce an error result for search_stays, which is excluded from the allowed names.
  const malformed: AssistantToolCall = { id: "ref-malformed", name: "search_stays", args: { nights: "four" } };
  const { result, diagnostics } = await runTurn("refs-error",
    scriptedPlanner([malformed], { kind: "show_results", references: ["search_stays"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), ["reference_not_in_results"]);
});

test("An empty reference list is accepted without a tool result", async () => {
  const { result, diagnostics } = await runTurn("refs-empty", scriptedPlanner([], { kind: "clarify_stay", references: [] }));
  assert.equal(result.ok, true);
  assert.deepEqual(rejections(diagnostics), []);
  assert.notEqual(result.controlOutcome, "rejected_plan_fallback");
});

test("The reply renders from the latest round even when the plan cites an earlier round", async () => {
  const cited = await runTurn("refs-render-cited",
    scriptedPlanner([searchCall, detailsCall], { kind: "show_details", references: ["search_stays"] }));
  const latest = await runTurn("refs-render-latest",
    scriptedPlanner([searchCall, detailsCall], { kind: "show_details", references: ["get_unit_details"] }));
  assert.equal(cited.result.ok, true);
  assert.deepEqual(cited.messages, latest.messages);
});

test("The per-request plan schema enumerates only the tool names that succeeded earlier in this turn", async () => {
  const requests: AssistantModelRequest[] = [];
  await runTurn("refs-schema", scriptedPlanner([searchCall, detailsCall], { kind: "show_results", references: [] }, requests));
  const planSchemas = requests
    .filter((request) => request.structuredOutput?.name === "assistant_reply_plan")
    .map((request) => request.structuredOutput?.schema as { properties: { references: { items: { enum?: readonly string[] } } }; required: readonly string[]; additionalProperties: boolean });
  const finalSchema = planSchemas.at(-1);
  assert.ok(finalSchema);
  assert.deepEqual(finalSchema.properties.references.items.enum, ["search_stays", "get_unit_details"]);
  assert.deepEqual(finalSchema.required, ["kind", "references"]);
  assert.equal(finalSchema.additionalProperties, false);
});
