import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createPlatformCommandEnvelope, InMemoryAuditLog, InMemoryTelemetry, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  AvailabilityCalendar,
  GuestVerificationService,
  InMemoryBookingStateRepository,
  SqliteOperatorRepresentativeGrantStore,
  UnitDiscoveryQuery,
  UnitRepository,
  InMemoryBookingPaymentJourneyRepository,
  InMemorySecurityDepositAccountingRepository,
  type BookingContract,
  type ContractRepository,
  type ReservationLike,
} from "../../../domains/shortlet/src/index.js";
import {
  createBookingRequestApplication,
  createConditionalOfferApplication,
  createCardPaymentApplication,
  createBookingContractApplication,
  type BookingRequestApplication,
  type ConditionalOfferApplication,
  type CardPaymentApplication,
  type BookingContractApplication,
} from "../../../apps/web/src/index.js";
import { SELF_BOOKING_ATTESTATION_VERSION } from "../../../domains/shortlet/src/guest-verification.js";

export const LOCAL_GUEST_PORT = 3001;

export interface LocalGuestFixtureConfig {
  readonly databasePath: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly representativePersonId: string;
  readonly representativePersonName: string;
  readonly adminId: string;
  readonly guestId: string;
  readonly guestName: string;
  /** Deterministic demo check-in; checkout is derived from requested nights. */
  readonly demoCheckIn: string;
  /** @deprecated Checkout is derived from the requested nights. */
  readonly demoCheckOut?: string;
  readonly clock?: () => Date;
}

export const DEFAULT_LOCAL_GUEST_CONFIG: LocalGuestFixtureConfig = {
  databasePath: ".scratch/local-guest/guest_fixture.sqlite",
  tenantId: "tenant-lagos-internal",
  operatorId: "op-lagos-owner-001",
  operatorName: "Eko Prime Living Ltd",
  representativePersonId: "person-owner-001",
  representativePersonName: "Babatunde Adeleke",
  adminId: "platform-admin-001",
  guestId: "guest-demo-101",
  guestName: "Demo Guest",
  demoCheckIn: "2026-09-10",
  demoCheckOut: "2026-09-13",
};

const INSPECTION_SCOPE = [
  "entire-place-possession",
  "structure-and-sanitation",
  "fire-and-emergency-readiness",
  "electrical-and-utilities",
  "locks-and-privacy",
  "access-controls",
  "cameras",
  "listing-accuracy",
  "current-media",
] as const;

const AUTHORITY_PERMISSIONS = [
  "advertise",
  "accept-bookings",
  "contract-guests",
  "provide-access",
  "collect-revenue",
  "manage-cancellations",
  "issue-refunds",
  "manage-incidents",
] as const;

/**
 * Local composition-side store for Booking Contracts produced by the real
 * CardPaymentManager confirmation path. It only records results that the
 * authoritative payment application returned; it never creates contracts.
 */
class LocalBookingContractRepository implements ContractRepository {
  readonly #contracts = new Map<string, BookingContract>();
  readonly #reservations = new Map<string, ReservationLike>();

  recordConfirmedOutcome(reservation: ReservationLike, contract: BookingContract): void {
    this.#reservations.set(reservation.reservationId, reservation);
    this.#contracts.set(contract.contractId, contract);
  }

  findContractById(contractId: string): BookingContract | null {
    return this.#contracts.get(contractId) ?? null;
  }

  findArrivalDataByContractId(_contractId: string): null {
    // Arrival data stays locked in the local demo; the protected view
    // (full address / access instructions) is not part of this milestone.
    return null;
  }

  findReservationById(reservationId: string): ReservationLike | null {
    return this.#reservations.get(reservationId) ?? null;
  }
}

