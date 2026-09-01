import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope, InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  ReservePayoutManager,
  type AuthoritativeReliabilityRecord,
  type OperatorReliabilityAuthority,
  type OperatorEnforcementAuthority,
  type OperatorScopeAuthority,
  type ReserveTranche
} from "../domains/shortlet/src/reserve-payout-trust.js";
import {
  InMemoryRevenueAccountingRepository,
  type RevenueLedgerLine
} from "../domains/shortlet/src/revenue-accounting.js";
import {
  RevenueReleaseManager,
  type ProductionRevenueReleaseRecord,
  type AuthoritativeReleaseInput
} from "../domains/shortlet/src/revenue-release.js";

const createMockReliability = (overrides: Partial<AuthoritativeReliabilityRecord> = {}): OperatorReliabilityAuthority => ({
  getReliability: ({ operatorId, tenantId }: { operatorId: string; tenantId: string }): AuthoritativeReliabilityRecord => ({
    operatorId,
    tenantId,
    trailing60dCompletedBookings: 12,
    trailing60dOpportunities: 12,
    trailing60dReliabilityRate: 0.96,
    trailing180dCompletedBookings: 35,
    trailing180dOpportunities: 35,
    trailing180dReliabilityRate: 0.99,
    ...overrides
  })
});

const createMockEnforcement = (overrides: Record<string, unknown> = {}): OperatorEnforcementAuthority => ({
  getProjections: ({ operatorId }: { operatorId: string }) => ({
    misconductCount: 0,
    enforcementLevel: "coaching" as const,
    operatorStatus: "active" as const,
    ...overrides
  })
});

const createMockScope = (overrides: { operatorId?: string; tenantId?: string } = {}): OperatorScopeAuthority => ({
  isOperatorInTenant: ({ operatorId, tenantId }: { operatorId: string; tenantId: string }) => {
    const validOp = overrides.operatorId ?? "op-100";
    const validTenant = overrides.tenantId ?? "tenant-lagos";
    return operatorId === validOp && tenantId === validTenant;
  }
});

function createCommittedProductionRelease(
  accountingRepo: InMemoryRevenueAccountingRepository,
  overrides: {
    reservationId?: string;
    operatorId?: string;
    tenantId?: string;
    payoutPlan?: "fast_payout" | "full_post_stay";
    capturedCommissionRate?: 0.08 | 0.1 | 0.12;
    commissionableRevenueKobo?: number;
    effectiveCheckoutAt?: string;
    now?: Date;
  } = {}
): ProductionRevenueReleaseRecord {
  const manager = new RevenueReleaseManager();
  const reservationId = overrides.reservationId ?? "res-501";
  const rate = overrides.capturedCommissionRate ?? 0.12;
  const revenue = overrides.commissionableRevenueKobo ?? 11000000;
  const now = overrides.now ?? new Date("2026-08-02T15:00:00.000Z");

  const input: AuthoritativeReleaseInput = {
    reservationId,
    contractId: `contract-${reservationId}`,
    contractVersion: 1,
    unitId: "unit-101",
    tenantId: overrides.tenantId ?? "tenant-lagos",
    operatorId: overrides.operatorId ?? "op-100",
    accessVersion: "v1",
    accessStatus: "verified_access",
    verifiedAccessAt: "2026-08-01T12:00:00.000Z",
    protectionWindowStartsAt: "2026-08-01T12:00:00.000Z",
    economics: {
      economicsVersion: "v1",
      currency: "NGN",
      commissionPolicyVersion: "v1",
      capturedCommissionRate: rate,
      commissionableOperatorRevenueKobo: revenue,
      operatorBorneProcessorCostsKobo: 0,
      applicableWithholdingKobo: 0,
      preReleaseRefundOrCreditKobo: 0,
      bookingOffsetsKobo: 0,
      securityDepositKobo: 1000000,
      platformRemittedTaxesKobo: 0,
      platformOwnedFeesKobo: 0,
      passThroughKobo: 0,
      undeliveredExtrasKobo: 0
    },
    payoutPlan: overrides.payoutPlan ?? "fast_payout",
    payoutPlanVersion: "v1",
    effectiveCheckoutAt: overrides.effectiveCheckoutAt ?? "2026-08-05T11:00:00.000Z",
    effectiveCheckoutVersion: "v1",
    riskHoldVersion: "v1",
    riskHoldKobo: 0,
    now
  };

  return manager.commitProductionRelease(input, accountingRepo);
}

