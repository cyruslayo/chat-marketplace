import test from "node:test";
import assert from "node:assert/strict";
import {
  OperatorUsabilityAndUnitEconomicsValidator,
  UsabilityFinding,
  UnitEconomicsInputs,
  PolicyOutcome
} from "../domains/shortlet/src/operator-unit-economics.js";

test("Representative prospective Operators complete scenario-based walkthroughs and usability findings are recorded with severity and frequency.", () => {
  const validator = new OperatorUsabilityAndUnitEconomicsValidator();

  const findingLagos: UsabilityFinding = {
    findingId: "find-lagos-01",
    area: "onboarding",
    description: "Physical inspection upload window requires clearer guidance on file sizes",
    severity: "medium",
    frequency: 3,
    location: "Lagos"
  };

  const findingAbuja: UsabilityFinding = {
    findingId: "find-abuja-01",
    area: "calendar",
    description: "Calendar hold expiry notification latency during peak active hours",
    severity: "high",
    frequency: 2,
    location: "Abuja"
  };

  validator.recordUsabilityFinding(findingLagos);
  validator.recordUsabilityFinding(findingAbuja);

  const findings = validator.getUsabilityFindings();
  assert.equal(findings.length, 2);
  assert.equal(findings[0].location, "Lagos");
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[1].location, "Abuja");
  assert.equal(findings[1].frequency, 2);

  assert.throws(
    () => validator.recordUsabilityFinding({ ...findingLagos, description: "" }),
    /Usability finding must include description and area/
  );
});

test("Economics model includes payment cost, refund, fraud, inspection, support, relocation, protection fund, reserves, taxes, and expected booking mix.", () => {
  const validator = new OperatorUsabilityAndUnitEconomicsValidator();

  const inputs: UnitEconomicsInputs = {
    grossBookingValueKobo: 10000000,
    pspFeePercent: 1.5,
    expectedRefundRate: 2.0,
    fraudLossRate: 0.5,
    inspectionAmortizationKobo: 100000,
    supportCostPerStayKobo: 150000,
    relocationExposureKobo: 50000,
    protectionFundContributionRate: 1.0,
    rollingReserveRate: 10.0,
    taxVatRate: 7.5,
    platformCommissionRate: 15.0
  };

  const report = validator.modelUnitEconomics(inputs);

  assert.equal(report.netPlatformRevenueKobo, 1500000);
  assert.ok(report.totalCostsKobo > 0);
  assert.equal(typeof report.contributionMarginKobo, "number");
  assert.equal(report.isViable, true);
});

test("Commission, founding duration, deposit caps, fund parameters, relocation limits, and payout tiers receive explicit validate/change outcomes.", () => {
  const validator = new OperatorUsabilityAndUnitEconomicsValidator();

  const commissionOutcome: PolicyOutcome = {
    parameter: "commission_rate",
    outcome: "validate",
    affectedAdr: "ADR 0062",
    rationale: "15% launch commission validated against PSP and operational cost modeling"
  };

  const depositOutcome: PolicyOutcome = {
    parameter: "deposit_caps",
    outcome: "change",
    affectedAdr: "ADR 0016",
    rationale: "Increase studio cap based on Abuja operator feedback",
    proposedValue: 12000000
  };

  const payoutOutcome: PolicyOutcome = {
    parameter: "payout_tiers",
    outcome: "validate",
    affectedAdr: "ADR 0026",
    rationale: "Fast Payout 90% / 10% reserve structure validated for launch"
  };

  validator.evaluatePolicyOutcome(commissionOutcome);
  validator.evaluatePolicyOutcome(depositOutcome);
  validator.evaluatePolicyOutcome(payoutOutcome);

  const outcomes = validator.getPolicyOutcomes();
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes.find(o => o.parameter === "commission_rate")?.outcome, "validate");
  assert.equal(outcomes.find(o => o.parameter === "deposit_caps")?.outcome, "change");
});

test("Any proposed change identifies the affected ADR and does not reopen unrelated launch policy implicitly.", () => {
  const validator = new OperatorUsabilityAndUnitEconomicsValidator();

  assert.throws(
    () => validator.evaluatePolicyOutcome({
      parameter: "commission_rate",
      outcome: "validate",
      affectedAdr: "ADR 0014",
      rationale: "Invalid ADR association"
    }),
    /Policy parameter 'commission_rate' must affect ADR 0062/
  );

  assert.throws(
    () => validator.evaluatePolicyOutcome({
      parameter: "relocation_limits",
      outcome: "change",
      affectedAdr: "ADR 0028",
      rationale: ""
    }),
    /Change outcome requires rationale and proposedValue/
  );
});
