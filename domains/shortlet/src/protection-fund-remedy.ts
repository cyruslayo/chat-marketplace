import { InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";

export interface ProtectionFundPolicy {
  policyVersion: string;
  minSeedCapitalKobo: number;
  minTargetBalanceKobo: number;
  contributionRateBeforeTarget: number;
  contributionRateAfterTarget: number;
  routineMaxPriceDiffRatio: number;
  routineMaxTotalExposureKobo: number;
  routineMaxTransportKobo: number;
  seniorMaxPriceDiffRatio: number;
  seniorMaxTotalExposureKobo: number;
  seniorMaxTransportKobo: number;
}

export interface RemedyApproval {
  userId: string;
  role: string;
}

export interface RemedyApprovalValidation {
  valid: boolean;
  tier: "routine" | "senior" | "executive";
  error?: string;
}

export interface LedgerLine {
  account: string;
  debitKobo: number;
  creditKobo: number;
}

export interface BalancedLedgerEntry {
  entryId: string;
  incidentId: string;
  bookingId: string;
  decisionId: string;
  fundingSource: string;
  balanced: boolean;
  lines: LedgerLine[];
  postedAtIso: string;
}

export interface DisburseRemedyInput {
  incidentId: string;
  bookingId: string;
  decisionId: string;
  remedyAmountKobo: number;
  operatorLiabilityKobo: number;
  approvals: RemedyApproval[];
  fundingSource: "guest_protection_fund" | "platform_reserve" | "original_payment_source";
}

export interface RemedyDisbursementRecord {
  disbursementId: string;
  incidentId: string;
  bookingId: string;
  decisionId: string;
  fundingSource: string;
  remedyApproved: boolean;
  remedyDisbursedKobo: number;
  operatorLiabilityKobo: number;
  fundDeficitKobo: number;
  refundFallbackGuaranteed: boolean;
  ledgerEntry: BalancedLedgerEntry;
  disbursedAtIso: string;
}

export interface FinanceExposureReport {
  totalExposureKobo: number;
  totalRemediesDisbursedKobo: number;
  totalRecoveredKobo: number;
  outstandingLiabilityKobo: number;
  fundAvailableBalanceKobo: number;
  activeIncidentsCount: number;
  reportedAtIso: string;
}

/**
 * ADR 0027, ADR 0028, ADR 0029, ADR 0063:
 * Manages the Guest Protection Fund, versioned policy rules, balanced double-entry ledger,
 * tiered remedy approvals, insufficient-balance fallback, and Finance exposure reporting.
 */
/** @deprecated Compatibility-only adapter retained for historical consumers. Production uses ProtectionFundApplication. */
export class ProtectionFundManager {
  readonly #auditLog?: InMemoryAuditLog;
  #availableBalanceKobo = 0;
  #totalRemediesDisbursedKobo = 0;
  #totalRecoveredKobo = 0;
  #totalOperatorLiabilityKobo = 0;
  #ledgerEntries: BalancedLedgerEntry[] = [];
  #disbursements: RemedyDisbursementRecord[] = [];

  constructor({ auditLog }: { auditLog?: InMemoryAuditLog } = {}) {
    this.#auditLog = auditLog;
  }

  /**
   * ADR 0027 & ADR 0063:
   * Policy version gpf-v1.0-launch.
   */
  getPolicy(): ProtectionFundPolicy {
    return Object.freeze({
      policyVersion: "gpf-v1.0-launch",
      minSeedCapitalKobo: 500000000, // ₦5m (500,000,000 kobo)
      minTargetBalanceKobo: 1000000000, // ₦10m (1,000,000,000 kobo)
      contributionRateBeforeTarget: 0.10, // 10%
      contributionRateAfterTarget: 0.02, // 2%
      routineMaxPriceDiffRatio: 0.25,
      routineMaxTotalExposureKobo: 15000000, // ₦150k
      routineMaxTransportKobo: 5000000, // ₦50k
      seniorMaxPriceDiffRatio: 0.50,
      seniorMaxTotalExposureKobo: 50000000, // ₦500k
      seniorMaxTransportKobo: 10000000 // ₦100k
    });
  }

  /**
   * ADR 0063:
   * Seed capital is the greatest of ₦5m, 3x projected P95 net remedy exposure, or 1% of next 90d GBV.
   */
  calculateSeedCapital({
    projectedP95ExposureKobo = 0,
    next90DayGbvKobo = 0
  }: {
    projectedP95ExposureKobo?: number;
    next90DayGbvKobo?: number;
  }): number {
    const policy = this.getPolicy();
    const p95Cap = projectedP95ExposureKobo * 3;
    const gbvCap = Math.floor(next90DayGbvKobo * 0.01);
    return Math.max(policy.minSeedCapitalKobo, p95Cap, gbvCap);
  }

  /**
   * Seeds the fund with initial capital.
   */
  seedFund({ seedAmountKobo }: { seedAmountKobo: number }): number {
    this.#availableBalanceKobo += seedAmountKobo;

    const entryId = `led_seed_${Date.now()}`;
    const ledgerEntry: BalancedLedgerEntry = {
      entryId,
      incidentId: "SYSTEM_SEED",
      bookingId: "SYSTEM_SEED",
      decisionId: "SYSTEM_SEED",
      fundingSource: "platform_capital",
      balanced: true,
      lines: [
        { account: "gpf_available_balance", debitKobo: seedAmountKobo, creditKobo: 0 },
        { account: "gpf_platform_capital", debitKobo: 0, creditKobo: seedAmountKobo }
      ],
      postedAtIso: new Date().toISOString()
    };

    this.#ledgerEntries.push(ledgerEntry);
    this.#auditLog?.record({
      action: "gpf_fund_seeded",
      seedAmountKobo,
      newAvailableBalanceKobo: this.#availableBalanceKobo
    });

    return this.#availableBalanceKobo;
  }

  getAvailableBalanceKobo(): number {
    return this.#availableBalanceKobo;
  }

  /**
   * ADR 0027 & ADR 0063:
   * Earned commission contributes 10% until target is met, then 2%.
   */
  recordCommissionContribution({ earnedCommissionKobo }: { earnedCommissionKobo: number }): number {
    const policy = this.getPolicy();
    const rate = this.#availableBalanceKobo < policy.minTargetBalanceKobo
      ? policy.contributionRateBeforeTarget
      : policy.contributionRateAfterTarget;

    const contributionKobo = Math.floor(earnedCommissionKobo * rate);
    this.#availableBalanceKobo += contributionKobo;

    const entryId = `led_contrib_${Date.now()}`;
    const ledgerEntry: BalancedLedgerEntry = {
      entryId,
      incidentId: "COMMISSION_CONTRIB",
      bookingId: "COMMISSION_CONTRIB",
      decisionId: "COMMISSION_CONTRIB",
      fundingSource: "earned_commission",
      balanced: true,
      lines: [
        { account: "gpf_available_balance", debitKobo: contributionKobo, creditKobo: 0 },
        { account: "earned_commission_contribution", debitKobo: 0, creditKobo: contributionKobo }
      ],
      postedAtIso: new Date().toISOString()
    };

    this.#ledgerEntries.push(ledgerEntry);
    this.#auditLog?.record({
      action: "gpf_commission_contributed",
      earnedCommissionKobo,
      contributionKobo,
      rate,
      newAvailableBalanceKobo: this.#availableBalanceKobo
    });

    return contributionKobo;
  }

  /**
   * ADR 0063:
   * Validates remedy approval tiers based on price diff ratio, total exposure, and transport cost.
   */
  validateRemedyApproval({
    originalPriceKobo,
    priceDiffKobo,
    transportCostKobo,
    approvals
  }: {
    originalPriceKobo: number;
    priceDiffKobo: number;
    transportCostKobo: number;
    approvals: RemedyApproval[];
  }): RemedyApprovalValidation {
    const policy = this.getPolicy();
    const priceDiffRatio = originalPriceKobo > 0 ? priceDiffKobo / originalPriceKobo : 0;
    const totalExposureKobo = priceDiffKobo + transportCostKobo;

    let requiredTier: "routine" | "senior" | "executive" = "routine";

    if (
      priceDiffRatio > policy.seniorMaxPriceDiffRatio ||
      totalExposureKobo > policy.seniorMaxTotalExposureKobo ||
      transportCostKobo > policy.seniorMaxTransportKobo
    ) {
      requiredTier = "executive";
    } else if (
      priceDiffRatio > policy.routineMaxPriceDiffRatio ||
      totalExposureKobo > policy.routineMaxTotalExposureKobo ||
      transportCostKobo > policy.routineMaxTransportKobo
    ) {
      requiredTier = "senior";
    }

    if (requiredTier === "routine") {
      const hasRoutineRole = approvals.some((a) =>
        ["support_agent", "routine_operations", "admin", "operator_support", "senior_operations", "finance", "executive_1", "executive_2"].includes(a.role)
      );
      if (!hasRoutineRole) {
        return {
          valid: false,
          tier: "routine",
          error: "Routine relocation requires approval from authorized support or operations role"
        };
      }
      return { valid: true, tier: "routine" };
    }

    if (requiredTier === "senior") {
      const hasSeniorOps = approvals.some((a) => ["senior_operations", "admin", "executive_1", "executive_2"].includes(a.role));
      const hasFinance = approvals.some((a) => ["finance", "admin", "executive_1", "executive_2"].includes(a.role));

      if (!hasSeniorOps || !hasFinance) {
        return {
          valid: false,
          tier: "senior",
          error: "Senior relocation requires both senior operations and finance approvals"
        };
      }
      return { valid: true, tier: "senior" };
    }

    const execApprovals = approvals.filter((a) => a.role.includes("executive") || a.role === "admin");
    if (execApprovals.length < 2) {
      return {
        valid: false,
        tier: "executive",
        error: "Executive relocation requires 2 executive approvals"
      };
    }

    return { valid: true, tier: "executive" };
  }

  /**
   * ADR 0027, ADR 0028, ADR 0029:
   * Disburses an approved guest remedy, records double-entry balanced ledger entries,
   * handles insufficient fund balance safely without erasing remedy or fallback workflow.
   */
  disburseRemedy(input: DisburseRemedyInput): RemedyDisbursementRecord {
    const { incidentId, bookingId, decisionId, remedyAmountKobo, operatorLiabilityKobo, fundingSource } = input;

    let fundDeficitKobo = 0;
    if (this.#availableBalanceKobo >= remedyAmountKobo) {
      this.#availableBalanceKobo -= remedyAmountKobo;
    } else {
      fundDeficitKobo = remedyAmountKobo - this.#availableBalanceKobo;
      this.#availableBalanceKobo = 0;
    }

    this.#totalRemediesDisbursedKobo += remedyAmountKobo;
    this.#totalOperatorLiabilityKobo += operatorLiabilityKobo;

    const entryId = `led_disb_${incidentId}_${Date.now()}`;
    const ledgerEntry: BalancedLedgerEntry = {
      entryId,
      incidentId,
      bookingId,
      decisionId,
      fundingSource,
      balanced: true,
      lines: [
        { account: "remedy_disbursement", debitKobo: remedyAmountKobo, creditKobo: 0 },
        { account: "gpf_available_balance", debitKobo: 0, creditKobo: remedyAmountKobo }
      ],
      postedAtIso: new Date().toISOString()
    };

    this.#ledgerEntries.push(ledgerEntry);

    const record: RemedyDisbursementRecord = {
      disbursementId: `disb_${incidentId}`,
      incidentId,
      bookingId,
      decisionId,
      fundingSource,
      remedyApproved: true,
      remedyDisbursedKobo: remedyAmountKobo,
      operatorLiabilityKobo,
      fundDeficitKobo,
      refundFallbackGuaranteed: true,
      ledgerEntry,
      disbursedAtIso: new Date().toISOString()
    };

    this.#disbursements.push(record);
    this.#auditLog?.record({
      action: "gpf_remedy_disbursed",
      incidentId,
      bookingId,
      decisionId,
      remedyAmountKobo,
      operatorLiabilityKobo,
      fundDeficitKobo
    });

    return record;
  }

  /**
   * ADR 0027:
   * Records Operator recovery, replenishing fund balance.
   */
  recordOperatorRecovery({
    incidentId,
    bookingId,
    recoveredAmountKobo
  }: {
    incidentId: string;
    bookingId: string;
    recoveredAmountKobo: number;
  }): number {
    this.#availableBalanceKobo += recoveredAmountKobo;
    this.#totalRecoveredKobo += recoveredAmountKobo;

    const entryId = `led_rec_${incidentId}_${Date.now()}`;
    const ledgerEntry: BalancedLedgerEntry = {
      entryId,
      incidentId,
      bookingId,
      decisionId: "OPERATOR_RECOVERY",
      fundingSource: "operator_recovery",
      balanced: true,
      lines: [
        { account: "gpf_available_balance", debitKobo: recoveredAmountKobo, creditKobo: 0 },
        { account: "operator_liability_receivable", debitKobo: 0, creditKobo: recoveredAmountKobo }
      ],
      postedAtIso: new Date().toISOString()
    };

    this.#ledgerEntries.push(ledgerEntry);
    this.#auditLog?.record({
      action: "gpf_operator_recovered",
      incidentId,
      bookingId,
      recoveredAmountKobo,
      newAvailableBalanceKobo: this.#availableBalanceKobo
    });

    return this.#availableBalanceKobo;
  }

  /**
   * ADR 0071 & ADR 0075:
   * Produces Finance exposure report showing exposure and recovery WITHOUT guest PII or interaction chat text.
   */
  getFinanceExposureReport(): FinanceExposureReport {
    const outstandingLiabilityKobo = Math.max(0, this.#totalOperatorLiabilityKobo - this.#totalRecoveredKobo);

    return Object.freeze({
      totalExposureKobo: this.#totalRemediesDisbursedKobo,
      totalRemediesDisbursedKobo: this.#totalRemediesDisbursedKobo,
      totalRecoveredKobo: this.#totalRecoveredKobo,
      outstandingLiabilityKobo,
      fundAvailableBalanceKobo: this.#availableBalanceKobo,
      activeIncidentsCount: this.#disbursements.length,
      reportedAtIso: new Date().toISOString()
    });
  }
}
