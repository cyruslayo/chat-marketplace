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
  InMemoryRevenueAccountingRepository,
  InMemoryBookingStateRepository,
  type Unit,
  type OperatorRepresentativeGrant,
  type TrustTierEvaluation,
  type PayoutPlanResult,
  type ReserveTranche,
  type OperatorUnitProjections,
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
  readonly reservePayoutManager: ReservePayoutManager;
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
    this.accountingRepository = new InMemoryRevenueAccountingRepository();
    this.reservePayoutManager = new ReservePayoutManager({
      accountingRepository: this.accountingRepository,
      enforcementAuthority: this.enforcementManager,
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
      id: this.config.operatorId, // Acts on behalf of Operator
      role: "operator",
      tenantId: this.config.tenantId,
    };
  }

  getHumanActorPrincipal(): CommandPrincipal {
    return {
      id: this.config.representativePersonId,
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
      completedBookings60d: 12,
      completedBookings180d: 35,
      reliabilityScore60d: 0.98,
      reliabilityScore180d: 0.99,
      activeEnforcementState: "none",
    });

    const samplePayout = this.reservePayoutManager.calculatePayoutPlanAndReserve({
      booking: {
        reservationId: "sample-res-overview",
        operatorId: this.config.operatorId,
        tenantId: this.config.tenantId,
        accommodationKobo: unit.price.nightlyKobo * 3, // 3 nights = ₦360,000
        mandatoryChargesKobo: unit.price.mandatoryFeesKobo ?? 0,
        securityDepositKobo: unit.price.refundableSecurityDepositKobo,
        checkoutDateIso: "2026-08-18T11:00:00Z",
      },
      payoutPlan: "founding_90_10",
      tier: trustTier.tier,
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
