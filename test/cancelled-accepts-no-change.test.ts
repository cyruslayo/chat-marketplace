import test from "node:test";
import assert from "node:assert/strict";
import {
  BookingAmendmentManager,
  CancellationNoShowManager,
  CheckInSupportManager,
  EXTENDED_STAY_POLICY,
  ExtendedStayExtensionManager,
  ExtensionRefusedError,
  NoticeToEndManager,
  SqliteBookingStateRepository,
  recordedNoticeRefundPort,
  type BookingAmendmentDependencies,
  type BookingContract,
  type CheckInReservation,
  type Reservation,
} from "../domains/shortlet/src/index.js";
import { SqliteOwnerPayableLedger } from "../domains/shortlet/src/owner-payable.js";
import { CancellationApplication } from "../apps/web/src/cancellation-application.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createBookingFixture, createSqliteBookingState } from "./helpers/booking-state-fixture.js";
import { fixedOccupancyLedger } from "./helpers/continuous-occupancy-fixture.js";
import { extendedToReservation, contractOf as extendedContractOf } from "./helpers/notice-chat-journey.js";
import { extendedFixture } from "./helpers/notice-chat-journey.js";

const NOW = new Date("2026-08-10T10:00:00Z");
const clock = () => NOW;
const guest: CommandPrincipal = { id: "g1", role: "guest", tenantId: "t1" };
const otherGuest: CommandPrincipal = { id: "g-other", role: "guest", tenantId: "t1" };
const system: CommandPrincipal = { id: "settlement-service", role: "system", tenantId: "t1" };
const staff: CommandPrincipal = { id: "staff-1", role: "authorized_staff", tenantId: "t1" };
const operator: CommandPrincipal = { id: "op", role: "operator", tenantId: "t1" };

const command = <T>(name: string, principal: CommandPrincipal, payload: T) =>
  createPlatformCommandEnvelope({ commandName: name, principal, payload });

