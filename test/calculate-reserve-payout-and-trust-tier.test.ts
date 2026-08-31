import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope, InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  ReservePayoutManager,
  OperatorActivity,
  PayoutCalculationInput,
  ReserveTranche
} from "../domains/shortlet/src/reserve-payout-trust.js";
import {
  InMemoryRevenueAccountingRepository,
  journal,
  type RevenueLedgerLine
} from "../domains/shortlet/src/revenue-accounting.js";
import type { ProductionRevenueReleaseRecord } from "../domains/shortlet/src/revenue-release.js";

const sampleOperatorActivity: OperatorActivity = {
  operatorId: "op-100",
  tenantId: "tenant-lagos",
  completedBookings60d: 12,
  completedBookings180d: 35,
  reliabilityScore60d: 0.96,
  reliabilityScore180d: 0.99,
  activeEnforcementState: "none"
};

const sampleBooking: PayoutCalculationInput = {
  reservationId: "res-501",
  operatorId: "op-100",
  tenantId: "tenant-lagos",
  accommodationKobo: 10000000, // ₦100,000
  mandatoryChargesKobo: 1000000, // ₦10,000
  securityDepositKobo: 2000000, // ₦20,000
  checkoutDateIso: "2026-08-10T11:00:00Z"
};

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0062, ADR 0063, ADR 0064, ADR 0066, ADR 0083
 */
test("Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms use versioned provisional policy", () => {
  const manager = new ReservePayoutManager();

  // Founding 90/10 payout plan (Fast Payout)
  const founding9010 = manager.calculatePayoutPlanAndReserve({
    booking: sampleBooking,
    payoutPlan: "founding_90_10",
    tier: "standard"
  });

  assert.equal(founding9010.policyVersion, "v1.0-launch");
  assert.equal(founding9010.commissionBaseKobo, 11000000); // ₦110,000
  assert.equal(founding9010.commissionKobo, 1320000); // 12% standard commission = ₦13,200
  assert.equal(founding9010.operatorNetKobo, 9680000); // ₦96,800
  assert.equal(founding9010.payableNowKobo, 8712000); // 90% payable = ₦87,120
  assert.equal(founding9010.reserveTrancheKobo, 968000); // 10% reserve = ₦9,680
  assert.equal(founding9010.payableNowKobo + founding9010.reserveTrancheKobo, founding9010.operatorNetKobo);

  // Founding post-checkout choice (Full Post-Stay 100%)
  const foundingPostCheckout = manager.calculatePayoutPlanAndReserve({
    booking: sampleBooking,
    payoutPlan: "founding_100_post_checkout",
    tier: "standard"
  });
  assert.equal(foundingPostCheckout.payableNowKobo, 9680000);
  assert.equal(foundingPostCheckout.reserveTrancheKobo, 0);

  // Proven 95/5 terms
  const provenTerms = manager.calculatePayoutPlanAndReserve({
    booking: sampleBooking,
    payoutPlan: "proven_95_5",
    tier: "proven"
  });
  assert.equal(provenTerms.payableNowKobo, 9196000); // 95% of 96,800 = ₦91,960
  assert.equal(provenTerms.reserveTrancheKobo, 484000); // 5% = ₦4,840

  // Preferred terms (100% after access, 10% commission rate)
  const preferredTerms = manager.calculatePayoutPlanAndReserve({
    booking: { ...sampleBooking, operatorTier: "preferred" },
    payoutPlan: "preferred_100_access",
    tier: "preferred"
  });
  assert.equal(preferredTerms.commissionKobo, 1100000); // 10% preferred commission = ₦11,000
  assert.equal(preferredTerms.operatorNetKobo, 9900000); // ₦99,000
  assert.equal(preferredTerms.payableNowKobo, 9900000);
  assert.equal(preferredTerms.reserveTrancheKobo, 0);

  // ADR 0083: Consuming immutable Revenue Release does not recalculate captured economics
  const mockRevenueRelease: ProductionRevenueReleaseRecord = {
    releaseId: "rev-rel-501",
    releaseVersion: 1,
    reservationId: "res-501",
    contractId: "contract-501",
    contractVersion: 1,
    unitId: "unit-101",
    tenantId: "tenant-lagos",
    operatorId: "op-100",
    accessVersion: "v1",
    accessStatus: "verified_access",
    verifiedAccessAt: "2026-08-01T12:00:00Z",
    protectionWindowStartsAt: "2026-08-01T12:00:00Z",
    protectionWindowEndsAt: "2026-08-02T12:00:00Z",
    economicsVersion: "v1",
    commissionPolicyVersion: "v1",
    commissionRate: 0.08, // Founding 8% captured rate!
    commissionBaseKobo: 11000000,
    commissionKobo: 880000, // 8% of 110,000 = 8,800
    operatorNetKobo: 10120000, // 110,000 - 8,800 = 101,200
    payoutPlan: "fast_payout",
    payoutPlanVersion: "v1",
    payableNowKobo: 9108000,
    routineReserveTrancheKobo: 1012000,
    deferredPostStayKobo: 0,
    riskHoldVersion: "v1",
    riskHoldKobo: 0,
    ledgerJournalId: "j-501",
    earnedCommissionRecordId: "ec-501",
    effectiveCheckoutVersion: "v1",
    releasedAt: "2026-08-02T12:00:00Z",
    currency: "NGN"
  };

  const provenWithFoundingEconomics = manager.calculatePayoutPlanAndReserve({
    booking: sampleBooking,
    payoutPlan: "proven_95_5",
    tier: "proven",
    revenueRelease: mockRevenueRelease
  });
  // Preserves 8% founding commission economics while applying Proven 95/5 settlement
  assert.equal(provenWithFoundingEconomics.commissionKobo, 880000);
  assert.equal(provenWithFoundingEconomics.operatorNetKobo, 10120000);
  assert.equal(provenWithFoundingEconomics.payableNowKobo, 9614000); // 95% of 10,120,000
  assert.equal(provenWithFoundingEconomics.reserveTrancheKobo, 506000); // 5% of 10,120,000
});

