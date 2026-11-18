/**
 * The Booking Request draft's action event names (weaver catalogues issue 04, ADR 0102). Held apart from
 * `request-draft-a2ui.ts` so the catalogue manifest can allow-list them without an import cycle: this module
 * imports nothing. The names are the shipped values; `request-draft-a2ui.ts` re-exports them unchanged.
 */
export const REQUEST_DRAFT_REVIEW_EVENT = "shortlet.request-draft.review";
export const REQUEST_DRAFT_SUBMIT_EVENT = "shortlet.request-draft.submit";
