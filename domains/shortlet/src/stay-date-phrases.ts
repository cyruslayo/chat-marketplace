/**
 * The shared stay-date resolver (ADR 0106, 27 Oct and 2 Nov 2026 amendments; ADR 0055 Booking Horizon).
 *
 * `resolveStayDatePhrases` reads the guest's own words and returns typed resolutions with the text span each one
 * covers. It is pure: the turn clock and one policy object are the only inputs. Callers decide what a resolution
 * authorizes; this module authorizes nothing by itself (ADR 0106, 2 Nov 2026: a date phrase is guest-authored only
 * after the guest confirms its show-back).
 *
 * Vocabulary (English words that name a phrase) lives here. Every rule value (week start, the "next <weekday>"
 * rule, the weekend days, holidays, month spans, the horizon) comes from the `StayDatePolicy` object, so no rule
 * value is a literal inside the logic.
 *
 * Africa/Lagos is the calendar: "today" is the Lagos date of `now`, and every date is an ISO calendar date.
 */
import { BOOKING_HORIZON_DAYS, dateKeyInLagos } from "./browse.js";

/** Sunday is 0, as in `Date.prototype.getUTCDay`. */
export type StayDateWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface StayDateHoliday {
  readonly name: string;
  /** Phrases the guest may type, matched as whole words and case-insensitively. */
  readonly phrases: readonly string[];
}

export interface StayDateFixedHoliday extends StayDateHoliday {
  readonly month: number;
  readonly day: number;
}

export interface StayDateMonthSpans {
  /** "first week of <month>": days 1 to this value of the month. */
  readonly firstWeekDays: number;
  /** "end of the month": this many last days of the month. */
  readonly endOfMonthDays: number;
  /** "mid-<month>": the first and last day of the window. */
  readonly midMonthFromDay: number;
  readonly midMonthToDay: number;
}

/** Every rule value the resolver uses. The default is `DEFAULT_STAY_DATE_POLICY`. */
export interface StayDatePolicy {
  /** The first day of a week for "next week" and the other spans (ADR 0106, 2 Nov: Monday). */
  readonly weekStart: StayDateWeekday;
  /**
   * The weekdays on which "next <weekday>" is ambiguous when its two readings differ: the coming occurrence, and the
   * occurrence in the following week-start week. On any other weekday only the following-week reading applies.
   */
  readonly nextWeekdayAmbiguousOn: readonly StayDateWeekday[];
  /** The weekend's check-in and check-out weekdays ("this weekend" is Friday to Sunday). */
  readonly weekendCheckInWeekday: StayDateWeekday;
  readonly weekendCheckOutWeekday: StayDateWeekday;
  /** "next tomorrow" is this many days after today (ADR 0106, 2 Nov: the day after tomorrow, so 2). */
  readonly nextTomorrowDays: number;
  readonly fixedHolidays: readonly StayDateFixedHoliday[];
  /** Holidays whose date is set by the moon or the church calendar. They never resolve (ADR 0106, 2 Nov). */
  readonly movingHolidays: readonly StayDateHoliday[];
  readonly monthSpans: StayDateMonthSpans;
  /** The Booking Horizon: a check-in date may be at most this many days after today (ADR 0055). */
  readonly bookingHorizonDays: number;
}

