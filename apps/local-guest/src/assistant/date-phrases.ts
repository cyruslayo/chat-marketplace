/**
 * The guest's relative date phrases on the assistant path (issue 04, ADR 0106 2 Nov 2026 amendment).
 *
 * The planner returns the guest's own words for arrival ("next Friday", "in two weeks"). This module checks the words are in the
 * guest's text and reads them with the shared stay-date resolver (domains/shortlet). It never computes a date for the planner; the
 * result is a reading the pack acts on: a literal day the guest typed, one relative day to show back, candidates to choose from, or
 * a refusal. Nothing here authorizes a date (ADR 0106): the guest's confirmation does that, in the pack's settle step.
 */
import { DEFAULT_STAY_DATE_POLICY, resolveStayDatePhrases } from "../../../../domains/shortlet/src/index.js";

export type CheckInPhraseReading =
  /** A single day the guest typed as a literal ("20 Nov"): authorized by its own text, as a checkIn is (ADR 0106, 27 Oct). */
  | { readonly kind: "literal"; readonly date: string }
  /** One relative day ("in two weeks"): a show-back the guest confirms with Yes (ADR 0106, 2 Nov). */
  | { readonly kind: "confirm"; readonly date: string }
  /** Two or more readings ("next Friday" on this clock): one chip per candidate, and a tap chooses one (ADR 0106, 2 Nov). */
  | { readonly kind: "choose"; readonly candidates: readonly string[] }
  /** A span ("next week", "next month") or a phrase that resolves to nothing: the guest is asked for a day in plain words. */
  | { readonly kind: "clarify" };

function normalizeWords(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True when the phrase appears in one of the guest's texts as whole words (the current turn and the earlier guest text, as the
 * planner's history carries them). A phrase the guest did not write is never read (ADR 0106: fail closed).
 */
export function phraseIsGuestAuthored(phrase: string, guestTexts: readonly string[]): boolean {
  const wanted = normalizeWords(phrase);
  if (wanted === "") return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
  return guestTexts.some((text) => pattern.test(normalizeWords(text)));
}

/** Reads one guest phrase against the turn clock with the shared resolver. Exactly one reading is used; anything else is a clarify. */
export function readCheckInPhrase(phrase: string, now: Date): CheckInPhraseReading {
  const found = resolveStayDatePhrases(phrase, now, DEFAULT_STAY_DATE_POLICY);
  if (found.length !== 1) return { kind: "clarify" };
  const [only] = found;
  if (only === undefined) return { kind: "clarify" };
  if (only.kind === "day") {
    // A stay pair ("10-13 Nov") is not one arrival day, so it is not read here.
    if (only.endDate !== undefined) return { kind: "clarify" };
    return only.source === "literal" ? { kind: "literal", date: only.date } : { kind: "confirm", date: only.date };
  }
  if (only.kind === "ambiguous") return { kind: "choose", candidates: only.candidates };
  return { kind: "clarify" };
}
