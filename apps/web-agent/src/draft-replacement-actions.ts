/**
 * The request-draft replacement proposal's action event names. Held apart from `draft-replacement-a2ui.ts` so the
 * catalogue manifest can allow-list them without an import cycle: this module imports nothing. The names are the
 * shipped values; `draft-replacement-a2ui.ts` re-exports them unchanged.
 */
export const DRAFT_REPLACEMENT_ACCEPT_EVENT = "shortlet.request-draft.replacement.accept";
export const DRAFT_REPLACEMENT_KEEP_EVENT = "shortlet.request-draft.replacement.keep";