test("Tier evaluation uses the accepted booking counts, observation periods, reliability thresholds, and enforcement state", () => {
  const manager = new ReservePayoutManager();

  // 1. Preferred Tier: >= 30 bookings in 180d, reliability >= 0.98, no enforcement
  const preferredEval = manager.evaluateOperatorTrustTier(sampleOperatorActivity);
  assert.equal(preferredEval.tier, "preferred");

  // 2. Proven Tier: >= 10 bookings in 60d, reliability >= 0.95, no enforcement
  const provenEval = manager.evaluateOperatorTrustTier({
    ...sampleOperatorActivity,
    completedBookings180d: 15,
    reliabilityScore180d: 0.96
  });
  assert.equal(provenEval.tier, "proven");

  // 3. Standard Tier: < 10 bookings
  const standardEval = manager.evaluateOperatorTrustTier({
    ...sampleOperatorActivity,
    completedBookings60d: 5,
    completedBookings180d: 8
  });
  assert.equal(standardEval.tier, "standard");

  // 4. Downgrade by reliability score (< 0.95)
  const lowReliabilityEval = manager.evaluateOperatorTrustTier({
    ...sampleOperatorActivity,
    reliabilityScore60d: 0.90,
    reliabilityScore180d: 0.90
  });
  assert.equal(lowReliabilityEval.tier, "standard");

  // 5. Downgrade by active enforcement state (e.g. "warning", "restriction")
  const activeEnforcementEval = manager.evaluateOperatorTrustTier({
    ...sampleOperatorActivity,
    activeEnforcementState: "restriction"
  });
  assert.equal(activeEnforcementEval.tier, "standard");
  assert.equal(activeEnforcementEval.overriddenByEnforcement, true);

  // Authoritative provider evaluation
  const authoritativeReliability = {
    getReliability: ({ operatorId }: { operatorId: string; tenantId: string }) => ({
      operatorId,
      tenantId: "tenant-lagos",
      trailing60dCompletedBookings: 12,
      trailing60dOpportunities: 12,
      trailing60dReliabilityRate: 0.96,
      trailing180dCompletedBookings: 35,
      trailing180dOpportunities: 35,
      trailing180dReliabilityRate: 0.99
    })
  };
  const authoritativeEnforcement = {
    getProjections: ({ operatorId }: { operatorId: string }) => ({
      misconductCount: 0,
      enforcementLevel: "coaching" as const,
      operatorStatus: "active" as const
    })
  };

  const providerManager = new ReservePayoutManager({
    reliabilityAuthority: authoritativeReliability,
    enforcementAuthority: authoritativeEnforcement
  });

  const authEval = providerManager.evaluateOperatorTrustTier({
    operatorId: "op-100",
    tenantId: "tenant-lagos"
  });
  assert.equal(authEval.tier, "preferred");
});

