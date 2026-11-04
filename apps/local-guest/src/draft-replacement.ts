import { createStayQuote, type Unit } from "../../../domains/shortlet/src/index.js";
import { GUEST_GLOSSARY, formatStayDates, type DraftStayTerms } from "../../web-agent/src/index.js";
import type { LocalGuestEnvironment } from "./fixture.js";
import type { DiscoverySearchContext, StayRequestFilters } from "./concierge.js";
import { parseDiscoverySearchContext } from "./concierge.js";

/**
 * Issue 13a (ADR 0015, ADR 0080): the Request Draft replacement that the deterministic path and the assistant path both propose
 * and accept. One module owns the all-in quote, the availability check, the persisted shape and its parser, so the two paths
 * cannot quote the same stay differently.
 */

/** The stay a replacement Request Draft would cover (issue 14). */
export interface DraftReplacementStay {
  readonly location: string;
  readonly neighbourhood?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
}

/** A replacement the guest has been shown and may accept (ADR 0074: the basedOn and surface id bind the accept to it). */
export interface PendingDraftReplacement {
  readonly basedOnDraftId: string;
  readonly basedOn: string;
  readonly unitId: string;
  readonly stay: DraftReplacementStay;
  readonly filters: StayRequestFilters;
  readonly context: DiscoverySearchContext;
  readonly proposed: DraftStayTerms;
  readonly surfaceId: string;
}

/**
 * ADR 0015: the same deterministic all-in quote a Request Draft carries; null when the Unit can't take the stay (it is not
 * in the authoritative search for those dates and party size, or it no longer exists).
 */
export function draftReplacementTerms(environment: LocalGuestEnvironment, unitId: string, stay: DraftReplacementStay): DraftStayTerms | null {
  // Revalidate availability and capacity for the stay itself, not budget or bedroom preferences.
  const results = environment.discoveryQuery.search({ ...stay }).facts.results;
  const unit = environment.unitRepository.findById(unitId) as Unit | null;
  if (!unit || !results.some((candidate) => candidate.id === unitId)) return null;
  const quote = createStayQuote({
    unit,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    partySize: stay.partySize,
    ...(environment.extendedStayPolicy ? { extendedStayPolicy: environment.extendedStayPolicy } : {}),
    demoTerms: environment.config.demo === true,
    clock: environment.clock,
  });
  return {
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights,
    partySize: stay.partySize,
    allInStayTotalKobo: quote.allInStayTotalKobo,
    refundableSecurityDepositKobo: quote.refundableSecurityDepositKobo,
    amountDueNowKobo: quote.totalAmountDueNowKobo,
  };
}

/** The guest's words when the Unit can't take the stay. Shared by both paths. */
export function draftReplacementUnavailable(environment: LocalGuestEnvironment, unitId: string, stay: DraftReplacementStay): string {
  const title = (environment.unitRepository.findById(unitId) as Unit | null)?.title ?? `This ${GUEST_GLOSSARY.unit}`;
  return `${title} isn't available for ${formatStayDates(stay.checkIn, stay.checkOut)} for ${stay.partySize} ${stay.partySize === 1 ? "guest" : "guests"}.`;
}

/** The guest's words for a replacement that is proposed and waits for the guest's choice (issue 14; shared by both paths). */
export const DRAFT_REPLACEMENT_PROPOSED_COPY = "Here is your Request Draft with the new details. It changes only if you choose “Use the new details”.";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseStay(value: unknown): DraftReplacementStay | null {
  if (!isRecord(value)) return null;
  if (!boundedString(value.location, 200) || !boundedString(value.checkIn, 10) || !boundedString(value.checkOut, 10)) return null;
  if (value.neighbourhood !== undefined && !boundedString(value.neighbourhood, 200)) return null;
  if (!isCount(value.partySize) || value.partySize < 1) return null;
  return {
    location: value.location,
    ...(value.neighbourhood === undefined ? {} : { neighbourhood: value.neighbourhood as string }),
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    partySize: value.partySize,
  };
}

function parseFilters(value: unknown): StayRequestFilters | null {
  const stay = parseStay(value);
  if (!stay || !isRecord(value)) return null;
  if (value.bedrooms !== undefined && !isCount(value.bedrooms)) return null;
  if (value.maxPriceKobo !== undefined && !isCount(value.maxPriceKobo)) return null;
  return {
    ...stay,
    ...(value.bedrooms === undefined ? {} : { bedrooms: value.bedrooms as number }),
    ...(value.maxPriceKobo === undefined ? {} : { maxPriceKobo: value.maxPriceKobo as number }),
  };
}

function parseTerms(value: unknown): DraftStayTerms | null {
  if (!isRecord(value)) return null;
  if (!boundedString(value.checkIn, 10) || !boundedString(value.checkOut, 10)) return null;
  if (![value.nights, value.partySize, value.allInStayTotalKobo, value.refundableSecurityDepositKobo, value.amountDueNowKobo].every(isCount)) return null;
  return {
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    nights: value.nights as number,
    partySize: value.partySize as number,
    allInStayTotalKobo: value.allInStayTotalKobo as number,
    refundableSecurityDepositKobo: value.refundableSecurityDepositKobo as number,
    amountDueNowKobo: value.amountDueNowKobo as number,
  };
}

/**
 * Reads a persisted replacement (the thread projection or the assistant task state). An invalid value reads as null, so the
 * guest's accept then fails closed as stale rather than replacing anything from partial data (ADR 0074).
 */
export function parsePendingDraftReplacement(value: unknown): PendingDraftReplacement | null {
  if (!isRecord(value)) return null;
  if (!boundedString(value.basedOnDraftId, 200) || !boundedString(value.basedOn, 20_000) || !boundedString(value.unitId, 200) || !boundedString(value.surfaceId, 300)) return null;
  const stay = parseStay(value.stay);
  const filters = parseFilters(value.filters);
  const context = parseDiscoverySearchContext(value.context);
  const proposed = parseTerms(value.proposed);
  if (!stay || !filters || !context || !proposed) return null;
  return { basedOnDraftId: value.basedOnDraftId, basedOn: value.basedOn, unitId: value.unitId, stay, filters, context, proposed, surfaceId: value.surfaceId };
}
