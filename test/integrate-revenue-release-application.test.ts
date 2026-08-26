import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryRevenueAccountingRepository, RepositoryEarnedCommissionSource, journal, type RevenueAdjustmentRecord } from "../domains/shortlet/src/revenue-accounting.js";
import { CheckInSupportManager } from "../domains/shortlet/src/checkin-support.js";
import { InMemoryMidStayIncidentRepository, MidStayBlockingComplaintQuery } from "../domains/shortlet/src/mid-stay-failure.js";
import { CheckInSupportApplication } from "../apps/web/src/checkin-support-application.js";
import { RevenueReleaseCheckInAccessAdapter, RevenueReleaseBlockingComplaintQuery } from "../apps/web/src/revenue-release-authority-adapters.js";
import type { AuthoritativeRevenueEconomics } from "../domains/shortlet/src/revenue-release.js";
import { setupRevenueRelease as setup, revenueNow as now, revenuePrincipal as principal } from "./revenue-release-fixtures.js";
test("Production Revenue Release uses authoritative state, exact 24-hour boundary, captured commission, and balanced Fast Payout", () => { const s = setup(); const release = s.app.releaseRevenue("reservation-1", principal); assert.equal(release.releaseId, "revenue-release:reservation-1"); assert.equal(release.commissionRate, 0.08); assert.equal(release.commissionBaseKobo, 123457); assert.equal(release.commissionKobo, 9876); assert.equal(release.operatorNetKobo, 113470); assert.equal(release.payableNowKobo + release.routineReserveTrancheKobo + release.riskHoldKobo, release.operatorNetKobo); assert.equal(s.accounting.findLedgerEntriesForRelease(release.releaseId)[0].balanced, true); assert.equal(new RepositoryEarnedCommissionSource(s.accounting).getEarnedCommission(release.releaseId)?.earnedCommissionKobo, 9876); assert.strictEqual(s.app.releaseRevenue("reservation-1", principal), release); });

test("Production Revenue Release rejects awaiting access and cancelled Reservation", () => { assert.throws(() => setup({ accessStatus: "awaiting_access" }).app.releaseRevenue("reservation-1", principal), /authoritative Verified Access/); assert.throws(() => setup({ status: "cancelled" }).app.releaseRevenue("reservation-1", principal), /confirmed Reservation/); });

test("Production release uses trusted captured rates and excludes non-commissionable All-In components", () => {
  for (const [rate, expected] of [[0.12, 14814], [0.08, 9876], [0.1, 12345]] as const) {
    const economics: AuthoritativeRevenueEconomics = { economicsVersion: `economics-${rate}`, currency: "NGN", commissionPolicyVersion: "adr-0062-launch-v1", capturedCommissionRate: rate, commissionableOperatorRevenueKobo: 123457, operatorBorneProcessorCostsKobo: 101, applicableWithholdingKobo: 7, preReleaseRefundOrCreditKobo: 13, bookingOffsetsKobo: 17, securityDepositKobo: 9001, platformRemittedTaxesKobo: 8003, platformOwnedFeesKobo: 607, passThroughKobo: 601, undeliveredExtrasKobo: 5 };
    const s = setup({ providers: { economics: { getEconomics: () => economics } } });
    const release = s.app.releaseRevenue("reservation-1", principal);
    assert.equal(release.commissionRate, rate); assert.equal(release.commissionKobo, expected); assert.equal(release.commissionBaseKobo, 123457); assert.equal(release.economicsVersion, `economics-${rate}`); assert.equal(release.commissionPolicyVersion, "adr-0062-launch-v1");
  }
});