export const DEFAULT_STAY_DATE_POLICY: StayDatePolicy = Object.freeze({
  weekStart: 1,
  nextWeekdayAmbiguousOn: Object.freeze([1, 2, 3, 4, 5, 6] as const),
  weekendCheckInWeekday: 5,
  weekendCheckOutWeekday: 0,
  nextTomorrowDays: 2,
  fixedHolidays: Object.freeze([
    Object.freeze({ name: "Christmas Day", month: 12, day: 25, phrases: Object.freeze(["christmas day", "christmas", "xmas"]) }),
    Object.freeze({ name: "New Year's Eve", month: 12, day: 31, phrases: Object.freeze(["new year's eve", "new years eve", "new year eve"]) }),
  ]),
  movingHolidays: Object.freeze([
    Object.freeze({ name: "Sallah", phrases: Object.freeze(["sallah"]) }),
    Object.freeze({ name: "Eid", phrases: Object.freeze(["eid"]) }),
    Object.freeze({ name: "Easter", phrases: Object.freeze(["easter"]) }),
  ]),
  monthSpans: Object.freeze({ firstWeekDays: 7, endOfMonthDays: 7, midMonthFromDay: 10, midMonthToDay: 20 }),
  bookingHorizonDays: BOOKING_HORIZON_DAYS,
});

export interface StayDateSpan {
  /** Offsets into the text that was resolved. */
  readonly start: number;
  readonly end: number;
}

export type StayDateUnresolvedReason = "past" | "beyond_horizon" | "invalid" | "weekday_mismatch" | "moving_holiday" | "unknown";

export type StayDateResolution =
  /** A single day. `literal` is a day-month the guest typed; `relative` is worked out from the clock. `endDate` is set for "10-13 Nov". */
  | { readonly kind: "day"; readonly span: StayDateSpan; readonly date: string; readonly source: "literal" | "relative"; readonly endDate?: string }
  /** A span the guest picks a day from. `latest` is not clipped to the horizon, because the Booking Horizon limits check-in only (ADR 0055). */
  | { readonly kind: "range"; readonly span: StayDateSpan; readonly earliest: string; readonly latest: string; readonly grain: "weekend" | "week" | "month" }
  /** Two or more readings the guest has to choose between. Nothing is authorized until the guest taps one. */
  | { readonly kind: "ambiguous"; readonly span: StayDateSpan; readonly candidates: readonly string[] }
  /** A reading that cannot be used. `date` (and `endDate`) keep the reading that was refused, so a caller can say so. */
  /** For a refused single day, `source` says whether the guest typed it or the clock worked it out. Refused spans carry no source. */
  | { readonly kind: "unresolved"; readonly span: StayDateSpan; readonly reason: StayDateUnresolvedReason; readonly date?: string; readonly endDate?: string; readonly source?: "literal" | "relative" };

// ---- vocabulary (English words, not rule values) -------------------------------------------------------------

const MONTH_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
});
const ABBREVIATED_WEEKDAYS: Readonly<Partial<Record<string, StayDateWeekday>>> = Object.freeze({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 });
const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
});
/** Calendar units for "in N days" and "in N weeks". */
const DAYS_PER_WEEK = 7;