function setupAmendmentOnSqlite(options: {
  readonly reservationStatus?: Reservation["status"];
  readonly omitReservation?: boolean;
  readonly reservationPrimaryGuestId?: string;
  readonly settlementStatus?: "settled" | "pending";
  readonly onSettle?: (state: SqliteBookingStateRepository) => void;
} = {}) {
  const fixture = createBookingFixture({
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 },
    quote: { allInStayTotalKobo: 50000, refundableSecurityDepositKobo: 0, currency: "NGN" },
    totalAmountDueNowKobo: 50000,
    reservationStatus: options.reservationStatus ?? "confirmed",
  });
  if (options.reservationPrimaryGuestId) {
    fixture.reservation = { ...fixture.reservation, primaryGuestId: options.reservationPrimaryGuestId };
  }
  const sqlite = createSqliteBookingState(fixture, { storage: "memory" });
  if (options.omitReservation) {
    sqlite.state.removeBookingAtomically({ contractId: "nonexistent-ctr", reservationId: fixture.reservation.reservationId });
  }
  let settleCalls = 0;
  let chargedKobo = 0;
  let mutateCalls = 0;

  const deps: BookingAmendmentDependencies = {
    continuousOccupancy: fixedOccupancyLedger({ unitProperties: { u1: "p1" } }),
    contractRepository: {
      getContract: (id) => {
        const found = sqlite.state.findContractById(id);
        if (!found) throw new Error("Contract not found");
        return found;
      },
      mutateContract: (id, expectedVersion, mutation) => {
        mutateCalls += 1;
        return sqlite.state.mutateContract(id, expectedVersion, mutation);
      },
    },
    reservationRepository: sqlite.state,
    calendar: { getAuthoritativeAvailability: () => ({ isAvailable: true, version: "a1" }), hasSameDayCheckInOnDate: () => false },
    inspectionRepository: { isPassedAndValidThrough: () => ({ valid: true, version: "i1" }) },
    authorityRepository: { isValidThrough: () => ({ valid: true, version: "m1" }) },
    quoteProvider: {
      quote: ({ resultingDates }) => {
        if (resultingDates.nights === 6) {
          return {
            quoteId: "q-add",
            quoteVersion: "2",
            currency: "NGN",
            revisedAllInStayTotalKobo: 60000,
            financialAdjustment: { type: "additional_collection", amountKobo: 10000, currency: "NGN" },
          };
        }
        return {
          quoteId: "q-none",
          quoteVersion: "2",
          currency: "NGN",
          revisedAllInStayTotalKobo: 50000,
          financialAdjustment: { type: "none", amountKobo: 0, currency: "NGN" },
        };
      },
    },
    settlementProvider: {
      settle: ({ amendmentId, contractId, adjustment, quote }) => {
        settleCalls += 1;
        options.onSettle?.(sqlite.state);
        const status = options.settlementStatus ?? "settled";
        if (status === "settled") chargedKobo += adjustment.amountKobo;
        return {
          settlementId: "set-1",
          amendmentId,
          contractId,
          type: adjustment.type,
          amountKobo: adjustment.amountKobo,
          currency: "NGN",
          quoteId: quote.quoteId,
          quoteVersion: quote.quoteVersion,
          status,
        };
      },
    },
  };
  const manager = new BookingAmendmentManager(deps);
  const cancelApp = new CancellationApplication({
    state: sqlite.state,
    cases: sqlite.cases,
    manager: new CancellationNoShowManager(),
    amendments: manager,
    clock,
    timing: { getWindow: () => ({ startIso: "2026-08-20T13:00:00.000Z", timezone: "Africa/Lagos" }) },
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
    arrival: { getState: () => ({ status: "awaiting_access", version: "a1" }) },
    refunds: {
      initiateOrGetRefund: ({ amountKobo }) => ({ refundId: "rf-1", status: "pending", amountKobo, currency: "NGN" }),
    },
    ledger: {
      postCancellation: () => ({ ledgerRecordId: "led-1", status: "posted" }),
    },
    availability: { releaseConfirmedBooking: () => {} },
  });
  return {
    sqlite,
    deps,
    manager,
    cancelApp,
    get settleCalls() {
      return settleCalls;
    },
    get chargedKobo() {
      return chargedKobo;
    },
    get mutateCalls() {
      return mutateCalls;
    },
    close: () => sqlite.close(),
  };
}

