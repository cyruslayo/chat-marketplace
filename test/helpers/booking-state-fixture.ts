import {
  BookingAmendmentManager,
  CancellationNoShowManager,
  type BookingAmendmentDependencies,
  type ReservationStatus,
} from "../../domains/shortlet/src/index.js";
import { SqliteBookingStateRepository } from "../../domains/shortlet/src/booking-state.js";
import { SqliteCancellationCaseRepository } from "../../domains/shortlet/src/cancellation-case-store.js";
import type { BookingContract, Reservation } from "../../domains/shortlet/src/card-payment.js";
import { CancellationApplication } from "../../apps/web/src/cancellation-application.js";
import {
  createPlatformCommandEnvelope,
  type CommandPrincipal,
} from "../../packages/platform-core/src/index.js";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { fixedOccupancyLedger } from "./continuous-occupancy-fixture.js";
import { exploreOrders, type ExploreOrdersResult, type FaultController } from "./explore.js";
import { temporaryDatabasePath } from "./temporary-database.js";

export interface BookingFixtureOptions {
  readonly contractId?: string;
  readonly reservationId?: string;
  readonly offerId?: string;
  readonly unitId?: string;
  readonly tenantId?: string;
  readonly primaryGuest?: { readonly id: string; readonly name: string };
  readonly operator?: { readonly id: string; readonly name?: string };
  readonly distinctPayer?: { readonly id: string; readonly name: string } | null;
  readonly dates?: { readonly checkIn: string; readonly checkOut: string; readonly nights: number };
  readonly occupants?: readonly { readonly name: string }[];
  readonly quote?: unknown;
  readonly totalAmountDueNowKobo?: number;
  readonly cancellationPolicy?: unknown;
  readonly guestConductRules?: readonly string[];
  readonly paymentDetails?: BookingContract["paymentDetails"];
  readonly createdAt?: string;
  readonly contractVersion?: number;
  readonly checkout?: BookingContract["checkout"];
  readonly financialSummary?: BookingContract["financialSummary"];
  readonly reservationStatus?: Reservation["status"];
  readonly confirmedAt?: string;
  readonly inventoryCommitmentId?: string;
}

let sqliteSequence = 0;

/**
 * Creates a fresh synthetic BookingContract and matching Reservation for tests.
 * Defaults mirror the cancellation-application baseline so shared callers remain unchanged.
 */
export function createBookingFixture(options: BookingFixtureOptions = {}): {
  contract: BookingContract;
  reservation: Reservation;
} {
  const contractId = options.contractId ?? "c1";
  const reservationId = options.reservationId ?? "r1";
  const unitId = options.unitId ?? "u1";
  const primaryGuest = options.primaryGuest ? { ...options.primaryGuest } : { id: "g1", name: "Guest" };
  const dates = options.dates
    ? { ...options.dates }
    : { checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2 };
  const totalAmountDueNowKobo = options.totalAmountDueNowKobo ?? 10000;

  const contract: BookingContract = {
    contractId,
    reservationId,
    offerId: options.offerId ?? "o1",
    unitId,
    tenantId: options.tenantId ?? "t1",
    parties: {
      primaryGuest,
      operator: options.operator ? { ...options.operator } : { id: "op" },
      distinctPayer: options.distinctPayer === undefined ? null : options.distinctPayer,
    },
    dates,
    occupants: options.occupants
      ? options.occupants.map((occupant) => ({ ...occupant }))
      : [{ name: primaryGuest.name }],
    quote: options.quote ?? {},
    totalAmountDueNowKobo,
    policies: {
      cancellationPolicy: options.cancellationPolicy ?? {
        type: "flexible",
        version: "A",
        policySummary: "Flexible",
      },
      guestConductRules: options.guestConductRules ? [...options.guestConductRules] : [],
    },
    paymentDetails: options.paymentDetails ?? {
      paymentMethod: "fresh_card",
      pspReference: "backend-card-ref",
      amountKobo: totalAmountDueNowKobo,
      currency: "NGN",
      paidAt: "2026-08-01T00:00:00Z",
    },
    createdAt: options.createdAt ?? "2026-08-01T00:00:00Z",
    contractVersion: options.contractVersion ?? 1,
    ...(options.checkout !== undefined ? { checkout: { ...options.checkout } } : {}),
    ...(options.financialSummary !== undefined
      ? {
          financialSummary: {
            ...options.financialSummary,
            amendmentAdjustments: [...options.financialSummary.amendmentAdjustments],
          },
        }
      : {}),
  };

  const reservation: Reservation = {
    reservationId,
    contractId,
    unitId,
    primaryGuestId: primaryGuest.id,
    dates: { checkIn: dates.checkIn, checkOut: dates.checkOut },
    status: options.reservationStatus ?? "confirmed",
    confirmedAt: options.confirmedAt ?? "2026-08-01T00:00:00Z",
    inventoryCommitmentId: options.inventoryCommitmentId ?? "commit-1",
  };

  return { contract, reservation };
}

