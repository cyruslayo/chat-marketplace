/**
 * The unit detail's action event names (weaver catalogues issue 05, ADR 0102). Held apart from
 * `unit-detail-a2ui.ts` so the catalogue manifest can allow-list them without an import cycle: this module imports
 * nothing. The names are the shipped values; `unit-detail-a2ui.ts` re-exports them unchanged.
 */
export const REQUEST_TO_BOOK_EVENT = "shortlet.unit-detail.request-to-book";
export const BACK_TO_RESULTS_EVENT = "shortlet.unit-detail.back-to-results";
