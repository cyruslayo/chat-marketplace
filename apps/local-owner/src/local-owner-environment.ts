import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  UnitRepository,
  AvailabilityCalendar,
  GuestVerificationService,
  BookingRequestManager,
  SqliteOperatorRepresentativeGrantStore,
  OperatorEnforcementManager,
  ReservePayoutManager,
  RevenueReleaseManager,
  InMemoryRevenueAccountingRepository,
  InMemoryBookingStateRepository,
  type Unit,
  type OperatorRepresentativeGrant,
  type TrustTierEvaluation,
  type PayoutPlanResult,
  type ReserveTranche,
  type OperatorUnitProjections,
  type AuthoritativeReliabilityRecord,
  type OperatorReliabilityAuthority,
  type OperatorScopeAuthority,
  type ProductionRevenueReleaseRecord,
  type AuthoritativeReleaseInput,
  SqliteOperatorSessionAuthority,
  SqliteGuestInteractionStore,
  SqliteAvailabilityStore,
  JsonUnitRepository,
  JsonOperatorRepository,
  SqliteBookingPaymentJourneyRepository,
  SqliteBookingStateRepository,
  SqliteCheckInSupportStore,
  contractualCheckInWindow,
  isSupportVerificationBasis,
  ownerPayableDueAt,
  type AccessStatus,
  type CheckInSupportState,
  type ComplaintCategory,
  type ContractualCheckInWindow,
  type OperatorRepository,
} from "../../../domains/shortlet/src/index.js";
import { bookingPaymentMethod, offerRecordFromJson, projectBookingStage, type BookingPaymentMethod, type BookingStage, type BookingStageProjection } from "./booking-projection.js";
import {
  createBookingRequestApplication,
  createConditionalOfferApplication,
  createCheckInSupportApplication,
  type CheckInSupportApplication,
  type BookingRequestApplication,
  type BookingRequestArtifact,
} from "../../../apps/web/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../../../packages/platform-core/src/index.js";

export interface LocalOwnerFixtureConfig {
  readonly databasePath: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly representativePersonId: string;
  readonly representativePersonName: string;
  readonly adminId: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly inventoryPath?: string;
  readonly operatorsPath?: string;
  readonly seedFixture?: boolean;
  readonly clock?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Decision D1: the only decline reasons, with no free text (ADR 0075). The Guest never sees them. */
export const DECLINE_REASONS = Object.freeze({
  dates_not_available: "Dates not available",
  other_reason: "Other reason",
} as const);
export type DeclineReasonCode = keyof typeof DECLINE_REASONS;
export function isDeclineReasonCode(value: unknown): value is DeclineReasonCode {
  return typeof value === "string" && Object.hasOwn(DECLINE_REASONS, value);
}

/** What the confirm form submits: the explicit re-attestation and the version it was rendered from. */
export interface OperatorConfirmDecision { readonly attested: boolean; readonly basedOnVersion: number }
/** What the decline form submits: a D1 reason code and the version it was rendered from. */
export interface OperatorDeclineDecision { readonly reason: string; readonly basedOnVersion: number }

export type OperatorDecisionInputProblem = "attestation_required" | "reason_required";
/** A decision form was incomplete. Nothing was changed. */
export class OperatorDecisionInputError extends Error {
  constructor(readonly problem: OperatorDecisionInputProblem) {
    super(problem === "attestation_required" ? "Explicit re-attestation is required to confirm" : "A decline reason is required");
    this.name = "OperatorDecisionInputError";
  }
}

/** A confirmed Booking Request as the back office lists it (B4). Labels only: no ids beyond the request, no payment details (ADR 0075). */
export interface OperatorBooking extends BookingStageProjection {
  readonly requestId: string;
  readonly ownerName: string;
  readonly apartmentTitle: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly partySize: number;
  readonly allInStayTotalKobo: number | null;
}

/** A confirmed Reservation's snapshot facts and check-in state (B5). No card, reference or account values (ADR 0075). */
export interface OperatorReservation extends OperatorBooking {
  readonly reservationId: string;
  /** The Guest's phone, for coordination only (ADR 0075). */
  readonly phoneNumber: string | null;
  readonly checkInWindow: ContractualCheckInWindow | null;
  readonly checkoutTime: string | null;
  readonly amountPaidKobo: number;
  readonly paidWith: BookingPaymentMethod | null;
  readonly accessStatus: AccessStatus;
  readonly accessRecordedAt: string | null;
  readonly openComplaints: readonly ComplaintCategory[];
  /** Null until Verified Access, and while any Blocking Fulfilment Complaint is open (ADR 0089). */
  readonly ownerPayableDueAt: string | null;
  /** The version the check-in forms carry (ADR 0072). */
  readonly version: string;
}

/**
 * Blocking Fulfilment Complaint categories as the back office names them. The codes are the domain's; the words
 * follow CONTEXT.md (access, substitution, habitability, safety, authority). Fixed list, no free text (ADR 0091).
 */
export const COMPLAINT_CATEGORY_LABELS: Readonly<Record<ComplaintCategory, string>> = Object.freeze({
  access_failure: "Access failure",
  habitability_failure: "Habitability failure",
  substitution: "Substitution",
  safety_issue: "Safety issue",
  authority_defect: "Authority defect",
});
export function isComplaintCategory(value: unknown): value is ComplaintCategory {
  return typeof value === "string" && Object.hasOwn(COMPLAINT_CATEGORY_LABELS, value);
}

export type CheckInInputProblem = "basis_required" | "category_required";
/** A check-in form was incomplete. Nothing was recorded. */
export class CheckInInputError extends Error {
  constructor(readonly problem: CheckInInputProblem) {
    super(problem === "basis_required" ? "Choose how access was verified" : "Choose a complaint category");
    this.name = "CheckInInputError";
  }
}
/** The Reservation changed since the form was rendered (ADR 0072). Nothing was recorded. */
export class CheckInStaleError extends Error {
  constructor() { super("This Reservation changed since you opened it"); this.name = "CheckInStaleError"; }
}

export const DEFAULT_LOCAL_OWNER_CONFIG: LocalOwnerFixtureConfig = {
  databasePath: ".scratch/local-owner/owner_fixture.sqlite",
  tenantId: "tenant-lagos-internal",
  operatorId: "op-lagos-owner-001",
  operatorName: "Eko Prime Living Ltd",
  representativePersonId: "person-owner-001",
  representativePersonName: "Babatunde Adeleke",
  adminId: "platform-admin-001",
  unitId: "unit-lagos-ikoyi-001",
  propertyId: "property-lagos-ikoyi-001",
  seedFixture: true,
};

export interface LocalOwnerStateOverview {
  readonly tenantId: string;
  readonly operator: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly legalForm: string;
    readonly verified: boolean;
  };
  readonly representative: {
    readonly actorId: string;
    readonly name: string;
    readonly isAuthorized: boolean;
    readonly grant: OperatorRepresentativeGrant | null;
  };
  readonly unit: {
    readonly id: string;
    readonly title: string;
    readonly city: string;
    readonly neighbourhood: string;
    readonly occupancyModel: string;
    readonly capacity: number;
    readonly published: boolean;
    readonly inspectionStatus: string;
    readonly authorityStatus: string;
    readonly nightlyKobo: number;
    readonly refundableSecurityDepositKobo: number;
  };
  readonly availability: {
    readonly isAvailable: boolean;
    readonly sampleCheckIn: string;
    readonly sampleCheckOut: string;
  };
  readonly enforcement: OperatorUnitProjections;
  readonly trustTier: TrustTierEvaluation;
  readonly payoutProjections: PayoutPlanResult;
  readonly pendingRequests: readonly BookingRequestArtifact[];
  readonly reserveTranches: readonly ReserveTranche[];
}