export class LocalGuestEnvironment {
  readonly config: LocalGuestFixtureConfig;
  readonly clock: () => Date;
  readonly unitRepository: UnitRepository;
  readonly calendar: AvailabilityCalendar;
  readonly grantStore: SqliteOperatorRepresentativeGrantStore;
  readonly audit: InMemoryAuditLog;
  readonly discoveryQuery: UnitDiscoveryQuery;
  readonly bookingRequestApp: BookingRequestApplication;
  readonly conditionalOfferApp: ConditionalOfferApplication;
  readonly cardPaymentApp: CardPaymentApplication;
  readonly contractApp: BookingContractApplication;
  readonly contractRepository = new LocalBookingContractRepository();
  #searchCounter = 0;

  constructor(config: Partial<LocalGuestFixtureConfig> = {}) {
    this.config = { ...DEFAULT_LOCAL_GUEST_CONFIG, ...config };
    this.clock = this.config.clock ?? (() => new Date("2026-09-03T10:00:00Z"));

    mkdirSync(dirname(this.config.databasePath), { recursive: true });

    this.grantStore = new SqliteOperatorRepresentativeGrantStore(this.config.databasePath, { clock: this.clock });
    this.unitRepository = new UnitRepository();
    this.calendar = new AvailabilityCalendar({ repository: this.unitRepository });
    this.audit = new InMemoryAuditLog();

    this.discoveryQuery = new UnitDiscoveryQuery({
      repository: this.unitRepository,
      audit: this.audit,
      telemetry: new InMemoryTelemetry(),
      clock: this.clock,
      idFactory: () => `guest-demo-${String(++this.#searchCounter).padStart(3, "0")}`,
    });

    const guestVerification = new GuestVerificationService({
      repository: this.unitRepository,
      verificationResults: {
        getVerificationResult: ({ tenantId, guestId }) =>
          tenantId === this.config.tenantId && guestId === this.config.guestId
            ? { tenantId, guestId, governmentIdVerified: true }
            : null,
      },
    });

    this.bookingRequestApp = createBookingRequestApplication({
      repository: this.unitRepository,
      calendar: this.calendar,
      audit: this.audit,
      guestVerification,
      // ADR-0082: operator representative authority is evaluated through the
      // real server-side grant store on every consequential operator command.
      operatorAuthority: this.grantStore,
      clock: this.clock,
    });

    this.conditionalOfferApp = createConditionalOfferApplication({
      bookingRequestApplication: this.bookingRequestApp,
      repository: this.unitRepository,
      audit: this.audit,
      calendar: this.calendar,
      clock: this.clock,
      operatorAuthority: this.grantStore,
    });

    this.cardPaymentApp = createCardPaymentApplication({
      conditionalOfferApplication: this.conditionalOfferApp,
      repository: this.unitRepository,
      calendar: this.calendar,
      audit: this.audit,
      // Local deterministic PSP stub: no live PSP, no credentials. The amount
      // is resolved from the authoritative checkout session, never the client.
      pspClient: {
        verifyTransaction: (pspReference: string) => {
          const session = this.cardPaymentApp.manager.getCheckoutSessionByReference(pspReference);
          return {
            verified: true,
            status: "success",
            amountKobo: session?.amountKobo ?? 0,
            currency: "NGN",
            pspReference,
            payerId: this.config.guestId,
          };
        },
      },
      journeyRepository: new InMemoryBookingPaymentJourneyRepository(),
      securityDepositAccounting: new InMemorySecurityDepositAccountingRepository(),
      securityDepositCapability: {
        getCapability: ({ paymentMethod }) => ({
          capabilityVersion: "local-demo-security-deposit-v1",
          enabled: true,
          pspProviderId: "local-demo-psp",
          pspApproved: true,
          counselApproved: true,
          collectionModel: "separate_actual_charge",
          paymentMethod,
        }),
      },
      bookingState: new InMemoryBookingStateRepository(),
      clock: this.clock,
    });

    this.contractApp = createBookingContractApplication({
      repository: this.contractRepository,
      clock: this.clock,
    });

    this.#seedUnits();
    this.#seedRepresentativeGrant();
  }

