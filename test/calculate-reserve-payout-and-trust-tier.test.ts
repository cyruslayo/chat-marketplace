import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope, InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  ReservePayoutManager,
  type AuthoritativeReliabilityRecord,
  type OperatorReliabilityAuthority,
  type OperatorEnforcementAuthority,
  type ReserveTranche
} from "../domains/shortlet/src/reserve-payout-trust.js";
import {
  InMemoryRevenueAccountingRepository,
  journal,
  type RevenueLedgerLine
} from "../domains/shortlet/src/revenue-accounting.js";
import type { ProductionRevenueReleaseRecord } from "../domains/shortlet/src/revenue-release.js";

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

function createMockRevenueRelease(overrides: Partial<ProductionRevenueReleaseRecord> = {}): ProductionRevenueReleaseRecord {
  return {
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
    commissionRate: 0.12, // Standard 12% captured rate
    commissionBaseKobo: 11000000, // ₦110,000
    commissionKobo: 1320000, // ₦13,200
    operatorNetKobo: 9680000, // ₦96,800
    payoutPlan: "fast_payout",
    payoutPlanVersion: "v1",
    payableNowKobo: 8712000,
    routineReserveTrancheKobo: 968000,
    deferredPostStayKobo: 0,
    riskHoldVersion: "v1",
    riskHoldKobo: 0,
    ledgerJournalId: "j-501",
    earnedCommissionRecordId: "ec-501",
    effectiveCheckoutVersion: "v1",
    releasedAt: "2026-08-02T12:00:00Z",
    currency: "NGN",
    ...overrides
  };
}

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0062, ADR 0063, ADR 0064, ADR 0066, ADR 0072, ADR 0075, ADR 0083
 */
test("Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms consume authoritative Revenue Release economics", () => {
  // 1. Standard tier with Fast Payout (90/10)
  const standardReliability = createMockReliability({
    trailing60dCompletedBookings: 5,
    trailing180dCompletedBookings: 8,
    trailing60dReliabilityRate: 0.90,
    trailing180dReliabilityRate: 0.90
  });
  const standardManager = new ReservePayoutManager({ reliabilityAuthority: standardReliability });
  const releaseStandard = createMockRevenueRelease();

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

  // 2. Standard tier with Full Post-Stay choice (100% deferred)
  const standardPostCheckout = standardManager.calculatePayoutPlanAndReserve({
    revenueRelease: releaseStandard,
    standardPayoutPreference: "full_post_stay"
  });
  assert.equal(standardPostCheckout.payableNowKobo, 9680000);
  assert.equal(standardPostCheckout.reserveTrancheKobo, 0);

  // 3. Proven tier terms (95/5)
  const provenReliability = createMockReliability({
    trailing60dCompletedBookings: 12,
    trailing60dReliabilityRate: 0.96,
    trailing180dCompletedBookings: 15,
    trailing180dReliabilityRate: 0.96
  });
  const provenManager = new ReservePayoutManager({ reliabilityAuthority: provenReliability });
  const provenTerms = provenManager.calculatePayoutPlanAndReserve({
    revenueRelease: releaseStandard
  });
  assert.equal(provenTerms.tier, "proven");
  assert.equal(provenTerms.payableNowKobo, 9196000); // 95% of 9,680,000
  assert.equal(provenTerms.reserveTrancheKobo, 484000); // 5% of 9,680,000

  // 4. Preferred tier terms (100% payout, 0% reserve) with captured 10% economics
  const preferredReliability = createMockReliability({
    trailing180dCompletedBookings: 35,
    trailing180dReliabilityRate: 0.99
  });
  const preferredManager = new ReservePayoutManager({ reliabilityAuthority: preferredReliability });
  const releasePreferred = createMockRevenueRelease({
    commissionRate: 0.1,
    commissionKobo: 1100000,
    operatorNetKobo: 9900000
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

test("Tier evaluation strictly requires authoritative reliability and enforcement sources", () => {
  // 1. Missing reliability source fails closed
  const noSourceManager = new ReservePayoutManager();
  assert.throws(
    () => noSourceManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" }),
    /Authoritative reliability authority is required/
  );

  // 2. Preferred Tier: >= 30 bookings in 180d, reliability >= 0.98, no enforcement
  const prefManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing180dCompletedBookings: 35,
      trailing180dReliabilityRate: 0.99
    })
  });
  const prefEval = prefManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(prefEval.tier, "preferred");

  // 3. Proven Tier: >= 10 bookings in 60d, reliability >= 0.95
  const provManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing60dCompletedBookings: 12,
      trailing60dReliabilityRate: 0.96,
      trailing180dCompletedBookings: 15,
      trailing180dReliabilityRate: 0.96
    })
  });
  const provEval = provManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(provEval.tier, "proven");

  // 4. Standard Tier: < 10 bookings in 60d
  const stdManager = new ReservePayoutManager({
    reliabilityAuthority: createMockReliability({
      trailing60dCompletedBookings: 5,
      trailing60dReliabilityRate: 0.96,
      trailing180dCompletedBookings: 8,
      trailing180dReliabilityRate: 0.96
    })
  });
  const stdEval = stdManager.evaluateOperatorTrustTier({ operatorId: "op-100", tenantId: "tenant-lagos" });
  assert.equal(stdEval.tier, "standard");

  // 5. Active enforcement override forces Standard tier
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
  const reliability = createMockReliability();
  const manager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    accountingRepository: accountingRepo
  });

  const release = createMockRevenueRelease({
    commissionRate: 0.1,
    commissionKobo: 1100000,
    operatorNetKobo: 9900000
  });

  // Open risk / legal hold / open liabilities override payout acceleration
  const overriddenPayout = manager.calculatePayoutPlanAndReserve({
    revenueRelease: release,
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
  const manager = new ReservePayoutManager({
    reliabilityAuthority: reliability,
    accountingRepository: accountingRepo
  });

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

  // Failure path: Missing accounting repository fails closed
  const noRepoManager = new ReservePayoutManager({ reliabilityAuthority: reliability });
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
    () => manager.processAdminPayoutOverride(missingIdemCmd),
    /Idempotency key is required/
  );

  // Tenant mismatch on financial command fails closed
  const tenantMismatchCmd = createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold",
    principal: { id: "admin-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      operatorId: "op-100",
      tenantId: "tenant-abuja", // Mismatched tenant!
      action: "apply_hold" as const,
      reason: "Tenant mismatch test"
    },
    idempotencyKey: "idem-mismatch-1"
  });
  assert.throws(
    () => manager.processAdminPayoutOverride(tenantMismatchCmd),
    /Principal tenant does not match resource tenant/
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
