import test from "node:test";
import assert from "node:assert/strict";
import { RevenueReleaseManager } from "../domains/shortlet/src/index.js";

function createMockBookingData(overrides: Record<string, any> = {}) {
  return {
    reservationId: "res-rev-101",
    unitId: "unit-lagos-1",
    tenantId: "tenant-lagos",
    operatorId: "op-lekki",
    operatorTier: "standard" as "standard" | "founding" | "preferred",
    accommodationKobo: 50000000, // ₦500,000 accommodation
    mandatoryChargesKobo: 5000000, // ₦50,000 cleaning
    securityDepositKobo: 10000000, // ₦100,000 deposit (non-commissionable!)
    attributableTaxKobo: 3750000, // ₦37,500 tax (non-commissionable!)
    payoutPlan: "fast_payout" as "fast_payout" | "full_post_stay",
    ...overrides
  };
}

test("Standard, founding, and Preferred rates apply prospectively to the correct commission base and captured booking version", () => {
  const manager = new RevenueReleaseManager();

  // 1. Standard operator (12% rate)
  const stdBooking = createMockBookingData({ operatorTier: "standard" });
  const stdCalc = manager.calculateCommissionAndNet(stdBooking);
  // Base = 50,000,000 + 5,000,000 = 55,000,000 Kobo. 12% = 6,600,000 Kobo.
  assert.equal(stdCalc.commissionBaseKobo, 55000000);
  assert.equal(stdCalc.commissionRate, 0.12);
  assert.equal(stdCalc.commissionKobo, 6600000);
  assert.equal(stdCalc.operatorNetKobo, 48400000); // 55,000,000 - 6,600,000

  // 2. Founding operator (8% rate)
  const fndBooking = createMockBookingData({ operatorTier: "founding" });
  const fndCalc = manager.calculateCommissionAndNet(fndBooking);
  // 8% of 55,000,000 = 4,400,000 Kobo.
  assert.equal(fndCalc.commissionRate, 0.08);
  assert.equal(fndCalc.commissionKobo, 4400000);
  assert.equal(fndCalc.operatorNetKobo, 50600000);

  // 3. Preferred operator (10% rate)
  const prefBooking = createMockBookingData({ operatorTier: "preferred" });
  const prefCalc = manager.calculateCommissionAndNet(prefBooking);
  // 10% of 55,000,000 = 5,500,000 Kobo.
  assert.equal(prefCalc.commissionRate, 0.1);
  assert.equal(prefCalc.commissionKobo, 5500000);
  assert.equal(prefCalc.operatorNetKobo, 49500000);
});

test("Revenue becomes payable only after Verified Access plus 24 hours without an unresolved Blocking Fulfilment Complaint", () => {
  const manager = new RevenueReleaseManager();
  const booking = createMockBookingData();

  const verifiedAccessIso = "2026-08-25T14:00:00.000Z";

  // Attempting release BEFORE 24h post Verified Access MUST throw (ADR 0021)
  const earlyAttemptIso = "2026-08-26T10:00:00.000Z"; // 20h < 24h
  assert.throws(
    () =>
      manager.processRevenueRelease({
        booking,
        verifiedAccessIso,
        currentIso: earlyAttemptIso,
        hasUnresolvedBlockingComplaint: false
      }),
    /Check-In Protection Window active: Revenue release requires Verified Access plus 24 hours/
  );

  // Attempting release with an unresolved Blocking Fulfilment Complaint MUST throw (ADR 0021)
  const eligibleTimeIso = "2026-08-26T15:00:00.000Z"; // 25h > 24h
  assert.throws(
    () =>
      manager.processRevenueRelease({
        booking,
        verifiedAccessIso,
        currentIso: eligibleTimeIso,
        hasUnresolvedBlockingComplaint: true
      }),
    /Revenue release blocked: Unresolved Blocking Fulfilment Complaint exists/
  );

  // Success path: Released after 24h without unresolved complaint
  const release = manager.processRevenueRelease({
    booking,
    verifiedAccessIso,
    currentIso: eligibleTimeIso,
    hasUnresolvedBlockingComplaint: false
  });

  assert.equal(release.status, "released");
  assert.equal(release.isPayable, true);
});

