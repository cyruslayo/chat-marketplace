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

export interface StayRequestFilters {
  readonly location: string;
  readonly neighbourhood?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
  /** Optional conversational refinement (for example "only show two bedrooms"). */
  readonly bedrooms?: number;
}

export type StayRequestInterpretation =
  | { readonly kind: "search"; readonly filters: StayRequestFilters }
  | { readonly kind: "clarify"; readonly missing: readonly string[]; readonly reply: string };

export interface ConciergeOptions {
  readonly demoCheckIn: string;
  /** Retained for callers that supplied the old fixed-date option; ignored. */
  readonly demoCheckOut?: string;
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
}

/** Facts understood from a single Guest message. Every field is optional. */
export interface StayRequestFacts {
  readonly location?: StayRequestLocation;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
}

export interface StayRequestConflict {
  readonly pending: PendingLocationChange;
  readonly question: string;
}

export interface StayRequestMergeOutcome {
  readonly context: DiscoverySearchContext;
  readonly conflict?: StayRequestConflict;
}

export type StayRequestResolution =
  | { readonly kind: "search"; readonly filters: StayRequestFilters }
  | { readonly kind: "clarify"; readonly missing: readonly string[]; readonly reply: string };

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

function addCalendarDays(dateIso: string, nights: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError("demoCheckIn must be an ISO calendar date");
  date.setUTCDate(date.getUTCDate() + nights);
  return date.toISOString().slice(0, 10);
}

/** Builds a context object without ever materialising `undefined` keys. */
function buildContext(parts: {
  readonly city?: string;
  readonly neighbourhood?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly pendingLocationChange?: PendingLocationChange;
}): DiscoverySearchContext {
  return {
    ...(parts.city === undefined ? {} : { city: parts.city }),
    ...(parts.neighbourhood === undefined ? {} : { neighbourhood: parts.neighbourhood }),
    ...(parts.nights === undefined ? {} : { nights: parts.nights }),
    ...(parts.partySize === undefined ? {} : { partySize: parts.partySize }),
    ...(parts.bedrooms === undefined ? {} : { bedrooms: parts.bedrooms }),
    ...(parts.pendingLocationChange === undefined ? {} : { pendingLocationChange: parts.pendingLocationChange }),
  };
}

function scalarParts(context: DiscoverySearchContext): {
  readonly city?: string;
  readonly neighbourhood?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
} {
  return {
    ...(context.city === undefined ? {} : { city: context.city }),
    ...(context.neighbourhood === undefined ? {} : { neighbourhood: context.neighbourhood }),
    ...(context.nights === undefined ? {} : { nights: context.nights }),
    ...(context.partySize === undefined ? {} : { partySize: context.partySize }),
    ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
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

/**
 * Extracts only the facts present in one message. Missing facts stay missing;
 * they are never inferred from, or replaced by, the rest of the conversation.
 */
export function extractStayRequestFacts(text: string): StayRequestFacts {
  const normalized = text.trim();
  const location = resolveLocationMention(normalized);
  const nightsMatch = NIGHTS_PATTERN.exec(normalized);
  const guestsMatch = GUESTS_PATTERN.exec(normalized);
  const bedroomsMatch = BEDROOMS_PATTERN.exec(normalized);
  const nights = nightsMatch ? Number.parseInt(nightsMatch[1] ?? "", 10) : undefined;
  const partySize = guestsMatch ? Number.parseInt(guestsMatch[1] ?? "", 10) : undefined;
  const bedroomsToken = bedroomsMatch?.[1]?.toLowerCase();
  const bedrooms = bedroomsToken === undefined ? undefined : (BEDROOM_WORDS[bedroomsToken] ?? Number.parseInt(bedroomsToken, 10));
  return {
    ...(location === undefined ? {} : { location }),
    ...(nights === undefined || Number.isNaN(nights) || nights < 1 ? {} : { nights }),
    ...(partySize === undefined || Number.isNaN(partySize) || partySize < 1 ? {} : { partySize }),
    ...(bedrooms === undefined || Number.isNaN(bedrooms) || bedrooms < 1 ? {} : { bedrooms }),
  };
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

  // 3. Merge scalar facts; whichever slot was supplied is replaced, the rest
  //    are preserved.
  context = buildContext({
    ...scalarParts(context),
    ...(facts.nights === undefined ? {} : { nights: facts.nights }),
    ...(facts.partySize === undefined ? {} : { partySize: facts.partySize }),
    ...(facts.bedrooms === undefined ? {} : { bedrooms: facts.bedrooms }),
    ...(context.pendingLocationChange === undefined ? {} : { pendingLocationChange: context.pendingLocationChange }),
  });

  if (conflict === undefined && context.pendingLocationChange !== undefined) {
    conflict = { pending: context.pendingLocationChange, question: locationConflictQuestion(context.pendingLocationChange, context) };
  }
  return { context, ...(conflict === undefined ? {} : { conflict }) };
}

function clarifyReply(context: DiscoverySearchContext, missing: readonly string[]): string {
  const known = context.city !== undefined || context.nights !== undefined || context.partySize !== undefined;
  const ask = missing.length === 1
    ? `Could you tell me ${missing[0]}?`
    : `Could you tell me ${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}?`;
  return known ? `Thanks — I've kept what you've already told me. ${ask}` : `I can help you find a place. ${ask}`;
}

/**
 * Decides whether the accumulated context can execute an authoritative
 * discovery query, or which missing inputs still have to be asked for.
 */
export function resolveStayRequestContext(
  context: DiscoverySearchContext,
  options: { readonly demoCheckIn: string },
): StayRequestResolution {
  const city = context.city;
  const nights = context.nights;
  const partySize = context.partySize;
  const missing: string[] = [];
  if (city === undefined) missing.push("where you want to stay (for example: Ikoyi or Lekki, Lagos)");
  if (nights === undefined) missing.push("how many nights you need");
  if (partySize === undefined) missing.push("how many guests are staying");
  if (city === undefined || nights === undefined || partySize === undefined) {
    return { kind: "clarify", missing, reply: clarifyReply(context, missing) };
  }
  return {
    kind: "search",
    filters: {
      location: city,
      ...(context.neighbourhood === undefined ? {} : { neighbourhood: context.neighbourhood }),
      checkIn: options.demoCheckIn,
      checkOut: addCalendarDays(options.demoCheckIn, nights),
      partySize,
      ...(context.bedrooms === undefined ? {} : { bedrooms: context.bedrooms }),
    },
  };
}

/**
 * Single-message compatibility entry point: extract, merge against an empty
 * context and resolve. Multi-turn callers must use the merge/resolve pair so
 * earlier turns are never discarded.
 */
export function interpretStayRequest(text: string, options: ConciergeOptions): StayRequestInterpretation {
  const merged = mergeStayRequestContext(null, extractStayRequestFacts(text), text);
  const resolution = resolveStayRequestContext(merged.context, { demoCheckIn: options.demoCheckIn });
  if (resolution.kind === "search") return { kind: "search", filters: resolution.filters };
  return { kind: "clarify", missing: resolution.missing, reply: resolution.reply };
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
  });
}