  guestPrincipal(): CommandPrincipal {
    return { id: this.config.guestId, role: "guest", tenantId: this.config.tenantId };
  }

  /**
   * ADR-0082: the local operator simulator acts through the separate
   * representative person actor, never by impersonating the Operator ID.
   */
  representativePrincipal(): CommandPrincipal {
    return { id: this.config.representativePersonId, role: "operator", tenantId: this.config.tenantId };
  }

  systemPrincipal(): CommandPrincipal {
    return { id: "platform-system-001", role: "system", tenantId: this.config.tenantId };
  }

  demoOccupants(partySize: number): { name: string }[] {
    const count = Math.max(1, Math.floor(partySize));
    return Array.from({ length: count }, (_, index) => ({
      name: index === 0 ? this.config.guestName : `Companion ${index}`,
    }));
  }

  selfBookingAttestation(): { readonly accepted: true; readonly version: string } {
    return { accepted: true, version: SELF_BOOKING_ATTESTATION_VERSION };
  }

  /**
   * Local-only operator simulation: confirms a disclosed booking request and
   * issues the Conditional Booking Offer through the real application paths,
   * using the ADR-0082 representative grant. No authorization is bypassed.
   */
  simulateOperatorAcceptance(requestId: string): { readonly offerId: string } {
    const representative = this.representativePrincipal();
    const artifact = this.bookingRequestApp.getArtifact(requestId, representative);
    const confirmAction = artifact.actions.find((action) => action.type === "confirm");
    if (!confirmAction) {
      throw new Error(`Cannot simulate operator acceptance for ${requestId}: no confirm action available`);
    }
    this.bookingRequestApp.confirm({
      artifactId: confirmAction.artifactId,
      requestId: confirmAction.requestId,
      expectedStatus: confirmAction.expectedStatus,
      projectionVersion: confirmAction.projectionVersion,
      principal: representative,
      action: "confirm",
    });
    const offer = this.conditionalOfferApp.issue(requestId, representative);
    return { offerId: offer.offerId };
  }

  #seedUnits(): void {
    const operator = {
      id: this.config.operatorId,
      name: this.config.operatorName,
      status: "approved",
      approvedAt: "2026-01-01T00:00:00Z",
      legalForm: "private-company-limited-by-shares",
      cacVerified: true,
      responsiblePersonsVerified: true,
      beneficialOwnersVerified: true,
      paymentProviderApproved: true,
      settlementAccountVerified: true,
      approvalExpiresAt: "2027-12-31T23:59:59Z",
    } as const;

    // Same Ikoyi unit facts as the local-owner fixture; the two runtimes stay
    // independent because each composes its own repositories and stores.
    this.unitRepository.save({
      id: "unit-lagos-ikoyi-001",
      propertyId: "property-lagos-ikoyi-001",
      title: "Luxury 2-Bedroom Apartment in Old Ikoyi",
      location: { city: "Lagos", neighbourhood: "Old Ikoyi" },
      occupancyModel: "entire-place",
      capacity: 4,
      amenities: ["wifi", "24_7_power_generator", "parking", "air_conditioning", "security_guard", "swimming_pool"],
      published: true,
      price: {
        nightlyKobo: 12000000,
        mandatoryFeesKobo: 1000000,
        refundableSecurityDepositKobo: 5000000,
        version: "price-ikoyi-v1",
      },
      operator,
      inspection: {
        id: "inspection-ikoyi-001",
        inspectorId: "inspector-verified-01",
        status: "passed",
        inspectedAt: "2026-01-15T00:00:00Z",
        expiresAt: "2027-01-15T00:00:00Z",
        materialChangePending: false,
        scope: [...INSPECTION_SCOPE],
      },
      managementAuthority: {
        id: "authority-ikoyi-001",
        propertyId: "property-lagos-ikoyi-001",
        status: "verified",
        verifiedAt: "2026-01-15T00:00:00Z",
        expiresAt: "2027-01-15T00:00:00Z",
        permissions: [...AUTHORITY_PERMISSIONS],
      },
      regulatory: {
        licensing: { status: "verified", verifiedAt: "2026-01-15T00:00:00Z", expiresAt: "2027-01-15T00:00:00Z" },
        insurance: {
          status: "verified",
          verifiedAt: "2026-01-15T00:00:00Z",
          expiresAt: "2027-01-15T00:00:00Z",
          publicLiabilityPerOccurrenceKobo: 1000000000,
          annualAggregateKobo: 2000000000,
          propertyCoverVerified: true,
        },
      },
      blockedDates: [],
    });

