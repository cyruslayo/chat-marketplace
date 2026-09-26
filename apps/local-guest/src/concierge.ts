/**
 * Local deterministic concierge interpreter for the guest demo.
 *
 * This is deliberately NOT a production LLM. It is a small regex-based
 * interpreter sufficient for the local demo flows. It must never be labelled
 * as an AI model inside the guest product UI; the local/dev documentation is
 * the only place that explains what it is.
 *
 * A single Guest turn only carries the facts the Guest chose to type. The
 * interpreter therefore separates *extraction* (what does this message say?)
 * from *merge* (what is the accumulated authoritative search context?) and
 * from *resolution* (is the accumulated context complete enough to search?).
 * Parsing a message must never replace the accumulated context with only the
 * facts found in the latest message.
 */

import { BOOKING_HORIZON_DAYS, MAX_STAY_NIGHTS, dateKeyInLagos } from "../../../domains/shortlet/src/index.js";
import { formatNgnKobo } from "../../web-agent/src/discovery-a2ui.js";

/**
 * Issue 03b / ADR-0015: a budget is compared with the All-In Stay Total and
 * never includes the Refundable Security Deposit (ADR-0016). A nightly budget
 * is kept as nightly and converted with the current nights at search time.
 */
export interface StayBudget {
  readonly kobo: number;
  readonly per: "stay" | "night";
}

export interface StayRequestFilters {
  readonly location: string;
  readonly neighbourhood?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
  /** Optional conversational refinement (for example "only show two bedrooms"). */
  readonly bedrooms?: number;
  /** Issue 03b: the budget as an All-In Stay Total for these dates (ADR-0015). */
  readonly maxPriceKobo?: number;
}

export type StayRequestInterpretation = StayRequestResolution;

export interface ConciergeOptions {
  /** The injected clock; every date phrase resolves against Africa/Lagos "today". */
  readonly now: Date;
}

/** A location explicitly named by the Guest, with the phrase they used. */
export interface StayRequestLocation {
  readonly city: string;
  readonly neighbourhood?: string;
  /** The Guest's own words (for example "Wuse" or "Lekki Phase 1"). */
  readonly label: string;
}

/**
 * A location the Guest named that contradicts the established city. It is held
 * on the accumulated context, never applied silently, until the Guest resolves
 * it or explicitly corrects the search.
 */
export interface PendingLocationChange {
  readonly city: string;
  readonly neighbourhood?: string;
  readonly label: string;
}

/**
 * The accumulated, server-owned discovery search context for one Guest thread.
 * Every field is optional: partial turns contribute whatever they contain and
 * the merge keeps everything already understood.
 */
export interface DiscoverySearchContext {
  readonly city?: string;
  readonly neighbourhood?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly pendingLocationChange?: PendingLocationChange;
  /** Arrival date (YYYY-MM-DD, Africa/Lagos). Never assumed; only given or confirmed. */
  readonly checkIn?: string;
  /** False while a resolved relative phrase ("this weekend") awaits the Guest's yes. */
  readonly datesConfirmed?: boolean;
  readonly budget?: StayBudget;
}

/**
 * Dates understood from one message. `given` dates were typed as calendar
 * dates; resolved relative phrases must be shown back and confirmed first.
 */
export interface StayRequestDates {
  readonly checkIn: string;
  readonly checkOut?: string;
  readonly given: boolean;
}

/** Facts understood from a single Guest message. Every field is optional. */
export interface StayRequestFacts {
  readonly location?: StayRequestLocation;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly dates?: StayRequestDates;
  readonly budget?: StayBudget;
  /** Preferences the Guest asked for that discovery cannot filter by yet (issue 02 AC3). */
  readonly unsupportedPreferences?: readonly string[];
}

export interface StayRequestConflict {
  readonly pending: PendingLocationChange;
  readonly question: string;
}

export interface StayRequestMergeOutcome {
  readonly context: DiscoverySearchContext;
  readonly conflict?: StayRequestConflict;
  /** True when this turn confirmed dates that were waiting for the Guest's yes. */
  readonly confirmedDates?: boolean;
}

/** The criteria asked for, in asking order: where, who, when, how long (issue 02). */
export type StayCriterion = "where" | "who" | "when" | "nights";

/**
 * Issue 11 AC3: one-tap answers to the criterion just asked for. Every reply
 * is a phrase this interpreter already understands, so tapping it fills that
 * criterion; relative dates still go through the confirmation step (issue 01).
 */
export function quickRepliesFor(next: StayCriterion): readonly string[] {
  switch (next) {
    case "where": return SEARCH_AREAS.filter((area) => area.neighbourhood !== undefined).map((area) => area.label);
    case "who": return ["Just me", "2 guests", "3 guests", "4 guests"];
    case "when": return ["This weekend", "Next weekend", "Next Friday"];
    case "nights": return ["1 night", "2 nights", "3 nights", "7 nights"];
  }
}

export type StayRequestResolution =
  | { readonly kind: "search"; readonly filters: StayRequestFilters }
  | { readonly kind: "clarify"; readonly missing: readonly string[]; readonly next: StayCriterion; readonly reply: string }
  /** Resolved dates are shown back as concrete dates; no search runs until confirmed. */
  | { readonly kind: "confirm"; readonly filters: StayRequestFilters; readonly reply: string }
  /** Dates outside launch limits (ADR-0023, ADR-0055), explained with the limit. */
  | { readonly kind: "refuse"; readonly reply: string };

