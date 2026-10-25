/**
 * Exact ISO date token helpers shared by the assistant runtime and the shortlet pack.
 * ADR 0106: a date authorizes a role only when the guest's own text contains it as a whole token.
 */

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
 * True when any exact occurrence of `date` in `text` is governed by a checkout keyword in the
 * same clause (text since the previous clause boundary or ISO date token).
 */
export function isDateGovernedByCheckOut(text: string, date: string): boolean {
  if (date.length === 0) return false;
  let start = text.indexOf(date);
  while (start >= 0) {
    const before = text[start - 1];
    const after = text[start + date.length];
    if (!isDigit(before) && !isDigit(after)) {
      const clause = text.slice(0, start).replace(CLAUSE_BOUNDARY, "");
      if (CHECKOUT_KEYWORD.test(clause)) return true;
    }
    start = text.indexOf(date, start + 1);
  }
  return false;
}

export interface CurrentTurnDateSlots {
  readonly checkIn: string | null;
  readonly checkOut: string | null;
}

/**
 * Binds classifier date slots to check-in and checkout roles for the current guest text.
 * Fails closed (ADR 0106): identical slot dates are ambiguous, and a check-in slot whose date is
 * governed by a checkout keyword carries no check-in authority. Missing exact tokens carry none either.
 */
export function currentTurnDateRoles(text: string, slots: CurrentTurnDateSlots): { checkIn?: string; checkOut?: string } {
  if (slots.checkIn !== null && slots.checkIn === slots.checkOut) return {};
  const checkIn = slots.checkIn !== null
    && containsExactDateToken(text, slots.checkIn)
    && !isDateGovernedByCheckOut(text, slots.checkIn)
    ? { checkIn: slots.checkIn }
    : {};
  const checkOut = slots.checkOut !== null && containsExactDateToken(text, slots.checkOut) ? { checkOut: slots.checkOut } : {};
  return { ...checkIn, ...checkOut };
}
