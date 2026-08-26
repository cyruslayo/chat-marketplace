import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import type { BookingContract, Reservation } from "../domains/shortlet/src/card-payment.js";
import { InMemoryRevenueAccountingRepository, RepositoryEarnedCommissionSource } from "../domains/shortlet/src/revenue-accounting.js";
import { InMemoryProtectionFundAccountingRepository } from "../domains/shortlet/src/protection-fund-accounting.js";
import { ProtectionFundApplication, type ProtectionFundRemedyAuthorityProvider } from "../apps/web/src/protection-fund-application.js";
import { createRelocationProtectionFundingPort, relocationCaseAsProtectionFundAuthority } from "../apps/web/src/protection-fund-relocation-adapter.js";
import { protectionFundArtifact } from "../apps/web/src/protection-fund-artifact.js";
import { protectionFundArtifactToA2UI } from "../apps/web-agent/src/protection-fund-a2ui.js";
import { InMemoryRelocationBookingConsequence, InMemoryRelocationRemedyRepository, RelocationApplication } from "../apps/web/src/relocation-application.js";
import { setupRevenueRelease } from "./revenue-release-fixtures.js";

const guest = { id: "guest-1", role: "guest" as const, tenantId: "tenant-1" };
const system = { id: "system-1", role: "system" as const, tenantId: "tenant-1" };
const finance = { id: "finance-1", role: "authorized_staff" as const, tenantId: "tenant-1" };
const contract: BookingContract = {
  contractId: "contract-1", reservationId: "reservation-1", offerId: "offer-1", unitId: "unit-1", tenantId: "tenant-1",
  parties: { primaryGuest: { id: guest.id, name: "Primary Guest" }, operator: { id: "operator-1", name: "Operator" } },
  dates: { checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2 }, occupants: [{ name: "Primary Guest" }], quote: {},
  totalAmountDueNowKobo: 100_000, policies: { cancellationPolicy: {}, guestConductRules: [] },
  paymentDetails: { paymentMethod: "fresh_card", pspReference: "psp-reference", amountKobo: 100_000, currency: "NGN", paidAt: "2026-08-01T10:00:00.000Z" },
  createdAt: "2026-08-01T10:00:00.000Z", contractVersion: 1
};
const reservation: Reservation = { reservationId: contract.reservationId, contractId: contract.contractId, unitId: contract.unitId, primaryGuestId: guest.id, dates: contract.dates, status: "confirmed", confirmedAt: "2026-08-01T10:00:00.000Z" };