function getBalances(accountingRepo: InMemoryRevenueAccountingRepository, releaseId: string) {
  const journals = accountingRepo.findLedgerEntriesForRelease(releaseId);
  let operatorPayableKobo = 0;
  let rollingReserveKobo = 0;
  let postStayDeferredKobo = 0;
  let riskRestrictedKobo = 0;
  let operatorCostsAndOffsetsKobo = 0;

  for (const j of journals) {
    for (const line of j.lines) {
      const delta = line.side === "credit" ? line.amountKobo : -line.amountKobo;
      if (line.account === "operator_payable") operatorPayableKobo += delta;
      else if (line.account === "rolling_reserve") rollingReserveKobo += delta;
      else if (line.account === "post_stay_deferred") postStayDeferredKobo += delta;
      else if (line.account === "risk_restricted") riskRestrictedKobo += delta;
      else if (line.account === "operator_costs_and_offsets") operatorCostsAndOffsetsKobo += delta;
    }
  }
  return {
    operatorPayableKobo,
    rollingReserveKobo,
    postStayDeferredKobo,
    riskRestrictedKobo,
    operatorCostsAndOffsetsKobo,
  };
}

/**
 * Criterion 1:
 * Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms use versioned provisional policy
 */
test("Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms use versioned provisional policy", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();

  // 1. Standard tier with Fast Payout (90/10)
  const standardReliability = createMockReliability({
    trailing60dCompletedBookings: 5,
    trailing180dCompletedBookings: 8,
    trailing60dReliabilityRate: 0.90,
    trailing180dReliabilityRate: 0.90
  });
  const standardEnforcement = createMockEnforcement();
  const standardManager = new ReservePayoutManager({
    reliabilityAuthority: standardReliability,
    enforcementAuthority: standardEnforcement,
    accountingRepository: accountingRepo
  });
  const releaseStandard = createCommittedProductionRelease(accountingRepo, { reservationId: "res-std-1" });

  const standard9010 = standardManager.calculatePayoutPlanAndReserve({
    revenueRelease: releaseStandard
  });

  assert.equal(standard9010.policyVersion, "v1.0-launch");
  assert.equal(standard9010.tier, "standard");
  assert.equal(standard9010.commissionBaseKobo, 11000000);
  assert.equal(standard9010.commissionKobo, 1320000);
  assert.equal(standard9010.operatorNetKobo, 9680000);
  assert.equal(standard9010.payableNowKobo, 8712000); // 90% payable
  assert.equal(standard9010.reserveTrancheKobo, 968000); // 10% reserve
  assert.equal(standard9010.payableNowKobo + standard9010.reserveTrancheKobo, standard9010.operatorNetKobo);

  // 2. Standard tier with Full Post-Stay: BEFORE +24h boundary (checkout = 2026-08-05T11:00:00Z -> eligible = 2026-08-06T11:00:00Z)
  const fullPostStayRelease = createCommittedProductionRelease(accountingRepo, {
    reservationId: "res-post-stay-1",
    payoutPlan: "full_post_stay",
    effectiveCheckoutAt: "2026-08-05T11:00:00.000Z"
  });

  // Querying before +24h (e.g. 2026-08-05T15:00:00Z) MUST NOT report payable
  const clockBefore = () => new Date("2026-08-05T15:00:00.000Z");
  const managerBefore = new ReservePayoutManager({
    reliabilityAuthority: standardReliability,
    enforcementAuthority: standardEnforcement,
    accountingRepository: accountingRepo,
    clock: clockBefore
  });
  const beforeResult = managerBefore.calculatePayoutPlanAndReserve({
    revenueRelease: fullPostStayRelease
  });
  assert.equal(beforeResult.payableNowKobo, 0);
  assert.equal(beforeResult.reserveTrancheKobo, 0);
  assert.equal(beforeResult.heldAmountKobo, 0); // Not a hold, but deferred
  assert.ok(beforeResult.overrideReasons.includes("post_stay_deferred_active"));

  // Querying AT OR AFTER +24h (e.g. 2026-08-06T12:00:00Z) posts balanced ledger transition and reports payable
  const clockAfter = () => new Date("2026-08-06T12:00:00.000Z");
  const managerAfter = new ReservePayoutManager({
    reliabilityAuthority: standardReliability,
    enforcementAuthority: standardEnforcement,
    accountingRepository: accountingRepo,
    clock: clockAfter
  });
  const afterResult = managerAfter.calculatePayoutPlanAndReserve({
    revenueRelease: fullPostStayRelease
  });
  assert.equal(afterResult.payableNowKobo, 9680000);
  assert.equal(afterResult.reserveTrancheKobo, 0);
  assert.equal(afterResult.heldAmountKobo, 0);

  // Check ledger adjustment committed
  const postStayAdjustments = accountingRepo.findAdjustmentsForRelease(fullPostStayRelease.releaseId);
  assert.equal(postStayAdjustments.length, 1);
  assert.equal(postStayAdjustments[0].reasonCode, "settlement_tier_standard_reclassification");

  // Replay does not duplicate adjustment
  managerAfter.calculatePayoutPlanAndReserve({
    revenueRelease: fullPostStayRelease
  });
  assert.equal(accountingRepo.findAdjustmentsForRelease(fullPostStayRelease.releaseId).length, 1);

  // 3. Proven tier terms (95/5)
  const provenReliability = createMockReliability({
    trailing60dCompletedBookings: 12,
    trailing60dReliabilityRate: 0.96,
    trailing180dCompletedBookings: 15,
    trailing180dReliabilityRate: 0.96
  });
  const provenManager = new ReservePayoutManager({
    reliabilityAuthority: provenReliability,
    enforcementAuthority: standardEnforcement,
    accountingRepository: accountingRepo
  });
  const releaseProven = createCommittedProductionRelease(accountingRepo, { reservationId: "res-proven-1" });
  const provenTerms = provenManager.calculatePayoutPlanAndReserve({
    revenueRelease: releaseProven
  });
  assert.equal(provenTerms.tier, "proven");
  assert.equal(provenTerms.payableNowKobo, 9196000); // 95% of 9,680,000
  assert.equal(provenTerms.reserveTrancheKobo, 484000); // 5% of 9,680,000

  // 4. Preferred tier terms (100% payout, 0% reserve) with captured 10% economics
  const preferredReliability = createMockReliability({
    trailing180dCompletedBookings: 35,
    trailing180dReliabilityRate: 0.99
  });
  const preferredManager = new ReservePayoutManager({
    reliabilityAuthority: preferredReliability,
    enforcementAuthority: standardEnforcement,
    accountingRepository: accountingRepo
  });
  const releasePreferred = createCommittedProductionRelease(accountingRepo, {
    reservationId: "res-pref-1",
    capturedCommissionRate: 0.1
  });
  const preferredTerms = preferredManager.calculatePayoutPlanAndReserve({
    revenueRelease: releasePreferred
  });
  assert.equal(preferredTerms.tier, "preferred");
  assert.equal(preferredTerms.commissionKobo, 1100000);
  assert.equal(preferredTerms.operatorNetKobo, 9900000);
  assert.equal(preferredTerms.payableNowKobo, 9900000);
  assert.equal(preferredTerms.reserveTrancheKobo, 0);

  // 5. Fail closed when Revenue Release is missing or uncommitted
  assert.throws(
    () => standardManager.calculatePayoutPlanAndReserve({} as unknown as { revenueRelease: ProductionRevenueReleaseRecord }),
    /Authoritative ProductionRevenueReleaseRecord is mandatory/
  );
  const uncommittedRelease = { ...releaseStandard, reservationId: "uncommitted-res", releaseId: "uncommitted-rel" };
  assert.throws(
    () => standardManager.calculatePayoutPlanAndReserve({ revenueRelease: uncommittedRelease }),
    /Committed Revenue Release not found/
  );
});

