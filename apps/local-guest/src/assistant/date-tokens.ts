/**
 * Exact date helpers shared by the assistant runtime and the shortlet pack.
 * ADR 0106: a date authorizes a role only when the guest's own text contains it, either as a whole ISO token
 * or as an English day-month literal that resolves to it (date-literals.ts). Model-only dates never authorize.
 */
import { guestDateLiterals, type GuestDateLiteral } from "./date-literals.js";

/** Closed diagnostic identity; current task dates and authored dates are separate authorities (ADR 0106). */
export class AssistantDateProvenanceError extends Error {}

/**
 * A planner date that is malformed or outside the stay rules. The runtime turns it into a dated clarification
 * (ADR 0106 tool rejection), never into a failed turn.
 */
export class AssistantDateValidationError extends Error {}

const CHECKOUT_KEYWORD = /\bcheck[\s-]*out\b/i;
const CLAUSE_BOUNDARY = /^[\s\S]*(?:[;,.!?\n]|\d{4}-\d{2}-\d{2})/;

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** True when `date` occurs in `text` at least once with no digit on either side. */
export function containsExactDateToken(text: string, date: string): boolean {
  if (date.length === 0) return false;
  let start = text.indexOf(date);
  while (start >= 0) {
    if (!isDigit(text[start - 1]) && !isDigit(text[start + date.length])) return true;
    start = text.indexOf(date, start + 1);
  }
  return false;
}

/**
 * True when `date` is authored by the guest's text: an exact ISO token, or an English day-month literal that
 * resolves to it at `now`. Without `now` only exact ISO tokens authorize, so the check fails closed.
 */
export function containsGuestDate(text: string, date: string, now?: Date): boolean {
  if (containsExactDateToken(text, date)) return true;
  return now !== undefined && guestDateLiterals(text, now).some((literal) => literal.date === date);
}

/**
 * The clause that governs a date at `start`: the text since the previous clause boundary (punctuation or an ISO
 * token), or the end of the previous English date literal when that is later.
 */
function clauseBefore(text: string, start: number, literals: readonly GuestDateLiteral[]): string {
  const boundary = CLAUSE_BOUNDARY.exec(text.slice(0, start));
  let from = boundary === null ? 0 : boundary[0].length;
  for (const literal of literals) {
    if (literal.end <= start && literal.end > from) from = literal.end;
  }
  return text.slice(from, start);
}

/**
 * True when any occurrence of `date` in `text` (an exact ISO token or a resolved English literal) is governed
 * by a checkout keyword in the same clause.
 */
export function isDateGovernedByCheckOut(text: string, date: string, now?: Date): boolean {
  if (date.length === 0) return false;
  const literals = now === undefined ? [] : guestDateLiterals(text, now);
  let start = text.indexOf(date);
  while (start >= 0) {
    const before = text[start - 1];
    const after = text[start + date.length];
    if (!isDigit(before) && !isDigit(after) && CHECKOUT_KEYWORD.test(clauseBefore(text, start, literals))) return true;
    start = text.indexOf(date, start + 1);
  }
  return literals.some((literal) => literal.date === date && CHECKOUT_KEYWORD.test(clauseBefore(text, literal.start, literals)));
}

export interface CurrentTurnDateSlots {
  readonly checkIn: string | null;
  readonly checkOut: string | null;
}

/**
 * Binds classifier date slots to check-in and checkout roles for the current guest text.
 * Fails closed (ADR 0106): identical slot dates are ambiguous, and a check-in slot whose date is
 * governed by a checkout keyword carries no check-in authority. Dates the guest did not write carry none either.
 */
export function currentTurnDateRoles(text: string, slots: CurrentTurnDateSlots, now?: Date): { checkIn?: string; checkOut?: string } {
  if (slots.checkIn !== null && slots.checkIn === slots.checkOut) return {};
  const checkIn = slots.checkIn !== null
    && containsGuestDate(text, slots.checkIn, now)
    && !isDateGovernedByCheckOut(text, slots.checkIn, now)
    ? { checkIn: slots.checkIn }
    : {};
  const checkOut = slots.checkOut !== null && containsGuestDate(text, slots.checkOut, now) ? { checkOut: slots.checkOut } : {};
  return { ...checkIn, ...checkOut };
}