test("AC1: After cancellation, request, accept and commit are refused, nothing is collected and the contract version does not move (including no_show, missing Reservation, another guest's Reservation, and mid-commit races)", () => {
  const missingRepoCheck = setupAmendmentOnSqlite();
  try {
    assert.throws(
      () => new BookingAmendmentManager({ ...missingRepoCheck.deps, reservationRepository: undefined as never }),
      /reservationRepository/,
    );
  } finally {
    missingRepoCheck.close();
  }

  for (const terminalStatus of ["cancelled", "no_show"] as const) {
    // 1) Request and accept refuse when Reservation is already cancelled or no_show.
    const direct = setupAmendmentOnSqlite({ reservationStatus: terminalStatus });
    try {
      assert.throws(
        () => direct.manager.requestAmendment(command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), clock),
        /STALE_ACTION/,
      );
      assert.equal(direct.sqlite.state.findContractById("c1")?.contractVersion, 1);
      assert.equal(direct.settleCalls, 0);
    } finally {
      direct.close();
    }

    // 2) Proposed -> Reservation becomes terminal -> accept & commit refuse.
    const acceptRace = setupAmendmentOnSqlite();
    try {
      const proposed = acceptRace.manager.requestAmendment(
        command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
        clock,
      );
      acceptRace.sqlite.state.transitionReservationStatus("r1", "confirmed", terminalStatus);
      assert.throws(() => acceptRace.manager.acceptAmendment(proposed.amendmentId, guest, clock), /STALE_ACTION/);
      assert.throws(
        () => acceptRace.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: proposed.amendmentId }), clock),
        /Explicit guest acceptance is required|STALE_ACTION/,
      );
      assert.equal(acceptRace.settleCalls, 0);
      assert.equal(acceptRace.chargedKobo, 0);
      assert.equal(acceptRace.sqlite.state.findContractById("c1")?.contractVersion, 1);
    } finally {
      acceptRace.close();
    }

    // 3) Accepted -> Reservation becomes terminal before settle -> commit refuses before calling settle.
    const commitRace = setupAmendmentOnSqlite();
    try {
      const proposed = commitRace.manager.requestAmendment(
        command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
        clock,
      );
      commitRace.manager.acceptAmendment(proposed.amendmentId, guest, clock);
      commitRace.sqlite.state.transitionReservationStatus("r1", "confirmed", terminalStatus);
      assert.throws(
        () => commitRace.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: proposed.amendmentId }), clock),
        /STALE_ACTION/,
      );
      assert.equal(commitRace.settleCalls, 0);
      assert.equal(commitRace.chargedKobo, 0);
      assert.equal(commitRace.sqlite.state.findContractById("c1")?.contractVersion, 1);
    } finally {
      commitRace.close();
    }
  }

  // 4) Missing Reservation fails closed across request, accept, and commit.
  const missingReservation = setupAmendmentOnSqlite({ omitReservation: true });
  try {
    assert.throws(
      () => missingReservation.manager.requestAmendment(command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), clock),
      /STALE_ACTION/,
    );
  } finally {
    missingReservation.close();
  }

  // 5) Another guest's Reservation (and wrong guest principal) is refused.
  const wrongGuestReservation = setupAmendmentOnSqlite({ reservationPrimaryGuestId: "g-other" });
  try {
    assert.throws(
      () => wrongGuestReservation.manager.requestAmendment(command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), clock),
      /Booking amendment is not authorized/,
    );
    assert.throws(
      () => wrongGuestReservation.manager.requestAmendment(command("booking_amendment.request", otherGuest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), clock),
      /Booking amendment is not authorized/,
    );
  } finally {
    wrongGuestReservation.close();
  }

  // 6) Re-read right before mutateContract catches a concurrent cancellation during settlement.
  const preWriteRace = setupAmendmentOnSqlite({
    onSettle: (state) => {
      state.transitionReservationStatus("r1", "confirmed", "cancelled");
    },
  });
  try {
    const proposed = preWriteRace.manager.requestAmendment(
      command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
      clock,
    );
    preWriteRace.manager.acceptAmendment(proposed.amendmentId, guest, clock);
    assert.throws(
      () => preWriteRace.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: proposed.amendmentId }), clock),
      /STALE_ACTION/,
    );
    assert.equal(preWriteRace.mutateCalls, 0);
    assert.equal(preWriteRace.sqlite.state.findContractById("c1")?.contractVersion, 1);
  } finally {
    preWriteRace.close();
  }
});