/**
 * Criterion 2:
 * Tier evaluation uses the accepted booking counts, observation periods, reliability thresholds, and enforcement state
 */
test("Tier evaluation uses the accepted booking counts, observation periods, reliability thresholds, and enforcement state", () => {
  const validRel = createMockReliability();
  const validEnf = createMockEnforcement();

  // 1. Missing reliability source fails closed
  const noRelManager = new ReservePayoutManager({ enforcementAuthority: validEnf });
  assert.throws(
    () => noRelManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" }),
    /Authoritative reliability authority is required/
  );

  // 2. Missing enforcement source fails closed
  const noEnfManager = new ReservePayoutManager({ reliabilityAuthority: validRel });
  assert.throws(
    () => noEnfManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" }),
    /Authoritative enforcement authority is required/
  );

  // 3. Both sources present allow evaluation - Preferred Tier (>=30 / 180d, >=98% reliability)
  const prefManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing180dCompletedBookings: 35,
      trailing180dReliabilityRate: 0.99
    }),
    enforcementAuthority: validEnf
  });
  const prefEval = prefManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(prefEval.tier, "preferred");

  // 4. Proven Tier: >= 10 bookings in 60d, reliability >= 0.95
  const provManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing60dCompletedBookings: 12,
      trailing60dReliabilityRate: 0.96,
      trailing180dCompletedBookings: 15,
      trailing180dReliabilityRate: 0.96
    }),
    enforcementAuthority: validEnf
  });
  const provEval = provManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(provEval.tier, "proven");

  // 5. Standard Tier: < 10 bookings in 60d
  const stdManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing60dCompletedBookings: 5,
      trailing60dReliabilityRate: 0.96,
      trailing180dCompletedBookings: 8,
      trailing180dReliabilityRate: 0.96
    }),
    enforcementAuthority: validEnf
  });
  const stdEval = stdManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(stdEval.tier, "standard");

  // 6. Active enforcement override forces Standard tier
  const enforcedManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing180dCompletedBookings: 35,
      trailing180dReliabilityRate: 0.99
    }),
    enforcementAuthority: createMockEnforcement({
      enforcementLevel: "restriction" as const,
      operatorStatus: "active_with_restrictions" as const
    })
  });
  const enforcedEval = enforcedManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(enforcedEval.tier, "standard");
  assert.equal(enforcedEval.overriddenByEnforcement, true);
});