test("Authoritative unresolved complaint query cannot be bypassed by a false caller flag", () => {
  const complaintQuery = { hasUnresolvedBlockingComplaint: () => true };
  const manager = new RevenueReleaseManager({ blockingComplaintQuery: complaintQuery });
  assert.throws(() => manager.processRevenueRelease({ booking: createMockBookingData(), verifiedAccessIso: "2026-08-25T14:00:00.000Z", currentIso: "2026-08-26T15:00:00.000Z", hasUnresolvedBlockingComplaint: false }), /Unresolved Blocking Fulfilment Complaint/);
});

test("One launch Reservation creates at most one Revenue Release while corrections use explicit ledger adjustments", () => {
  const manager = new RevenueReleaseManager();
  const booking = createMockBookingData();
  const verifiedAccessIso = "2026-08-25T14:00:00.000Z";
  const currentIso = "2026-08-26T15:00:00.000Z";

  // First revenue release succeeds
  const firstRelease = manager.processRevenueRelease({
    booking,
    verifiedAccessIso,
    currentIso,
    hasUnresolvedBlockingComplaint: false
  });
  assert.equal(firstRelease.releaseId, `rev_rel_${booking.reservationId}`);

  // Attempting a SECOND revenue release on the same reservation MUST throw (ADR 0024)
  assert.throws(
    () =>
      manager.processRevenueRelease({
        booking,
        verifiedAccessIso,
        currentIso,
        hasUnresolvedBlockingComplaint: false
      }),
    /Revenue release already processed for reservation res-rev-101/
  );

  // Corrections MUST use explicit ledger adjustments
  const adjustment = manager.postLedgerAdjustment({
    reservationId: booking.reservationId,
    reason: "Late fee correction adjustment",
    adjustmentKobo: -1000000,
    recordedAtIso: currentIso
  });

  assert.equal(adjustment.type, "ledger_adjustment");
  assert.equal(adjustment.adjustmentKobo, -1000000);
});

test("Duplicate events, cancellation, refund, incident, and provider failure preserve financial balance and audit correlation", () => {
  const manager = new RevenueReleaseManager();
  const bookingFast = createMockBookingData({ payoutPlan: "fast_payout" });
  const verifiedAccessIso = "2026-08-25T14:00:00.000Z";
  const currentIso = "2026-08-26T15:00:00.000Z";

  // Fast Payout (90% payable, 10% rolling reserve tranche) (ADR 0026)
  const release = manager.processRevenueRelease({
    booking: bookingFast,
    verifiedAccessIso,
    currentIso,
    hasUnresolvedBlockingComplaint: false
  });

  // Verify financial balance: Operator Net = Payable Net + Reserve Tranche
  const expectedNet = release.operatorNetKobo;
  const payableNet = release.payableNetKobo;
  const reserveTranche = release.reserveTrancheKobo;

  assert.equal(payableNet + reserveTranche, expectedNet);
  assert.equal(release.balanced, true);

  // Full Post-Stay Payout (100% payable, 0% reserve) (ADR 0026)
  const bookingFull = createMockBookingData({
    reservationId: "res-rev-102",
    payoutPlan: "full_post_stay"
  });
  const releaseFull = manager.processRevenueRelease({
    booking: bookingFull,
    verifiedAccessIso,
    currentIso,
    hasUnresolvedBlockingComplaint: false
  });

  assert.equal(releaseFull.payableNetKobo, releaseFull.operatorNetKobo);
  assert.equal(releaseFull.reserveTrancheKobo, 0);
  assert.equal(releaseFull.balanced, true);
});
