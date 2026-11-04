/**
 * Deterministic English day-month date literals that a guest typed (ADR 0106 date authority).
 *
 * A literal authorizes its resolved ISO date only inside the guest's own text. The parser is strict:
 * relative words ("tomorrow", "Friday", "next week") and numeric forms ("03/04/2026") resolve to nothing;
 * a weekday that contradicts the resolved date, an invalid calendar day, a past date, or a date outside
 * the booking horizon resolves to nothing; a year-omitted literal resolves to the nearest on-or-after
 * occurrence in Africa/Lagos. Anything unresolved stays unauthorized and the planner must ask again.
 *
 * The rules live in the shortlet stay-date resolver (issue 02). This wrapper keeps the assistant's authority
 * unchanged: it returns only single days the guest typed, never relative phrases, ranges or stay pairs.
 */
import { DEFAULT_STAY_DATE_POLICY, resolveStayDatePhrases } from "../../../../domains/shortlet/src/index.js";

export interface GuestDateLiteral {
  /** Resolved ISO calendar date (YYYY-MM-DD). */
  readonly date: string;
  /** Span of the literal in the guest's text, used for clause binding. */
  readonly start: number;
  readonly end: number;
}

/**
 * The ISO dates that the guest's text spells out as English day-month literals, in text order.
 * `now` is the injected turn clock; "today" is its Africa/Lagos calendar date (UTC+1, no daylight saving).
 */
export function guestDateLiterals(text: string, now: Date): readonly GuestDateLiteral[] {
  return resolveStayDatePhrases(text, now, DEFAULT_STAY_DATE_POLICY).flatMap((result) =>
    // A literal stay ("10-13 Nov") is not one typed day, so it authorizes nothing here, as before (issue 02).
    result.kind === "day" && result.source === "literal" && result.endDate === undefined
      ? [{ date: result.date, start: result.span.start, end: result.span.end }]
      : [],
  );
}