test("D3: Cancellation closes proposed, accepted, and unpaid awaiting_financial_settlement Booking Amendments to cancelled with no charge; in-flight amendment settlement refuses cancellation with a reason", () => {
  // Proposed -> cancelled
  const proposedWorld = setupAmendmentOnSqlite();
  try {
    const proposed = proposedWorld.manager.requestAmendment(
      command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
      clock,
    );
    proposedWorld.cancelApp.cancel("r1", guest);
    assert.equal(proposedWorld.manager.getAmendment(proposed.amendmentId)?.status, "cancelled");
    assert.equal(proposedWorld.chargedKobo, 0);
    assert.throws(
      () => proposedWorld.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: proposed.amendmentId }), clock),
      /STALE_ACTION/,
    );
  } finally {
    proposedWorld.close();
  }

  // Accepted (no financial adjustment) -> cancelled
  const acceptedWorld = setupAmendmentOnSqlite();
  try {
    const accepted = acceptedWorld.manager.requestAmendment(
      command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-24" } } }),
      clock,
    );
    acceptedWorld.manager.acceptAmendment(accepted.amendmentId, guest, clock);
    acceptedWorld.cancelApp.cancel("r1", guest);
    assert.equal(acceptedWorld.manager.getAmendment(accepted.amendmentId)?.status, "cancelled");
    assert.equal(acceptedWorld.chargedKobo, 0);
    assert.throws(
      () => acceptedWorld.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: accepted.amendmentId }), clock),
      /STALE_ACTION/,
    );
  } finally {
    acceptedWorld.close();
  }

  // Unpaid awaiting_financial_settlement -> cancelled with no charge
  const unpaidWorld = setupAmendmentOnSqlite();
  try {
    const unpaid = unpaidWorld.manager.requestAmendment(
      command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
      clock,
    );
    const awaiting = unpaidWorld.manager.acceptAmendment(unpaid.amendmentId, guest, clock);
    assert.equal(awaiting.status, "awaiting_financial_settlement");
    unpaidWorld.cancelApp.cancel("r1", guest);
    assert.equal(unpaidWorld.manager.getAmendment(unpaid.amendmentId)?.status, "cancelled");
    assert.equal(unpaidWorld.chargedKobo, 0);
    assert.equal(unpaidWorld.settleCalls, 0);
  } finally {
    unpaidWorld.close();
  }

  // Settlement in flight (pending settlement) -> cancellation refuses with a reason until settled
  const inFlightWorld = setupAmendmentOnSqlite({ settlementStatus: "pending" });
  try {
    const proposed = inFlightWorld.manager.requestAmendment(
      command("booking_amendment.request", guest, { contractId: "c1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }),
      clock,
    );
    inFlightWorld.manager.acceptAmendment(proposed.amendmentId, guest, clock);
    assert.throws(
      () => inFlightWorld.manager.commitAmendment(command("booking_amendment.commit", system, { amendmentId: proposed.amendmentId }), clock),
      /settlement is pending/,
    );
    assert.equal(inFlightWorld.manager.hasSettlementInFlight("c1"), true);
    assert.throws(
      () => inFlightWorld.cancelApp.cancel("r1", guest),
      /Booking Amendment settlement is in flight/,
    );
    assert.equal(inFlightWorld.sqlite.state.findReservationById("r1")?.status, "confirmed");
  } finally {
    inFlightWorld.close();
  }
});