/**
 * Opens a durable SqliteBookingStateRepository seeded atomically with the given booking fixture.
 */
export function createSqliteBookingState(
  seed: { readonly contract: BookingContract; readonly reservation: Reservation },
  options: { readonly storage?: "file" | "memory" } = {},
): {
  readonly state: SqliteBookingStateRepository;
  readonly cases: SqliteCancellationCaseRepository;
  close(): void;
} {
  const storage = options.storage ?? "file";
  const database =
    storage === "memory"
      ? new NodeSqliteDatabase(":memory:")
      : openNodeSqliteDatabase(temporaryDatabasePath(`booking-state-${++sqliteSequence}.sqlite`));
  const state = new SqliteBookingStateRepository(database);
  const cases = new SqliteCancellationCaseRepository(database);
  state.saveBookingAtomically({
    contract: structuredClone(seed.contract),
    reservation: structuredClone(seed.reservation),
  });
  return {
    state,
    cases,
    close(): void {
      state.close();
      database.close();
    },
  };
}

export const DEFAULT_AFTER_BOOKING_DEPTH = 6;
export const DEFAULT_AFTER_BOOKING_RESUMES = 3;

export const afterBookingGuestPrincipal: CommandPrincipal = {
  id: "g1",
  role: "guest",
  tenantId: "t1",
};

const afterBookingSystemPrincipal: CommandPrincipal = {
  id: "settlement-service",
  role: "system",
  tenantId: "t1",
};

const fixedAfterBookingNow = () => new Date("2026-08-10T10:00:00Z");

export interface AfterBookingWorld {
  readonly state: SqliteBookingStateRepository;
  readonly cancelApp: CancellationApplication;
  readonly amendmentManager: BookingAmendmentManager;
  readonly calls: string[];
  amendmentId: string;
  chargedKobo: number;
  contractVersionAtCancel: number | null;
  chargedAtCancelKobo: number | null;
  observeCancelSnapshot(): void;
  close(): void;
}

export interface AmendmentViolationDetail {
  readonly reservationStatus: ReservationStatus;
  readonly contractVersion: number;
  readonly contractTotalKobo: number;
  readonly chargedAfterCancelKobo: number;
}

