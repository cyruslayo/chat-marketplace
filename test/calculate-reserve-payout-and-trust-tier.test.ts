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
  journal,
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

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0062, ADR 0063, ADR 0064, ADR 0066, ADR 0072, ADR 0075, ADR 0083
 */
test("Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms consume authoritative Revenue Release economics and enforce timing", () => {
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
    revenueRelease: releaseStandard,
    standardPayoutPreference: "fast_payout"
  });

  assert.equal(standard9010.policyVersion, "v1.0-launch");
  assert.equal(standard9010.tier, "standard");
  assert.equal(standard9010.commissionBaseKobo, 11000000);
  assert.equal(standard9010.commissionKobo, 1320000);
  assert.equal(standard9010.operatorNetKobo, 9680000);
  assert.equal(standard9010.payableNowKobo, 8712000); // 90% payable
  assert.equal(standard9010.reserveTrancheKobo, 968000); // 10% reserve
  assert.equal(standard9010.payableNowKobo + standard9010.reserveTrancheKobo, standard9010.operatorNetKobo);

  // 2. Standard tier with Full Post-Stay choice: BEFORE +24h boundary (checkout = 2026-08-05T11:00:00Z -> eligible = 2026-08-06T11:00:00Z)
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
    revenueRelease: fullPostStayRelease,
    standardPayoutPreference: "full_post_stay"
  });
  assert.equal(beforeResult.payableNowKobo, 0);
  assert.equal(beforeResult.reserveTrancheKobo, 0);
  assert.equal(beforeResult.heldAmountKobo, 9680000);
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
    revenueRelease: fullPostStayRelease,
    standardPayoutPreference: "full_post_stay"
  });
  assert.equal(afterResult.payableNowKobo, 9680000);
  assert.equal(afterResult.reserveTrancheKobo, 0);
  assert.equal(afterResult.heldAmountKobo, 0);

  // Check ledger adjustment committed
  const postStayAdjustments = accountingRepo.findAdjustmentsForRelease(fullPostStayRelease.releaseId);
  assert.equal(postStayAdjustments.length, 1);
  assert.equal(postStayAdjustments[0].reasonCode, "post_stay_deferred_released_to_payable");

  // Replay does not duplicate adjustment
  managerAfter.calculatePayoutPlanAndReserve({
    revenueRelease: fullPostStayRelease,
    standardPayoutPreference: "full_post_stay"
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

  // 5. Fail closed when Revenue Release is missing
  assert.throws(
    () => standardManager.calculatePayoutPlanAndReserve({} as any),
    /Authoritative ProductionRevenueReleaseRecord is mandatory/
  );
});

test("Tier evaluation strictly requires both authoritative reliability and enforcement sources", () => {
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

  // 3. Both sources present allow evaluation - Preferred Tier
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
  assert.equal(adjustments[0].reasonCode, "trust_tier_preferred_reclassification");

  // Open risk / legal hold / open liabilities override payout acceleration and prevent reclassification
  const releaseWithHold = createCommittedProductionRelease(accountingRepo, {
    reservationId: "res-pref-hold",
    capturedCommissionRate: 0.1,
    commissionableRevenueKobo: 11000000
  });

  const overriddenPayout = manager.calculatePayoutPlanAndReserve({
    revenueRelease: releaseWithHold,
    holds: {
      openRisk: true,
      openLiabilitiesKobo: 5000000,
      legalHold: false,
      providerRestriction: false
    }
  });

  assert.equal(overriddenPayout.payoutAccelerated, false);
  assert.equal(overriddenPayout.payableNowKobo, 0);
  assert.equal(overriddenPayout.heldAmountKobo, 9900000); // Entire Operator Net held pending risk/liability resolution
  assert.ok(overriddenPayout.overrideReasons.includes("open_risk"));
  assert.ok(overriddenPayout.overrideReasons.includes("open_liabilities"));
});