const LOCATION_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly city: string;
  readonly neighbourhood?: string;
}[] = [
  { pattern: /\b(wuse\s*2|wuse\s*ii|wuse\s+two)\b/i, city: "Abuja", neighbourhood: "Wuse 2" },
  // Abuja/Wuse knowledge: a bare "Wuse" names the Abuja district even though
  // the accepted pilot inventory only carries the Wuse 2 neighbourhood.
  { pattern: /\bwuse\b/i, city: "Abuja" },
  { pattern: /\babuja\b/i, city: "Abuja" },
  { pattern: /\b(ikoyi|old ikoyi)\b/i, city: "Lagos", neighbourhood: "Old Ikoyi" },
  { pattern: /\b(lekki|lekki phase 1)\b/i, city: "Lagos", neighbourhood: "Lekki Phase 1" },
  { pattern: /\b(victoria island|vi)\b/i, city: "Lagos", neighbourhood: "Victoria Island" },
  { pattern: /\b(lagos)\b/i, city: "Lagos" },
];

const NIGHTS_PATTERN = /\b(\d{1,2})\s*(?:nights?|nitesc?|nts?)\b/i;
const GUESTS_PATTERN = /\b(\d{1,2})\s*(?:people|persons?|guests?|adults?|pax)\b/i;
const BEDROOMS_PATTERN = /\b(\d{1,2}|one|two|three|four)\s*[- ]?bedrooms?\b/i;
const BEDROOM_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4 };
const CORRECTION_PATTERN = /\b(actually|instead|rather|change (?:it )?to|change to|make it|switch to|correct it to)\b/i;
const KEEP_PATTERN = /\b(keep|stay (?:with|in)|stick with|remain in|leave it|no)\b/i;
const AFFIRMATION_PATTERN = /^(?:yes|yeah|yep|yup|sure|ok|okay|okey|go ahead|do it|confirm|confirmed|that works|sounds good)\b/i;

// Plain party phrases (issue 01 AC4). An explicit count ("4 guests") always wins.
const SOLO_PATTERN = /\b(?:just|only)\s+(?:me|myself)\b|\bby myself\b|\bon my own\b|\bsolo\b/i;
const PAIR_PATTERN = /\b(?:me|myself)\s+and\s+my\s+(?:wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?|friend|colleague|sister|brother|mum|mom|dad|son|daughter)\b|\bmy\s+(?:wife|husband|partner)\s+and\s+(?:i|me)\b|\b(?:a|as a)\s+couple\b|\b(?:the\s+)?two of us\b/i;

