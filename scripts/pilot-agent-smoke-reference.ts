import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";

/** Fixed decisions for the smoke's four turns; this measures tool execution, not language understanding. */
export function createSmokeReferenceModel(): ScriptedAssistantModel {
  return new ScriptedAssistantModel([(request) => {
    const step = request.history.at(-1);
    if (step?.role === "tool_results") return { text: "Review the authoritative stay details and actions shown." };
    if (step?.role !== "user") return null;
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