function graph(options: { remedyAmount?: number; fulfillment?: "completed" | "unavailable" | "throws"; balance?: "seed" | "empty" } = {}) {
  const amount = options.remedyAmount ?? 100;
  const cases = new InMemoryRelocationRemedyRepository();
  const accounting = new InMemoryProtectionFundAccountingRepository();
  const consequence = new InMemoryRelocationBookingConsequence();
  const events: string[] = [];
  let refunds = 0;
  const candidate = {
    candidateId: "replacement-1", candidateVersion: "candidate-v1", termsVersion: "terms-v1", neighborhood: "Ikoyi", entirePlace: true,
    capacity: 2, bedrooms: 1, beds: 1, requiredAmenities: ["wifi"], accessibilityCompatible: true, inspectionCurrent: true,
    safetyEligible: true, verificationCurrent: true, managementAuthorityCurrent: true, locationComparable: true, qualityComparable: true,
    checkInTimingComparable: true, operatorAcceptable: true, dates: contract.dates, replacementRemainingStayAccommodationKobo: 100_000 + amount,
    materialDisclosures: ["second floor"], availability: { available: true, commitmentId: "commitment-1", version: "availability-v1" }, priceCurrency: "NGN" as const
  };
  const protectionFund = new ProtectionFundApplication({
    accounting,
    metrics: { getMetrics: () => ({ metricsVersion: "metrics-v1", projectedP95NetRemedyExposureKobo: 0, projectedNext90DayGbvKobo: 0, trailing90DayGbvKobo: 0, trailingP95NetRemedyExposureKobo: 0 }) },
    capital: { allocateOrGet: input => ({ allocationId: "allocation-1", allocationVersion: "1", status: "settled" as const, amountKobo: input.requiredAmountKobo, currency: "NGN" as const }) },
    commissions: { getEarnedCommission: () => null }, remedies: relocationCaseAsProtectionFundAuthority(cases) as ProtectionFundRemedyAuthorityProvider,
    recovery: { getRecovery: () => ({ recoveryId: "recovery-1", recoveryVersion: "1", fundingRecordId: "unused", status: "settled" as const, amountKobo: 0, currency: "NGN" as const, source: "operator_settlement" as const }) },
    financeAuthorization: { canView: principal => principal.role === "authorized_staff" || principal.role === "admin" }, clock: () => new Date("2026-09-01T12:00:00.000Z")
  });
  if (options.balance !== "empty") protectionFund.seed(finance);
  const port = createRelocationProtectionFundingPort(protectionFund, cases, system);
  const relocation = new RelocationApplication({
    bookingState: new InMemoryBookingStateRepository({ contracts: [contract], reservations: [reservation] }),
    eligibility: { getEligibility: () => ({ eligible: true, eligibilityId: "eligibility-1", eligibilityVersion: "eligibility-v1", source: "failed_access" as const, failureActor: "operator" as const, currentGuestRemedy: "relocation_or_refund" as const, remainingStay: { ...contract.dates, nights: 2 } }) },
    candidates: { getCandidates: () => ({ candidateSetVersion: "candidate-set-v1", candidates: [candidate] }), getCandidate: () => candidate },
    comparability: { compare: () => ({ comparabilityVersion: "comparability-v1", comparable: true, dimensions: {}, reasons: [] }) },
    economics: { get: () => ({ economicsVersion: "economics-v1", originalRemainingStayAccommodationKobo: 100_000, currency: "NGN" as const }) },
    transport: { get: () => ({ quoteVersion: "transport-v1", costKobo: 0 }) },
    approvals: { getApprovalState: () => ({ policyVersion: "relocation-v1", approvalVersion: "approval-v1", tier: "routine" as const, approved: true, approvals: [] }) },
    funding: { get: () => ({ fundingVersion: "funding-v1", source: "guest_protection_fund" as const, status: "pending_accounting" as const }) },
    obligations: { get: () => ({ obligationId: "obligation-1", obligationVersion: "obligation-v1", scope: "full_booking" as const, amountKobo: 100_000, currency: "NGN" as const }) },
    refunds: { initiateOrGetRefund: () => { refunds += 1; return { refundId: "refund-1", status: "settled" as const, amountKobo: 100_000, currency: "NGN" as const }; } },
    fulfilment: { completeReplacement: () => { events.push("replacement.complete"); if (options.fulfillment === "throws") throw new Error("provider unavailable"); return { status: options.fulfillment ?? "completed", replacementReservationId: "replacement-reservation-1", replacementBookingReference: "replacement-booking-1" }; } },
    protectionFunding: { reserve: input => { events.push("fund.reserve"); return port.reserve(input); }, settle: input => { events.push("fund.settle"); return port.settle(input); }, release: input => port.release(input) },
    liability: { get: () => ({ liabilityVersion: "liability-v1", responsibleParty: "operator" as const, operatorLiabilityKobo: amount, platformExposureKobo: 0 }) }, policyVersion: "relocation-v1", cases, consequence
  });
  return { relocation, protectionFund, accounting, cases, consequence, events, getRefunds: () => refunds };
}
function choose(s: ReturnType<typeof graph>) { const artifact = s.relocation.getArtifact(reservation.reservationId, guest); const action = artifact.actions.find(item => item.type === "choose_relocation_candidate"); assert.ok(action); return s.relocation.chooseRelocation(reservation.reservationId, guest, action); }