test("Production payment authority accepts fresh_card and bank_transfer but blocks malformed unpaid contracts", () => {
  for (const paymentMethod of ["fresh_card", "bank_transfer"] as const) {
    const s = setup();
    s.state.saveContract({ ...s.contract, paymentDetails: paymentMethod === "fresh_card"
      ? { paymentMethod, pspReference: "fresh-card-authority", amountKobo: 100000, currency: "NGN", paidAt: "2026-09-01T10:00:00.000Z" }
      : { paymentMethod, transferReference: "transfer-authority", amountKobo: 100000, currency: "NGN", paidAt: "2026-09-01T10:00:00.000Z" } });
    assert.equal(s.app.releaseRevenue("reservation-1", principal).releaseId, "revenue-release:reservation-1");
  }
  const malformed = setup();
  malformed.state.saveContract({ ...malformed.contract, paymentDetails: { paymentMethod: "fresh_card", pspReference: "unpaid", amountKobo: 0, currency: "NGN", paidAt: "2026-09-01T10:00:00.000Z" } });
  assert.equal(malformed.app.getArtifact("reservation-1", { id: "operator-1", role: "operator", tenantId: "tenant" }).facts.status, "blocked");
  assert.throws(() => malformed.app.releaseRevenue("reservation-1", principal), /unpaid_or_malformed_contract/);
});

test("Full Post-Stay uses effective Checkout and does not make Operator Net payable at Revenue Release", () => { const release = setup({ plan: "full_post_stay", risk: 0 }).app.releaseRevenue("reservation-1", principal); assert.equal(release.payableNowKobo, 0); assert.equal(release.routineReserveTrancheKobo, 0); assert.equal(release.deferredPostStayKobo, release.operatorNetKobo); assert.equal(release.postStayPayableEligibleAt, "2026-09-04T13:00:00.000Z"); });

test("Terminal lifecycle state takes precedence and does not call pre-release providers", () => {
  for (const status of ["cancelled", "no_show"] as const) {
    let calls = 0;
    const throwing = () => { calls += 1; throw new Error("SHOULD_NOT_BE_CALLED"); };
    const s = setup({ status, providers: {
      access: { getAccess: throwing }, complaints: { hasUnresolvedBlockingComplaint: throwing }, holds: { getHold: throwing }, accounts: { getStatus: throwing }, economics: { getEconomics: throwing }, payoutPlans: { getPlan: throwing }, checkout: { getTerms: throwing }, risk: { getHold: throwing }
    }});
    const artifact = s.app.getArtifact("reservation-1", { id: "operator-1", role: "operator", tenantId: "tenant" });
    assert.equal(artifact.facts.status, "blocked");
    assert.deepEqual(artifact.facts.blockerReasonCodes, [`${status}_reservation`]);
    assert.equal(calls, 0);
    assert.throws(() => s.app.releaseRevenue("reservation-1", principal), /confirmed Reservation/);
    assert.equal(calls, 0);
  }
});

test("Real Check-In Support adapter preserves verifiedAt separately from protectionWindowStartsAt at the exact boundary", () => {
  let current = new Date("2026-09-02T12:00:00.000Z");
  let base = setup({ clock: () => current });
  const support = new CheckInSupportManager({
    windowProvider: { getWindow: () => ({ checkInDate: "2026-09-01", earliestAccessTime: "14:00", latestPermittedArrival: "22:00", timezone: "Africa/Lagos" }) },
    assignmentProvider: { assign: () => ({ assignedResponderId: "responder", backupResponderId: "backup" }) },
    reservationProvider: { getReservation: () => ({ reservationId: "reservation-1", primaryGuestId: "guest-1", tenantId: "tenant", status: "confirmed" }) }
  });
  const supportApp = new CheckInSupportApplication(support, () => current);
  supportApp.scheduleSupport("reservation-1", principal);
  const access = supportApp.recordSupportVerification({ reservationId: "reservation-1", provisionedAt: "2026-09-01T15:00:00.000Z", validAccess: true, failedAccess: false, positiveAtContractualCheckIn: true }, principal);
  const adapter = new RevenueReleaseCheckInAccessAdapter(support);
  base = setup({ clock: () => current, providers: { access: adapter } });
  const adapted = adapter.getAccess("reservation-1");
  assert.notEqual(adapted.verifiedAt, adapted.protectionWindowStartsAt);
  assert.equal(adapted.verifiedAt, access.verifiedAt);
  assert.equal(adapted.protectionWindowStartsAt, "2026-09-01T13:00:00.000Z");
  current = new Date("2026-09-02T12:59:59.999Z");
  assert.equal(base.app.getArtifact("reservation-1", { id: "operator-1", role: "operator", tenantId: "tenant" }).facts.status, "pending_protection_window");
  assert.throws(() => base.app.releaseRevenue("reservation-1", principal), /blocked/);
  current = new Date("2026-09-02T13:00:00.000Z");
  assert.equal(base.app.getArtifact("reservation-1", { id: "operator-1", role: "operator", tenantId: "tenant" }).facts.status, "eligible");
  assert.equal(base.app.releaseRevenue("reservation-1", principal).releaseId, "revenue-release:reservation-1");
});