export class LocalApartmentOwnerEnvironment {
  readonly config: LocalOwnerFixtureConfig;
  readonly clock: () => Date;
  readonly unitRepository: UnitRepository | JsonUnitRepository;
  readonly operatorRepository: OperatorRepository | null;
  readonly calendar: AvailabilityCalendar;
  readonly grantStore: SqliteOperatorRepresentativeGrantStore;
  readonly enforcementManager: OperatorEnforcementManager;
  readonly reliabilityAuthority: OperatorReliabilityAuthority;
  readonly scopeAuthority: OperatorScopeAuthority;
  readonly reservePayoutManager: ReservePayoutManager;
  readonly revenueReleaseManager: RevenueReleaseManager;
  readonly accountingRepository: InMemoryRevenueAccountingRepository;
  readonly bookingStateRepository: InMemoryBookingStateRepository;
  readonly bookingRequestApp: BookingRequestApplication;
  readonly conditionalOfferApp: ReturnType<typeof createConditionalOfferApplication>;
  readonly sessionAuthority: SqliteOperatorSessionAuthority;
  readonly interactionStore: SqliteGuestInteractionStore;
  readonly audit: InMemoryAuditLog;
  readonly telemetry: InMemoryTelemetry;
  readonly #database: DatabaseSync;

  /** Read-only here: the committed Reservation's current status (B4). The Guest side writes it. */
  readonly #bookingState: SqliteBookingStateRepository;
  /** Durable check-in state shared with every process on this database (B5). */
  readonly #checkInStore: SqliteCheckInSupportStore;

  #demoRequests: string[] = [];