/**
 * Criterion 3:
 * Reserve and payout projections reconcile to ledger entries and never promise unavailable or legally held funds
 */
test("Reserve and payout projections reconcile to ledger entries and never promise unavailable or legally held funds", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();
  const reliability = createMockReliability({
    trailing180dCompletedBookings: 35,
    trailing180dReliabilityRate: 0.99
  });
  const enforcement = createMockEnforcement();
  const manager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    accountingRepository: accountingRepo
  });

  const release = createCommittedProductionRelease(accountingRepo, {
    reservationId: "res-pref-reclass",
    capturedCommissionRate: 0.1,
    commissionableRevenueKobo: 11000000
  });

  // Preferred settlement reclassifies routine reserve to operator_payable in ledger
  const result = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release
  });

  assert.equal(result.tier, "preferred");
  assert.equal(result.payableNowKobo, 9900000);
  assert.equal(result.reserveTrancheKobo, 0);

  // Check that ledger reclassification adjustment is committed
  const adjustments = accountingRepo.findAdjustmentsForRelease(release.releaseId);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].reasonCode, "settlement_tier_preferred_reclassification");

  // Ledger state balances match projection exactly
  const balances = getBalances(accountingRepo, release.releaseId);
  assert.equal(balances.operatorPayableKobo, 9900000);
  assert.equal(balances.rollingReserveKobo, 0);
  assert.equal(balances.riskRestrictedKobo, 0);

  // Open risk / legal hold / open liabilities override payout acceleration and reclassify to risk_restricted
  const holdResult = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release,
    holds: {
      openRisk: true,
      openLiabilitiesKobo: 5000000,
      legalHold: false,
      providerRestriction: false
    }
  });

  assert.equal(holdResult.payoutAccelerated, false);
  assert.equal(holdResult.payableNowKobo, 0);
  assert.equal(holdResult.heldAmountKobo, 9900000); // Entire Operator Net held pending risk/liability resolution
  assert.ok(holdResult.overrideReasons.includes("open_risk"));
  assert.ok(holdResult.overrideReasons.includes("open_liabilities"));

  // Check ledger state under hold: payable was transferred to risk_restricted
  const holdBalances = getBalances(accountingRepo, release.releaseId);
  assert.equal(holdBalances.operatorPayableKobo, 0);
  assert.equal(holdBalances.rollingReserveKobo, 0);
  assert.equal(holdBalances.riskRestrictedKobo, 9900000);
});