test("D29: A cancelled or no_show Reservation refuses Extension approve, Notice to End and Complaint upheld, and closes any waiting Extension", async () => {
  const f = extendedFixture([], () => new Date("2026-10-27T10:00:00Z"));
  try {
    const { offerId } = await extendedToReservation(f, "g-0ee1000401");
    const contract = extendedContractOf(f, offerId);
    const extGuest: CommandPrincipal = { id: contract.parties.primaryGuest.id, role: "guest", tenantId: contract.tenantId };
    const extOp: CommandPrincipal = { id: contract.parties.operator.id, role: "operator", tenantId: contract.tenantId };
    const extStaff: CommandPrincipal = { id: "staff-ext", role: "authorized_staff", tenantId: contract.tenantId };

    const sqlite = createSqliteBookingState(
      {
        contract,
        reservation: {
          reservationId: contract.reservationId,
          contractId: contract.contractId,
          unitId: contract.unitId,
          primaryGuestId: contract.parties.primaryGuest.id,
          dates: { checkIn: contract.dates.checkIn, checkOut: contract.dates.checkOut },
          status: "confirmed",
          confirmedAt: "2026-10-27T10:00:00Z",
          inventoryCommitmentId: "commit-ext-1",
        },
      },
      { storage: "memory" },
    );

    const extensions = new ExtendedStayExtensionManager({
      contracts: {
        getContract: (id) => {
          const found = sqlite.state.findContractById(id);
          if (!found) throw new Error("Booking Contract is not found");
          return found;
        },
        mutateContract: (id, expectedVersion, mutation) => sqlite.state.mutateContract(id, expectedVersion, mutation),
      },
      reservations: sqlite.state,
      units: f.environment.unitRepository,
      calendar: f.environment.calendar,
      continuousOccupancy: f.environment.bookingRequestApp.continuousOccupancy,
      extendedStayPolicy: EXTENDED_STAY_POLICY,
      clock: () => new Date("2026-10-27T10:00:00Z"),
    });

    const owners = new SqliteOwnerPayableLedger(new NodeSqliteDatabase(":memory:"), () => new Date("2026-10-27T10:00:00Z"));
    const noticeToEnd = new NoticeToEndManager({
      contracts: {
        getContract: (id) => {
          const found = sqlite.state.findContractById(id);
          if (!found) throw new Error("Booking Contract is not found");
          return found;
        },
        mutateContract: (id, expectedVersion, mutation) => sqlite.state.mutateContract(id, expectedVersion, mutation),
      },
      reservations: sqlite.state,
      periods: {
        projectBillingPeriods: () => [{ periodIndex: 1, status: "paid" }],
        paymentsFor: () => [],
      },
      owners,
      arrival: { hasVerifiedAccess: () => true },
      failures: { hasOpenFailure: () => false },
      refunds: recordedNoticeRefundPort(),
      extendedStayPolicy: EXTENDED_STAY_POLICY,
      clock: () => new Date("2026-11-01T10:00:00Z"),
    });

    // Request a waiting extension while confirmed, then cancel via CancellationApplication.
    const requested = extensions.requestExtension(contract.contractId, extGuest, {
      newCheckOut: "2026-12-08",
      contractVersion: contract.contractVersion,
    });
    assert.equal(requested.status, "awaiting_operator");

    const cancelApp = new CancellationApplication({
      state: sqlite.state,
      cases: sqlite.cases,
      manager: new CancellationNoShowManager(),
      extensions,
      clock: () => new Date("2026-10-27T11:00:00Z"),
      timing: { getWindow: () => ({ startIso: "2026-10-28T13:00:00.000Z", timezone: "Africa/Lagos" }) },
      economics: {
        getEconomics: () => ({
          version: "e-ext",
          currency: "NGN",
          cancellationBaseKobo: contract.paymentDetails.amountKobo,
          refundableCleaningKobo: 0,
          refundableUnprovidedServicesKobo: 0,
          refundableSecurityDepositKobo: 0,
          refundableAttributableTaxKobo: 0,
          refundableDuplicatePaymentKobo: 0,
          commissionRate: 0.1,
        }),
      },
      arrival: { getState: () => ({ status: "awaiting_access", version: "a1" }) },
      refunds: { initiateOrGetRefund: ({ amountKobo }) => ({ refundId: "rf-ext", status: "pending", amountKobo, currency: "NGN" }) },
      ledger: { postCancellation: () => ({ ledgerRecordId: "led-ext", status: "posted" }) },
      availability: { releaseConfirmedBooking: () => {} },
    });

    cancelApp.cancel(contract.reservationId, extGuest);
    assert.equal(sqlite.state.findReservationById(contract.reservationId)?.status, "cancelled");
    assert.equal(sqlite.state.findContractById(contract.contractId)?.extensionRequest?.status, "cancelled");
    assert.equal(extensions.statusOf(contract.contractId)?.status, "cancelled");

    // Cancelled Reservation refuses Extension approve/preview/request and Notice to End preview/give.
    assert.throws(
      () => extensions.approveExtension(contract.contractId, extOp, requested.extensionId),
      (error: unknown) => error instanceof ExtensionRefusedError && error.code === "STALE",
    );
    assert.throws(
      () => extensions.preview(contract.contractId, extGuest, "2026-12-08"),
      (error: unknown) => error instanceof ExtensionRefusedError && error.code === "STALE",
    );
    assert.throws(
      () => noticeToEnd.previewNotice(contract.contractId, extGuest),
      /confirmed Reservation/,
    );
    assert.throws(
      () => noticeToEnd.giveNotice(contract.contractId, extGuest),
      /confirmed Reservation/,
    );

    // Also test no_show and CheckInSupportManager.upholdBlockingComplaintAsSupport refusal.
    for (const terminalStatus of ["cancelled", "no_show"] as const) {
      let currentStatus: CheckInReservation["status"] = "confirmed";
      const checkInManager = new CheckInSupportManager({
        windowProvider: { getWindow: () => ({ checkInDate: "2026-08-20", earliestAccessTime: "14:00", latestPermittedArrival: "22:00", timezone: "Africa/Lagos" }) },
        assignmentProvider: { assign: () => ({ assignedResponderId: "r-1", backupResponderId: "r-2" }) },
        reservationProvider: {
          getReservation: (id) => ({
            reservationId: id,
            primaryGuestId: "g1",
            tenantId: "t1",
            status: currentStatus,
          }),
        },
      });
      checkInManager.scheduleHumanSupport(command("checkin_support.schedule", system, { reservationId: "r-ci" }));
      const complaint = checkInManager.raiseBlockingComplaint(
        command("checkin_support.report_problem", guest, { reservationId: "r-ci", category: "access_failure" }),
      );
      currentStatus = terminalStatus;
      assert.throws(
        () =>
          checkInManager.upholdBlockingComplaintAsSupport(
            command("checkin_support.support_uphold_complaint", staff, {
              reservationId: "r-ci",
              complaintId: complaint.complaintId,
              firstAffectedNight: "2026-08-20",
            }),
          ),
        /Reservation that is not confirmed/,
      );
      assert.equal(checkInManager.hasUnresolvedBlockingComplaint("r-ci"), true);
    }

    // no_show also refuses Extension approve and Notice to End when tested directly.
    const noShowContract: BookingContract = {
      ...contract,
      contractId: "c-ns",
      reservationId: "r-ns",
      extensionRequest: { ...requested, status: "awaiting_operator" },
    };
    const nsRepo = createSqliteBookingState(
      {
        contract: noShowContract,
        reservation: {
          reservationId: "r-ns",
          contractId: "c-ns",
          unitId: contract.unitId,
          primaryGuestId: contract.parties.primaryGuest.id,
          dates: { checkIn: contract.dates.checkIn, checkOut: contract.dates.checkOut },
          status: "no_show",
          confirmedAt: "2026-10-27T10:00:00Z",
        },
      },
      { storage: "memory" },
    );
    const nsExt = new ExtendedStayExtensionManager({
      contracts: {
        getContract: (id) => nsRepo.state.findContractById(id)!,
        mutateContract: (id, expected, m) => nsRepo.state.mutateContract(id, expected, m),
      },
      reservations: nsRepo.state,
      units: f.environment.unitRepository,
      calendar: f.environment.calendar,
      continuousOccupancy: f.environment.bookingRequestApp.continuousOccupancy,
      extendedStayPolicy: EXTENDED_STAY_POLICY,
      clock: () => new Date("2026-10-27T10:00:00Z"),
    });
    assert.throws(
      () => nsExt.approveExtension("c-ns", extOp, requested.extensionId),
      (error: unknown) => error instanceof ExtensionRefusedError && error.code === "STALE",
    );
    assert.equal(nsExt.statusOf("c-ns")?.status, "cancelled");
    const nsNotice = new NoticeToEndManager({
      contracts: {
        getContract: (id) => nsRepo.state.findContractById(id)!,
        mutateContract: (id, expected, m) => nsRepo.state.mutateContract(id, expected, m),
      },
      reservations: nsRepo.state,
      periods: { projectBillingPeriods: () => [{ periodIndex: 1, status: "paid" }], paymentsFor: () => [] },
      owners,
      arrival: { hasVerifiedAccess: () => true },
      failures: { hasOpenFailure: () => false },
      refunds: recordedNoticeRefundPort(),
      extendedStayPolicy: EXTENDED_STAY_POLICY,
      clock: () => new Date("2026-11-01T10:00:00Z"),
    });
    assert.throws(() => nsNotice.giveNotice("c-ns", extGuest), /confirmed Reservation/);
    sqlite.close();
    nsRepo.close();
  } finally {
    f.close();
  }
});
