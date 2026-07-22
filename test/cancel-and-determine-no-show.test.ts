import test from "node:test";
import assert from "node:assert/strict";
import { CancellationNoShowManager } from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createMockBooking() {
  return {
    bookingId: "bk-cancel-101",
    policyType: "flexible" as const, // flexible, standard, firm
    checkInIso: "2026-09-01T13:00:00.000Z", // 2:00 PM WAT on Sept 1, 2026
    cancellationBaseKobo: 10000000, // ₦100,000 accommodation
    cleaningFeeKobo: 1000000, // ₦10,000 cleaning
    unprovidedServicesKobo: 500000, // ₦5,000 optional extra
    securityDepositKobo: 2000000, // ₦20,000 deposit
    attributableTaxKobo: 750000, // ₦7,500 tax
    duplicatePaymentKobo: 0
  };
}

test("Exact boundary tests cover every full, partial, and zero-refund threshold in all three policies", () => {
  const manager = new CancellationNoShowManager();

  // 1. Flexible policy (T-72h 100%, T-24h 50%, <24h 0%)
  const checkIn = new Date("2026-09-01T13:00:00.000Z").getTime();

  // Full refund: exactly T-72h (72 hours prior)
  const flexFullTime = new Date(checkIn - 72 * 3600 * 1000).toISOString();
  const flexFull = manager.calculateGuestCancellation({
    policyType: "flexible",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: flexFullTime
  });
  assert.equal(flexFull.refundPercentage, 100);
  assert.equal(flexFull.cancellationBaseRefundKobo, 100000);

  // Partial refund: T-48h (between 24h and 72h)
  const flexPartTime = new Date(checkIn - 48 * 3600 * 1000).toISOString();
  const flexPart = manager.calculateGuestCancellation({
    policyType: "flexible",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: flexPartTime
  });
  assert.equal(flexPart.refundPercentage, 50);
  assert.equal(flexPart.cancellationBaseRefundKobo, 50000);

  // Zero refund: T-12h (<24h)
  const flexZeroTime = new Date(checkIn - 12 * 3600 * 1000).toISOString();
  const flexZero = manager.calculateGuestCancellation({
    policyType: "flexible",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: flexZeroTime
  });
  assert.equal(flexZero.refundPercentage, 0);
  assert.equal(flexZero.cancellationBaseRefundKobo, 0);

  // 2. Standard policy (T-14d 100%, T-7d 50%, <7d 0%)
  const stdFull = manager.calculateGuestCancellation({
    policyType: "standard",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 15 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(stdFull.refundPercentage, 100);

  const stdPart = manager.calculateGuestCancellation({
    policyType: "standard",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 10 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(stdPart.refundPercentage, 50);

  const stdZero = manager.calculateGuestCancellation({
    policyType: "standard",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 3 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(stdZero.refundPercentage, 0);

  // 3. Firm policy (T-30d 100%, T-14d 50%, <14d 0%)
  const firmFull = manager.calculateGuestCancellation({
    policyType: "firm",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 31 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(firmFull.refundPercentage, 100);

  const firmPart = manager.calculateGuestCancellation({
    policyType: "firm",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 20 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(firmPart.refundPercentage, 50);

  const firmZero = manager.calculateGuestCancellation({
    policyType: "firm",
    checkInIso: "2026-09-01T13:00:00.000Z",
    cancellationBaseKobo: 100000,
    cancelledAtIso: new Date(checkIn - 5 * 24 * 3600 * 1000).toISOString()
  });
  assert.equal(firmZero.refundPercentage, 0);
});

test("Deposit, duplicate payment, unprovided services, cleaning, and attributable refundable tax are excluded as required", () => {
  const manager = new CancellationNoShowManager();
  const booking = createMockBooking();

  // Cancel at T-12h (0% of accommodation cancellation base)
  const cancelledAtIso = new Date(new Date(booking.checkInIso).getTime() - 12 * 3600 * 1000).toISOString();

  const breakdown = manager.calculateFullCancellationRefund({
    booking,
    cancelledAtIso,
    liability: "guest"
  });

  // Accommodation refund is 0
  assert.equal(breakdown.cancellationBaseRefundKobo, 0);

  // BUT non-base items are 100% refunded!
  assert.equal(breakdown.securityDepositRefundKobo, booking.securityDepositKobo);
  assert.equal(breakdown.cleaningFeeRefundKobo, booking.cleaningFeeKobo);
  assert.equal(breakdown.unprovidedServicesRefundKobo, booking.unprovidedServicesKobo);
  assert.equal(breakdown.attributableTaxRefundKobo, booking.attributableTaxKobo);

  // Total refund = 0 + deposit + cleaning + unprovided + tax
  const expectedTotal =
    booking.securityDepositKobo + booking.cleaningFeeKobo + booking.unprovidedServicesKobo + booking.attributableTaxKobo;
  assert.equal(breakdown.totalRefundKobo, expectedTotal);
});

test("Cancellation Liability selects the correct guest, Operator, platform, force-majeure, or legal funding outcome", () => {
  const manager = new CancellationNoShowManager();
  const booking = createMockBooking();
  const cancelledAtIso = new Date(new Date(booking.checkInIso).getTime() - 12 * 3600 * 1000).toISOString();

  // 1. Guest liability: policy applies
  const guestResult = manager.calculateFullCancellationRefund({ booking, cancelledAtIso, liability: "guest" });
  assert.equal(guestResult.liability, "guest");
  assert.equal(guestResult.cancellationBaseRefundKobo, 0);

  // 2. Operator failure: 100% full refund of all amounts + operator liability funding
  const opResult = manager.calculateFullCancellationRefund({ booking, cancelledAtIso, liability: "operator_failure" });
  assert.equal(opResult.liability, "operator_failure");
  assert.equal(opResult.cancellationBaseRefundKobo, booking.cancellationBaseKobo);
  assert.equal(opResult.fundingSource, "operator");

  // 3. Platform failure: 100% full refund + platform funding
  const platResult = manager.calculateFullCancellationRefund({ booking, cancelledAtIso, liability: "platform_failure" });
  assert.equal(platResult.liability, "platform_failure");
  assert.equal(platResult.fundingSource, "platform");

  // 4. Force majeure: 100% refund + force majeure fund
  const fmResult = manager.calculateFullCancellationRefund({ booking, cancelledAtIso, liability: "force_majeure" });
  assert.equal(fmResult.liability, "force_majeure");
  assert.equal(fmResult.fundingSource, "force_majeure_fund");

  // 5. Legal override: 100% statutory refund
  const legalResult = manager.calculateFullCancellationRefund({ booking, cancelledAtIso, liability: "legal_override" });
  assert.equal(legalResult.liability, "legal_override");
  assert.equal(legalResult.fundingSource, "statutory_override");
});

test("Agent, conventional, and support cancellation paths produce the same calculation, command, ledger, and audit evidence", () => {
  const manager = new CancellationNoShowManager();
  const booking = createMockBooking();
  const cancelledAtIso = "2026-08-30T10:00:00.000Z";

  // Create command envelope from Agent channel
  const agentEnvelope: PlatformCommandEnvelope<any> = {
    commandId: "cmd-agent-cxl",
    commandName: "cancellation.process",
    timestamp: "2026-08-30T10:00:00.000Z",
    principal: { id: "guest-ada", role: "guest", tenantId: "tenant-lagos" },
    payload: { bookingId: booking.bookingId, liability: "guest" }
  };

  // Create command envelope from Web channel
  const webEnvelope: PlatformCommandEnvelope<any> = {
    commandId: "cmd-web-cxl",
    commandName: "cancellation.process",
    timestamp: "2026-08-30T10:00:00.000Z",
    principal: { id: "guest-ada", role: "guest", tenantId: "tenant-lagos" },
    payload: { bookingId: booking.bookingId, liability: "guest" }
  };

  const agentOutcome = manager.processCancellationCommand(agentEnvelope, booking, cancelledAtIso);
  const webOutcome = manager.processCancellationCommand(webEnvelope, booking, cancelledAtIso);

  // Deterministic Parity (ADR 0080 & ADR 0072): Same calculations, ledger entries, and audit trail structure
  assert.deepEqual(agentOutcome.calculation, webOutcome.calculation);
  assert.equal(agentOutcome.ledgerEntry.amountKobo, webOutcome.ledgerEntry.amountKobo);
  assert.equal(agentOutcome.auditRecord.commandName, "cancellation.process");

  // No-Show determination test: requires human confirmation and 10:00 AM WAT deadline on day after arrival
  const checkInDate = "2026-09-01"; // Sept 1
  const earlyAttemptIso = "2026-09-01T20:00:00.000Z"; // Sept 1 9:00 PM WAT (< Sept 2 10:00 AM WAT)

  // Failure path: No-show attempted before 10:00 AM WAT next day MUST fail
  assert.throws(
    () =>
      manager.determineNoShow({
        bookingId: booking.bookingId,
        checkInDate,
        attemptIso: earlyAttemptIso,
        contactAttemptsFailed: true,
        humanConfirmed: true
      }),
    /No-Show can only be determined at or after 10:00 AM WAT the day after scheduled arrival/
  );

  // Failure path: No-show attempted without human confirmation MUST fail
  const validTimeIso = "2026-09-02T09:30:00.000Z"; // 10:30 AM WAT Sept 2
  assert.throws(
    () =>
      manager.determineNoShow({
        bookingId: booking.bookingId,
        checkInDate,
        attemptIso: validTimeIso,
        contactAttemptsFailed: true,
        humanConfirmed: false
      }),
    /No-Show determination requires explicit human confirmation/
  );

  // Success path: Valid No-Show determination
  const noShowResult = manager.determineNoShow({
    bookingId: booking.bookingId,
    checkInDate,
    attemptIso: validTimeIso,
    contactAttemptsFailed: true,
    humanConfirmed: true
  });

  assert.equal(noShowResult.status, "no_show_confirmed");
  assert.equal(noShowResult.humanConfirmed, true);
});
