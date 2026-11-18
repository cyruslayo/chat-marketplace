/**
 * The discovery surface's action event names (weaver catalogues issues 05–07, ADR 0102). Held apart from
 * `discovery-a2ui.ts` so the catalogue manifest can allow-list them without an import cycle: this module imports
 * nothing. The names are the shipped values; `discovery-a2ui.ts` re-exports them unchanged.
 */
export const VIEW_UNIT_EVENT = "shortlet.discovery.view-unit";
export const SEE_ALL_DISCOVERY_EVENT = "shortlet.discovery.see-all";
export const COMPARE_UNIT_EVENT = "shortlet.discovery.compare";
export const COMPARE_BACK_EVENT = "shortlet.discovery.compare.back-to-results";
