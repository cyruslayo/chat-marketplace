/**
 * Deterministic English day-month date literals that a guest typed (ADR 0106 date authority).
 *
 * A literal authorizes its resolved ISO date only inside the guest's own text. The parser is strict:
 * relative words ("tomorrow", "Friday", "next week") and numeric forms ("03/04/2026") resolve to nothing;
 * a weekday that contradicts the resolved date, an invalid calendar day, a past date, or a date outside
 * the booking horizon resolves to nothing; a year-omitted literal resolves to the nearest on-or-after
 * occurrence in Africa/Lagos. Anything unresolved stays unauthorized and the planner must ask again.
 */
import { BOOKING_HORIZON_DAYS, dateKeyInLagos } from "../../../../domains/shortlet/src/browse.js";

export interface GuestDateLiteral {
  /** Resolved ISO calendar date (YYYY-MM-DD). */
  readonly date: string;
  /** Span of the literal in the guest's text, used for clause binding. */
  readonly start: number;
  readonly end: number;
}

const MONTH_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
});
const WEEKDAY_NUMBERS: Readonly<Record<string, number>> = Object.freeze({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });

const WEEKDAY = "(?<weekday>mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const MONTH_WITH_MAY = "(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_WITHOUT_MAY = "(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORDINAL = "(?:st|nd|rd|th)?";
/** An explicit four-digit year, or no year at all. A longer digit run after the day or month is not a date. */
const OPTIONAL_YEAR = "(?:,?\\s+(?<year>\\d{4})(?!\\d)|(?!\\s*,?\\s*\\d{4}))";
/** A count noun after a month name ("November 2 guests") means the number is not a day. */
const NOT_A_COUNT = "(?!\\s*(?:guests?|nights?|people|persons?|adults?|pax|beds?|bedrooms?)\\b)";

/** Day first: "20 November 2026", "Fri 20th of Nov", "20 Sept". */
const DAY_FIRST = new RegExp(`(?<![\\d/.-])(?:${WEEKDAY}\\.?,?\\s+)?(?<day>\\d{1,2})(?!\\d)${ORDINAL}\\s+(?:of\\s+)?${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi");
/** Month first: "November 20, 2026", "Nov 20". "May" is skipped here because it reads as a word. */
const MONTH_FIRST = new RegExp(`(?<![\\w/.-])(?:${WEEKDAY}\\.?,?\\s+)?${MONTH_WITHOUT_MAY}\\.?\\s+(?<day>\\d{1,2})(?!\\d)${ORDINAL}${NOT_A_COUNT}${OPTIONAL_YEAR}`, "gi");

/** The ISO date for a valid Gregorian calendar day, or undefined for an impossible one such as 31 February. */
function isoDate(year: number, month: number, day: number): string | undefined {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

function dayNumber(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000;
}

function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

/** Resolves one match to an authorized ISO date, or undefined when the literal is ambiguous, invalid, past, or beyond the horizon. */
function resolveLiteral(groups: Readonly<Record<string, string | undefined>>, today: string): string | undefined {
  const month = MONTH_NUMBERS[(groups.month ?? "").toLowerCase()];
  const day = Number(groups.day);
  if (month === undefined || !Number.isSafeInteger(day)) return undefined;
  const todayYear = Number(today.slice(0, 4));
  const explicitYear = groups.year === undefined ? undefined : Number(groups.year);
  // A year-omitted literal takes the nearest on-or-after occurrence; the horizon check below bounds how far that can be.
  const years = explicitYear === undefined ? [todayYear, todayYear + 1] : [explicitYear];
  let candidate: string | undefined;
  for (const year of years) {
    const iso = isoDate(year, month, day);
    if (iso !== undefined && iso >= today) {
      candidate = iso;
      break;
    }
  }
  if (candidate === undefined) return undefined;
  const offset = dayNumber(candidate) - dayNumber(today);
  if (offset < 0 || offset > BOOKING_HORIZON_DAYS) return undefined;
  if (groups.weekday !== undefined) {
    const named = WEEKDAY_NUMBERS[groups.weekday.slice(0, 3).toLowerCase()];
    if (named === undefined || named !== weekdayOf(candidate)) return undefined;
  }
  return candidate;
}

/**
 * The ISO dates that the guest's text spells out as English day-month literals, in text order.
 * `now` is the injected turn clock; "today" is its Africa/Lagos calendar date (UTC+1, no daylight saving).
 */
export function guestDateLiterals(text: string, now: Date): readonly GuestDateLiteral[] {
  const today = dateKeyInLagos(now, "now");
  const found: GuestDateLiteral[] = [];
  for (const pattern of [DAY_FIRST, MONTH_FIRST]) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // Overlapping matches cannot both be the guest's literal; the earlier one wins.
      if (found.some((literal) => start < literal.end && literal.start < end)) continue;
      const date = resolveLiteral(match.groups ?? {}, today);
      if (date !== undefined) found.push({ date, start, end });
    }
  }
  return found.sort((left, right) => left.start - right.start);
}