export function createAfterBookingWorld(options: {
  readonly faults?: FaultController;
  readonly storage?: "file" | "memory";
  readonly withDeposit?: boolean;
} = {}): AfterBookingWorld {
  const fixture = createBookingFixture({
    contractId: "c1",
    reservationId: "r1",
    offerId: "o1",
    unitId: "u1",
    tenantId: "t1",
    primaryGuest: { id: "g1", name: "Ada" },
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 },
    quote: {
      allInStayTotalKobo: 50000,
      refundableSecurityDepositKobo: options.withDeposit ? 10000 : 0,
      currency: "NGN",
    },
    totalAmountDueNowKobo: options.withDeposit ? 60000 : 50000,
    paymentDetails: {
      paymentMethod: "fresh_card",
      pspReference: "original",
      amountKobo: 50000,
      currency: "NGN",
      paidAt: "2026-08-01T00:00:00Z",
    },
    checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" },
    financialSummary: {
      originalBookingTotalKobo: 50000,
      currentContractTotalKobo: 50000,
      currency: "NGN",
      amendmentAdjustments: [],
    },
  });
  if (options.withDeposit) {
    fixture.contract = {
      ...fixture.contract,
      securityDeposit: {
        policyVersion: "dep-v1",
        amountKobo: 10000,
        currency: "NGN",
        collectionId: "col-1",
        status: "held",
      },
    };
  }

  const sqlite = createSqliteBookingState(fixture, {
    storage: options.storage ?? "file",
  });
  const calls: string[] = [];
  const faults = options.faults;

  const portStep = (port: "ledger" | "release" | "refund" | "depositRefund"): void => {
    if (faults) {
      faults.failIfArmed(port);
    }
    calls.push(port);
  };

  let chargedKobo = 0;

  const amendmentDeps: BookingAmendmentDependencies = {
    continuousOccupancy: fixedOccupancyLedger({ unitProperties: { u1: "p1" } }),
    contractRepository: {
      getContract: (id: string) => {
        const contract = sqlite.state.findContractById(id);
        if (!contract) throw new Error("Contract not found");
        return contract;
      },
      mutateContract: (id, expectedVersion, mutation) =>
        sqlite.state.mutateContract(id, expectedVersion, mutation),
    },
    reservationRepository: sqlite.state,
    calendar: {
      getAuthoritativeAvailability: () => ({ isAvailable: true, version: "a1" }),
      hasSameDayCheckInOnDate: () => false,
    },
    inspectionRepository: {
      isPassedAndValidThrough: () => ({ valid: true, version: "i1" }),
    },
    authorityRepository: {
      isValidThrough: () => ({ valid: true, version: "m1" }),
    },
    quoteProvider: {
      quote: ({ resultingDates }) => ({
        quoteId: "q",
        quoteVersion: "2",
        currency: "NGN",
        revisedAllInStayTotalKobo: resultingDates.nights === 6 ? 60000 : 50000,
        financialAdjustment:
          resultingDates.nights === 6
            ? { type: "additional_collection", amountKobo: 10000, currency: "NGN" }
            : { type: "none", amountKobo: 0, currency: "NGN" },
      }),
    },
    settlementProvider: {
      settle: ({ amendmentId, contractId, adjustment, quote }) => {
        chargedKobo += adjustment.amountKobo;
        return {
          settlementId: "s1",
          amendmentId,
          contractId,
          type: adjustment.type,
          amountKobo: adjustment.amountKobo,
          currency: "NGN",
          quoteId: quote.quoteId,
          quoteVersion: quote.quoteVersion,
          status: "settled",
        };
      },
    },
  };

  const amendmentManager = new BookingAmendmentManager(amendmentDeps);

  const cancelApp = new CancellationApplication({
    state: sqlite.state,
    cases: sqlite.cases,
    manager: new CancellationNoShowManager(),
    amendments: amendmentManager,
    clock: fixedAfterBookingNow,
    timing: {
      getWindow: () => ({
        startIso: "2026-08-20T13:00:00.000Z",
        timezone: "Africa/Lagos",
      }),
    },
    economics: {
      getEconomics: () => ({
        version: "e1",
        currency: "NGN",
        cancellationBaseKobo: 50000,
        refundableCleaningKobo: 0,
        refundableUnprovidedServicesKobo: 0,
        refundableSecurityDepositKobo: 0,
        refundableAttributableTaxKobo: 0,
        refundableDuplicatePaymentKobo: 0,
        commissionRate: 0.12,
      }),
    },
    arrival: {
      getState: () => ({ status: "awaiting_access", version: "a1" }),
    },
    refunds: {
      initiateOrGetRefund: (input) => {
        portStep("refund");
        return {
          refundId: "rf1",
          status: "pending",
          amountKobo: input.amountKobo,
          currency: "NGN",
        };
      },
    },
    ...(options.withDeposit
      ? {
          depositRefunds: {
            initiateOrGetRefund: (input) => {
              portStep("depositRefund");
              return {
                refundId: "drf1",
                status: "pending",
                amountKobo: input.amountKobo,
                currency: "NGN",
              };
            },
          },
        }
      : {}),
    ledger: {
      postCancellation: () => {
        portStep("ledger");
        return { ledgerRecordId: "l1", status: "posted" };
      },
    },
    availability: {
      releaseConfirmedBooking: () => {
        portStep("release");
      },
    },
  });

  const world: AfterBookingWorld = {
    state: sqlite.state,
    cancelApp,
    amendmentManager,
    calls,
    amendmentId: "",
    get chargedKobo() {
      return chargedKobo;
    },
    set chargedKobo(value: number) {
      chargedKobo = value;
    },
    contractVersionAtCancel: null,
    chargedAtCancelKobo: null,
    observeCancelSnapshot(): void {
      if (world.contractVersionAtCancel !== null) return;
      const reservation = sqlite.state.findReservationById("r1");
      if (reservation?.status === "cancelled") {
        const contract = sqlite.state.findContractById("c1");
        world.contractVersionAtCancel = contract?.contractVersion ?? null;
        world.chargedAtCancelKobo = chargedKobo;
      }
    },
    close(): void {
      sqlite.close();
    },
  };

  return world;
}