// ADR 0028/0029 and ADR 0072: the production command owns the ordering and fallback.
test("Real Issue 23 to Issue 24 sufficient Fund reserves before fulfilment and settles", () => {
  const s = graph(); const result = choose(s); const snapshot = s.accounting.snapshot();
  assert.equal(result.facts.caseStatus, "relocated"); assert.equal(s.cases.findByReservationId("reservation-1")?.fundingStatus, "settled");
  assert.equal(s.cases.findByReservationId("reservation-1")?.replacementBookingReference, "replacement-booking-1");
  assert.equal(s.cases.findByReservationId("reservation-1")?.replacementReservationId, "replacement-reservation-1"); assert.equal(s.consequence.isAccommodationActive("reservation-1"), false);
  assert.equal(snapshot.availableBalanceKobo, 499_999_900); assert.equal(snapshot.committedBalanceKobo, 0); assert.equal(snapshot.remedies.length, 1); assert.equal(snapshot.remedies[0].settledAmountKobo, 100); assert.deepEqual(s.events, ["fund.reserve", "replacement.complete", "fund.settle"]); assert.equal(s.getRefunds(), 0);
});
test("Real Issue 23 to Issue 24 insufficient Fund preserves automatic Refund Fallback", () => { const s = graph({ remedyAmount: 500_000_001 }); const result = choose(s); const record = s.accounting.snapshot().remedies[0]; assert.equal(result.facts.caseStatus, "refunded"); assert.equal(record.status, "insufficient"); assert.equal(record.shortfallKobo, 1); assert.equal(s.accounting.snapshot().availableBalanceKobo, 500_000_000); assert.equal(s.accounting.snapshot().committedBalanceKobo, 0); assert.deepEqual(s.events, ["fund.reserve"]); assert.equal(s.getRefunds(), 1); });
test("Real Issue 23 to Issue 24 exact balance does not falsely report insufficient", () => { const s = graph({ remedyAmount: 500_000_000 }); choose(s); assert.equal(s.accounting.snapshot().remedies[0].status, "settled"); assert.equal(s.accounting.snapshot().availableBalanceKobo, 0); });
test("Real Issue 23 to Issue 24 unavailable fulfilment releases reservation and falls back", () => { const s = graph({ fulfillment: "unavailable" }); choose(s); const snapshot = s.accounting.snapshot(); assert.equal(snapshot.remedies[0].status, "released"); assert.equal(snapshot.availableBalanceKobo, 500_000_000); assert.equal(snapshot.committedBalanceKobo, 0); assert.equal(s.getRefunds(), 1); });
test("Real Issue 23 to Issue 24 fulfilment exception releases reservation without duplicate credit", () => { const s = graph({ fulfillment: "throws" }); choose(s); const first = s.accounting.snapshot(); assert.equal(first.remedies[0].status, "released"); assert.equal(first.availableBalanceKobo, 500_000_000); assert.equal(first.committedBalanceKobo, 0); assert.equal(s.getRefunds(), 1); });
test("Real Issue 23 to Issue 24 zero balance never creates a false disbursement", () => { const s = graph({ balance: "empty", remedyAmount: 100 }); choose(s); const snapshot = s.accounting.snapshot(); assert.equal(snapshot.remedies[0].status, "insufficient"); assert.equal(snapshot.remedies[0].reservedAmountKobo, 0); assert.equal(snapshot.remedies[0].settledAmountKobo, 0); assert.equal(s.getRefunds(), 1); });
test("Actual funding port rejects stale case version and wrong reservation binding without Fund movement", () => { const s = graph(); s.relocation.getArtifact("reservation-1", guest); const c = { caseId: "case-1", reservationId: "reservation-1", caseVersion: 1, status: "relocation_pending_completion" as const, choice: "relocation" as const, fundingSource: "guest_protection_fund" as const, fundingStatus: "pending_accounting" as const, responsibleParty: "operator" as const, priceDiffKobo: 100, transportCostKobo: 0, operatorLiabilityKobo: 100, platformExposureKobo: 0, incidentId: "incident-1", obligationId: "obligation-1", obligationVersion: "obligation-v1", eligibilityId: "eligibility-1", eligibilityVersion: "eligibility-v1", approvalVersion: "approval-v1", decisionVersion: "decision-v1", fundingVersion: "funding-v1", liabilityVersion: "liability-v1" }; s.cases.createIfAbsent(c); const port = createRelocationProtectionFundingPort(s.protectionFund, s.cases, system); assert.throws(() => port.reserve({ remedyCaseId: c.caseId, reservationId: c.reservationId, expectedCaseVersion: 0 }), /STALE_ACTION/); assert.throws(() => port.reserve({ remedyCaseId: c.caseId, reservationId: "wrong", expectedCaseVersion: c.caseVersion }), /STALE_ACTION/); assert.equal(s.accounting.snapshot().availableBalanceKobo, 500_000_000); });

