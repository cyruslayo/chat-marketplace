import { MAX_STAY_NIGHTS } from "./browse.js";
import { assertStayLength, type ExtendedStayPolicy } from "./extended-stay.js";
import type { BookingContract, Reservation } from "./card-payment.js";

/**
 * ADR 0023 as amended 1 Nov 2026 and ADR 0092 (amended 1 Nov 2026): Continuous Occupancy at one Property.
 *
 * Owner decisions (issue 04, 1 Nov 2026): the same Primary Guest account only; adjacency is a check-in on the checkout
 * date of another counted stay, in either direction; chains add up end to end; a gap of one night or more breaks the
 * chain; the scope is the whole Property (`Unit.propertyId`), across Units.
 *
 * Counted stays (issue 06, AC5): a Booking Request that is disclosed (awaiting the Operator), or confirmed and still
 * holding nights through an issued or accepted Conditional Offer, or a confirmed Reservation. Declined, expired,
 * delivery-failed, expired/stale/revoked-offer, cancelled and no-show stays are not counted.
 */

/** A refusal the guest may read. The message names only nights and the limit: no guest, request or contract id (ADR 0075). */
export class ContinuousOccupancyError extends Error {
  readonly total: number | undefined;
  readonly limit: number | undefined;
  constructor(message: string, details: { readonly total?: number; readonly limit?: number } = {}) {
    super(message);
    this.name = "ContinuousOccupancyError";
    this.total = details.total;
    this.limit = details.limit;
  }
}

/** A stay that counts toward Continuous Occupancy. `ref` is internal; it never reaches a guest surface or a log. */
export interface OccupancyStay {
  readonly ref: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly stayType: "short" | "extended";
  readonly contractId?: string;
  readonly offerId?: string;
}

export interface ContinuousOccupancyAssessment {
  readonly allowed: boolean;
  readonly totalNights: number;
  readonly limit: number;
  readonly chain: readonly OccupancyStay[];
  readonly extendedChain: boolean;
}

const DAY_MS = 86_400_000;

/** The one fail-closed refusal for a stay that cannot be checked: unresolved tenant, Property, Primary Guest or status. */
const UNRESOLVED = "These dates cannot be checked against your other stays at this property.";

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  const nights = (end - start) / DAY_MS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || !Number.isInteger(nights)) {
    throw new ContinuousOccupancyError(UNRESOLVED);
  }
  return nights;
}

/** The maximum for a chain: the existing Short Stay constant, or the Extended Stay policy's maximum when the chain has one. */
function chainLimit(extendedChain: boolean, policy: ExtendedStayPolicy | undefined): number {
  if (!extendedChain) return MAX_STAY_NIGHTS;
  // Fail closed: an Extended Stay in the chain with no policy to bound it is refused, never assumed to fit.
  if (policy === undefined) throw new ContinuousOccupancyError(UNRESOLVED);
  return policy.maximumNights;
}

/**
 * The pure chain calculation. Starting from the candidate, it follows adjacent counted stays at the same Property in both
 * directions (a checkout equal to a check-in). Stays of another Property, and stays that do not touch by a checkout and
 * check-in, are not in the chain. Throws on a counted stay it cannot place, so the caller refuses (fail closed).
 */
export function assessContinuousOccupancy(
  candidate: OccupancyStay,
  counted: readonly OccupancyStay[],
  policy: ExtendedStayPolicy | undefined,
): ContinuousOccupancyAssessment {
  const candidateNights = nightsBetween(candidate.checkIn, candidate.checkOut);
  if (candidateNights < 1) throw new ContinuousOccupancyError(UNRESOLVED);
  const members = new Map<string, OccupancyStay & { readonly nights: number }>();
  members.set(candidate.ref, { ...candidate, nights: candidateNights });
  for (const stay of counted) {
    if (stay.ref === candidate.ref || stay.propertyId !== candidate.propertyId) continue;
    if (!stay.propertyId || !stay.unitId) throw new ContinuousOccupancyError(UNRESOLVED);
    members.set(stay.ref, { ...stay, nights: nightsBetween(stay.checkIn, stay.checkOut) });
  }

  const visited = new Set<string>([candidate.ref]);
  const queue = [candidate.ref];
  while (queue.length > 0) {
    const current = members.get(queue.shift()!)!;
    for (const other of members.values()) {
      if (visited.has(other.ref)) continue;
      const followsCurrent = other.checkIn === current.checkOut;
      const precedesCurrent = other.checkOut === current.checkIn;
      if (followsCurrent || precedesCurrent) {
        visited.add(other.ref);
        queue.push(other.ref);
      }
    }
  }

  const chain = [...visited].map((ref) => members.get(ref)!);
  const totalNights = chain.reduce((sum, stay) => sum + stay.nights, 0);
  const extendedChain = chain.some((stay) => stay.stayType === "extended");
  const limit = chainLimit(extendedChain, policy);
  return { allowed: totalNights <= limit, totalNights, limit, chain, extendedChain };
}