test("Reserve movements are strictly ledger-atomic, fail closed on accounting error, and require mandatory idempotency & tenant scope", () => {
  const accountingRepo = new InMemoryRevenueAccountingRepository();
  const auditLog = new InMemoryAuditLog();
  const reliability = createMockReliability();
  const enforcement = createMockEnforcement();
  const scope = createMockScope({ operatorId: "op-100", tenantId: "tenant-lagos" });
  const manager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    scopeAuthority: scope,
    accountingRepository: accountingRepo
  });

  // Commit release in accounting repo to ensure balanced ledger tracking
  const release = createCommittedProductionRelease(accountingRepo, { reservationId: "res-501" });
  const releaseId = release.releaseId;

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

  // Failure path: Missing accounting repository fails closed
  const noRepoManager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    scopeAuthority: scope
  });
  noRepoManager.registerReserveTranche({ ...tranche, trancheId: "tr-no-repo" });
  assert.throws(
    () => noRepoManager.releaseReserveTranche("tr-no-repo", "2026-09-10T00:00:00Z"),
    /Authoritative RevenueAccountingRepository is required/
  );

  // Failure path: Ledger write failure leaves tranche held
  const brokenRepo: any = {
    postAdjustment: () => {
      throw new Error("Ledger database disk full");
    }
  };
  const brokenRepoManager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    scopeAuthority: scope,
    accountingRepository: brokenRepo
  });
  brokenRepoManager.registerReserveTranche({ ...tranche, trancheId: "tr-broken-ledger" });
  assert.throws(
    () => brokenRepoManager.releaseReserveTranche("tr-broken-ledger", "2026-09-10T00:00:00Z"),
    /Ledger database disk full/
  );
  assert.equal(brokenRepoManager.getReserveTranche("tr-broken-ledger")?.status, "held");
  assert.equal(brokenRepoManager.getReserveTranche("tr-broken-ledger")?.releasedAtIso, undefined);

  // Success path: Release after maturity reconciles balanced movement
  const released = manager.releaseReserveTranche("tr-101", "2026-09-10T00:00:00Z", {}, auditLog);
  assert.equal(released.status, "released");
  assert.equal(released.releasedAtIso, "2026-09-10T00:00:00Z");
  assert.ok(released.ledgerJournalId);

  const adjustments = accountingRepo.findAdjustmentsForRelease(releaseId);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].reasonCode, "reserve_tranche_released_to_payable");

  // Mandatory idempotency on financial commands
  const missingIdemCmd = {
    ...createPlatformCommandEnvelope({
      commandName: "reserve.override_payout_hold",
      principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
      payload: {
        operatorId: "op-100",
        tenantId: "tenant-lagos",
        action: "apply_hold" as const,
        reason: "Missing idempotency test"
      },
    }),
    idempotencyKey: undefined
  };
  assert.throws(
    () => manager.processAdminPayoutOverride(missingIdemCmd as any),
    /Idempotency key is required/
  );

  // Tenant mismatch on financial command fails closed
  const tenantMismatchCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-abuja", // Mismatched payload tenant!
      action: "apply_hold" as const,
      reason: "Tenant mismatch test"
    },
    idempotencyKey: "idem-mismatch-1"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(tenantMismatchCmd),
    /Principal tenant does not match resource tenant/
  );

  // Authoritative scope check: Operator in different tenant cannot be acted upon by spoofing payload
  const crossTenantScope = createMockScope({ operatorId: "op-other", tenantId: "tenant-other" });
  const crossTenantManager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    enforcementAuthority: enforcement,
    scopeAuthority: crossTenantScope,
    accountingRepository: accountingRepo
  });
  const crossTenantCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100", // Not in tenant-lagos according to crossTenantScope!
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "Cross-tenant test"
    },
    idempotencyKey: "idem-cross-tenant-1"
  });
  assert.throws(
    () => crossTenantManager.processAdminPayoutOverride(crossTenantCmd),
    /Operator op-100 does not belong to tenant tenant-lagos/
  );

  // Agent role rejection (ADR 0072 & ADR 0083)
  const agentCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "agent-bot", role: "agent", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "AI agent decision"
    },
    idempotencyKey: "idem-override-agent"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(agentCmd),
    /Admin authority required/
  );

  // System role rejection
  const systemCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "cron-system", role: "system", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-lagos",
      action: "apply_hold" as const,
      reason: "Automated hold"
    },
    idempotencyKey: "idem-override-system"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(systemCmd),
    /Admin authority required/
  );
});