    this.unitRepository.save({
      id: "unit-lagos-lekki-002",
      propertyId: "property-lagos-lekki-002",
      title: "Serene 1-Bedroom Suite in Lekki Phase 1",
      location: { city: "Lagos", neighbourhood: "Lekki Phase 1" },
      occupancyModel: "entire-place",
      capacity: 2,
      amenities: ["wifi", "24_7_power_generator", "air_conditioning", "security_guard"],
      published: true,
      price: {
        nightlyKobo: 6500000,
        mandatoryFeesKobo: 500000,
        refundableSecurityDepositKobo: 3000000,
        version: "price-lekki-v1",
      },
      operator,
      inspection: {
        id: "inspection-lekki-002",
        inspectorId: "inspector-verified-01",
        status: "passed",
        inspectedAt: "2026-02-01T00:00:00Z",
        expiresAt: "2027-02-01T00:00:00Z",
        materialChangePending: false,
        scope: [...INSPECTION_SCOPE],
      },
      managementAuthority: {
        id: "authority-lekki-002",
        propertyId: "property-lagos-lekki-002",
        status: "verified",
        verifiedAt: "2026-02-01T00:00:00Z",
        expiresAt: "2027-02-01T00:00:00Z",
        permissions: [...AUTHORITY_PERMISSIONS],
      },
      regulatory: {
        licensing: { status: "verified", verifiedAt: "2026-02-01T00:00:00Z", expiresAt: "2027-02-01T00:00:00Z" },
        insurance: {
          status: "verified",
          verifiedAt: "2026-02-01T00:00:00Z",
          expiresAt: "2027-02-01T00:00:00Z",
          publicLiabilityPerOccurrenceKobo: 1000000000,
          annualAggregateKobo: 2000000000,
          propertyCoverVerified: true,
        },
      },
      blockedDates: [],
    });
  }

  #seedRepresentativeGrant(): void {
    const authorized = this.grantStore.canActForOperator({
      actorId: this.config.representativePersonId,
      operatorId: this.config.operatorId,
      tenantId: this.config.tenantId,
    });
    if (authorized) return;

    const grantCommand = createPlatformCommandEnvelope({
      commandName: "operator_representative.grant",
      principal: { id: this.config.adminId, role: "admin", tenantId: this.config.tenantId },
      payload: {
        actorId: this.config.representativePersonId,
        operatorId: this.config.operatorId,
        expiresAtIso: "2027-01-01T00:00:00Z",
        responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z",
        verificationReference: "verif-ref-adeleke-001",
      },
      idempotencyKey: `seed-guest-grant-${this.config.representativePersonId}`,
    });
    this.grantStore.createGrant(grantCommand);
  }

  close(): void {
    this.grantStore.close();
  }
}

export function resetLocalGuestFixture(databasePath = DEFAULT_LOCAL_GUEST_CONFIG.databasePath): void {
  if (!existsSync(databasePath)) return;
  try {
    unlinkSync(databasePath);
  } catch (error) {
    // A concurrent remover is the only benign race; locked or permission
    // failures must be visible rather than falsely reported as a reset.
    if (existsSync(databasePath)) throw error;
  }
}
