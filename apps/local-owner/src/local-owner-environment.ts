import { DatabaseSync } from "node:sqlite";
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
} from "../../../domains/shortlet/src/index.js";
import {
  createBookingRequestApplication,
  type BookingRequestApplication,
  type BookingRequestArtifact,
} from "../../../apps/web/src/index.js";

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
  readonly clock?: () => Date;
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
  readonly unitRepository: UnitRepository;
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

  #demoRequests: string[] = [];

  constructor(config: Partial<LocalOwnerFixtureConfig> = {}) {
    this.config = { ...DEFAULT_LOCAL_OWNER_CONFIG, ...config };
    this.clock = this.config.clock ?? (() => new Date("2026-08-10T10:00:00Z"));

    mkdirSync(dirname(this.config.databasePath), { recursive: true });

    this.grantStore = new SqliteOperatorRepresentativeGrantStore(this.config.databasePath, { clock: this.clock });
    this.unitRepository = new UnitRepository();
    this.calendar = new AvailabilityCalendar({ repository: this.unitRepository });
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
    });

    this.#seedFixture();
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
      amenities: ["wifi", "24_7_power_generator", "parking", "air_conditioning", "security_guard", "swimming_pool"],
      published: true,
      price: {
        nightlyKobo: 12000000, // ₦120,000 / night
        mandatoryFeesKobo: 1000000, // ₦10,000 cleaning & service
        refundableSecurityDepositKobo: 5000000, // ₦50,000 deposit
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

  createDemoIncomingBookingRequest(input: {
    guestId?: string;
    guestName?: string;
    checkIn?: string;
    checkOut?: string;
    partySize?: number;
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

    const disclosed = this.bookingRequestApp.disclose(draft.draftId, guestPrincipal, true);
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
        securityDepositKobo: 5000000,
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
    this.grantStore.close();
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