/** The refusal for a chain over its limit. Wording for owner confirmation (issue 06, Comments). */
export function continuousOccupancyRefusal(assessment: ContinuousOccupancyAssessment): ContinuousOccupancyError {
  const { totalNights, limit, extendedChain } = assessment;
  if (extendedChain) {
    return new ContinuousOccupancyError(
      `These dates join another stay of yours at this property, making ${totalNights} nights, more than the ${limit}-night maximum.`,
      { total: totalNights, limit },
    );
  }
  return new ContinuousOccupancyError(
    `These dates join another stay of yours at this property, making ${totalNights} nights. A stay of ${MAX_STAY_NIGHTS + 1} nights or more must be booked as one Extended Stay.`,
    { total: totalNights, limit },
  );
}

/** A Booking Request as the ledger reads it. `status` is the projected status at the ledger's clock (ADR 0041, 0043). */
export interface CountableBookingRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly primaryGuestId: string;
  readonly unitId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly status: string;
}

export interface ContinuousOccupancyLedgerOptions {
  /** The durable store: its offers and booking snapshots. Null when the composition keeps no store (in-memory). */
  readonly store: {
    listConditionalOffersByRequestId(requestId: string): readonly { readonly offerId: string; readonly status: string; readonly tenantId: string }[];
    findBookingSnapshotByOfferId(offerId: string): { readonly reservationId: string; readonly contractId: string } | null;
  } | null;
  /** The authoritative booking state: confirmed reservations and their contracts (ADR 0092 dates and status). */
  readonly bookingState: {
    findContractById(contractId: string): BookingContract | null;
    findReservationById(reservationId: string): Reservation | null;
  } | null;
  /** The Property of a Unit, or undefined when the Unit cannot be read (fail closed). */
  readonly unitPropertyId: (unitId: string) => string | undefined;
  /** The Booking Requests of one Primary Guest in one tenant, with projected status. */
  readonly listBookingRequests: (input: { readonly tenantId: string; readonly primaryGuestId: string; readonly now: Date }) => readonly CountableBookingRequest[];
  readonly extendedStayPolicy?: ExtendedStayPolicy;
}

export interface CountedStayExclusion {
  readonly contractId?: string;
  readonly offerId?: string;
}

const HOLDING_REQUEST_STATUSES = new Set(["disclosed", "confirmed"]);
const NOT_HOLDING_REQUEST_STATUSES = new Set(["declined", "expired", "delivery_failed"]);
const OPEN_OFFER_STATUSES = new Set(["issued", "accepted"]);
const CLOSED_OFFER_STATUSES = new Set(["expired", "stale", "revoked"]);

/**
 * Reads one Primary Guest's counted stays in one tenant. Every unreadable record throws: a counted stay whose Property,
 * dates or status cannot be resolved refuses the new stay rather than being skipped.
 */
export class ContinuousOccupancyLedger {
  readonly #options: ContinuousOccupancyLedgerOptions;

  constructor(options: ContinuousOccupancyLedgerOptions) {
    this.#options = options;
  }

  countedStays(input: { readonly tenantId: string | undefined; readonly primaryGuestId: string; readonly now: Date; readonly exclude?: CountedStayExclusion }): OccupancyStay[] {
    // Fail closed: a stay is only ever read inside the caller's tenant. No tenant, no read (never a cross-tenant read).
    if (!input.primaryGuestId || !input.tenantId) throw new ContinuousOccupancyError(UNRESOLVED);
    const tenantId = input.tenantId;
    const stays = new Map<string, OccupancyStay>();
    for (const request of this.#options.listBookingRequests({ tenantId, primaryGuestId: input.primaryGuestId, now: input.now })) {
      if (request.tenantId !== tenantId || request.primaryGuestId !== input.primaryGuestId) throw new ContinuousOccupancyError(UNRESOLVED);
      for (const stay of this.#staysForRequest(request, tenantId)) {
        if (input.exclude?.contractId !== undefined && stay.contractId === input.exclude.contractId) continue;
        if (input.exclude?.offerId !== undefined && stay.offerId === input.exclude.offerId) continue;
        stays.set(stay.ref, stay);
      }
    }
    return [...stays.values()];
  }