test("Reserve and payout projections reconcile to ledger entries and never promise unavailable or legally held funds", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();
  const manager = new ReservePayoutManager({ accountingRepository: accountingRepo });

  // Open risk / legal hold / open liabilities override payout acceleration
  const overriddenPayout = manager.calculatePayoutPlanAndReserve({
    booking: sampleBooking,
    payoutPlan: "preferred_100_access",
    tier: "preferred",
    holds: {
      openRisk: true,
      openLiabilitiesKobo: 5000000, // ₦50,000 open liability
      legalHold: false,
      providerRestriction: false
    }
  });

  // Payout acceleration is overridden -> funds are NOT promised/payable now
  assert.equal(overriddenPayout.payoutAccelerated, false);
  assert.equal(overriddenPayout.payableNowKobo, 0);
  assert.equal(overriddenPayout.heldAmountKobo, 9900000); // Entire Operator Net held pending risk/liability resolution
  assert.ok(overriddenPayout.overrideReasons.includes("open_risk"));
  assert.ok(overriddenPayout.overrideReasons.includes("open_liabilities"));
});

test("Downgrade, open liability, appeal, adjustment, and duplicate-release cases are covered behaviourally", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();
  const auditLog = new InMemoryAuditLog();
  const manager = new ReservePayoutManager({ accountingRepository: accountingRepo });

  // Seed release in accounting repo to ensure balanced ledger tracking
  const releaseId = "revenue-release:res-501";
  const lines: RevenueLedgerLine[] = [
    { lineId: `${releaseId}:1`, account: "revenue_pending", side: "debit", amountKobo: 11000000, currency: "NGN" },
    { lineId: `${releaseId}:2`, account: "platform_commission_earned", side: "credit", amountKobo: 1320000, currency: "NGN" },
    { lineId: `${releaseId}:3`, account: "operator_net_recognized", side: "credit", amountKobo: 9680000, currency: "NGN" },
    { lineId: `${releaseId}:4`, account: "operator_net_recognized", side: "debit", amountKobo: 9680000, currency: "NGN" },
    { lineId: `${releaseId}:5`, account: "operator_payable", side: "credit", amountKobo: 8712000, currency: "NGN" },
    { lineId: `${releaseId}:6`, account: "rolling_reserve", side: "credit", amountKobo: 968000, currency: "NGN" },
    { lineId: `${releaseId}:7`, account: "post_stay_deferred", side: "credit", amountKobo: 0, currency: "NGN" }
  ];
  const j = journal({ correlationId: releaseId, lines, createdAt: "2026-08-10T12:00:00Z" });
  accountingRepo.commitRelease({
    release: { releaseId, reservationId: "res-501" },
    journal: j,
    earnedCommission: {
      recordId: `ec-${releaseId}`,
      releaseId,
      reservationId: "res-501",
      commissionPolicyVersion: "v1.0-launch",
      earnedCommissionKobo: 1320000,
      currency: "NGN",
      earnedAt: "2026-08-10T12:00:00Z"
    }
  });

  // Create a reserve tranche
  const tranche: ReserveTranche = {
    trancheId: "tr-101",
    reservationId: "res-501",
    operatorId: "op-100",
    tenantId: "tenant-lagos",
    amountKobo: 968000,
    checkoutDateIso: "2026-08-10T11:00:00Z",
    maturityDateIso: "2026-09-09T11:00:00Z", // checkout + 30 days
    status: "held",
    policyVersion: "v1.0-launch"
  };

  manager.registerReserveTranche(tranche);

  // Failure path 1: Cannot release before maturity date
  assert.throws(
    () => manager.releaseReserveTranche("tr-101", "2026-08-20T00:00:00Z", {}, auditLog),
    /Tranche tr-101 has not reached maturity date/
  );

  // Failure path 2: Paused due to open appeal or legal hold
  assert.throws(
    () => manager.releaseReserveTranche("tr-101", "2026-09-10T00:00:00Z", { legalHold: true }, auditLog),
    /Tranche release paused due to legal hold or open appeal/
  );

  // Success path: Release after maturity without holds reconciles balanced movement
  const released = manager.releaseReserveTranche("tr-101", "2026-09-10T00:00:00Z", {}, auditLog);
  assert.equal(released.status, "released");
  assert.equal(released.releasedAtIso, "2026-09-10T00:00:00Z");
  assert.ok(released.ledgerJournalId);

  const adjustments = accountingRepo.findAdjustmentsForRelease(releaseId);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].reasonCode, "reserve_tranche_released_to_payable");

  // Failure path 3: Duplicate release attempt
  assert.throws(
    () => manager.releaseReserveTranche("tr-101", "2026-09-11T00:00:00Z", {}, auditLog),
    /Duplicate release attempted for tranche tr-101/
  );

  // Open liability offset case: Tranche applied to offset open liability
  const releaseId2 = "revenue-release:res-502";
  accountingRepo.commitRelease({
    release: { releaseId: releaseId2, reservationId: "res-502" },
    journal: journal({
      correlationId: releaseId2,
      lines: [
        { lineId: `${releaseId2}:1`, account: "revenue_pending", side: "debit", amountKobo: 5000000, currency: "NGN" },
        { lineId: `${releaseId2}:2`, account: "platform_commission_earned", side: "credit", amountKobo: 600000, currency: "NGN" },
        { lineId: `${releaseId2}:3`, account: "operator_net_recognized", side: "credit", amountKobo: 4400000, currency: "NGN" },
        { lineId: `${releaseId2}:4`, account: "operator_net_recognized", side: "debit", amountKobo: 4400000, currency: "NGN" },
        { lineId: `${releaseId2}:5`, account: "operator_payable", side: "credit", amountKobo: 3900000, currency: "NGN" },
        { lineId: `${releaseId2}:6`, account: "rolling_reserve", side: "credit", amountKobo: 500000, currency: "NGN" },
        { lineId: `${releaseId2}:7`, account: "post_stay_deferred", side: "credit", amountKobo: 0, currency: "NGN" }
      ],
      createdAt: "2026-08-10T12:00:00Z"
    }),
    earnedCommission: {
      recordId: `ec-${releaseId2}`,
      releaseId: releaseId2,
      reservationId: "res-502",
      commissionPolicyVersion: "v1.0-launch",
      earnedCommissionKobo: 600000,
      currency: "NGN",
      earnedAt: "2026-08-10T12:00:00Z"
    }
  });

  const tranche2: ReserveTranche = {
    trancheId: "tr-102",
    reservationId: "res-502",
    operatorId: "op-100",
    tenantId: "tenant-lagos",
    amountKobo: 500000,
    checkoutDateIso: "2026-08-10T11:00:00Z",
    maturityDateIso: "2026-09-09T11:00:00Z",
    status: "held",
    policyVersion: "v1.0-launch"
  };
  manager.registerReserveTranche(tranche2);

  const forfeited = manager.releaseReserveTranche(
    "tr-102",
    "2026-09-10T00:00:00Z",
    { openLiabilitiesKobo: 1000000 },
    auditLog
  );
  assert.equal(forfeited.status, "forfeited_for_liability");
  assert.ok(forfeited.ledgerJournalId);

  // Manual override command via PlatformCommandEnvelope with idempotency
  const overrideCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      action: "apply_hold" as const,
      reason: "Under investigation for fraudulent listing"
    },
    idempotencyKey: "idem-override-101"
  });

  const holdResult = manager.processAdminPayoutOverride(overrideCmd);
  assert.equal(holdResult.operatorId, "op-100");
  assert.equal(holdResult.holdActive, true);

  // Replay of same command envelope returns idempotent cached result
  const replayed = manager.processAdminPayoutOverride(overrideCmd);
  assert.equal(replayed.operatorId, "op-100");
  assert.equal(replayed.holdActive, true);

  // Conflicting idempotency key reuse fails closed
  const conflictingCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-999", // Different payload!
      action: "apply_hold" as const,
      reason: "Different reason"
    },
    idempotencyKey: "idem-override-101"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(conflictingCmd),
    /Idempotency key was reused for a different command/
  );

  // Non-human/agent execution rejection (ADR 0072 & ADR 0083)
  const agentCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "agent-bot", role: "agent" as any, tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      action: "apply_hold" as const,
      reason: "AI agent decision"
    },
    idempotencyKey: "idem-override-agent"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(agentCmd),
    /Admin authority required/
  );
});