const MONTH_WITH_MAY = "(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_WITHOUT_MAY = "(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_ABBREVIATED = "(?<weekday>mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const WEEKDAY_FULL = "(?<weekday>sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
const ORDINAL = "(?:st|nd|rd|th)?";
/** An explicit four-digit year, or no year at all. A longer digit run after the day or month is not a date. */
const OPTIONAL_YEAR = "(?:,?\\s+(?<year>\\d{4})(?!\\d)|(?!\\s*,?\\s*\\d{4}))";
/** A count noun after a month name ("November 2 guests") means the number is not a day. */
const NOT_A_COUNT = "(?!\\s*(?:guests?|nights?|people|persons?|adults?|pax|beds?|bedrooms?)\\b)";
/** A fixed holiday followed by one of these is a span or another day ("Christmas week", "Christmas Eve"), not the holiday. */
const NOT_A_HOLIDAY_SPAN = "(?!\\s+(?:week|weekend|season|holidays?|break|period|month|eve|morning))";

// ---- date arithmetic on ISO calendar dates -------------------------------------------------------------------

function dayNumber(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000;
}

function isoFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  return isoFromDayNumber(dayNumber(dateIso) + days);
}

function weekdayOf(dateIso: string): StayDateWeekday {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay() as StayDateWeekday;
}

/** The ISO date for a real calendar day, or undefined for an impossible one such as 31 February. */
function validIso(year: number, month: number, day: number): string | undefined {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

/** Last day of a calendar month (1 to 12). Day 0 of the next month is the last day of this one. */
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function escapeForRegExp(phrase: string): string {
  return phrase.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]")).join("\\s+");
}

// ---- resolution context --------------------------------------------------------------------------------------

interface Context {
  readonly today: string;
  readonly policy: StayDatePolicy;
}

type Groups = Readonly<Record<string, string | undefined>>;
type Body = StayDateResolution extends infer R ? R extends StayDateResolution ? Omit<R, "span"> : never : never;

/** Why a date cannot be used on the Booking Horizon, or undefined when it can (ADR 0055: check-in dates only). */
function arrivalProblem(date: string, ctx: Context): "past" | "beyond_horizon" | undefined {
  const offset = dayNumber(date) - dayNumber(ctx.today);
  if (offset < 0) return "past";
  if (offset > ctx.policy.bookingHorizonDays) return "beyond_horizon";
  return undefined;
}

/** A day the guest can use, or the reason it cannot be used (the refused reading is kept). */
function dayOrRefusal(date: string, source: "literal" | "relative", ctx: Context, endDate?: string): Body {
  const problem = arrivalProblem(date, ctx);
  if (problem !== undefined) return { kind: "unresolved", reason: problem, date, source, ...(endDate === undefined ? {} : { endDate }) };
  return { kind: "day", date, source, ...(endDate === undefined ? {} : { endDate }) };
}

/** A literal's reading: a usable date, or the reason it is refused (with the refused date when the horizon refused it). */
type LiteralOutcome =
  | { readonly ok: true; readonly date: string }
  | { readonly ok: false; readonly reason: StayDateUnresolvedReason; readonly date?: string };

function refusedLiteral(outcome: LiteralOutcome, source: "literal" | "relative" = "literal"): Body {
  if (outcome.ok) return { kind: "unresolved", reason: "invalid" };
  return { kind: "unresolved", reason: outcome.reason, ...(outcome.date === undefined ? {} : { date: outcome.date, source }) };
}

/**
 * The strict English day-month literal rules (ADR 0106, 27 Oct 2026): a year-omitted literal takes the nearest on-or-after
 * occurrence; an explicit year is used as written; a past or impossible day, a day beyond the horizon, or a weekday that
 * contradicts the date is not a date.
 */
function literalOutcome(month: number, day: number, year: number | undefined, weekday: StayDateWeekday | undefined, ctx: Context): LiteralOutcome {
  const todayYear = Number(ctx.today.slice(0, 4));
  const years = year === undefined ? [todayYear, todayYear + 1] : [year];
  let firstValid: string | undefined;
  let candidate: string | undefined;
  for (const candidateYear of years) {
    const iso = validIso(candidateYear, month, day);
    if (iso === undefined) continue;
    firstValid ??= iso;
    if (iso >= ctx.today) {
      candidate = iso;
      break;
    }
  }
  if (candidate === undefined) return { ok: false, reason: firstValid === undefined ? "invalid" : "past" };
  if (arrivalProblem(candidate, ctx) === "beyond_horizon") return { ok: false, reason: "beyond_horizon", date: candidate };
  if (weekday !== undefined && weekdayOf(candidate) !== weekday) return { ok: false, reason: "weekday_mismatch" };
  return { ok: true, date: candidate };
}

function monthNumber(groups: Groups): number | undefined {
  return MONTH_NUMBERS[(groups.month ?? "").toLowerCase()];
}

function yearOf(groups: Groups): number | undefined {
  return groups.year === undefined ? undefined : Number(groups.year);
}

function weekdayNumber(groups: Groups): StayDateWeekday | undefined {
  return groups.weekday === undefined ? undefined : ABBREVIATED_WEEKDAYS[groups.weekday.slice(0, 3).toLowerCase()];
}

/** The first day of the policy's week that contains `dateIso`. */
function weekStartOf(dateIso: string, ctx: Context): string {
  return addDays(dateIso, -((weekdayOf(dateIso) - ctx.policy.weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK));
}

/** The first day of the following week (the policy's week start). */
function followingWeekStart(ctx: Context): string {
  return addDays(weekStartOf(ctx.today, ctx), DAYS_PER_WEEK);
}

/** The next occurrence of `weekday` on or after today. */
function occurrenceOnOrAfter(weekday: StayDateWeekday, ctx: Context): string {
  return addDays(ctx.today, (weekday - weekdayOf(ctx.today) + DAYS_PER_WEEK) % DAYS_PER_WEEK);
}

function nextOccurrenceAfterToday(weekday: StayDateWeekday, ctx: Context): string {
  return addDays(ctx.today, ((weekday - weekdayOf(ctx.today) + DAYS_PER_WEEK) % DAYS_PER_WEEK) || DAYS_PER_WEEK);
}

/** A span within one calendar month, from the first to the last day of the window; the first window that ends on or after today wins. */
function monthWindow(
  candidates: readonly { readonly year: number; readonly month: number }[],
  window: (lastDay: number) => { readonly first: number; readonly last: number },
  grain: "week" | "month",
  explicitYear: boolean,
  ctx: Context,
): Body {
  for (const { year, month } of candidates) {
    const { first, last } = window(lastDayOf(year, month));
    const from = validIso(year, month, first);
    const to = validIso(year, month, last);
    if (from === undefined || to === undefined) continue;
    if (to < ctx.today) continue;
    const earliest = from < ctx.today ? ctx.today : from;
    const problem = arrivalProblem(earliest, ctx);
    if (problem !== undefined) return { kind: "unresolved", reason: problem, date: earliest, endDate: to };
    return { kind: "range", earliest, latest: to, grain };
  }
  return { kind: "unresolved", reason: explicitYear ? "past" : "invalid" };
}

// ---- rules ---------------------------------------------------------------------------------------------------

interface Rule {
  readonly pattern: RegExp;
  /** A literal the guest typed. A refused literal does not hide another literal match (date-literals.ts behaviour). */
  readonly literal: boolean;
  /** Whether the match hides overlapping matches. A literal range leaves its single days visible (see resolveStayDatePhrases). */
  readonly hidesOverlaps: boolean;
  readonly resolve: (groups: Groups, ctx: Context) => Body;
}

function holidayRules(holidays: readonly StayDateFixedHoliday[], moving: readonly StayDateHoliday[]): Rule[] {
  const phraseRule = (holiday: StayDateHoliday, resolve: Rule["resolve"]): Rule => {
    const alternatives = [...holiday.phrases].sort((left, right) => right.length - left.length).map(escapeForRegExp).join("|");
    return {
      pattern: new RegExp(`\\b(?:${alternatives})${NOT_A_HOLIDAY_SPAN}`, "gi"),
      literal: false,
      hidesOverlaps: true,
      resolve,
    };
  };
  return [
    // A fixed holiday is the nearest on-or-after occurrence (ADR 0106, 2 Nov: 25 and 31 December resolve).
    ...holidays.map((holiday) => phraseRule(holiday, (_groups, ctx) => {
      const outcome = literalOutcome(holiday.month, holiday.day, undefined, undefined, ctx);
      return outcome.ok ? dayOrRefusal(outcome.date, "relative", ctx) : refusedLiteral(outcome, "relative");
    })),
    ...moving.map((holiday) => phraseRule(holiday, () => ({ kind: "unresolved", reason: "moving_holiday" }))),
  ];
}

/** The check-out day of a literal stay: the same month, on or after the check-in (in the explicit year when one was typed). */
function checkOutDate(month: number, endDay: number, year: number | undefined, checkIn: string): string | undefined {
  const checkInYear = Number(checkIn.slice(0, 4));
  const years = year === undefined ? [checkInYear, checkInYear + 1] : [year];
  for (const candidateYear of years) {
    const iso = validIso(candidateYear, month, endDay);
    if (iso !== undefined && iso >= checkIn) return iso;
  }
  return undefined;
}

/** Count of days for "in <n> days" / "in <n> weeks", from the words and digits the guest typed. */
function countOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw.toLowerCase()];
}

