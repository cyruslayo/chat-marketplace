/**
 * Shared fixtures for Continuous Occupancy tests (ADR 0023 as amended 1 Nov 2026, issue 06). Every value is synthetic.
 * A "confirmed" stay is a real Booking Request made through the manager, then moved to its later states through the
 * same durable tables the composition writes (offers, booking snapshots, booking state), so the ledger reads what
 * production reads.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAuditLog, createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import {
  BookingAmendmentManager,
  BookingRequestManager,
  ContinuousOccupancyLedger,
  SELF_BOOKING_ATTESTATION_VERSION,
  SqliteBookingStateRepository,
  SqliteGuestInteractionStore,
  UnitRepository,
  seedIssue01Units,
  type BookingAmendmentDependencies,
  type BookingContract,
  type CountableBookingRequest,
  type DurableBookingRequest,
  type ExtendedStayPolicy,
  type Reservation,
} from "../../domains/shortlet/src/index.js";
import type { Unit } from "../../domains/shortlet/src/browse.js";
import { createTestAvailabilityCalendar } from "./availability-calendar.js";
import { extendUnit } from "./demo-extended-journey.js";

export const OCCUPANCY_TENANT = "tenant-occupancy";
export const GUEST = "guest-occupancy-1";
export const OTHER_GUEST = "guest-occupancy-2";
export const PROPERTY = "property-occupancy-p";
export const OTHER_PROPERTY = "property-occupancy-q";
export const UNIT_A = "unit-occupancy-a";
export const UNIT_B = "unit-occupancy-b";
export const UNIT_OTHER_PROPERTY = "unit-occupancy-q";

/** A ledger over fixed Unit-to-Property facts and a fixed list of Booking Requests, with no store (amendment tests). */
export function fixedOccupancyLedger(options: {
  readonly unitProperties: Readonly<Record<string, string>>;
  readonly requests?: readonly CountableBookingRequest[];
  readonly extendedStayPolicy?: ExtendedStayPolicy;
}): ContinuousOccupancyLedger {
  return new ContinuousOccupancyLedger({
    store: null,
    bookingState: null,
    unitPropertyId: (unitId: string) => (Object.hasOwn(options.unitProperties, unitId) ? options.unitProperties[unitId] : undefined),
    listBookingRequests: ({ tenantId, primaryGuestId }) => (options.requests ?? []).filter((request) =>
      (tenantId === undefined || request.tenantId === tenantId) && request.primaryGuestId === primaryGuestId),
    extendedStayPolicy: options.extendedStayPolicy,
  });
}

/** Units for the occupancy tests: two Units at Property P, one Unit at another Property Q. Optional Extended Stay terms. */
export function occupancyUnits(options: { readonly extended?: boolean; readonly claimsThrough?: string } = {}): UnitRepository {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const base = repository.findAll()[0]!;
  // The management authority names the Property it covers, so it moves with the Unit's propertyId (ADR 0057).
  const place = (unit: Unit, propertyId: string): Unit => ({ ...unit, propertyId, managementAuthority: { ...unit.managementAuthority, propertyId } });
  const shape = (unit: Unit): Unit => (options.extended ? extendUnit(unit, { claimsThrough: options.claimsThrough }) : unit);
  repository.save(shape({ ...place(base, PROPERTY), id: UNIT_A }));
  repository.save(shape({ ...place(base, PROPERTY), id: UNIT_B }));
  repository.save(shape({ ...place(base, OTHER_PROPERTY), id: UNIT_OTHER_PROPERTY }));
  return repository;
}

export interface OccupancyStores {
  readonly store: SqliteGuestInteractionStore;
  readonly bookingState: SqliteBookingStateRepository;
  close(): void;
}

/** A durable store and booking state over a fresh temporary SQLite database (the composition's own tables). */
export function openOccupancyStores(): OccupancyStores {
  const directory = mkdtempSync(join(tmpdir(), "continuous-occupancy-"));
  const database = openNodeSqliteDatabase(join(directory, "occupancy.sqlite"));
  return {
    store: new SqliteGuestInteractionStore(database),
    bookingState: new SqliteBookingStateRepository(database),
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export interface OccupancyManagerOptions {
  readonly repository: UnitRepository;
  readonly clock: () => Date;
  readonly stores?: OccupancyStores;
  readonly extendedStayPolicy?: ExtendedStayPolicy;
}

/** A BookingRequestManager over the occupancy Units, with the in-memory calendar and, when given, the durable stores. */
export function occupancyManager(options: OccupancyManagerOptions) {
  const audit = new InMemoryAuditLog();
  const calendar = createTestAvailabilityCalendar({ repository: options.repository, audit });
  const manager = new BookingRequestManager({
    repository: options.repository,
    audit,
    calendar,
    store: options.stores?.store ?? null,
    bookingState: options.stores?.bookingState ?? null,
    extendedStayPolicy: options.extendedStayPolicy,
  });
  return { manager, calendar, audit };
}

/** The Primary Guest principal the tests act as. */
export function guestPrincipal(id: string) {
  return { id, role: "guest" as const, tenantId: OCCUPANCY_TENANT };
}

/** Creates a Request Draft for one Primary Guest, through the manager's own rules. */
export function draftFor(manager: BookingRequestManager, clock: () => Date, input: { unitId: string; guestId?: string; checkIn: string; checkOut: string }) {
  const guestId = input.guestId ?? GUEST;
  return manager.createDraft({
    unitId: input.unitId,
    primaryGuest: { id: guestId, name: "Synthetic Guest", isGovernmentIdVerified: true },
    occupants: [{ name: "Synthetic Guest" }],
    selfBookingAttestation: { accepted: true, version: SELF_BOOKING_ATTESTATION_VERSION },
    checkIn: input.checkIn,
    checkOut: input.checkOut,
  }, { clock, tenantId: OCCUPANCY_TENANT });
}

/** Submits a draft (Booking Request disclosure) as its Primary Guest. */
export function disclose(manager: BookingRequestManager, clock: () => Date, draftId: string, guestId: string = GUEST) {
  return manager.discloseBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: guestPrincipal(guestId),
    payload: { draftId },
  }), { clock });
}

