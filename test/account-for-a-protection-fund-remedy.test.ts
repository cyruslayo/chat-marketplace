import test from "node:test";
import assert from "node:assert/strict";
import { ProtectionFundManager } from "../domains/shortlet/src/protection-fund-remedy.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";

test("Seed, contribution, target, approval, and available-balance rules use versioned provisional policy.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new ProtectionFundManager({ auditLog: audit });

  // Verify versioned policy evaluation (ADR 0027, ADR 0063)
  const policy = manager.getPolicy();
  assert.equal(policy.policyVersion, "gpf-v1.0-launch");
  assert.equal(policy.contributionRateBeforeTarget, 0.10);
  assert.equal(policy.contributionRateAfterTarget, 0.02);

  // Seed capital rule: greatest of ₦5m (500,000,000 kobo), 3 * P95, or 1% GBV
  const seedAmount = manager.calculateSeedCapital({
    projectedP95ExposureKobo: 100000000, // ₦1m -> 3*P95 = ₦3m
    next90DayGbvKobo: 40000000000 // ₦400m -> 1% = ₦4m
  });
  assert.equal(seedAmount, 500000000); // ₦5m wins as minimum

  // Seed the fund
  manager.seedFund({ seedAmountKobo: seedAmount });
  assert.equal(manager.getAvailableBalanceKobo(), 500000000);

  // Contribution rule: 10% until target
  manager.recordCommissionContribution({ earnedCommissionKobo: 10000000 }); // ₦100k commission -> 10% = ₦10k (1,000,000 kobo)
  assert.equal(manager.getAvailableBalanceKobo(), 501000000); // 500m + 1m = 501m kobo

  // Approval tier rules
  const routineEval = manager.validateRemedyApproval({
    originalPriceKobo: 10000000,
    priceDiffKobo: 2000000, // 20% diff <= 25%
    transportCostKobo: 3000000, // ₦30k <= ₦50k
    approvals: [{ userId: "usr-1", role: "support_agent" }]
  });
  assert.equal(routineEval.valid, true);
  assert.equal(routineEval.tier, "routine");

  const failedRoutineEval = manager.validateRemedyApproval({
    originalPriceKobo: 10000000,
    priceDiffKobo: 4000000, // 40% diff > 25% -> requires senior ops + finance
    transportCostKobo: 3000000,
    approvals: [{ userId: "usr-1", role: "support_agent" }]
  });
  assert.equal(failedRoutineEval.valid, false);
  assert.equal(failedRoutineEval.tier, "senior");
  assert.match(failedRoutineEval.error!, /Senior relocation requires both senior operations and finance approvals/);
});

test("Every movement posts balanced ledger entries with incident, booking, decision, and funding correlation.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new ProtectionFundManager({ auditLog: audit });
  manager.seedFund({ seedAmountKobo: 500000000 });

  const record = manager.disburseRemedy({
    incidentId: "inc-101",
    bookingId: "bk-202",
    decisionId: "dec-303",
    remedyAmountKobo: 15000000,
    operatorLiabilityKobo: 15000000,
    approvals: [{ userId: "mgr-1", role: "routine_operations" }],
    fundingSource: "guest_protection_fund"
  });

  assert.equal(record.ledgerEntry.balanced, true);
  assert.equal(record.ledgerEntry.incidentId, "inc-101");
  assert.equal(record.ledgerEntry.bookingId, "bk-202");
  assert.equal(record.ledgerEntry.decisionId, "dec-303");
  assert.equal(record.ledgerEntry.fundingSource, "guest_protection_fund");

  // Verify total debits === total credits
  const totalDebits = record.ledgerEntry.lines.reduce((s, l) => s + l.debitKobo, 0);
  const totalCredits = record.ledgerEntry.lines.reduce((s, l) => s + l.creditKobo, 0);
  assert.equal(totalDebits, totalCredits);
  assert.equal(totalDebits, 15000000);
});

test("Insufficient fund balance does not erase the approved guest remedy or Refund Fallback workflow.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new ProtectionFundManager({ auditLog: audit });
  // Start with 0 available fund balance
  assert.equal(manager.getAvailableBalanceKobo(), 0);

  const record = manager.disburseRemedy({
    incidentId: "inc-999",
    bookingId: "bk-999",
    decisionId: "dec-999",
    remedyAmountKobo: 20000000,
    operatorLiabilityKobo: 20000000,
    approvals: [{ userId: "mgr-1", role: "routine_operations" }],
    fundingSource: "guest_protection_fund"
  });

  // Remedy is still approved and guaranteed!
  assert.equal(record.remedyApproved, true);
  assert.equal(record.refundFallbackGuaranteed, true);
  assert.equal(record.fundDeficitKobo, 20000000);
  assert.equal(record.remedyDisbursedKobo, 20000000);
});

test("Finance can see exposure and recovery without accessing unrelated interaction or identity data.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new ProtectionFundManager({ auditLog: audit });
  manager.seedFund({ seedAmountKobo: 500000000 });

  manager.disburseRemedy({
    incidentId: "inc-300",
    bookingId: "bk-300",
    decisionId: "dec-300",
    remedyAmountKobo: 10000000,
    operatorLiabilityKobo: 10000000,
    approvals: [{ userId: "ops-1", role: "routine_operations" }],
    fundingSource: "guest_protection_fund"
  });

  manager.recordOperatorRecovery({
    incidentId: "inc-300",
    bookingId: "bk-300",
    recoveredAmountKobo: 5000000
  });

  const report = manager.getFinanceExposureReport();
  assert.equal(report.totalExposureKobo, 10000000);
  assert.equal(report.totalRecoveredKobo, 5000000);
  assert.equal(report.outstandingLiabilityKobo, 5000000);

  // Redaction check: Ensure no interaction chat text, guest PII, or credentials are present
  const reportString = JSON.stringify(report);
  assert.equal(reportString.includes("chatMessage"), false);
  assert.equal(reportString.includes("guestEmail"), false);
  assert.equal(reportString.includes("guestPhone"), false);
  assert.equal(reportString.includes("bearerToken"), false);
});