  constructor(config: Partial<LocalOwnerFixtureConfig> = {}) {
    this.config = { ...DEFAULT_LOCAL_OWNER_CONFIG, ...config };
    this.clock = this.config.clock ?? (() => new Date("2026-08-10T10:00:00Z"));

    mkdirSync(dirname(this.config.databasePath), { recursive: true });

    this.#database = new DatabaseSync(this.config.databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.interactionStore = new SqliteGuestInteractionStore(this.config.databasePath, this.#database);
    this.#bookingState = new SqliteBookingStateRepository(this.#database, this.config.databasePath);
    this.#checkInStore = new SqliteCheckInSupportStore(this.#database);
    this.audit = new InMemoryAuditLog();
    this.telemetry = new InMemoryTelemetry();
    this.grantStore = new SqliteOperatorRepresentativeGrantStore(this.config.databasePath, { clock: this.clock });
    this.sessionAuthority = new SqliteOperatorSessionAuthority(this.config.databasePath, { clock: this.clock });
    this.unitRepository = this.config.inventoryPath ? new JsonUnitRepository(this.config.inventoryPath) : new UnitRepository();
    this.operatorRepository = this.config.operatorsPath ? new JsonOperatorRepository(this.config.operatorsPath, { clock: this.clock }) : null;
    this.calendar = new AvailabilityCalendar({ repository: this.unitRepository, store: new SqliteAvailabilityStore(this.config.databasePath, this.#database) });
    this.enforcementManager = new OperatorEnforcementManager({
      clock: this.clock,
      operatorAuthority: this.grantStore,
    });
    this.reliabilityAuthority = {
      getReliability: ({ operatorId, tenantId }: { operatorId: string; tenantId: string }): AuthoritativeReliabilityRecord => ({
        operatorId,
        tenantId,
        trailing60dCompletedBookings: 12,
        trailing60dOpportunities: 12,
        trailing60dReliabilityRate: 0.98,
        trailing180dCompletedBookings: 35,
        trailing180dOpportunities: 35,
        trailing180dReliabilityRate: 0.99,
      }),
    };
    this.scopeAuthority = {
      isOperatorInTenant: ({ operatorId, tenantId }: { operatorId: string; tenantId: string }) =>
        operatorId === this.config.operatorId && tenantId === this.config.tenantId,
    };
    this.accountingRepository = new InMemoryRevenueAccountingRepository();
    this.revenueReleaseManager = new RevenueReleaseManager();
    this.reservePayoutManager = new ReservePayoutManager({
      accountingRepository: this.accountingRepository,
      enforcementAuthority: this.enforcementManager,
      reliabilityAuthority: this.reliabilityAuthority,
      scopeAuthority: this.scopeAuthority,
      clock: this.clock,
    });
    this.bookingStateRepository = new InMemoryBookingStateRepository();

    const guestVerification = new GuestVerificationService({
      repository: this.unitRepository,
      verificationResults: {
        getVerificationResult: ({ tenantId, guestId }) => ({
          tenantId,
          guestId,
          governmentIdVerified: true,
        }),
      },
    });

    this.bookingRequestApp = createBookingRequestApplication({
      repository: this.unitRepository,
      calendar: this.calendar,
      guestVerification,
      operatorAuthority: this.grantStore,
      clock: this.clock,
      store: this.interactionStore,
      audit: this.audit,
      guestContacts: { find: (guestId: string, tenantId: string) => ({ guestId, tenantId, phoneNumber: "+2348012345678", contactEmail: null, revision: 1 }) },
    });
    this.conditionalOfferApp = createConditionalOfferApplication({
      bookingRequestApplication: this.bookingRequestApp,
      repository: this.unitRepository,
      calendar: this.calendar,
      store: this.interactionStore,
      operatorAuthority: this.grantStore,
      audit: this.audit,
      clock: this.clock,
    });

    if (this.config.seedFixture !== false) this.#seedFixture();
  }

  #seedFixture(): void {
    const inspectionScope = [
      "entire-place-possession",
      "structure-and-sanitation",
      "fire-and-emergency-readiness",
      "electrical-and-utilities",
      "locks-and-privacy",
      "access-controls",
      "cameras",
      "listing-accuracy",
      "current-media",
    ];

    const authorityPermissions = [
      "advertise",
      "accept-bookings",
      "contract-guests",
      "provide-access",
      "collect-revenue",
      "manage-cancellations",
      "issue-refunds",
      "manage-incidents",
    ];

    const seededUnit: Unit = {
      id: this.config.unitId,
      propertyId: this.config.propertyId,
      title: "Luxury 2-Bedroom Apartment in Old Ikoyi",
      location: { city: "Lagos", neighbourhood: "Old Ikoyi" },
      occupancyModel: "entire-place",
      capacity: 4,
      bedrooms: 2,
      bathrooms: 2,
      description: "A bright, quiet apartment with a spacious living room and reliable power.",
      amenities: ["wifi", "24_7_power_generator", "parking", "air_conditioning", "security_guard", "swimming_pool"],
      photoUrls: [],
      published: true,
      price: {
        nightlyKobo: 12000000, // ₦120,000 / night
        mandatoryFeesKobo: 1000000, // ₦10,000 cleaning & service
        refundableSecurityDepositKobo: 2000000, // ₦20,000 deposit
        version: "price-ikoyi-v1",
      },
      operator: {
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
      },
      inspection: {
        id: "inspection-ikoyi-001",
        inspectorId: "inspector-verified-01",
        status: "passed",
        inspectedAt: "2026-01-15T00:00:00Z",
        expiresAt: "2027-01-15T00:00:00Z",
        materialChangePending: false,
        scope: inspectionScope,
      },
      managementAuthority: {
        id: "authority-ikoyi-001",
        propertyId: this.config.propertyId,
        status: "verified",
        verifiedAt: "2026-01-15T00:00:00Z",
        expiresAt: "2027-01-15T00:00:00Z",
        permissions: authorityPermissions,
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
      checkInWindow: { earliestAccessTime: "14:00", latestPermittedArrival: "22:00", timezone: "Africa/Lagos" }, // ADR 0031 launch boundary
    };

    this.unitRepository.save(seededUnit);

    // Seed Representative Grant if not already in SQLite DB
    if (!this.grantStore.canActForOperator({
      actorId: this.config.representativePersonId,
      operatorId: this.config.operatorId,
      tenantId: this.config.tenantId,
    })) {
      const grantCmd = createPlatformCommandEnvelope({
        commandName: "operator_representative.grant",
        principal: { id: this.config.adminId, role: "admin", tenantId: this.config.tenantId },
        payload: {
          actorId: this.config.representativePersonId,
          operatorId: this.config.operatorId,
          expiresAtIso: "2027-01-01T00:00:00Z",
          responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z",
          verificationReference: "verif-ref-adeleke-001",
        },
        idempotencyKey: `seed-grant-${this.config.representativePersonId}`,
      });
      this.grantStore.createGrant(grantCmd);
    }
  }

  getRepresentativePrincipal(): CommandPrincipal {
    return {
      id: this.config.representativePersonId, // Authenticated human representative actor
      role: "operator",
      tenantId: this.config.tenantId,
    };
  }

  provisionOperatorAccessToken(actorId = this.config.representativePersonId, tenantId = this.config.tenantId): string {
    const authorized = this.grantStore.canActForOperator({ actorId, operatorId: this.config.operatorId, tenantId });
    return this.sessionAuthority.provisionAccessToken({ actorId, tenantId, representativeAuthorized: authorized }).token;
  }

  createDemoIncomingBookingRequest(input: {
    guestId?: string;
    guestName?: string;
    checkIn?: string;
    checkOut?: string;
    partySize?: number;
    /** False leaves the request in Delivery Pending (ADR 0043), for testing Delivery Failed. */
    delivered?: boolean;
  } = {}): BookingRequestArtifact {
    const guestId = input.guestId ?? "demo-guest-101";
    const guestPrincipal: CommandPrincipal = {
      id: guestId,
      role: "guest",
      tenantId: this.config.tenantId,
    };

    const draft = this.bookingRequestApp.createDraft(
      {
        unitId: this.config.unitId,
        primaryGuest: { id: guestId, name: input.guestName ?? "Dr. Kemi Balogun" },
        occupants: [{ name: input.guestName ?? "Dr. Kemi Balogun" }],
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        checkIn: input.checkIn ?? "2026-08-15",
        checkOut: input.checkOut ?? "2026-08-18",
      },
      guestPrincipal
    );

    const disclosed = this.bookingRequestApp.disclose(draft.draftId, guestPrincipal, input.delivered ?? true);
    this.#demoRequests.push(disclosed.requestId);

    return this.bookingRequestApp.getArtifact(disclosed.requestId, this.getRepresentativePrincipal());
  }

  confirmBookingRequest(requestId: string): BookingRequestArtifact {
    const artifact = this.bookingRequestApp.getArtifact(requestId, this.getRepresentativePrincipal());
    const action = artifact.actions.find((a) => a.type === "confirm");
    if (!action) {
      throw new Error(`Cannot confirm booking request ${requestId}: no confirm action available`);
    }

    this.bookingRequestApp.confirm({
      artifactId: action.artifactId,
      requestId: action.requestId,
      expectedStatus: action.expectedStatus,
      projectionVersion: action.projectionVersion,
      principal: this.getRepresentativePrincipal(),
      action: "confirm",
    });

    return this.bookingRequestApp.getArtifact(requestId, this.getRepresentativePrincipal());
  }

  declineBookingRequest(requestId: string, reason = "Dates unavailable due to private maintenance"): BookingRequestArtifact {
    const artifact = this.bookingRequestApp.getArtifact(requestId, this.getRepresentativePrincipal());
    const action = artifact.actions.find((a) => a.type === "decline");
    if (!action) {
      throw new Error(`Cannot decline booking request ${requestId}: no decline action available`);
    }

    this.bookingRequestApp.decline({
      artifactId: action.artifactId,
      requestId: action.requestId,
      expectedStatus: action.expectedStatus,
      projectionVersion: action.projectionVersion,
      principal: this.getRepresentativePrincipal(),
      action: "decline",
      reason,
    });

    return this.bookingRequestApp.getArtifact(requestId, this.getRepresentativePrincipal());
  }

  /** Your name for the back-office header. Never an actor id (ADR 0075); an unknown actor gets a neutral label. */
  representativeDisplayName(actorId: string): string {
    return actorId === this.config.representativePersonId ? this.config.representativePersonName : "Signed-in representative";
  }

  /**
   * Owner and apartment names for a request, so no page labels work by id (B1 AC1).
   * Callers must already hold the request through a grant-checked read (`listOperatorRequestArtifacts` or `operatorRequestDetail`).
   */
  requestLabels(requestId: string): { readonly ownerName: string; readonly apartmentTitle: string } {
    const request = this.bookingRequestApp.manager.getRequest(requestId) as { operatorId?: string; unitId?: string };
    const unit: unknown = request.unitId ? this.unitRepository.findById(request.unitId) : null;
    const unitRecord = isRecord(unit) ? unit : {};
    const unitOperator = isRecord(unitRecord.operator) ? unitRecord.operator : {};
    const ownerName = (request.operatorId ? this.operatorRepository?.findById(request.operatorId)?.name : undefined)
      ?? (typeof unitOperator.name === "string" && unitOperator.name ? unitOperator.name : undefined)
      ?? (request.operatorId === this.config.operatorId ? this.config.operatorName : "Owner name not on file");
    const apartmentTitle = typeof unitRecord.title === "string" && unitRecord.title ? unitRecord.title : "Apartment name not on file";
    return Object.freeze({ ownerName, apartmentTitle });
  }

  listOperatorRequestArtifacts(principal: CommandPrincipal): readonly BookingRequestArtifact[] {
    if (principal.role !== "operator" || !principal.id || !principal.tenantId) return [];
    const actorId = principal.id;
    const tenantId = principal.tenantId;
    const requests = this.interactionStore.listBookingRequestIds().flatMap((requestId) => {
      try {
        const request = this.bookingRequestApp.manager.getRequest(requestId) as { operatorId?: string; tenantId?: string; status: string };
        if (!request.operatorId || request.tenantId !== tenantId || !this.grantStore.canActForOperator({ actorId, operatorId: request.operatorId, tenantId })) return [];
        // Delivery Failed stays visible as its own state, never as a missed response (ADR 0043).
        if (!["disclosed", "confirmed", "declined", "expired", "delivery_failed"].includes(request.status)) return [];
        const artifact = this.bookingRequestApp.getArtifact(requestId, principal);
        try { this.audit.record({ type: "operator_request_visible", actorId: principal.id, tenantId: principal.tenantId, requestId, status: artifact.facts.status }); this.telemetry.track({ type: "operator_request_visible", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* observability cannot block visibility */ }
        return [artifact];
      } catch { return []; }
    });
    // Requests awaiting your response come first, soonest projected deadline first (B2 AC1, ADR 0077).
    return requests.sort((a, b) => {
      const pending = (artifact: BookingRequestArtifact) => artifact.facts.status === "disclosed" ? (artifact.facts.delivered ? 0 : 1) : 2;
      return pending(a) - pending(b) || Date.parse(a.facts.operatorResponseDeadlineAt) - Date.parse(b.facts.operatorResponseDeadlineAt);
    });
  }

  operatorRequestDetail(requestId: string, principal: CommandPrincipal): BookingRequestArtifact {
    const request = this.bookingRequestApp.manager.getRequest(requestId) as { operatorId?: string; tenantId?: string };
    if (!request.operatorId || !request.tenantId || request.tenantId !== principal.tenantId || principal.role !== "operator" || !principal.id || !this.grantStore.canActForOperator({ actorId: principal.id, operatorId: request.operatorId, tenantId: request.tenantId })) throw new Error("Operator request not found");
    const artifact = this.bookingRequestApp.getArtifact(requestId, principal);
    try { this.audit.record({ type: "operator_request_opened", actorId: principal.id, tenantId: principal.tenantId, requestId, status: artifact.facts.status }); this.telemetry.track({ type: "operator_request_opened", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* observability cannot block reads */ }
    const phoneNumber = (request as { phoneNumber?: string }).phoneNumber;
    return phoneNumber ? Object.freeze({ ...artifact, facts: Object.freeze({ ...artifact.facts, phoneNumber }) }) : artifact;
  }

  /**
   * Confirms on the owner's behalf. Fails closed unless you explicitly re-attested the ADR 0041 facts, and only
   * at the version the form was rendered from (ADR 0072), so a stale tab or a repeat can never issue a second offer.
   */
  confirmOperatorRequest(requestId: string, principal: CommandPrincipal, decision: OperatorConfirmDecision): BookingRequestArtifact {
    if (decision.attested !== true) throw new OperatorDecisionInputError("attestation_required");
    const artifact = this.operatorRequestDetail(requestId, principal);
    const action = artifact.actions.find((candidate) => candidate.type === "confirm");
    if (!action) throw new Error("Booking Request action is stale or no longer allowed");
    try { this.audit.record({ type: "operator_confirmation_attempted", actorId: principal.id, tenantId: principal.tenantId, requestId, previousState: artifact.facts.status }); this.telemetry.track({ type: "operator_confirmation_attempted", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ }
    try {
      // The expected version is the one you saw, not the current one (ADR 0072).
      this.bookingRequestApp.confirm({ ...action, projectionVersion: decision.basedOnVersion, principal, action: "confirm" });
      this.conditionalOfferApp.issue(requestId, principal);
    } catch (error) {
      try { this.audit.record({ type: "operator_stale_action_rejected", actorId: principal.id, tenantId: principal.tenantId, requestId, reasonCode: /expired/i.test(String(error)) ? "expired" : "stale" }); this.telemetry.track({ type: "operator_stale_action_rejected", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ }
      throw error;
    }
    try { this.audit.record({ type: "operator_request_confirmed", actorId: principal.id, tenantId: principal.tenantId, requestId, previousState: artifact.facts.status, newState: "confirmed" }); this.telemetry.track({ type: "operator_request_confirmed", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ }
    return this.operatorRequestDetail(requestId, principal);
  }

  /**
   * Declines with one of the two D1 reason codes; there is no free text (ADR 0075). The domain releases the dates
   * immediately (ADR 0041). "Dates not available" also records a calendar-accuracy event (ADR 0039).
   */
  declineOperatorRequest(requestId: string, principal: CommandPrincipal, decision: OperatorDeclineDecision): BookingRequestArtifact {
    if (!isDeclineReasonCode(decision.reason)) throw new OperatorDecisionInputError("reason_required");
    const artifact = this.operatorRequestDetail(requestId, principal);
    const action = artifact.actions.find((candidate) => candidate.type === "decline");
    if (!action) throw new Error("Booking Request action is stale or no longer allowed");
    try { this.audit.record({ type: "operator_decline_attempted", actorId: principal.id, tenantId: principal.tenantId, requestId, previousState: artifact.facts.status }); this.telemetry.track({ type: "operator_decline_attempted", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ }
    try { this.bookingRequestApp.decline({ ...action, projectionVersion: decision.basedOnVersion, principal, action: "decline", reason: decision.reason }); }
    catch (error) { try { this.audit.record({ type: "operator_expired_action_rejected", actorId: principal.id, tenantId: principal.tenantId, requestId, reasonCode: /expired/i.test(String(error)) ? "expired" : "stale" }); this.telemetry.track({ type: "operator_expired_action_rejected", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ } throw error; }
    try { this.audit.record({ type: "operator_request_declined", actorId: principal.id, tenantId: principal.tenantId, requestId, previousState: artifact.facts.status, newState: "declined", reasonCode: decision.reason }); this.telemetry.track({ type: "operator_request_declined", principalId: principal.id, tenantId: principal.tenantId, aggregateId: requestId }); } catch { /* no block */ }
    if (decision.reason === "dates_not_available") this.#recordCalendarAccuracyEvent(requestId);
    return this.operatorRequestDetail(requestId, principal);
  }

  /**
   * ADR 0039: declining an unconfirmed request because the dates were not available is a calendar-accuracy event.
   * Recorded in the append-only audit, not as an enforcement incident: severity and attribution are human
   * enforcement judgments (ADR 0064) that no ADR fixes for this impact class. Minimal by design (ADR 0075):
   * ids, time and reason code only; no free text and no guest data.
   */
  #recordCalendarAccuracyEvent(requestId: string): void {
    const request = this.bookingRequestApp.manager.getRequest(requestId) as { unitId?: string; operatorId?: string; tenantId?: string };
    try {
      this.audit.record({ type: "calendar_accuracy_event", impactClass: "unavailable_request_decline", requestId, unitId: request.unitId, operatorId: request.operatorId, tenantId: request.tenantId, reasonCode: "dates_not_available", occurredAt: this.clock().toISOString() });
    } catch { /* observability cannot undo a completed decline */ }
  }

  /**
   * Every confirmed Booking Request for an owner you hold a grant for (ADR 0082), with its stage read from the
   * authoritative records the Guest side writes to the shared database. Read on each call, never cached, so a payment
   * recorded by another process shows on the next view. Read-only: no command is issued.
   */
  listOperatorBookings(principal: CommandPrincipal): readonly OperatorBooking[] {
    if (principal.role !== "operator" || !principal.id || !principal.tenantId) return [];
    const journeys = new SqliteBookingPaymentJourneyRepository(this.#database, this.config.databasePath);
    const now = this.clock();
    const bookings = this.interactionStore.listBookingRequestIds().flatMap((requestId) => {
      try {
        const booking = this.#bookingFor(requestId, principal, journeys, now);
        return booking ? [booking] : [];
      } catch { return []; }
    });
    const rank: Record<BookingStage, number> = { offer_not_issued: 0, offer_issued: 1, awaiting_payment: 1, reservation_confirmed: 2, ended: 3 };
    // Open payments first, soonest deadline first; then Reservations by check-in; then ended bookings.
    const key = (booking: OperatorBooking) => rank[booking.stage] === 1 ? Date.parse(booking.graceEndsAt ?? booking.paymentDeadlineAt ?? "") : Date.parse(booking.checkIn);
    return bookings.sort((a, b) => rank[a.stage] - rank[b.stage] || key(a) - key(b));
  }

  /** One booking, or "Booking not found" for an unknown id, an unconfirmed request, or an owner you do not act for (ADR 0082). */
  operatorBooking(requestId: string, principal: CommandPrincipal): OperatorBooking {
    const booking = this.#bookingFor(requestId, principal, new SqliteBookingPaymentJourneyRepository(this.#database, this.config.databasePath), this.clock());
    if (!booking) throw new Error("Booking not found");
    return booking;
  }

  #bookingFor(requestId: string, principal: CommandPrincipal, journeys: SqliteBookingPaymentJourneyRepository, now: Date): OperatorBooking | null {
    if (principal.role !== "operator" || !principal.id || !principal.tenantId) return null;
    let request: { operatorId?: string; tenantId?: string; status: string; checkIn: string; checkOut: string; nights: number; occupants: readonly unknown[]; quote?: { allInStayTotalKobo?: number } };
    try { request = this.bookingRequestApp.manager.getRequest(requestId) as typeof request; } catch { return null; }
    // Fail closed: a missing owner, tenant or grant is not found (ADR 0082).
    if (!request.operatorId || !request.tenantId || request.tenantId !== principal.tenantId || !this.grantStore.canActForOperator({ actorId: principal.id, operatorId: request.operatorId, tenantId: request.tenantId })) return null;
    if (request.status !== "confirmed") return null;
    const storedOffer = this.interactionStore.findConditionalOfferByRequestId(requestId);
    const offer = storedOffer ? offerRecordFromJson(storedOffer.offerJson) : null;
    const journey = offer ? journeys.findByOfferId(offer.offerId) : null;
    const reservationId = offer ? this.interactionStore.findBookingSnapshotByOfferId(offer.offerId)?.reservationId : undefined;
    const reservation = reservationId ? this.#bookingState.findReservationById(reservationId) : null;
    const projection = projectBookingStage({
      offer,
      journey,
      attemptMethod: offer ? this.interactionStore.findLivePaymentAttemptByOfferId(offer.offerId)?.method ?? null : null,
      // A snapshot without a live row still records a verified, committed Reservation (ADR 0005).
      reservationStatus: reservation?.status ?? (reservationId ? "confirmed" : null),
      now,
    });
    return Object.freeze({
      requestId,
      ...this.requestLabels(requestId),
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      nights: request.nights,
      partySize: request.occupants.length,
      // ADR 0077: the amount is the offer's captured quote, falling back to the request's; never recalculated.
      allInStayTotalKobo: offer?.allInStayTotalKobo ?? request.quote?.allInStayTotalKobo ?? null,
      ...projection,
    });
  }

  /**
   * A Reservation's snapshot facts and check-in state (B5). Grant-checked through `operatorBooking` (ADR 0082);
   * "Booking not found" unless the booking is a confirmed Reservation. Facts come from the Booking Contract,
   * never from the unit or a recalculation (ADR 0077).
   */
  operatorReservation(requestId: string, principal: CommandPrincipal): OperatorReservation {
    const booking = this.operatorBooking(requestId, principal);
    if (booking.stage !== "reservation_confirmed") throw new Error("Booking not found");
    const offer = this.interactionStore.findConditionalOfferByRequestId(requestId);
    const reservationId = offer ? this.interactionStore.findBookingSnapshotByOfferId(offer.offerId)?.reservationId : undefined;
    const reservation = reservationId ? this.#bookingState.findReservationById(reservationId) : null;
    const contract = reservation ? this.#bookingState.findContractById(reservation.contractId) : null;
    if (!reservation || !contract) throw new Error("Booking not found");
    const request = this.bookingRequestApp.manager.getRequest(requestId) as { phoneNumber?: string | null };
    const checkIn = this.#checkInState(reservation.reservationId);
    const openComplaints = checkIn.complaints.filter((complaint) => complaint.status !== "resolved").map((complaint) => complaint.category);
    const accessRecorded = checkIn.result?.status === "verified_access" || checkIn.result?.status === "late_voluntary_arrival";
    const protectionWindowStartsAt = accessRecorded ? checkIn.result?.protectionWindowStartsAt ?? null : null;
    // ADR 0072: the version the check-in forms were rendered from; any change to access or complaints makes it stale.
    const version = createHash("sha256").update(JSON.stringify([checkIn.result?.status ?? "awaiting_access", checkIn.result?.verifiedAt ?? "", checkIn.complaints.map((complaint) => `${complaint.complaintId}:${complaint.status}`)])).digest("hex").slice(0, 16);
    return Object.freeze({
      ...booking,
      reservationId: reservation.reservationId,
      phoneNumber: request.phoneNumber ?? null,
      checkInWindow: contractualCheckInWindow(contract.checkInWindow),
      checkoutTime: contract.checkout?.time ?? null,
      amountPaidKobo: contract.paymentDetails.amountKobo,
      paidWith: bookingPaymentMethod(contract.paymentDetails.paymentMethod),
      accessStatus: checkIn.result?.status ?? "awaiting_access",
      accessRecordedAt: accessRecorded ? checkIn.result?.verifiedAt ?? null : null,
      openComplaints: Object.freeze(openComplaints),
      // ADR 0089: due 24 hours after Verified Access, and only while no Blocking Fulfilment Complaint is open.
      ownerPayableDueAt: protectionWindowStartsAt && openComplaints.length === 0 ? ownerPayableDueAt(protectionWindowStartsAt) : null,
      version,
    });
  }

  /**
   * Records Verified Access as platform support (ADR 0091): an `authorized_staff` principal for the signed-in actor,
   * only after the owner grant check, with a documented basis. The domain refuses a repeat or a record before the
   * Contractual Check-In Window (ADR 0022, 0031).
   */
  recordVerifiedAccess(requestId: string, principal: CommandPrincipal, input: { readonly basis: string; readonly basedOnVersion: string }): OperatorReservation {
    if (!isSupportVerificationBasis(input.basis)) throw new CheckInInputError("basis_required");
    const basis = input.basis;
    return this.#checkInCommand(requestId, principal, input.basedOnVersion, "operator_verified_access_recorded", (app, reservationId, staff) => {
      app.recordSupportVerification({ reservationId, provisionedAt: this.clock().toISOString(), validAccess: true, failedAccess: false, positiveAtContractualCheckIn: false, basis }, staff);
      return { basis };
    });
  }

  /** Reports a Blocking Fulfilment Complaint as platform support (ADR 0091): a fixed category, no free text (ADR 0075). */
  reportBlockingComplaint(requestId: string, principal: CommandPrincipal, input: { readonly category: string; readonly basedOnVersion: string }): OperatorReservation {
    if (!isComplaintCategory(input.category)) throw new CheckInInputError("category_required");
    const category = input.category;
    return this.#checkInCommand(requestId, principal, input.basedOnVersion, "operator_blocking_complaint_reported", (app, reservationId, staff) => {
      app.reportBlockingComplaintAsSupport(reservationId, category, staff);
      return { category };
    });
  }

  #checkInCommand(requestId: string, principal: CommandPrincipal, basedOnVersion: string, auditType: string, run: (app: CheckInSupportApplication, reservationId: string, staff: CommandPrincipal) => Record<string, string>): OperatorReservation {
    // Grant, tenant and Reservation checks first; a missing or revoked grant is "Booking not found" (ADR 0082).
    const current = this.operatorReservation(requestId, principal);
    if (!principal.id || !principal.tenantId) throw new Error("Booking not found");
    if (basedOnVersion !== current.version) throw new CheckInStaleError();
    const staff: CommandPrincipal = { id: principal.id, role: "authorized_staff", tenantId: principal.tenantId };
    const app = this.#checkInSupport(staff.id);
    // ADR 0030: support is scheduled for the window before check-in is recorded; the signed-in user is the responder.
    try { app.manager.projectCheckInStatus(current.reservationId); } catch { app.scheduleSupport(current.reservationId, staff); }
    const codes = run(app, current.reservationId, staff);
    try { this.audit.record({ type: auditType, actorId: principal.id, tenantId: principal.tenantId, requestId, reservationId: current.reservationId, ...codes, occurredAt: this.clock().toISOString() }); } catch { /* observability cannot undo a recorded fact */ }
    return this.operatorReservation(requestId, principal);
  }

  /** Check-in state read fresh from the shared store (another process may have written it). */
  #checkInState(reservationId: string): Pick<CheckInSupportState, "result" | "complaints"> {
    const state = this.#checkInStore.load(reservationId);
    return { result: state?.result ?? null, complaints: state?.complaints ?? [] };
  }

  /**
   * A check-in application over the durable store. Built per command: all state lives in SQLite, so nothing is cached.
   * The window comes from the Booking Contract's snapshot and fails closed when the contract has none (ADR 0031).
   */
  #checkInSupport(responderId: string): CheckInSupportApplication {
    return createCheckInSupportApplication({
      store: this.#checkInStore,
      clock: this.clock,
      audit: this.audit,
      windowProvider: {
        getWindow: (reservationId: string) => {
          const reservation = this.#bookingState.findReservationById(reservationId);
          const contract = reservation ? this.#bookingState.findContractById(reservation.contractId) : null;
          const window = contractualCheckInWindow(contract?.checkInWindow);
          if (!contract || !window) throw new Error("This Reservation has no Contractual Check-In Window on file");
          return { checkInDate: contract.dates.checkIn, earliestAccessTime: window.earliestAccessTime, latestPermittedArrival: window.latestPermittedArrival, timezone: window.timezone };
        },
      },
      // Pilot coverage: the signed-in platform-support user responds; the platform admin is the backup (ADR 0030).
      assignmentProvider: { assign: () => ({ assignedResponderId: responderId, backupResponderId: this.config.adminId }) },
    });
  }

  getStateOverview(): LocalOwnerStateOverview {
    const unit = this.unitRepository.findById(this.config.unitId);
    if (!unit) throw new Error("Fixture unit not found");

    const grants = this.grantStore.listGrants().filter(
      (g) => g.operatorId === this.config.operatorId && g.actorId === this.config.representativePersonId
    );
    const activeGrant = grants.find((g) => !g.revokedAtIso) ?? null;
    const isAuthorized = this.grantStore.canActForOperator({
      actorId: this.config.representativePersonId,
      operatorId: this.config.operatorId,
      tenantId: this.config.tenantId,
    });

    const enforcement = this.enforcementManager.getProjections({
      operatorId: this.config.operatorId,
      unitId: this.config.unitId,
    });

    const trustTier = this.reservePayoutManager.evaluateOperatorTrustTier({
      operatorId: this.config.operatorId,
      tenantId: this.config.tenantId,
    });

    // Authoritative Issue-28 Production Revenue Release execution:
    // 3 nights @ ₦120,000/night + ₦10,000 mandatory cleaning = ₦370,000 gross.
    // Captured Preferred commission rate = 10% (₦37,000). Operator Net = ₦333,000.
    const releaseInput: AuthoritativeReleaseInput = {
      reservationId: "res-sample-ikoyi-001",
      contractId: "ctr-sample-ikoyi-001",
      contractVersion: 1,
      unitId: this.config.unitId,
      tenantId: this.config.tenantId,
      operatorId: this.config.operatorId,
      accessVersion: "v1.0",
      accessStatus: "verified_access",
      verifiedAccessAt: "2026-08-15T14:00:00.000Z",
      protectionWindowStartsAt: "2026-08-15T14:00:00.000Z",
      economics: {
        economicsVersion: "econ-ikoyi-v1",
        currency: "NGN",
        commissionPolicyVersion: "adr-0062-v1",
        capturedCommissionRate: 0.1, // 10% Preferred captured rate
        commissionableOperatorRevenueKobo: 37000000,
        operatorBorneProcessorCostsKobo: 0,
        applicableWithholdingKobo: 0,
        preReleaseRefundOrCreditKobo: 0,
        bookingOffsetsKobo: 0,
        securityDepositKobo: 2000000,
        platformRemittedTaxesKobo: 0,
        platformOwnedFeesKobo: 0,
        passThroughKobo: 0,
        undeliveredExtrasKobo: 0,
      },
      payoutPlan: "fast_payout",
      payoutPlanVersion: "v1.0",
      effectiveCheckoutAt: "2026-08-18T11:00:00.000Z",
      effectiveCheckoutVersion: "v1.0",
      riskHoldVersion: "v1.0",
      riskHoldKobo: 0,
      now: new Date("2026-08-16T15:00:00.000Z"), // 25 hours post verified access
    };

    // Commit via RevenueReleaseManager into accountingRepository
    const committedRevenueRelease = this.revenueReleaseManager.commitProductionRelease(
      releaseInput,
      this.accountingRepository
    );

    // Issue 30: Feed committed Revenue Release into ReservePayoutManager to derive authoritative Trust Tier settlement & reclassify ledger
    const samplePayout = this.reservePayoutManager.calculatePayoutPlanAndReserve({
      revenueRelease: committedRevenueRelease,
    });

    const pendingRequests = this.#demoRequests.map((reqId) => {
      try {
        return this.bookingRequestApp.getArtifact(reqId, this.getRepresentativePrincipal());
      } catch {
        return null;
      }
    }).filter((a): a is BookingRequestArtifact => a !== null);

    const avail = this.calendar.getAuthoritativeAvailability({
      unitId: this.config.unitId,
      checkIn: "2026-08-15",
      checkOut: "2026-08-18",
      clock: this.clock,
    });

    return {
      tenantId: this.config.tenantId,
      operator: {
        id: unit.operator.id,
        name: unit.operator.name,
        status: unit.operator.status,
        legalForm: unit.operator.legalForm,
        verified: unit.operator.cacVerified && unit.operator.responsiblePersonsVerified,
      },
      representative: {
        actorId: this.config.representativePersonId,
        name: this.config.representativePersonName,
        isAuthorized,
        grant: activeGrant,
      },
      unit: {
        id: unit.id,
        title: unit.title,
        city: unit.location.city,
        neighbourhood: unit.location.neighbourhood,
        occupancyModel: unit.occupancyModel,
        capacity: unit.capacity,
        published: unit.published,
        inspectionStatus: unit.inspection?.status ?? "none",
        authorityStatus: unit.managementAuthority?.status ?? "none",
        nightlyKobo: unit.price.nightlyKobo,
        refundableSecurityDepositKobo: unit.price.refundableSecurityDepositKobo,
      },
      availability: {
        isAvailable: avail.isAvailable,
        sampleCheckIn: "2026-08-15",
        sampleCheckOut: "2026-08-18",
      },
      enforcement,
      trustTier,
      payoutProjections: samplePayout,
      pendingRequests,
      reserveTranches: [],
    };
  }

  close(): void {
    this.sessionAuthority.close();
    this.grantStore.close();
    if (this.#database.isOpen) this.#database.close();
  }
}

export function resetLocalOwnerFixture(databasePath = DEFAULT_LOCAL_OWNER_CONFIG.databasePath): void {
  if (existsSync(databasePath)) {
    try {
      unlinkSync(databasePath);
    } catch {
      // Ignore if locked or already removed
    }
  }
}