/**
 * Criterion 4:
 * Downgrade, open liability, appeal, adjustment, and duplicate-release cases are covered behaviourally
 */
test("Downgrade, open liability, appeal, adjustment, and duplicate-release cases are covered behaviourally", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();
  const auditLog = new InMemoryAuditLog();
  const reliability = createMockReliability({
    trailing180dCompletedBookings: 35,
    trailing180dReliabilityRate: 0.99
  });
  let enforcement = createMockEnforcement();
  const scope = createMockScope({ operatorId: "op-100", tenantId: "tenant-lagos" });

  const manager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: {
      getProjections: (p) => enforcement.getProjections(p),
    },
    scopeAuthority: scope,
    accountingRepository: accountingRepo
  });

  // Commit release: Initial Fast Payout state (90% payable = 8,712,000, 10% reserve = 968,000)
  const release = createCommittedProductionRelease(accountingRepo, { reservationId: "res-transitions-1" });
  const releaseId = release.releaseId;

  // 1. Initial Preferred evaluation -> moves 10% reserve to payable (100% payable = 9,680,000, 0 reserve)
  const prefResult = manager.calculatePayoutPlanAndReserve({ revenueRelease: release });
  assert.equal(prefResult.tier, "preferred");
  assert.equal(prefResult.payableNowKobo, 9680000);
  assert.equal(prefResult.reserveTrancheKobo, 0);

  let b = getBalances(accountingRepo, releaseId);
  assert.equal(b.operatorPayableKobo, 9680000);
  assert.equal(b.rollingReserveKobo, 0);

  // 2. Enforcement Downgrade: Misconduct causes restriction -> downgrades to Standard (100/0 -> 90/10 reverse movement)
  enforcement = createMockEnforcement({
    enforcementLevel: "restriction" as const,
    operatorStatus: "active_with_restrictions" as const
  });

  const downgradedResult = manager.calculatePayoutPlanAndReserve({ revenueRelease: release });
  assert.equal(downgradedResult.tier, "standard");
  assert.equal(downgradedResult.payableNowKobo, 8712000);
  assert.equal(downgradedResult.reserveTrancheKobo, 968000);

  b = getBalances(accountingRepo, releaseId);
  assert.equal(b.operatorPayableKobo, 8712000);
  assert.equal(b.rollingReserveKobo, 968000);

  // 3. Open liability / active hold restricts settlement -> moves funds to risk_restricted
  const heldResult = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release,
    holds: { openLiabilitiesKobo: 2000000 }
  });
  assert.equal(heldResult.payoutAccelerated, false);
  assert.equal(heldResult.payableNowKobo, 0);
  assert.equal(heldResult.heldAmountKobo, 9680000);

  b = getBalances(accountingRepo, releaseId);
  assert.equal(b.operatorPayableKobo, 0);
  assert.equal(b.rollingReserveKobo, 0);
  assert.equal(b.riskRestrictedKobo, 9680000);

  // 4. Appeal pending also restricts settlement
  const appealResult = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release,
    holds: { appealPending: true }
  });
  assert.equal(appealResult.payableNowKobo, 0);
  assert.equal(appealResult.heldAmountKobo, 9680000);

  // 5. Pending adjustment restricts settlement
  const pendingAdjResult = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release,
    holds: { pendingAdjustment: true }
  });
  assert.equal(pendingAdjResult.payableNowKobo, 0);
  assert.equal(pendingAdjResult.heldAmountKobo, 9680000);

  // 6. Restriction Cleared & Enforcement Cleared -> restores Preferred 100/0 classification from risk_restricted
  enforcement = createMockEnforcement(); // Cleared
  const restoredResult = manager.calculatePayoutPlanAndReserve({ revenueRelease: release });
  assert.equal(restoredResult.tier, "preferred");
  assert.equal(restoredResult.payableNowKobo, 9680000);
  assert.equal(restoredResult.reserveTrancheKobo, 0);
  assert.equal(restoredResult.heldAmountKobo, 0);

  b = getBalances(accountingRepo, releaseId);
  assert.equal(b.operatorPayableKobo, 9680000);
  assert.equal(b.rollingReserveKobo, 0);
  assert.equal(b.riskRestrictedKobo, 0);

  // 7. Reserve tranche duplicate-release prevention and atomic movements
  const tranche: ReserveTranche = {
    trancheId: "tr-downgrade-1",
    reservationId: "res-transitions-1",
    operatorId: "op-100",
    tenantId: "tenant-lagos",
    amountKobo: 968000,
    checkoutDateIso: "2026-08-10T11:00:00Z",
    maturityDateIso: "2026-09-09T11:00:00Z",
    status: "held",
    policyVersion: "v1.0-launch"
  };
  manager.registerReserveTranche(tranche);

  // Normal tranche release
  const released = manager.releaseReserveTranche("tr-downgrade-1", "2026-09-10T00:00:00Z", {}, auditLog);
  assert.equal(released.status, "released");

  // Duplicate release attempt fails closed
  assert.throws(
    () => manager.releaseReserveTranche("tr-downgrade-1", "2026-09-10T00:00:00Z", {}, auditLog),
    /Duplicate release attempted/
  );

  // 8. Mandatory OperatorScopeAuthority on financial commands (missing scope authority fails closed)
  const noScopeManager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    accountingRepository: accountingRepo
  });
  const holdCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "Missing scope test"
    },
    idempotencyKey: "idem-no-scope"
  });
  assert.throws(
    () => noScopeManager.processAdminPayoutOverride(holdCmd),
    /Authoritative OperatorScopeAuthority is mandatory/
  );

  // Wrong operator / tenant fails closed
  const wrongOpCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-wrong",
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "Wrong operator test"
    },
    idempotencyKey: "idem-wrong-op"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(wrongOpCmd),
    /Operator op-wrong does not belong to tenant tenant-lagos/
  );

  // Valid scope succeeds
  const validHoldCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "Risk inspection"
    },
    idempotencyKey: "idem-valid-hold-1"
  });
  const holdRecord = manager.processAdminPayoutOverride(validHoldCmd);
  assert.equal(holdRecord.holdActive, true);

  // Replaying with identical key returns idempotent result
  const replayHoldRecord = manager.processAdminPayoutOverride(validHoldCmd);
  assert.equal(replayHoldRecord.holdActive, true);

  // Conflicting idempotency key reuse fails closed
  const conflictCmd = {
    ...validHoldCmd,
    payload: {
      ...validHoldCmd.payload,
      reason: "Changed reason"
    }
  };
  assert.throws(
    () => manager.processAdminPayoutOverride(conflictCmd),
    /Idempotency key was reused for a different command/
  );
});
