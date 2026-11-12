import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantModelResponse, AssistantToolCall } from "../apps/local-guest/src/assistant/assistant-model.js";

/**
 * Issue 63: what a correct planner does with each terse answer on the journey the eval's set-up reached (a real search that asks the
 * missing fact, a real discovery surface, a server-shown date). The scripted reference measures tool execution, not language
 * understanding, so these are fixed decisions; the live eval sends the same texts to the configured model instead.
 * Shared with `test/pilot-agent-smoke-report.test.ts`, which drives `evaluateTerseFollowUps` through the same actions.
 */
export const REFERENCE_TERSE_ACTIONS: Readonly<Record<string, readonly AssistantToolCall[]>> = {
  "just me": [{ id: "reference-party-solo", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 1 } }],
  "2": [{ id: "reference-party-numeral", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
  "two of us": [{ id: "reference-party-pair", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
  "me and my wife": [{ id: "reference-party-couple", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
  "my partner and I": [{ id: "reference-party-partner", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
  "a week": [{ id: "reference-nights-week", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 7, guests: 2 } }],
  "3": [{ id: "reference-nights-numeral", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
  "two weeks": [{ id: "reference-nights-fortnight", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 14, guests: 2 } }],
  "the first one": [{ id: "reference-pick-first", name: "get_unit_details", args: { stayRef: "stay-1" } }],
  "the second": [{ id: "reference-pick-second", name: "get_unit_details", args: { stayRef: "stay-2" } }],
  "the last one": [{ id: "reference-pick-last", name: "get_unit_details", args: { stayRef: "stay-2" } }],
  yes: [{ id: "reference-date-yes", name: "search_stays", args: { city: "Lagos", neighbourhood: "Lekki Phase 1", nights: 3, guests: 2 } }],
  "Wuse 2": [{ id: "reference-area", name: "search_stays", args: { city: "Abuja", neighbourhood: "Wuse 2", checkIn: "2026-12-14", nights: 3, guests: 2 } }],
};

/** Fixed decisions for the smoke's four turns; this measures tool execution, not language understanding. */
export function createSmokeReferenceModel(): ScriptedAssistantModel {
  return new ScriptedAssistantModel([(request): AssistantModelResponse | null => {
    const step = request.history.at(-1);
    if (step?.role === "tool_results") return { text: "Review the authoritative stay details and actions shown." };
    if (step?.role !== "user") return null;
    const terse = REFERENCE_TERSE_ACTIONS[step.text];
    if (terse !== undefined) return { toolCalls: [...terse] };
    switch (step.text) {
      case "Show me apartments in Wuse 2.":
        return { toolCalls: [{ id: "reference-discovery", name: "search_stays", args: { city: "Abuja", neighbourhood: "Wuse 2", nights: null, guests: null, bedrooms: null } }] };
      case "Only show me two-bedroom apartments.":
        return { toolCalls: [{ id: "reference-refinement", name: "search_stays", args: { city: "Abuja", neighbourhood: "Wuse 2", nights: null, guests: null, bedrooms: 2 } }] };
      case "Open the first one.":
        return { toolCalls: [{ id: "reference-inspection", name: "get_unit_details", args: { stayRef: "stay-1" } }] };
      case "I want to book this apartment for two nights for two guests.":
        return { toolCalls: [{ id: "reference-booking", name: "prepare_request_draft", args: { stayRef: "stay-1", nights: 2, guests: 2 } }] };
      default:
        throw new Error("The scripted reference supports only the four smoke fixture turns.");
    }
  }]);
}