test("Real Issue 28 Revenue Release contributes the immutable earned commission record exactly once", () => { const revenue = setupRevenueRelease(); const release = revenue.app.releaseRevenue("reservation-1", { id: "system", role: "system", tenantId: "tenant" }); const source = new RepositoryEarnedCommissionSource(revenue.accounting); const accounting = new InMemoryProtectionFundAccountingRepository(); const app = new ProtectionFundApplication({ accounting, metrics: { getMetrics: () => ({ metricsVersion: "m1", projectedP95NetRemedyExposureKobo: 0, projectedNext90DayGbvKobo: 0, trailing90DayGbvKobo: 0, trailingP95NetRemedyExposureKobo: 0 }) }, capital: { allocateOrGet: i => ({ allocationId: "a", allocationVersion: "1", status: "settled" as const, amountKobo: i.requiredAmountKobo, currency: "NGN" as const }) }, commissions: source, remedies: { getRemedy: () => { throw new Error("unused"); } }, recovery: { getRecovery: () => { throw new Error("unused"); } }, financeAuthorization: { canView: () => true } }); const result = app.contribute(release.releaseId, system); assert.equal(result.status, "contributed"); assert.equal(result.record.releaseId, release.releaseId); assert.equal(result.record.reservationId, release.reservationId); assert.equal(result.record.earnedCommissionRecordId, revenue.accounting.getEarnedCommissionRecord(release.releaseId)?.recordId); assert.equal(result.record.earnedCommissionKobo, release.commissionKobo); const replay = app.contribute(release.releaseId, system); assert.strictEqual(replay.record, result.record); assert.equal(accounting.snapshot().contributions.length, 1); assert.strictEqual(revenue.accounting.getEarnedCommissionRecord(release.releaseId)?.recordId, result.record.earnedCommissionRecordId); });
test("Real Issue 28 source returns not_earned before a Revenue Release exists", () => { const revenue = setupRevenueRelease(); const accounting = new InMemoryProtectionFundAccountingRepository(); const app = new ProtectionFundApplication({ accounting, metrics: { getMetrics: () => ({ metricsVersion: "m", projectedP95NetRemedyExposureKobo: 0, projectedNext90DayGbvKobo: 0, trailing90DayGbvKobo: 0, trailingP95NetRemedyExposureKobo: 0 }) }, capital: { allocateOrGet: i => ({ allocationId: "a", allocationVersion: "1", status: "settled" as const, amountKobo: i.requiredAmountKobo, currency: "NGN" as const }) }, commissions: new RepositoryEarnedCommissionSource(revenue.accounting), remedies: { getRemedy: () => { throw new Error("unused"); } }, recovery: { getRecovery: () => { throw new Error("unused"); } }, financeAuthorization: { canView: () => true } }); assert.equal(app.contribute("revenue-release:reservation-1", system).status, "not_earned"); assert.equal(accounting.snapshot().availableBalanceKobo, 0); });

test("Finance reconciliation projection exposes count and no Weaver actions", () => { const s=graph(); const c={caseId:"case-reconcile",reservationId:"reservation-reconcile",caseVersion:1,status:"relocation_pending_completion" as const,choice:"relocation" as const,fundingSource:"guest_protection_fund" as const,fundingStatus:"pending_accounting" as const,responsibleParty:"operator" as const,priceDiffKobo:100,transportCostKobo:0,operatorLiabilityKobo:100,platformExposureKobo:0,incidentId:"incident",obligationId:"obligation",obligationVersion:"v",eligibilityId:"eligibility",eligibilityVersion:"v",approvalVersion:"v",decisionVersion:"v",fundingVersion:"v",liabilityVersion:"v"}; s.cases.createIfAbsent(c); const reserved=s.protectionFund.reserve({remedyCaseId:c.caseId,reservationId:c.reservationId,expectedCaseVersion:1},system); assert.equal(reserved.status,"reserved"); s.protectionFund.markReconciliationRequired(reserved.record.fundingRecordId,system); const artifact=protectionFundArtifact(s.protectionFund,finance); assert.equal(artifact.facts.reconciliationRequiredCount,1); assert.equal(artifact.actions.length,0); const messages=protectionFundArtifactToA2UI({artifact,surfaceId:"surface-1"}); assert.equal(JSON.stringify(messages).includes("reconciliation required: 1"),true); });
test("Shared protection Fund balance commits only the first atomic reservation", () => { const s = graph({ remedyAmount: 500_000_000 }); const base = { caseVersion: 1, status: "relocation_pending_completion" as const, choice: "relocation" as const, fundingSource: "guest_protection_fund" as const, fundingStatus: "pending_accounting" as const, responsibleParty: "operator" as const, priceDiffKobo: 500_000_000, transportCostKobo: 0, operatorLiabilityKobo: 500_000_000, platformExposureKobo: 0, incidentId: "incident", obligationId: "obligation", obligationVersion: "v", eligibilityId: "eligibility", eligibilityVersion: "v", approvalVersion: "v", decisionVersion: "v", fundingVersion: "v", liabilityVersion: "v" }; s.cases.createIfAbsent({ ...base, caseId: "case-a", reservationId: "reservation-a" }); s.cases.createIfAbsent({ ...base, caseId: "case-b", reservationId: "reservation-b" }); const first = s.protectionFund.reserve({ remedyCaseId: "case-a", reservationId: "reservation-a", expectedCaseVersion: 1 }, system); assert.equal(first.status, "reserved"); const second = s.protectionFund.reserve({ remedyCaseId: "case-b", reservationId: "reservation-b", expectedCaseVersion: 1 }, system); assert.equal(second.status, "insufficient"); assert.equal(s.accounting.snapshot().availableBalanceKobo, 0); assert.equal(s.accounting.snapshot().committedBalanceKobo, 500_000_000); assert.equal(s.accounting.snapshot().availableBalanceKobo >= 0, true); });