/**
 * Runs the after-booking amendment-vs-cancellation order exploration (Check A) over SQLite.
 */
export function runAfterBookingChangeExploration(options: {
  readonly depth?: number;
  readonly prune?: boolean;
  readonly storage?: "file" | "memory";
} = {}): ExploreOrdersResult<AmendmentViolationDetail> {
  const depth = options.depth ?? DEFAULT_AFTER_BOOKING_DEPTH;
  const prune = options.prune ?? true;
  const runObserved = (fn: (w: AfterBookingWorld) => void) => (w: AfterBookingWorld) => {
    try {
      fn(w);
    } finally {
      w.observeCancelSnapshot();
    }
  };

  return exploreOrders<AfterBookingWorld, AmendmentViolationDetail>({
    depth,
    prune,
    newWorld: () => createAfterBookingWorld({ storage: options.storage ?? "file" }),
    disposeWorld: (w) => w.close(),
    steps: [
      {
        name: "request",
        required: true,
        run: runObserved((w) => {
          if (w.amendmentId) throw new Error("once");
          const proposal = w.amendmentManager.requestAmendment(
            createPlatformCommandEnvelope({
              commandName: "booking_amendment.request",
              principal: afterBookingGuestPrincipal,
              payload: {
                contractId: "c1",
                changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } },
              },
            }),
            fixedAfterBookingNow,
          );
          w.amendmentId = proposal.amendmentId;
        }),
      },
      {
        name: "accept",
        required: true,
        run: runObserved((w) => {
          w.amendmentManager.acceptAmendment(
            w.amendmentId,
            afterBookingGuestPrincipal,
            fixedAfterBookingNow,
          );
        }),
      },
      {
        name: "commit",
        required: true,
        run: runObserved((w) => {
          w.amendmentManager.commitAmendment(
            createPlatformCommandEnvelope({
              commandName: "booking_amendment.commit",
              principal: afterBookingSystemPrincipal,
              payload: { amendmentId: w.amendmentId },
            }),
            fixedAfterBookingNow,
          );
        }),
      },
      {
        name: "cancel",
        required: true,
        run: runObserved((w) => {
          w.cancelApp.cancel("r1", afterBookingGuestPrincipal);
        }),
      },
    ],
    digest: {
      fields: [
        "reservationStatus",
        "contractVersion",
        "amendmentStatus",
        "chargedKobo",
        "contractVersionAtCancel",
        "chargedAtCancelKobo",
      ],
      read: (w) => {
        const reservation = w.state.findReservationById("r1");
        const contract = w.state.findContractById("c1");
        const amendment = w.amendmentId
          ? w.amendmentManager.getAmendment(w.amendmentId)
          : undefined;
        return {
          reservationStatus: reservation?.status ?? null,
          contractVersion: contract?.contractVersion ?? null,
          amendmentStatus: amendment?.status ?? null,
          chargedKobo: w.chargedKobo,
          contractVersionAtCancel: w.contractVersionAtCancel,
          chargedAtCancelKobo: w.chargedAtCancelKobo,
        };
      },
    },
    check: {
      reads: [
        "reservationStatus",
        "contractVersion",
        "chargedKobo",
        "contractVersionAtCancel",
        "chargedAtCancelKobo",
      ],
      verify: (w) => {
        if (w.contractVersionAtCancel === null || w.chargedAtCancelKobo === null) {
          return null;
        }
        const reservation = w.state.findReservationById("r1");
        const contract = w.state.findContractById("c1");
        if (!reservation || !contract) return null;

        const chargedAfterCancelKobo = w.chargedKobo - w.chargedAtCancelKobo;
        if (
          chargedAfterCancelKobo > 0 ||
          contract.contractVersion > w.contractVersionAtCancel
        ) {
          return {
            reason: "Contract mutated or charged after Reservation was cancelled",
            detail: {
              reservationStatus: reservation.status,
              contractVersion: contract.contractVersion,
              contractTotalKobo: contract.totalAmountDueNowKobo,
              chargedAfterCancelKobo,
            },
          };
        }
        return null;
      },
    },
  });
}
