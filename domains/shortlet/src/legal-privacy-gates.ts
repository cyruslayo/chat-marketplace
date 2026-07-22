export interface ProductOrOperationalChange {
  readonly changeId: string;
  readonly description: string;
  readonly type: "product" | "operational";
  readonly targetComponent: string;
}

export interface LegalTaxAdviceRecord {
  readonly adviceId: string;
  readonly jurisdiction: string;
  readonly sourceDate: string;
  readonly assumptions: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly owner: string;
  readonly requiredChanges: readonly ProductOrOperationalChange[];
}

export interface DpiaApprovalRecord {
  readonly dpiaId: string;
  readonly approver: string;
  readonly approvalDate: string;
  readonly providerRolesConfirmed: boolean;
  readonly retentionScheduleApproved: boolean;
  readonly restrictedDataFlowsApproved: boolean;
  readonly humanInterventionControlsApproved: boolean;
  readonly documentedApprovalEvidence: string;
}

export interface LicensingAndInsuranceConfirmation {
  readonly confirmationId: string;
  readonly lagosRegistrationConfirmed: boolean;
  readonly fctLicensingConfirmed: boolean;
  readonly insuranceWordingConfirmed: boolean;
  readonly exclusionsConfirmed: boolean;
  readonly evidenceConfirmed: boolean;
  readonly limitsConfirmed: boolean;
  readonly renewalsConfirmed: boolean;
  readonly claimsProcessConfirmed: boolean;
  readonly DocumentedEvidenceRef: string;
}

export interface LegalTaxAdrProposal {
  readonly parameter: "tax_vat_rate" | "tax_wht_rate" | "protection_fund_limit" | "data_retention_days";
  readonly outcome: "validate" | "change";
  readonly affectedAdr: string;
  readonly rationale: string;
  readonly proposedValue?: number | string;
}

export interface GateStatusSummary {
  readonly legalTaxAdviceGateClosed: boolean;
  readonly dpiaPrivacyGateClosed: boolean;
  readonly licensingInsuranceGateClosed: boolean;
  readonly adrProposalsValidated: boolean;
  readonly isLaunchGateClosed: boolean;
}

/**
 * ADR 0001, ADR 0006, ADR 0010, ADR 0027, ADR 0063, ADR 0065, ADR 0075, ADR 0076 & Issue 43:
 * Service for closing legal, tax, privacy, licensing, and insurance gates before platform launch.
 * Enforces specialist Nigerian review, DPIA approval, regulatory licensing & insurance confirmation,
 * and explicit ADR change proposals for tax, insurance, and retention values.
 */
export class LegalTaxPrivacyGateValidator {
  #legalTaxAdvice: LegalTaxAdviceRecord | null = null;
  #dpiaApproval: DpiaApprovalRecord | null = null;
  #licensingConfirmation: LicensingAndInsuranceConfirmation | null = null;
  readonly #adrProposals = new Map<string, LegalTaxAdrProposal>();

  /**
   * AC 1: Record legal and tax advice for Nigerian jurisdiction (Lagos & FCT).
   */
  recordLegalTaxAdvice(record: LegalTaxAdviceRecord): LegalTaxAdviceRecord {
    if (!record.jurisdiction || !record.sourceDate || !record.owner) {
      throw new Error("Legal advice must include jurisdiction, sourceDate, assumptions, owner, and requiredChanges");
    }

    if (!record.assumptions || record.assumptions.length === 0) {
      throw new Error("Legal advice must include jurisdiction, sourceDate, assumptions, owner, and requiredChanges");
    }

    this.#legalTaxAdvice = Object.freeze({ ...record });
    return record;
  }

  /**
   * AC 2: Record DPIA approval confirming provider roles, retention schedule, restricted-data flows, and human intervention.
   */
  recordDpiaApproval(record: DpiaApprovalRecord): DpiaApprovalRecord {
    if (!record.approver || !record.approvalDate || !record.documentedApprovalEvidence) {
      throw new Error("DPIA approval requires documented approver, approvalDate, and evidence");
    }

    if (
      record.providerRolesConfirmed !== true ||
      record.retentionScheduleApproved !== true ||
      record.restrictedDataFlowsApproved !== true ||
      record.humanInterventionControlsApproved !== true
    ) {
      throw new Error(
        "DPIA approval requires confirmation of provider roles, retention schedule, restricted data flows, and human intervention controls"
      );
    }

    this.#dpiaApproval = Object.freeze({ ...record });
    return record;
  }

  /**
   * AC 3: Confirm licensing, registration, insurance wording, exclusions, evidence, limits, renewals, and claims.
   */
  confirmLicensingAndInsurance(record: LicensingAndInsuranceConfirmation): LicensingAndInsuranceConfirmation {
    if (!record.DocumentedEvidenceRef) {
      throw new Error(
        "Licensing and insurance confirmation requires all regulatory, wording, exclusion, limit, renewal, and claim terms to be confirmed with evidence"
      );
    }

    if (
      record.lagosRegistrationConfirmed !== true ||
      record.fctLicensingConfirmed !== true ||
      record.insuranceWordingConfirmed !== true ||
      record.exclusionsConfirmed !== true ||
      record.evidenceConfirmed !== true ||
      record.limitsConfirmed !== true ||
      record.renewalsConfirmed !== true ||
      record.claimsProcessConfirmed !== true
    ) {
      throw new Error(
        "Licensing and insurance confirmation requires all regulatory, wording, exclusion, limit, renewal, and claim terms to be confirmed with evidence"
      );
    }

    this.#licensingConfirmation = Object.freeze({ ...record });
    return record;
  }

  /**
   * AC 4: Validate tax, insurance, and retention values via explicit ADR change proposals.
   */
  evaluateAdrProposal(proposal: LegalTaxAdrProposal): LegalTaxAdrProposal {
    const allowedMapping: Record<LegalTaxAdrProposal["parameter"], string[]> = {
      tax_vat_rate: ["ADR 0001", "ADR 0063", "ADR 0065"],
      tax_wht_rate: ["ADR 0001", "ADR 0063", "ADR 0065"],
      protection_fund_limit: ["ADR 0027", "ADR 0063"],
      data_retention_days: ["ADR 0075"]
    };

    const expectedAdrs = allowedMapping[proposal.parameter];
    if (!expectedAdrs || !expectedAdrs.includes(proposal.affectedAdr)) {
      const allowedStr = expectedAdrs ? expectedAdrs.join(" or ") : "known ADR";
      throw new Error(`Policy parameter '${proposal.parameter}' must affect ${allowedStr}`);
    }

    if (proposal.outcome === "change") {
      if (!proposal.rationale || proposal.rationale.trim() === "" || proposal.proposedValue === undefined) {
        throw new Error("Change outcome requires non-empty rationale and proposedValue");
      }
    }

    this.#adrProposals.set(proposal.parameter, Object.freeze({ ...proposal }));
    return proposal;
  }

  getGateStatusSummary(): GateStatusSummary {
    const legalTaxAdviceGateClosed = this.#legalTaxAdvice !== null;
    const dpiaPrivacyGateClosed = this.#dpiaApproval !== null;
    const licensingInsuranceGateClosed = this.#licensingConfirmation !== null;
    const adrProposalsValidated = this.#adrProposals.size > 0;

    const isLaunchGateClosed =
      legalTaxAdviceGateClosed && dpiaPrivacyGateClosed && licensingInsuranceGateClosed && adrProposalsValidated;

    return {
      legalTaxAdviceGateClosed,
      dpiaPrivacyGateClosed,
      licensingInsuranceGateClosed,
      adrProposalsValidated,
      isLaunchGateClosed
    };
  }
}
