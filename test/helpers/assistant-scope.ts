import { CONCIERGE_INTENTS, type ScopeClassifier } from "../../apps/local-guest/src/assistant/scope-classifier.js";

/**
 * Isolates planner tests from the separately tested scope boundary. It approves every intent except `change` (issue 12): a sent
 * stay's change is answered by the pack before any planner round, and that answer is tested on its own (assistant-change-explanations).
 */
export const approvedTestScope: ScopeClassifier = {
  assess: async () => ({ scope: "in_scope", risk: "ordinary", intents: CONCIERGE_INTENTS.filter((intent) => intent !== "change"),
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null }, reasonCode: "supported" }),
};
