/**
 * The booking contract's notice and extension action event names (ADR 0102). Held apart from
 * `booking-contract-a2ui.ts` so the catalogue manifest can allow-list them without an import cycle: this module
 * imports nothing. The names are the shipped values; `booking-contract-a2ui.ts` re-exports them unchanged.
 */
export const NOTICE_OPEN_EVENT = "shortlet.assistant.open-notice";
export const EXTENSION_OPEN_EVENT = "shortlet.assistant.open-extension";
