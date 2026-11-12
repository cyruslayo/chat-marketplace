/**
 * The stay length the guest typed, in nights, weeks or months (issue 19; ADR 0092 as amended 1 Nov 2026; ADR 0023).
 *
 * `readStayLength` is pure and reads only the guest's own words. A closed list of phrases is read: "N nights", "a/one
 * night", "a/one week", "N weeks" (7 nights each), "a/one fortnight" (14), and "a/one month", "N months" for 1 to 12
 * (`billingPeriodNights` each, from EXTENDED_STAY_POLICY; ADR 0092: a month is one 30-night Billing Period).
 *
 * Vague or conflicting words give no length (`vague`), so the caller asks the guest, as when no length is given:
 * "a few months", "2-3 months", "2 or 3 months", "a couple of months", "a month and a half", "a month or two", and two
 * different lengths in one message. A range or an "or/and" phrase never reads as one of its numbers. "in N weeks" and
 * "in N months" are check-in phrases (ADR 0106), so an "in" before the count is never a length.
 *
 * The number words and the week length are the stay-date vocabulary (`stay-date-phrases.ts`).
 */
import { EXTENDED_STAY_POLICY, type ExtendedStayPolicy } from "./extended-stay.js";
import { DAYS_PER_WEEK, NUMBER_WORDS } from "./stay-date-phrases.js";

export type StayLengthUnit = "night" | "week" | "fortnight" | "month";

export type StayLengthReading =
  /** One length: `count` of `unit`, which is `nights` nights. Months and weeks are shown back in their own words. */
  | { readonly kind: "length"; readonly unit: StayLengthUnit; readonly count: number; readonly nights: number }
  /** A duration the guest wrote that does not give one length (a range, "a few", two lengths): the caller asks. */
  | { readonly kind: "vague" }
  /** No duration phrase at all. */
  | { readonly kind: "none" };

/** The months a guest can state in words or digits (issue 19: 1 to 12). The nights a month spans come from the policy. */
const MAX_STATED_MONTHS = 12;
const NIGHTS_PER_FORTNIGHT = 2 * DAYS_PER_WEEK;

/** An article count ("a", "an", "one") that a money amount directly precedes is a rate, not a length. */
const RATE_ARTICLE = /^(?:a|an|one)$/i;
const AMOUNT_BEFORE = /(?:\d[\d,.]*|\d[kKmM])\s*$/;
/** A money rate such as "₦70,000 a night", removed before the duration words are checked for vagueness. */
const RATE_PHRASE = /(?:\d[\d,.]*|\d[kKmM])\s*(?:a|an|one)\s+(?:nights?|weeks?|months?|fortnights?)\b/gi;

/** Count words, longest first so that "three" is never read as "one" or "t". */
const COUNT_WORDS = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|");
const COUNT = `(?<count>\\d{1,3}|${COUNT_WORDS})`;
/**
 * A count that is part of a range or an alternative ("2-3 months", "2 or 3 months", "2 to 3 weeks", "a month and a half"),
 * or that follows "in" (a check-in phrase): such a count gives no length.
 */
const NOT_A_SPAN_OR_CHECK_IN_BEFORE = "(?<!\\bin\\s+|\\d\\s*(?:-|–|/)\\s*|\\d\\s+(?:or|and|to)\\s+|\\b(?:or|and|to)\\s+|(?:-|–)\\s*)";
const NOT_A_SPAN_AFTER = "(?!\\s*(?:-|–|/)\\s*\\d|\\s+(?:or|and|to)\\b)";
const NIGHT_UNIT = "(?:nights?|nitesc?|nts?)";

interface LengthMatch {
  readonly index: number;
  readonly unit: StayLengthUnit;
  readonly count: number;
  readonly nights: number;
}

function countOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw.toLowerCase()];
}

function collect(
  text: string,
  pattern: RegExp,
  unit: StayLengthUnit,
  nightsFor: (count: number) => number | undefined,
  countValid: (count: number) => boolean,
): LengthMatch[] {
  const found: LengthMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const count = countOf(match.groups?.count);
    if (count === undefined || !countValid(count)) continue;
    // "a" or "one" after an amount is a rate ("₦70,000 a night", "₦300,000 a month"), never a length.
    if (RATE_ARTICLE.test(match.groups?.count ?? "") && AMOUNT_BEFORE.test(text.slice(0, match.index ?? 0))) continue;
    const nights = nightsFor(count);
    if (nights === undefined) continue;
    found.push({ index: match.index ?? 0, unit, count, nights });
  }
  return found;
}

/**
 * Reads the stay length from a message. Zero lengths read as `none`. One distinct length reads as `length`, and several
 * distinct lengths, or a phrase that the closed list rejects (a range, "a few"), read as `vague`.
 */
export function readStayLength(text: string, policy: Pick<ExtendedStayPolicy, "billingPeriodNights"> = EXTENDED_STAY_POLICY): StayLengthReading {
  const nightMatches = collect(
    text,
    new RegExp(`${NOT_A_SPAN_OR_CHECK_IN_BEFORE}\\b${COUNT}\\s*${NIGHT_UNIT}\\b${NOT_A_SPAN_AFTER}`, "gi"),
    "night",
    (count) => count,
    (count) => count >= 1,
  );
  const singularNightMatches = collect(
    text,
    new RegExp(`\\b(?<count>a|an|one)\\s+night\\b${NOT_A_SPAN_AFTER}`, "gi"),
    "night",
    (count) => count,
    (count) => count >= 1,
  );
  const weekMatches = collect(
    text,
    new RegExp(`${NOT_A_SPAN_OR_CHECK_IN_BEFORE}\\b${COUNT}\\s+weeks?\\b${NOT_A_SPAN_AFTER}`, "gi"),
    "week",
    (count) => count * DAYS_PER_WEEK,
    (count) => count >= 1,
  );
  const fortnightMatches = collect(
    text,
    /\b(?<count>a|one)\s+fortnight\b(?!\s*(?:-|–|or|and|to)\b)/gi,
    "fortnight",
    () => NIGHTS_PER_FORTNIGHT,
    () => true,
  );
  const monthMatches = collect(
    text,
    new RegExp(`${NOT_A_SPAN_OR_CHECK_IN_BEFORE}\\b${COUNT}\\s+months?\\b${NOT_A_SPAN_AFTER}`, "gi"),
    "month",
    (count) => count * policy.billingPeriodNights,
    (count) => count >= 1 && count <= MAX_STATED_MONTHS,
  );
  const all = [...nightMatches, ...singularNightMatches, ...weekMatches, ...fortnightMatches, ...monthMatches]
    .sort((a, b) => a.index - b.index);
  if (all.length === 0) return duration(text);
  const distinct = new Set(all.map((match) => match.nights));
  if (distinct.size > 1) return { kind: "vague" };
  // The first phrase names the unit, so "2 months (60 nights)" is shown back in months.
  const first = all[0]!;
  return { kind: "length", unit: first.unit, count: first.count, nights: first.nights };
}

/** A message with a duration word that did not read as one length is vague; one with none is `none`. */
function duration(text: string): StayLengthReading {
  const words = text.replace(RATE_PHRASE, " ");
  const vague = /\b(?:months?|fortnights?)\b|\b(?:few|couple of|several)\s+(?:weeks?|nights?)\b|\b\d{1,3}\s*(?:-|–|or|to|and)\s*\d{1,3}\s*(?:nights?|weeks?)\b/i.test(words);
  return vague ? { kind: "vague" } : { kind: "none" };
}