function buildRules(policy: StayDatePolicy): Rule[] {
  const { monthSpans } = policy;
  const literalDayFirst: Rule = {
    pattern: new RegExp(`(?<![\\d/.-])(?:${WEEKDAY_ABBREVIATED}\\.?,?\\s+)?(?<day>\\d{1,2})(?!\\d)${ORDINAL}\\s+(?:of\\s+)?${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi"),
    literal: true,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "invalid" };
      const outcome = literalOutcome(month, Number(groups.day), yearOf(groups), weekdayNumber(groups), ctx);
      return outcome.ok ? { kind: "day", date: outcome.date, source: "literal" } : refusedLiteral(outcome);
    },
  };
  const literalMonthFirst: Rule = {
    pattern: new RegExp(`(?<![\\w/.-])(?:${WEEKDAY_ABBREVIATED}\\.?,?\\s+)?${MONTH_WITHOUT_MAY}\\.?\\s+(?<day>\\d{1,2})(?!\\d)${ORDINAL}${NOT_A_COUNT}${OPTIONAL_YEAR}`, "gi"),
    literal: true,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "invalid" };
      const outcome = literalOutcome(month, Number(groups.day), yearOf(groups), weekdayNumber(groups), ctx);
      return outcome.ok ? { kind: "day", date: outcome.date, source: "literal" } : refusedLiteral(outcome);
    },
  };
  // "10-13 Nov" or "10 to 13 Nov": a stay. Its single days stay visible to the literal rules (a caller may read either).
  const literalDayRange: Rule = {
    pattern: new RegExp(`\\b(?<day>\\d{1,2})${ORDINAL}\\s*(?:-|–|—|to|until|till)\\s*(?<endDay>\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi"),
    literal: true,
    hidesOverlaps: false,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "invalid" };
      const year = yearOf(groups);
      const start = literalOutcome(month, Number(groups.day), year, undefined, ctx);
      // The check-out is the nearest on-or-after occurrence of its day after the check-in, as the stay rule always read it.
      if (start.date === undefined) return refusedLiteral(start);
      const endDate = checkOutDate(month, Number(groups.endDay), year, start.date);
      if (endDate === undefined) return { kind: "unresolved", reason: "invalid" };
      if (!start.ok) return { kind: "unresolved", reason: start.reason, date: start.date, endDate, source: "literal" };
      return { kind: "day", date: start.date, source: "literal", endDate };
    },
  };
  const firstWeekOf: Rule = {
    pattern: new RegExp(`\\b(?:the\\s+)?(?:first|1st)\\s+week\\s+of\\s+${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "unknown" };
      const year = yearOf(groups);
      return monthWindow(monthCandidates(month, year, ctx), () => ({ first: 1, last: monthSpans.firstWeekDays }), "week", year !== undefined, ctx);
    },
  };
  const midMonth: Rule = {
    pattern: new RegExp(`\\b(?:mid(?:[\\s-]+)|middle\\s+of\\s+)${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "unknown" };
      const year = yearOf(groups);
      return monthWindow(monthCandidates(month, year, ctx), () => ({ first: monthSpans.midMonthFromDay, last: monthSpans.midMonthToDay }), "month", year !== undefined, ctx);
    },
  };
  const endOfTheMonth: Rule = {
    pattern: /\bend\s+of\s+(?:the\s+)?month\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => {
      // The current month's last days, or the next month's when they have passed.
      const todayYear = Number(ctx.today.slice(0, 4));
      const todayMonth = Number(ctx.today.slice(5, 7));
      return monthWindow(
        [{ year: todayYear, month: todayMonth }, nextMonthAfterToday(ctx)],
        (lastDay) => ({ first: lastDay - monthSpans.endOfMonthDays + 1, last: lastDay }),
        "week",
        false,
        ctx,
      );
    },
  };
  const endOfNamedMonth: Rule = {
    pattern: new RegExp(`\\bend\\s+of\\s+${MONTH_WITH_MAY}\\b${OPTIONAL_YEAR}`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const month = monthNumber(groups);
      if (month === undefined) return { kind: "unresolved", reason: "unknown" };
      const year = yearOf(groups);
      return monthWindow(monthCandidates(month, year, ctx), (lastDay) => ({ first: lastDay - monthSpans.endOfMonthDays + 1, last: lastDay }), "week", year !== undefined, ctx);
    },
  };
  const nextMonth: Rule = {
    pattern: /\bnext\s+month\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => {
      return monthWindow([nextMonthAfterToday(ctx)], (lastDay) => ({ first: 1, last: lastDay }), "month", false, ctx);
    },
  };
  const nextWeek: Rule = {
    pattern: /\bnext\s+week\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => {
      const earliest = followingWeekStart(ctx);
      const problem = arrivalProblem(earliest, ctx);
      if (problem !== undefined) return { kind: "unresolved", reason: problem, date: earliest };
      return { kind: "range", earliest, latest: addDays(earliest, DAYS_PER_WEEK - 1), grain: "week" };
    },
  };
  const weekend: Rule = {
    pattern: /\b(?<prefix>this\s+|next\s+)?weekend\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      // The weekend's check-in is the policy's weekday on or after today; "next weekend" is the one after.
      const checkIn = occurrenceOnOrAfter(ctx.policy.weekendCheckInWeekday, ctx);
      const start = /^next/i.test((groups.prefix ?? "").trim()) ? addDays(checkIn, DAYS_PER_WEEK) : checkIn;
      const checkOutOffset = (ctx.policy.weekendCheckOutWeekday - ctx.policy.weekendCheckInWeekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
      const latest = addDays(start, checkOutOffset);
      const problem = arrivalProblem(start, ctx);
      if (problem !== undefined) return { kind: "unresolved", reason: problem, date: start, endDate: latest };
      return { kind: "range", earliest: start, latest, grain: "weekend" };
    },
  };
  const nextWeekday: Rule = {
    pattern: new RegExp(`\\bnext\\s+${WEEKDAY_FULL}\\b`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const target = ABBREVIATED_WEEKDAYS[(groups.weekday ?? "").slice(0, 3).toLowerCase()];
      if (target === undefined) return { kind: "unresolved", reason: "unknown" };
      const coming = nextOccurrenceAfterToday(target, ctx);
      const following = addDays(followingWeekStart(ctx), (target - ctx.policy.weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK);
      const readings = [...new Set([coming, following])].sort();
      if (readings.length === 1 || !ctx.policy.nextWeekdayAmbiguousOn.includes(weekdayOf(ctx.today))) {
        return dayOrRefusal(following, "relative", ctx);
      }
      const beyond = readings.find((reading) => arrivalProblem(reading, ctx) !== undefined);
      if (beyond !== undefined) return { kind: "unresolved", reason: "beyond_horizon", date: beyond, source: "relative" };
      return { kind: "ambiguous", candidates: readings };
    },
  };
  const bareWeekday: Rule = {
    pattern: new RegExp(`\\b(?:this\\s+|on\\s+)?${WEEKDAY_FULL}\\b`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const target = ABBREVIATED_WEEKDAYS[(groups.weekday ?? "").slice(0, 3).toLowerCase()];
      if (target === undefined) return { kind: "unresolved", reason: "unknown" };
      return dayOrRefusal(occurrenceOnOrAfter(target, ctx), "relative", ctx);
    },
  };
  const nextTomorrow: Rule = {
    pattern: /\bnext\s+tomorrow\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => dayOrRefusal(addDays(ctx.today, ctx.policy.nextTomorrowDays), "relative", ctx),
  };
  const tomorrowRule: Rule = {
    pattern: /\btomorrow\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => dayOrRefusal(addDays(ctx.today, 1), "relative", ctx),
  };
  const todayRule: Rule = {
    pattern: /\b(?:tonight|today)\b/gi,
    literal: false,
    hidesOverlaps: true,
    resolve: (_groups, ctx) => dayOrRefusal(ctx.today, "relative", ctx),
  };
  const inCount: Rule = {
    pattern: new RegExp(`\\bin\\s+(?<count>\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?<unit>days?|weeks?)\\b`, "gi"),
    literal: false,
    hidesOverlaps: true,
    resolve: (groups, ctx) => {
      const count = countOf(groups.count);
      if (count === undefined) return { kind: "unresolved", reason: "unknown" };
      const unitDays = /^week/i.test(groups.unit ?? "") ? DAYS_PER_WEEK : 1;
      return dayOrRefusal(addDays(ctx.today, count * unitDays), "relative", ctx);
    },
  };
  return [
    literalDayRange,
    literalDayFirst,
    literalMonthFirst,
    firstWeekOf,
    midMonth,
    endOfTheMonth,
    endOfNamedMonth,
    nextMonth,
    nextWeek,
    weekend,
    nextWeekday,
    nextTomorrow,
    tomorrowRule,
    todayRule,
    inCount,
    bareWeekday,
    ...holidayRules(policy.fixedHolidays, policy.movingHolidays),
  ];
}

/** The calendar month after today's, in the Lagos calendar. */
function nextMonthAfterToday(ctx: Context): { readonly year: number; readonly month: number } {
  const todayYear = Number(ctx.today.slice(0, 4));
  const todayMonth = Number(ctx.today.slice(5, 7));
  return todayMonth === 12 ? { year: todayYear + 1, month: 1 } : { year: todayYear, month: todayMonth + 1 };
}

/** The months a month-named span can mean: the named month in the given year, or the nearest occurrence on or after today. */
function monthCandidates(month: number, year: number | undefined, ctx: Context): { readonly year: number; readonly month: number }[] {
  if (year !== undefined) return [{ year, month }];
  const todayYear = Number(ctx.today.slice(0, 4));
  return [{ year: todayYear, month }, { year: todayYear + 1, month }];
}

// ---- entry point ---------------------------------------------------------------------------------------------

/**
 * Every date phrase in `text`, resolved against the Africa/Lagos calendar date of `now` under `policy`. Results are in
 * text order. A phrase matched by one rule is not matched again by a later rule, so "next Friday" is never also "Friday".
 */
export function resolveStayDatePhrases(text: string, now: Date, policy: StayDatePolicy): readonly StayDateResolution[] {
  const ctx: Context = { today: dateKeyInLagos(now, "now"), policy };
  const found: StayDateResolution[] = [];
  const hidden: { readonly start: number; readonly end: number; readonly literal: boolean; readonly resolved: boolean }[] = [];
  for (const rule of buildRules(policy)) {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A resolved literal, or any non-literal match, hides overlapping matches; a refused literal hides only non-literals.
      const hiddenByEarlier = hidden.some((entry) => start < entry.end && entry.start < end && (entry.resolved || !rule.literal || !entry.literal));
      if (hiddenByEarlier) continue;
      const body = rule.resolve(match.groups ?? {}, ctx);
      found.push({ ...body, span: { start, end } } as StayDateResolution);
      if (rule.hidesOverlaps) hidden.push({ start, end, literal: rule.literal, resolved: body.kind !== "unresolved" });
    }
  }
  return found.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}
