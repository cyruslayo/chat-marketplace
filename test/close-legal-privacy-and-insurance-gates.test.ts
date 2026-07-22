import test from "node:test";
import assert from "node:assert/strict";
import {
  LegalTaxPrivacyGateValidator,
  LegalTaxAdviceRecord,
  DpiaApprovalRecord,
  LicensingAndInsuranceConfirmation,
  LegalTaxAdrProposal
} from "../domains/shortlet/src/legal-privacy-gates.js";

test("Legal and tax advice identifies jurisdiction, source date, assumptions, unresolved questions, owner, and required product or operational change.", () => {
  const validator = new LegalTaxPrivacyGateValidator();

  const validAdvice: LegalTaxAdviceRecord = {
    adviceId: "adv-leg-001",
    jurisdiction: "Nigeria (Lagos & FCT)",
    sourceDate: "2026-07-20T00:00:00.000Z",
    assumptions: ["Shortlet operator acts as contracting provider under ADR 0006"],
    unresolvedQuestions: ["FCT municipal licensing fee timeline"],
    owner: "Lead Legal Counsel",
    requiredChanges: [
      {
        changeId: "chg-01",
        description: "Add WHT 5% withholding breakdown on operator payout summary",
        type: "product",
        targetComponent: "revenue-release"
      }
    ]
  };

  const record = validator.recordLegalTaxAdvice(validAdvice);
  assert.equal(record.adviceId, "adv-leg-001");
  assert.equal(record.jurisdiction, "Nigeria (Lagos & FCT)");
  assert.equal(record.requiredChanges.length, 1);

  const status = validator.getGateStatusSummary();
  assert.equal(status.legalTaxAdviceGateClosed, true);

  // Failure path: missing assumptions or jurisdiction
  assert.throws(
    () =>
      validator.recordLegalTaxAdvice({
        ...validAdvice,
        assumptions: []
      }),
    /Legal advice must include jurisdiction, sourceDate, assumptions, owner, and requiredChanges/
  );
});

test("DPIA, provider roles, retention schedule, restricted-data flows, and human-intervention controls receive documented approval.", () => {
  const validator = new LegalTaxPrivacyGateValidator();

  const validDpia: DpiaApprovalRecord = {
    dpiaId: "dpia-2026-01",
    approver: "Data Protection Officer",
    approvalDate: "2026-07-21T00:00:00.000Z",
    providerRolesConfirmed: true,
    retentionScheduleApproved: true,
    restrictedDataFlowsApproved: true,
    humanInterventionControlsApproved: true,
    documentedApprovalEvidence: "REF-DPIA-APP-2026-SIGNED"
  };

  const record = validator.recordDpiaApproval(validDpia);
  assert.equal(record.dpiaId, "dpia-2026-01");
  assert.equal(record.restrictedDataFlowsApproved, true);

  const status = validator.getGateStatusSummary();
  assert.equal(status.dpiaPrivacyGateClosed, true);

  // Failure path: restricted data flows or human intervention not approved
  assert.throws(
    () =>
      validator.recordDpiaApproval({
        ...validDpia,
        restrictedDataFlowsApproved: false
      }),
    /DPIA approval requires confirmation of provider roles, retention schedule, restricted data flows, and human intervention controls/
  );
});

test("Required licensing, registration, and insurance wording, exclusions, evidence, limits, renewals, and claims process are confirmed.", () => {
  const validator = new LegalTaxPrivacyGateValidator();

  const validConfirmation: LicensingAndInsuranceConfirmation = {
    confirmationId: "lic-ins-001",
    lagosRegistrationConfirmed: true,
    fctLicensingConfirmed: true,
    insuranceWordingConfirmed: true,
    exclusionsConfirmed: true,
    evidenceConfirmed: true,
    limitsConfirmed: true,
    renewalsConfirmed: true,
    claimsProcessConfirmed: true,
    DocumentedEvidenceRef: "EVID-LIC-INS-2026-FINAL"
  };

  const record = validator.confirmLicensingAndInsurance(validConfirmation);
  assert.equal(record.confirmationId, "lic-ins-001");

  const status = validator.getGateStatusSummary();
  assert.equal(status.licensingInsuranceGateClosed, true);

  // Failure path: unconfirmed exclusions or missing evidence
  assert.throws(
    () =>
      validator.confirmLicensingAndInsurance({
        ...validConfirmation,
        exclusionsConfirmed: false
      }),
    /Licensing and insurance confirmation requires all regulatory, wording, exclusion, limit, renewal, and claim terms to be confirmed with evidence/
  );
});

test("Provisional tax, insurance, and retention values are validated or returned through explicit ADR change proposals.", () => {
  const validator = new LegalTaxPrivacyGateValidator();

  // Populate first 3 gates
  validator.recordLegalTaxAdvice({
    adviceId: "adv-01",
    jurisdiction: "Nigeria (Lagos & FCT)",
    sourceDate: "2026-07-20",
    assumptions: ["Valid"],
    unresolvedQuestions: [],
    owner: "Legal",
    requiredChanges: []
  });
  validator.recordDpiaApproval({
    dpiaId: "dpia-01",
    approver: "DPO",
    approvalDate: "2026-07-21",
    providerRolesConfirmed: true,
    retentionScheduleApproved: true,
    restrictedDataFlowsApproved: true,
    humanInterventionControlsApproved: true,
    documentedApprovalEvidence: "EVID-DPIA"
  });
  validator.confirmLicensingAndInsurance({
    confirmationId: "lic-01",
    lagosRegistrationConfirmed: true,
    fctLicensingConfirmed: true,
    insuranceWordingConfirmed: true,
    exclusionsConfirmed: true,
    evidenceConfirmed: true,
    limitsConfirmed: true,
    renewalsConfirmed: true,
    claimsProcessConfirmed: true,
    DocumentedEvidenceRef: "EVID-INS"
  });

  const vatProposal: LegalTaxAdrProposal = {
    parameter: "tax_vat_rate",
    outcome: "validate",
    affectedAdr: "ADR 0063",
    rationale: "7.5% VAT validated for shortlet fees"
  };

  const retentionProposal: LegalTaxAdrProposal = {
    parameter: "data_retention_days",
    outcome: "change",
    affectedAdr: "ADR 0075",
    rationale: "Align identity retention to 90 days following guest legal review",
    proposedValue: 90
  };

  validator.evaluateAdrProposal(vatProposal);
  validator.evaluateAdrProposal(retentionProposal);

  const summary = validator.getGateStatusSummary();
  assert.equal(summary.adrProposalsValidated, true);
  assert.equal(summary.isLaunchGateClosed, true);

  // Failure path 1: wrong ADR mapping
  assert.throws(
    () =>
      validator.evaluateAdrProposal({
        parameter: "protection_fund_limit",
        outcome: "validate",
        affectedAdr: "ADR 0001",
        rationale: "Mismatched ADR"
      }),
    /Policy parameter 'protection_fund_limit' must affect ADR 0027 or ADR 0063/
  );

  // Failure path 2: change outcome missing rationale or proposedValue
  assert.throws(
    () =>
      validator.evaluateAdrProposal({
        parameter: "tax_wht_rate",
        outcome: "change",
        affectedAdr: "ADR 0001",
        rationale: ""
      }),
    /Change outcome requires non-empty rationale and proposedValue/
  );
});