// Preferences discovery cannot filter by yet. They are acknowledged, never
// silently dropped and never applied (issue 02 AC3); area, dates, guests and
// bedrooms are the only filterable criteria.
const UNSUPPORTED_PREFERENCES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\b(quiet|peaceful)\b/i, label: "quiet" },
  { pattern: /\b(?:swimming\s+)?pool\b/i, label: "pool" },
  { pattern: /\bgym\b/i, label: "gym" },
  { pattern: /\bparking\b/i, label: "parking" },
  { pattern: /\b(?:wi-?fi|internet)\b/i, label: "Wi-Fi" },
  { pattern: /\bbalcony\b/i, label: "balcony" },
  { pattern: /\b(?:sea|ocean|lagoon|water)\s+view\b/i, label: "view" },
  { pattern: /\bpets?\b|\bpet-friendly\b/i, label: "pets" },
  { pattern: /\b(?:cheap|affordable|budget|luxury|luxurious)\b/i, label: "price level" },
  { pattern: /\b(?:generator|24\/7 power|constant power|steady power)\b/i, label: "power backup" },
  { pattern: /\bkitchen\b/i, label: "kitchen" },
  { pattern: /\b(?:workspace|desk)\b/i, label: "workspace" },
];

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAME = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const ORDINAL = "(?:st|nd|rd|th)?";
const DAY_MONTH_RANGE = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s*(?:-|–|—|to|until|till)\\s*(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(${MONTH_NAME})\\b`, "i");
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(${MONTH_NAME})\\b`, "gi");
// "May" leads too many ordinary sentences ("may 2 people stay"), so month-first dates skip it.
const MONTH_DAY = new RegExp(`\\b(${MONTH_NAME.replace("|may|", "|")})\\.?\\s+(\\d{1,2})${ORDINAL}\\b`, "gi");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_PATTERN = /\b(this\s+|next\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

function dayNumber(dateIso: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function fromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function addCalendarDays(dateIso: string, days: number): string {
  return fromDayNumber(dayNumber(dateIso) + days);
}

function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

/** "Fri 4 Sept 2026": every resolved date is shown back concretely (issue 01). */
export function formatGuestDay(dateIso: string): string {
  // ADR-0077: en-NG dates across channels.
  const parts = new Intl.DateTimeFormat("en-NG", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .formatToParts(new Date(`${dateIso}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

/** The next occurrence of a day and month on or after today (Africa/Lagos). */
function calendarDate(day: number, month: number, today: string): string | undefined {
  const year = Number(today.slice(0, 4));
  for (const candidateYear of [year, year + 1]) {
    const candidate = `${candidateYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) return undefined;
    if (candidate >= today) return candidate;
  }
  return undefined;
}

function explicitDates(text: string, today: string): StayRequestDates | undefined {
  const range = DAY_MONTH_RANGE.exec(text);
  if (range) {
    const month = MONTHS[range[3]!.toLowerCase()];
    const checkIn = month === undefined ? undefined : calendarDate(Number(range[1]), month, today);
    const checkOutDay = month === undefined ? undefined : calendarDate(Number(range[2]), month, checkIn ?? today);
    if (checkIn !== undefined && checkOutDay !== undefined) return { checkIn, checkOut: checkOutDay, given: true };
  }
  const mentions: { readonly index: number; readonly date: string }[] = [];
  for (const match of text.matchAll(DAY_MONTH)) {
    const month = MONTHS[match[2]!.toLowerCase()];
    const date = month === undefined ? undefined : calendarDate(Number(match[1]), month, today);
    if (date !== undefined) mentions.push({ index: match.index ?? 0, date });
  }
  for (const match of text.matchAll(MONTH_DAY)) {
    const month = MONTHS[match[1]!.toLowerCase()];
    const date = month === undefined ? undefined : calendarDate(Number(match[2]), month, today);
    if (date !== undefined) mentions.push({ index: match.index ?? 0, date });
  }
  mentions.sort((left, right) => left.index - right.index);
  const [first, second] = mentions;
  if (first === undefined) return undefined;
  if (second !== undefined && second.date > first.date) return { checkIn: first.date, checkOut: second.date, given: true };
  return { checkIn: first.date, given: true };
}

function relativeDates(text: string, today: string): StayRequestDates | undefined {
  if (/\b(?:tonight|today)\b/i.test(text)) return { checkIn: today, given: false };
  if (/\btomorrow\b/i.test(text)) return { checkIn: addCalendarDays(today, 1), given: false };
  const weekend = /\b(this\s+|next\s+)?weekend\b/i.exec(text);
  if (weekend) {
    // Friday check-in, Sunday check-out, on or after the injected clock.
    const friday = addCalendarDays(today, (5 - weekdayOf(today) + 7) % 7);
    const checkIn = /next/i.test(weekend[1] ?? "") ? addCalendarDays(friday, 7) : friday;
    return { checkIn, checkOut: addCalendarDays(checkIn, 2), given: false };
  }
  const weekday = WEEKDAY_PATTERN.exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!.toLowerCase() as typeof WEEKDAYS[number]);
    if (/next/i.test(weekday[1] ?? "")) {
      // "next Friday" is that weekday in the following Monday-start week.
      const nextMonday = addCalendarDays(today, 7 - ((weekdayOf(today) + 6) % 7));
      return { checkIn: addCalendarDays(nextMonday, (target + 6) % 7), given: false };
    }
    return { checkIn: addCalendarDays(today, (target - weekdayOf(today) + 7) % 7), given: false };
  }
  return undefined;
}

/** Builds a context object without ever materialising `undefined` keys. */
function buildContext(parts: {
  readonly city?: string;
  readonly neighbourhood?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly pendingLocationChange?: PendingLocationChange;
  readonly checkIn?: string;
  readonly datesConfirmed?: boolean;
  readonly budget?: StayBudget;
}): DiscoverySearchContext {
  return {
    ...(parts.budget === undefined ? {} : { budget: { kobo: parts.budget.kobo, per: parts.budget.per } }),
    ...(parts.city === undefined ? {} : { city: parts.city }),
    ...(parts.neighbourhood === undefined ? {} : { neighbourhood: parts.neighbourhood }),
    ...(parts.nights === undefined ? {} : { nights: parts.nights }),
    ...(parts.partySize === undefined ? {} : { partySize: parts.partySize }),
    ...(parts.bedrooms === undefined ? {} : { bedrooms: parts.bedrooms }),
    ...(parts.pendingLocationChange === undefined ? {} : { pendingLocationChange: parts.pendingLocationChange }),
    ...(parts.checkIn === undefined ? {} : { checkIn: parts.checkIn, datesConfirmed: parts.datesConfirmed === true }),
  };
}

function scalarParts(context: DiscoverySearchContext): {
  readonly city?: string;
  readonly neighbourhood?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly checkIn?: string;
  readonly datesConfirmed?: boolean;
  readonly budget?: StayBudget;
} {
  return {
    ...(context.budget === undefined ? {} : { budget: context.budget }),
    ...(context.city === undefined ? {} : { city: context.city }),
    ...(context.neighbourhood === undefined ? {} : { neighbourhood: context.neighbourhood }),
    ...(context.nights === undefined ? {} : { nights: context.nights }),
    ...(context.partySize === undefined ? {} : { partySize: context.partySize }),
    ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
    ...(context.checkIn === undefined ? {} : { checkIn: context.checkIn, datesConfirmed: context.datesConfirmed === true }),
  };
}

/** Resolves the first accepted Lagos/Abuja location phrase in a message. */
export function resolveLocationMention(text: string): StayRequestLocation | undefined {
  const normalized = text.trim();
  for (const candidate of LOCATION_PATTERNS) {
    const match = candidate.pattern.exec(normalized);
    if (!match) continue;
    return {
      city: candidate.city,
      ...(candidate.neighbourhood === undefined ? {} : { neighbourhood: candidate.neighbourhood }),
      label: match[0],
    };
  }
  return undefined;
}

const NAIRA_AMOUNT = "(₦|ngn\\s*|n(?=\\d))?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?\\b\\s*(naira)?";
const PER_NIGHT = "(\\s*(?:a|per|\\/|each|every)\\s*night)?";
// Words a Guest puts between "budget" and the amount ("my budget is around ₦400k").
const BUDGET_FILLER = "(?:\\s+(?:is|of|about|around|roughly|approximately|approx\\.?|at most|max|maximum))*";
const BUDGET_PATTERN = new RegExp(`\\b(?:budget${BUDGET_FILLER}|under|below|max(?:imum)?|up to|no more than|not more than|less than)\\s*:?\\s*${NAIRA_AMOUNT}${PER_NIGHT}`, "gi");
// The amount first: "₦400k budget", "500,000 naira total budget".
const AMOUNT_BUDGET_PATTERN = new RegExp(`${NAIRA_AMOUNT}${PER_NIGHT}\\s+(?:total\\s+)?budget\\b`, "gi");
const PRICED_NIGHT_PATTERN = new RegExp(`(₦|ngn\\s*)\\s*(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?\\b\\s*(naira)?(\\s*(?:a|per|\\/|each|every)\\s*night)`, "gi");
const AMOUNT_MULTIPLIERS: Readonly<Record<string, number>> = { k: 1_000, thousand: 1_000, m: 1_000_000, million: 1_000_000 };

/**
 * Issue 03b: "budget ₦500k", "under 200,000 naira", "₦60k a night". A bare
 * small number ("under 3 nights", "max 4 guests") is never read as money: it
 * needs a currency mark, a k/m multiplier, "naira", or at least ₦1,000.
 */
function extractBudget(text: string): StayBudget | undefined {
  for (const match of [...text.matchAll(BUDGET_PATTERN), ...text.matchAll(AMOUNT_BUDGET_PATTERN), ...text.matchAll(PRICED_NIGHT_PATTERN)]) {
    const [, currency, digits, multiplier, naira, perNight] = match;
    const value = Number.parseFloat((digits ?? "").replaceAll(",", "")) * (multiplier ? AMOUNT_MULTIPLIERS[multiplier.toLowerCase()] ?? 1 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!currency && !multiplier && !naira && value < 1_000) continue;
    return { kobo: Math.round(value * 100), per: perNight ? "night" : "stay" };
  }
  return undefined;
}

/**
 * The budget as shown back to the Guest (approved decision, 25 Sept 2026):
 * converted to a stay total with the current nights and "all fees
 * included". It is qualified with "About" until arrival, nights and party size
 * are all known, because only then can an All-In Stay Total be quoted
 * (ADR-0015).
 */
export function budgetLabel(context: DiscoverySearchContext): string | undefined {
  const budget = context.budget;
  if (!budget) return undefined;
  const nights = context.nights;
  if (budget.per === "night" && nights === undefined) return `About ${formatNgnKobo(budget.kobo)} a night`;
  const total = budget.per === "night" && nights !== undefined ? budget.kobo * nights : budget.kobo;
  const stay = nights === undefined ? "" : ` for ${nights} ${nights === 1 ? "night" : "nights"}`;
  const text = `${formatNgnKobo(total)} total${stay}, all fees included`;
  const quotable = context.checkIn !== undefined && nights !== undefined && context.partySize !== undefined;
  return quotable ? text : `About ${text}`;
}

/** The budget as an All-In Stay Total for the current nights, or undefined without both. */
export function stayBudgetKobo(context: DiscoverySearchContext): number | undefined {
  if (!context.budget) return undefined;
  if (context.budget.per === "stay") return context.budget.kobo;
  return context.nights === undefined ? undefined : context.budget.kobo * context.nights;
}

/**
 * Extracts only the facts present in one message. Missing facts stay missing;
 * they are never inferred from, or replaced by, the rest of the conversation.
 */
export function extractStayRequestFacts(text: string, options: { readonly now?: Date } = {}): StayRequestFacts {
  const normalized = text.trim();
  const location = resolveLocationMention(normalized);
  const nightsMatch = NIGHTS_PATTERN.exec(normalized);
  const guestsMatch = GUESTS_PATTERN.exec(normalized);
  const bedroomsMatch = BEDROOMS_PATTERN.exec(normalized);
  const rangeDates = options.now === undefined ? undefined : explicitDates(normalized, dateKeyInLagos(options.now, "now"));
  const dates = rangeDates ?? (options.now === undefined ? undefined : relativeDates(normalized, dateKeyInLagos(options.now, "now")));
  // A check-out date fixes the number of nights; otherwise use the nights the Guest typed.
  const nights = dates?.checkOut !== undefined
    ? dayNumber(dates.checkOut) - dayNumber(dates.checkIn)
    : nightsMatch ? Number.parseInt(nightsMatch[1] ?? "", 10) : undefined;
  const partySize = guestsMatch ? Number.parseInt(guestsMatch[1] ?? "", 10)
    : SOLO_PATTERN.test(normalized) ? 1
      : PAIR_PATTERN.test(normalized) ? 2 : undefined;
  const bedroomsToken = bedroomsMatch?.[1]?.toLowerCase();
  const bedrooms = bedroomsToken === undefined ? undefined : (BEDROOM_WORDS[bedroomsToken] ?? Number.parseInt(bedroomsToken, 10));
  const budget = extractBudget(normalized);
  // A stated amount is a supported budget (issue 03b), not an unfilterable "price level".
  const unsupportedPreferences = UNSUPPORTED_PREFERENCES.filter((preference) => preference.pattern.test(normalized))
    .map((preference) => preference.label)
    .filter((label) => budget === undefined || label !== "price level");
  return {
    ...(budget === undefined ? {} : { budget }),
    ...(location === undefined ? {} : { location }),
    ...(nights === undefined || Number.isNaN(nights) || nights < 1 ? {} : { nights }),
    ...(partySize === undefined || Number.isNaN(partySize) || partySize < 1 ? {} : { partySize }),
    ...(bedrooms === undefined || Number.isNaN(bedrooms) || bedrooms < 1 ? {} : { bedrooms }),
    ...(dates === undefined ? {} : { dates }),
    ...(unsupportedPreferences.length === 0 ? {} : { unsupportedPreferences }),
  };
}

// Questions about a Unit's facilities, answered only from `unit.amenities`
// (issue 04a AC2). An entry without ids is never listed by the catalogue, so
// the answer is always that it isn't listed.
const AMENITY_QUESTIONS: readonly { readonly pattern: RegExp; readonly label: string; readonly ids: readonly string[] }[] = [
  { pattern: /\bparking\b/i, label: "Parking", ids: ["parking"] },
  { pattern: /\b(?:swimming\s+)?pool\b/i, label: "A pool", ids: ["swimming_pool"] },
  { pattern: /\b(?:wi-?fi|internet)\b/i, label: "Wi-Fi", ids: ["wifi"] },
  { pattern: /\b(?:generator|backup power|24\/7 power|light|power)\b/i, label: "Backup power", ids: ["24_7_power_generator", "generator"] },
  { pattern: /\b(?:security|guards?)\b/i, label: "On-site security", ids: ["security_guard"] },
  { pattern: /\b(?:air[- ]?con(?:ditioning)?|a\/c|ac)\b/i, label: "Air conditioning", ids: ["air_conditioning"] },
  { pattern: /\b(?:workspace|desk)\b/i, label: "A workspace", ids: ["workspace"] },
  { pattern: /\bgym\b/i, label: "A gym", ids: [] },
  { pattern: /\bkitchen\b/i, label: "A kitchen", ids: [] },
  { pattern: /\bbalcony\b/i, label: "A balcony", ids: [] },
];
const QUESTION_PATTERN = /\?|\b(?:is there|are there|does (?:it|the (?:apartment|place|flat)) have|do (?:you|they) have|has it got|what about)\b/i;
const CHANGE_PATTERN = /\b(?:make it|change|extend|shorten|move (?:it|the dates)|add (?:a|another|one more) night|fewer nights|more nights)\b/i;

/** Facility questions in a message, in the order the catalogue lists them. */
export function amenityQuestions(text: string): readonly { readonly label: string; readonly ids: readonly string[] }[] {
  if (!QUESTION_PATTERN.test(text)) return [];
  return AMENITY_QUESTIONS.filter((question) => question.pattern.test(text)).map(({ label, ids }) => ({ label, ids }));
}

/** True when a message asks to change the stay (dates, nights, guests or area). */
export function stayChangeRequested(facts: StayRequestFacts, text: string): boolean {
  return facts.dates !== undefined || facts.nights !== undefined || facts.partySize !== undefined || facts.location !== undefined || CHANGE_PATTERN.test(text);
}

/** Acknowledges preferences that cannot be applied, so nothing is silently dropped. */
export function unsupportedPreferenceNote(labels: readonly string[] | undefined): string | undefined {
  if (labels === undefined || labels.length === 0) return undefined;
  const quoted = labels.map((label) => `“${label}”`);
  const list = quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
  return `I can't filter by ${list} yet, so ${labels.length === 1 ? "it isn't" : "they aren't"} applied to the search.`;
}

function locationMatches(candidate: StayRequestLocation | PendingLocationChange, target: { readonly city: string; readonly neighbourhood?: string }): boolean {
  if (candidate.city !== target.city) return false;
  return candidate.neighbourhood === undefined || target.neighbourhood === undefined || candidate.neighbourhood === target.neighbourhood;
}

/** Applies a location, preserving an existing neighbourhood within the same city. */
function applyLocation(context: DiscoverySearchContext, location: { readonly city: string; readonly neighbourhood?: string }): DiscoverySearchContext {
  const neighbourhood = location.neighbourhood ?? (context.city === location.city ? context.neighbourhood : undefined);
  return buildContext({ ...scalarParts(context), city: location.city, ...(neighbourhood === undefined ? {} : { neighbourhood }) });
}

function withPending(context: DiscoverySearchContext, pending: PendingLocationChange): DiscoverySearchContext {
  return buildContext({ ...scalarParts(context), pendingLocationChange: pending });
}

function locationConflictQuestion(pending: PendingLocationChange, context: DiscoverySearchContext): string {
  const wanted = pending.label.toLowerCase() === pending.city.toLowerCase() ? pending.city : `${pending.label} in ${pending.city}`;
  const incumbent = context.neighbourhood === undefined ? context.city ?? "your current search" : `${context.neighbourhood} in ${context.city ?? ""}`.trim();
  return `Do you want ${wanted}, or should I keep searching in ${incumbent}?`;
}

/**
 * Merges newly extracted facts into the accumulated context.
 *
 * previous authoritative discovery context + newly extracted facts = updated
 * discovery context. A location that contradicts the established city is
 * surfaced as an intentional conflict instead of silently discarding the
 * existing search; nights, guests and bedroom refinements are always kept.
 */
export function mergeStayRequestContext(
  previous: DiscoverySearchContext | null | undefined,
  facts: StayRequestFacts,
  text = "",
): StayRequestMergeOutcome {
  let context = buildContext(previous ?? {});
  const correction = CORRECTION_PATTERN.test(text);
  const supplied = facts.location;

  // 1. An outstanding location conflict is resolved first, but only when this
  //    turn actually answers it. An unrelated turn keeps the question open.
  const pending = context.pendingLocationChange;
  if (pending !== undefined && supplied === undefined) {
    if (KEEP_PATTERN.test(text)) {
      context = buildContext(scalarParts(context));
    } else if (AFFIRMATION_PATTERN.test(text)) {
      context = applyLocation(buildContext(scalarParts(context)), pending);
    }
  }

  // 2. Apply a location named in this turn. Naming the pending city confirms
  //    the change; naming the established city keeps it; naming a third city
  //    raises an intentional conflict; an explicit correction ("actually")
  //    switches immediately.
  let conflict: StayRequestConflict | undefined;
  const establishedCity = context.city;
  if (supplied !== undefined) {
    const confirmsPending = pending !== undefined && locationMatches(supplied, pending);
    if (confirmsPending) {
      context = applyLocation(buildContext(scalarParts(context)), pending);
    } else if (establishedCity !== undefined && establishedCity !== supplied.city && !correction) {
      const nextPending: PendingLocationChange = {
        city: supplied.city,
        ...(supplied.neighbourhood === undefined ? {} : { neighbourhood: supplied.neighbourhood }),
        label: supplied.label,
      };
      context = withPending(context, nextPending);
      conflict = { pending: nextPending, question: locationConflictQuestion(nextPending, context) };
    } else {
      context = applyLocation(buildContext(scalarParts(context)), supplied);
    }
  } else if (pending !== undefined && KEEP_PATTERN.test(text) === false && AFFIRMATION_PATTERN.test(text) === false) {
    conflict = { pending, question: locationConflictQuestion(pending, context) };
  }

  // 3. A plain "yes" confirms dates that were shown back and are awaiting the
  //    Guest (issue 01 AC1). New dates in this turn replace them instead.
  const confirmedDates = facts.dates === undefined && context.checkIn !== undefined
    && context.datesConfirmed !== true && AFFIRMATION_PATTERN.test(text.trim());

  // 4. Merge scalar facts; whichever slot was supplied is replaced, the rest
  //    are preserved.
  context = buildContext({
    ...scalarParts(context),
    ...(facts.nights === undefined ? {} : { nights: facts.nights }),
    ...(facts.partySize === undefined ? {} : { partySize: facts.partySize }),
    ...(facts.bedrooms === undefined ? {} : { bedrooms: facts.bedrooms }),
    ...(facts.budget === undefined ? {} : { budget: facts.budget }),
    ...(facts.dates === undefined ? {} : { checkIn: facts.dates.checkIn, datesConfirmed: facts.dates.given }),
    ...(confirmedDates ? { datesConfirmed: true } : {}),
    ...(context.pendingLocationChange === undefined ? {} : { pendingLocationChange: context.pendingLocationChange }),
  });

  if (conflict === undefined && context.pendingLocationChange !== undefined) {
    conflict = { pending: context.pendingLocationChange, question: locationConflictQuestion(context.pendingLocationChange, context) };
  }
  return { context, ...(conflict === undefined ? {} : { conflict }), ...(confirmedDates ? { confirmedDates } : {}) };
}

/**
 * Every criterion the server-owned context holds (ADR-0004), in guest words.
 * Unconfirmed dates are marked as still to confirm.
 */
function knownCriteria(context: DiscoverySearchContext): string[] {
  const criteria: string[] = [];
  if (context.city !== undefined) criteria.push(context.neighbourhood === undefined ? context.city : `${context.neighbourhood}, ${context.city}`);
  if (context.partySize !== undefined) criteria.push(`${context.partySize} ${context.partySize === 1 ? "guest" : "guests"}`);
  if (context.checkIn !== undefined) {
    const stay = context.nights === undefined
      ? `arriving ${formatGuestDay(context.checkIn)}`
      : `${formatGuestDay(context.checkIn)} to ${formatGuestDay(addCalendarDays(context.checkIn, context.nights))}`;
    criteria.push(context.datesConfirmed === true ? stay : `${stay} (to confirm)`);
  }
  if (context.nights !== undefined) criteria.push(`${context.nights} ${context.nights === 1 ? "night" : "nights"}`);
  if (context.bedrooms !== undefined) criteria.push(`${context.bedrooms} ${context.bedrooms === 1 ? "bedroom" : "bedrooms"}`);
  const budget = budgetLabel(context);
  if (budget !== undefined) criteria.push(`budget ${budget.startsWith("About") ? `about ${budget.slice("About ".length)}` : budget}`);
  return criteria;
}

/** Restates what is understood, then asks only for the next missing criterion (issue 02). */
function clarifyReply(context: DiscoverySearchContext, missing: readonly string[]): string {
  const criteria = knownCriteria(context);
  const ask = `Could you tell me ${missing[0]}?`;
  return criteria.length > 0 ? `So far I have: ${criteria.join(" · ")}. ${ask}` : `I can help you find a place. ${ask}`;
}

/**
 * Decides whether the accumulated context can execute an authoritative
 * discovery query, or which missing inputs still have to be asked for.
 */
/** Refuses dates outside launch limits with a plain statement of the limit. */
function dateLimitRefusal(checkIn: string, nights: number, today: string): string | undefined {
  // ADR-0023: one through fourteen nights.
  if (nights > MAX_STAY_NIGHTS) return `Stays can be at most ${MAX_STAY_NIGHTS} nights. Please choose ${MAX_STAY_NIGHTS} nights or fewer.`;
  if (checkIn < today) return "That arrival date has already passed. Please choose today or a later date.";
  // ADR-0055: the horizon limits check-in only; a stay may end after day 90.
  const latestArrival = addCalendarDays(today, BOOKING_HORIZON_DAYS);
  if (checkIn > latestArrival) return `Arrival dates can be at most ${BOOKING_HORIZON_DAYS} days ahead, so the latest arrival is ${formatGuestDay(latestArrival)}. Please choose an earlier date.`;
  return undefined;
}

/**
 * Decides whether the accumulated context can execute an authoritative
 * discovery query, or which missing inputs still have to be asked for. Dates
 * are never assumed: they are given by the Guest or confirmed by them.
 */
export function resolveStayRequestContext(
  context: DiscoverySearchContext,
  options: { readonly now: Date },
): StayRequestResolution {
  const city = context.city;
  const nights = context.nights;
  const partySize = context.partySize;
  const checkIn = context.checkIn;
  const today = dateKeyInLagos(options.now, "now");
  if (checkIn !== undefined && nights !== undefined) {
    const refusal = dateLimitRefusal(checkIn, nights, today);
    if (refusal !== undefined) return { kind: "refuse", reply: refusal };
  }
  const missing: string[] = [];
  // Asked one at a time in this order: where, who, when, how long.
  if (city === undefined) missing.push("where you want to stay (for example: Ikoyi or Lekki, Lagos)");
  if (partySize === undefined) missing.push("how many guests are staying");
  if (checkIn === undefined) missing.push("what date you arrive (for example: 10 Sept or this Friday)");
  if (nights === undefined) missing.push("how many nights you need");
  if (city === undefined || checkIn === undefined || nights === undefined || partySize === undefined) {
    const next: StayCriterion = city === undefined ? "where" : partySize === undefined ? "who" : checkIn === undefined ? "when" : "nights";
    return { kind: "clarify", missing, next, reply: clarifyReply(context, missing) };
  }
  const checkOut = addCalendarDays(checkIn, nights);
  const filters: StayRequestFilters = {
    location: city,
    ...(context.neighbourhood === undefined ? {} : { neighbourhood: context.neighbourhood }),
    checkIn,
    checkOut,
    partySize,
    ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
    // ADR-0015: the budget filters on the All-In Stay Total for these nights.
    ...(context.budget === undefined ? {} : { maxPriceKobo: stayBudgetKobo(context)! }),
  };
  if (context.datesConfirmed !== true) {
    const place = context.neighbourhood ?? city;
    return {
      kind: "confirm",
      filters,
      reply: `Just to check: arriving ${formatGuestDay(checkIn)} and leaving ${formatGuestDay(checkOut)} (${nights} ${nights === 1 ? "night" : "nights"}), ${partySize} ${partySize === 1 ? "guest" : "guests"} in ${place}. Shall I search these dates? Reply "yes", or tell me different dates.`,
    };
  }
  return { kind: "search", filters };
}

/**
 * Issue 03a: the areas a Guest can pick on the criteria strip and on the
 * conventional search form (ADR-0080). They are the locations the concierge
 * already understands in free text; no new inventory area is invented here.
 */
export const SEARCH_AREAS: readonly { readonly id: string; readonly label: string; readonly city: string; readonly neighbourhood?: string }[] = Object.freeze([
  { id: "abuja", label: "Abuja (all areas)", city: "Abuja" },
  { id: "wuse-2", label: "Wuse 2, Abuja", city: "Abuja", neighbourhood: "Wuse 2" },
  { id: "lagos", label: "Lagos (all areas)", city: "Lagos" },
  { id: "old-ikoyi", label: "Old Ikoyi, Lagos", city: "Lagos", neighbourhood: "Old Ikoyi" },
  { id: "lekki-phase-1", label: "Lekki Phase 1, Lagos", city: "Lagos", neighbourhood: "Lekki Phase 1" },
  { id: "victoria-island", label: "Victoria Island, Lagos", city: "Lagos", neighbourhood: "Victoria Island" },
]);

export function searchAreaFor(context: DiscoverySearchContext): typeof SEARCH_AREAS[number] | undefined {
  if (context.city === undefined) return undefined;
  return SEARCH_AREAS.find((area) => area.city === context.city && area.neighbourhood === context.neighbourhood);
}

export type CriteriaEdit =
  | { readonly field: "where"; readonly area: string }
  | { readonly field: "when"; readonly checkIn: string; readonly nights: number }
  | { readonly field: "guests"; readonly partySize: number }
  | { readonly field: "budget"; readonly budget: StayBudget | null };

/**
 * Applies one strip edit to the accumulated context (issue 03a). A chip's
 * dates are typed calendar dates, so they count as confirmed (issue 01).
 * Returns null for an unknown area; policy limits are checked afterwards by
 * `resolveStayRequestContext`, like any other criteria.
 */
export function applyCriteriaEdit(context: DiscoverySearchContext | null, edit: CriteriaEdit): DiscoverySearchContext | null {
  const current = context ?? {};
  if (edit.field === "where") {
    const area = SEARCH_AREAS.find((candidate) => candidate.id === edit.area);
    if (!area) return null;
    // Picking an area answers any open location question.
    const { pendingLocationChange: _pending, neighbourhood: _neighbourhood, ...rest } = current;
    return buildContext({ ...rest, city: area.city, ...(area.neighbourhood === undefined ? {} : { neighbourhood: area.neighbourhood }) });
  }
  if (edit.field === "when") return buildContext({ ...current, checkIn: edit.checkIn, nights: edit.nights, datesConfirmed: true });
  if (edit.field === "budget") {
    // A null budget removes it.
    const { budget: _budget, ...rest } = current;
    return buildContext(edit.budget === null ? rest : { ...rest, budget: edit.budget });
  }
  return buildContext({ ...current, partySize: edit.partySize });
}

/**
 * Single-message compatibility entry point: extract, merge against an empty
 * context and resolve. Multi-turn callers must use the merge/resolve pair so
 * earlier turns are never discarded.
 */
export function interpretStayRequest(text: string, options: ConciergeOptions): StayRequestInterpretation {
  const merged = mergeStayRequestContext(null, extractStayRequestFacts(text, { now: options.now }), text);
  return resolveStayRequestContext(merged.context, { now: options.now });
}

/**
 * Validates an unknown persisted search context. Invalid contexts fail closed
 * (null) so a corrupt durable projection can never drive discovery.
 */
export function parseDiscoverySearchContext(value: unknown): DiscoverySearchContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const optionalString = (candidate: unknown): boolean => candidate === undefined || typeof candidate === "string";
  const optionalPositiveInteger = (candidate: unknown): boolean =>
    candidate === undefined || (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 1);
  if (!optionalString(record.city) || !optionalString(record.neighbourhood)) return null;
  if (!optionalPositiveInteger(record.nights) || !optionalPositiveInteger(record.partySize) || !optionalPositiveInteger(record.bedrooms)) return null;
  if (record.checkIn !== undefined && (typeof record.checkIn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.checkIn))) return null;
  if (record.datesConfirmed !== undefined && typeof record.datesConfirmed !== "boolean") return null;
  const rawBudget = record.budget;
  let budget: StayBudget | undefined;
  if (rawBudget !== undefined) {
    if (typeof rawBudget !== "object" || rawBudget === null || Array.isArray(rawBudget)) return null;
    const budgetRecord = rawBudget as Record<string, unknown>;
    if (!optionalPositiveInteger(budgetRecord.kobo) || budgetRecord.kobo === undefined || (budgetRecord.per !== "stay" && budgetRecord.per !== "night")) return null;
    budget = { kobo: budgetRecord.kobo as number, per: budgetRecord.per };
  }
  let pending: PendingLocationChange | undefined;
  const rawPending = record.pendingLocationChange;
  if (rawPending !== undefined && rawPending !== null) {
    if (typeof rawPending !== "object" || Array.isArray(rawPending)) return null;
    const pendingRecord = rawPending as Record<string, unknown>;
    if (typeof pendingRecord.city !== "string" || typeof pendingRecord.label !== "string") return null;
    if (!optionalString(pendingRecord.neighbourhood)) return null;
    pending = {
      city: pendingRecord.city,
      label: pendingRecord.label,
      ...(typeof pendingRecord.neighbourhood === "string" ? { neighbourhood: pendingRecord.neighbourhood } : {}),
    };
  }
  return buildContext({
    ...(typeof record.city === "string" ? { city: record.city } : {}),
    ...(typeof record.neighbourhood === "string" ? { neighbourhood: record.neighbourhood } : {}),
    ...(typeof record.nights === "number" ? { nights: record.nights } : {}),
    ...(typeof record.partySize === "number" ? { partySize: record.partySize } : {}),
    ...(typeof record.bedrooms === "number" ? { bedrooms: record.bedrooms } : {}),
    ...(pending === undefined ? {} : { pendingLocationChange: pending }),
    ...(typeof record.checkIn === "string" ? { checkIn: record.checkIn, datesConfirmed: record.datesConfirmed === true } : {}),
    ...(budget === undefined ? {} : { budget }),
  });
}