  #staysForRequest(request: CountableBookingRequest, tenantId: string): OccupancyStay[] {
    if (NOT_HOLDING_REQUEST_STATUSES.has(request.status)) return [];
    if (!HOLDING_REQUEST_STATUSES.has(request.status)) throw new ContinuousOccupancyError(UNRESOLVED);
    const fromRequest = (offerId?: string) => this.#stay({
      ref: `request:${request.requestId}`,
      unitId: request.unitId,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      ...(offerId !== undefined ? { offerId } : {}),
    });
    if (request.status === "disclosed") return [fromRequest()];

    // Confirmed: the stay holds nights through its Conditional Offers, or as a confirmed Reservation.
    const store = this.#options.store;
    if (store === null) return [fromRequest()];
    const offers = store.listConditionalOffersByRequestId(request.requestId);
    if (offers.length === 0) return [fromRequest()];
    const stays: OccupancyStay[] = [];
    for (const offer of offers) {
      if (offer.tenantId !== tenantId) throw new ContinuousOccupancyError(UNRESOLVED);
      if (CLOSED_OFFER_STATUSES.has(offer.status)) continue;
      if (!OPEN_OFFER_STATUSES.has(offer.status)) throw new ContinuousOccupancyError(UNRESOLVED);
      if (offer.status === "issued") {
        stays.push(fromRequest(offer.offerId));
        continue;
      }
      const snapshot = store.findBookingSnapshotByOfferId(offer.offerId);
      if (snapshot === null) {
        // Accepted, payment not yet verified: the nights are held through the Payment Window.
        stays.push(fromRequest(offer.offerId));
        continue;
      }
      const reserved = this.#reservationStay(snapshot.reservationId, snapshot.contractId, offer.offerId, tenantId);
      if (reserved !== null) stays.push(reserved);
    }
    // A confirmed request with no open offer (every offer closed, or a cancelled reservation) holds nothing.
    return stays;
  }

  #reservationStay(reservationId: string, contractId: string, offerId: string, tenantId: string): OccupancyStay | null {
    const state = this.#options.bookingState;
    if (state === null) throw new ContinuousOccupancyError(UNRESOLVED);
    const reservation = state.findReservationById(reservationId);
    if (!reservation) throw new ContinuousOccupancyError(UNRESOLVED);
    if (reservation.status === "cancelled" || reservation.status === "no_show") return null;
    if (reservation.status !== "confirmed") throw new ContinuousOccupancyError(UNRESOLVED);
    const contract = state.findContractById(contractId);
    if (!contract || contract.contractId !== contractId || contract.tenantId !== tenantId) throw new ContinuousOccupancyError(UNRESOLVED);
    return this.#stay({
      ref: `contract:${contractId}`,
      unitId: contract.unitId,
      checkIn: contract.dates.checkIn,
      checkOut: contract.dates.checkOut,
      contractId,
      offerId,
    });
  }

  #stay(input: { readonly ref: string; readonly unitId: string; readonly checkIn: string; readonly checkOut: string; readonly contractId?: string; readonly offerId?: string }): OccupancyStay {
    const propertyId = this.#options.unitPropertyId(input.unitId);
    if (!propertyId) throw new ContinuousOccupancyError(UNRESOLVED);
    const nights = nightsBetween(input.checkIn, input.checkOut);
    let stayType: "short" | "extended";
    try {
      stayType = assertStayLength(nights, this.#options.extendedStayPolicy);
    } catch {
      throw new ContinuousOccupancyError(UNRESOLVED);
    }
    return {
      ref: input.ref,
      unitId: input.unitId,
      propertyId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights,
      stayType,
      ...(input.contractId !== undefined ? { contractId: input.contractId } : {}),
      ...(input.offerId !== undefined ? { offerId: input.offerId } : {}),
    };
  }

  /** The candidate's own Property, read through the same fail-closed rule. */
  propertyIdFor(unitId: string): string {
    const propertyId = this.#options.unitPropertyId(unitId);
    if (!propertyId) throw new ContinuousOccupancyError(UNRESOLVED);
    return propertyId;
  }
}

function candidateStayType(nights: number, policy: ExtendedStayPolicy | undefined): "short" | "extended" {
  try {
    return assertStayLength(nights, policy);
  } catch {
    throw new ContinuousOccupancyError(UNRESOLVED);
  }
}

/**
 * The guard used by every stay-changing path: draft creation, submission (re-checked at submit) and date-changing
 * amendments. It throws the refusal before any hold, quote acceptance or payment (ADR 0023).
 */
export function assertContinuousOccupancy(input: {
  readonly ledger: ContinuousOccupancyLedger;
  /** Undefined when the caller's tenant cannot be resolved: the guard refuses (fail closed). */
  readonly tenantId: string | undefined;
  readonly primaryGuestId: string;
  readonly unitId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly now: Date;
  readonly policy: ExtendedStayPolicy | undefined;
  readonly exclude?: CountedStayExclusion;
}): ContinuousOccupancyAssessment {
  const propertyId = input.ledger.propertyIdFor(input.unitId);
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const candidate: OccupancyStay = {
    ref: "candidate",
    unitId: input.unitId,
    propertyId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights,
    stayType: candidateStayType(nights, input.policy),
  };
  const counted = input.ledger.countedStays({
    tenantId: input.tenantId,
    primaryGuestId: input.primaryGuestId,
    now: input.now,
    ...(input.exclude !== undefined ? { exclude: input.exclude } : {}),
  });
  const assessment = assessContinuousOccupancy(candidate, counted, input.policy);
  if (!assessment.allowed) throw continuousOccupancyRefusal(assessment);
  return assessment;
}