/**
 * Moves a disclosed Booking Request to a confirmed stay: the request is confirmed, one Conditional Offer is written in
 * `offerStatus`, and an accepted offer gets its booking snapshot, confirmed or cancelled Reservation and contract.
 */
export function confirmStay(
  stores: OccupancyStores,
  request: DurableBookingRequest,
  options: { readonly offerStatus: "issued" | "accepted" | "expired"; readonly reservationStatus?: "confirmed" | "cancelled"; readonly at: string },
): void {
  stores.store.saveBookingRequest({ ...request, status: "confirmed", confirmedAt: options.at });
  const offerId = `offer-${request.requestId}`;
  stores.store.saveConditionalOffer({
    offerId,
    requestId: request.requestId,
    inventoryCommitmentId: request.inventoryCommitmentId,
    unitId: request.unitId,
    tenantId: request.tenantId,
    offerJson: "{}",
    status: options.offerStatus,
    issuedAt: options.at,
    acceptedAt: options.offerStatus === "accepted" ? options.at : null,
    tokenUsed: options.offerStatus === "accepted",
    offerVersion: 1,
  });
  if (options.offerStatus !== "accepted") return;
  const reservationId = `reservation-${request.requestId}`;
  const contractId = `contract-${request.requestId}`;
  const reservation: Reservation = {
    reservationId,
    contractId,
    unitId: request.unitId,
    primaryGuestId: request.primaryGuestId,
    dates: { checkIn: request.checkIn, checkOut: request.checkOut },
    status: options.reservationStatus ?? "confirmed",
    confirmedAt: options.at,
  };
  const contract = {
    contractId,
    reservationId,
    offerId,
    unitId: request.unitId,
    tenantId: request.tenantId,
    parties: { primaryGuest: { id: request.primaryGuestId, name: request.primaryGuestName }, operator: { id: "operator-occupancy" }, distinctPayer: null },
    dates: { checkIn: request.checkIn, checkOut: request.checkOut, nights: request.nights },
    occupants: [],
    quote: {},
    totalAmountDueNowKobo: 0,
    policies: { cancellationPolicy: {}, guestConductRules: [] },
    paymentDetails: { paymentMethod: "fresh_card", pspReference: `psp-ref-${request.requestId}` },
  } as unknown as BookingContract;
  stores.bookingState.saveBookingAtomically({ contract, reservation });
  stores.store.saveBookingSnapshot({
    reservationId,
    contractId,
    offerId,
    reservationJson: JSON.stringify(reservation),
    contractJson: JSON.stringify(contract),
    confirmedAt: options.at,
  });
}

/** The stored Booking Request for a request id, so a test can move it to another state. */
export function storedRequest(stores: OccupancyStores, requestId: string): DurableBookingRequest {
  const record = stores.store.findBookingRequest(requestId);
  if (!record) throw new Error("test fixture: the Booking Request was not stored");
  return record;
}

/** A dated, confirmed stay for one Primary Guest: draft, disclose, then confirm through the stores. */
export function confirmedStayFor(
  stores: OccupancyStores,
  manager: BookingRequestManager,
  clock: () => Date,
  input: { unitId: string; guestId?: string; checkIn: string; checkOut: string; reservationStatus?: "confirmed" | "cancelled" },
): string {
  const draft = draftFor(manager, clock, input);
  const requestId = disclose(manager, clock, draft.draftId, input.guestId ?? GUEST).requestId;
  confirmStay(stores, storedRequest(stores, requestId), {
    offerStatus: "accepted",
    reservationStatus: input.reservationStatus,
    at: clock().toISOString(),
  });
  return requestId;
}

/** Amendment dependencies over one contract, with fixed calendar, inspection, authority and quote answers. */
export function amendmentDependencies(contract: BookingContract, continuousOccupancy: ContinuousOccupancyLedger): BookingAmendmentDependencies {
  return {
    contractRepository: {
      getContract: () => contract,
      mutateContract: (_id, _version, mutation) => mutation(contract),
    },
    calendar: { getAuthoritativeAvailability: () => ({ isAvailable: true, version: "av-1" }) },
    inspectionRepository: { isPassedAndValidThrough: () => ({ valid: true, version: "ins-1" }) },
    authorityRepository: { isValidThrough: () => ({ valid: true, version: "auth-1" }) },
    quoteProvider: {
      quote: ({ resultingDates }) => ({
        quoteId: `quote-${resultingDates.nights}`,
        quoteVersion: "1",
        currency: "NGN",
        revisedAllInStayTotalKobo: 50000,
        financialAdjustment: { type: "none", amountKobo: 0, currency: "NGN" },
      }),
    },
    continuousOccupancy,
  };
}

export { BookingAmendmentManager };
