import { CONCIERGE_INTENTS, type ScopeClassifier } from "../../apps/local-guest/src/assistant/scope-classifier.js";

/** Isolates planner tests from the separately tested scope boundary. */
export const approvedTestScope: ScopeClassifier = {
  assess: async () => ({ scope: "in_scope", risk: "ordinary", intents: CONCIERGE_INTENTS,
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null }, reasonCode: "supported" }),
};