test("Real Check-In and Mid-Stay complaint queries compose and resolved incidents unblock release", () => {
  const support = new CheckInSupportManager({ windowProvider: { getWindow: () => ({ checkInDate: "2026-09-01", earliestAccessTime: "14:00", latestPermittedArrival: "22:00", timezone: "Africa/Lagos" }) }, assignmentProvider: { assign: () => ({ assignedResponderId: "responder", backupResponderId: "backup" }) }, reservationProvider: { getReservation: () => ({ reservationId: "reservation-1", primaryGuestId: "guest-1", tenantId: "tenant", status: "confirmed" }) } });
  const supportApp = new CheckInSupportApplication(support, () => now);
  supportApp.scheduleSupport("reservation-1", principal);
  const guest = { id: "guest-1", role: "guest" as const, tenantId: "tenant" };
  const repository = new InMemoryMidStayIncidentRepository();
  repository.createIfAbsent({ incidentId: "incident-1", reservationId: "reservation-1", contractVersion: 1, incidentVersion: 1, status: "reported", reportedAt: now.toISOString(), evidenceSetId: "evidence-1", evidenceVersion: "1", evidenceStatus: "sufficient", assessment: { assessmentVersion: "1", reservationId: "reservation-1", evidenceSetId: "evidence-1", contractVersion: 1, category: "safety_access_habitability", failureStartedAt: now.toISOString(), affectedNightDates: [], unusedNightDates: [], materiallyUnusableNightDates: [], overnightImpact: false, materialIncident: true, causationVersion: "1", causationStatus: "established", reportingDelayExcused: false, currentImpact: "ongoing", repeatedOrMaterialMinor: false }, humanOwned: true });
  const complaints = new RevenueReleaseBlockingComplaintQuery([support, new MidStayBlockingComplaintQuery(repository)]);
  const s = setup({ providers: { complaints } });
  assert.throws(() => s.app.releaseRevenue("reservation-1", principal), /blocked/);
  repository.update("incident-1", 1, (incident) => ({ ...incident, incidentVersion: 2, status: "closed" }));
  assert.equal(s.app.releaseRevenue("reservation-1", principal).releaseId, "revenue-release:reservation-1");
  const checkInComplaintApp = setup({ providers: { complaints } });
  supportApp.reportGuestCheckInProblem("reservation-1", "access_failure", guest);
  assert.throws(() => checkInComplaintApp.app.releaseRevenue("reservation-1", principal), /blocked/);
});

test("Replay and post-release views return immutable accounting authority before consulting throwing providers", () => {
  const accounting = new InMemoryRevenueAccountingRepository();
  const first = setup({ accounting });
  const release = first.app.releaseRevenue("reservation-1", principal);
  const journalCount = accounting.findLedgerEntriesForRelease(release.releaseId).length;
  const earned = accounting.getEarnedCommissionRecord(release.releaseId);
  let calls = 0;
  const fail = () => { calls += 1; throw new Error("SHOULD_NOT_BE_CALLED"); };
  const replay = setup({ accounting, providers: { access: { getAccess: fail }, complaints: { hasUnresolvedBlockingComplaint: fail }, holds: { getHold: fail }, accounts: { getStatus: fail }, economics: { getEconomics: fail }, payoutPlans: { getPlan: fail }, checkout: { getTerms: fail }, risk: { getHold: fail } } });
  assert.strictEqual(replay.app.releaseRevenue("reservation-1", principal), release);
  assert.equal(calls, 0);
  assert.equal(accounting.findLedgerEntriesForRelease(release.releaseId).length, journalCount);
  assert.strictEqual(accounting.getEarnedCommissionRecord(release.releaseId), earned);
  const artifact = replay.app.getArtifact("reservation-1", { id: "operator-1", role: "operator", tenantId: "tenant" });
  assert.equal(artifact.facts.status, "released"); assert.equal(artifact.facts.protectionWindowStartsAt, release.protectionWindowStartsAt); assert.equal(artifact.facts.commissionRate, release.commissionRate); assert.equal(calls, 0);
});

test("Adjustment identity is idempotent, discoverable, and conflicts fail closed", () => {
  const base = setup(); const release = base.app.releaseRevenue("reservation-1", principal);
  const adjustment: RevenueAdjustmentRecord = { adjustmentId: "adjustment-conflict", adjustmentVersion: 1, reservationId: "reservation-1", releaseId: release.releaseId, source: "refund", sourceReference: "refund-1", reasonCode: "refund_accepted", journal: journal({ correlationId: release.releaseId, createdAt: now.toISOString(), lines: [{ lineId: "debit", account: "operator_net_recognized", side: "debit", amountKobo: 11, currency: "NGN" }, { lineId: "credit", account: "operator_payable", side: "credit", amountKobo: 11, currency: "NGN" }] }) };
  const withAdjustment = setup({ accounting: base.accounting, adjustment });
  assert.equal(withAdjustment.app.postAdjustment(adjustment.adjustmentId, principal).journal.correlationId, release.releaseId);
  assert.equal(base.accounting.findLedgerEntriesForRelease(release.releaseId).length, 2);
  assert.equal(base.accounting.findAdjustmentsForRelease(release.releaseId).length, 1);
  assert.strictEqual(withAdjustment.app.postAdjustment(adjustment.adjustmentId, principal).adjustmentId, adjustment.adjustmentId);
  const conflicting = { ...adjustment, sourceReference: "different-ref" };
  const conflictApp = setup({ accounting: base.accounting, adjustment: conflicting });
  assert.throws(() => conflictApp.app.postAdjustment(adjustment.adjustmentId, principal), /Adjustment identity conflict/);
});

test("Trusted post-release adjustments are idempotent and do not mutate the historic release", () => { const s = setup(); const release = s.app.releaseRevenue("reservation-1", principal); const adjustment: RevenueAdjustmentRecord = { adjustmentId: "adjustment-1", adjustmentVersion: 1, reservationId: "reservation-1", releaseId: release.releaseId, source: "remedy", sourceReference: "mid-stay-failure:reservation-1", reasonCode: "accepted_remedy", journal: journal({ correlationId: release.releaseId, createdAt: now.toISOString(), lines: [{ lineId: "a", account: "operator_net_recognized", side: "debit", amountKobo: 10, currency: "NGN" }, { lineId: "b", account: "operator_payable", side: "credit", amountKobo: 10, currency: "NGN" }] }) };
  const withAuthority = setup({ adjustment }); const committed = withAuthority.app.releaseRevenue("reservation-1", principal); assert.equal(committed.releaseId, release.releaseId); const posted = withAuthority.app.postAdjustment("adjustment-1", principal); assert.equal(posted.adjustmentId, "adjustment-1"); assert.strictEqual(withAuthority.app.postAdjustment("adjustment-1", principal), posted); assert.equal(release.releaseVersion, 1);
});
