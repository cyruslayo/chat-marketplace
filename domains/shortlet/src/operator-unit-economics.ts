export interface UsabilityFinding {
  readonly findingId: string;
  readonly area:
    | "onboarding"
    | "response"
    | "calendar"
    | "turnover"
    | "cancellation"
    | "deposit"
    | "commission"
    | "reserve"
    | "payout"
    | "remedy"
    | "enforcement"
    | "support";
  readonly description: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly frequency: number;
  readonly location: "Lagos" | "Abuja";
}

export interface UnitEconomicsInputs {
  readonly grossBookingValueKobo: number;
  readonly pspFeePercent: number;
  readonly expectedRefundRate: number;
  readonly fraudLossRate: number;
  readonly inspectionAmortizationKobo: number;
  readonly supportCostPerStayKobo: number;
  readonly relocationExposureKobo: number;
  readonly protectionFundContributionRate: number;
  readonly rollingReserveRate: number;
  readonly taxVatRate: number;
  readonly platformCommissionRate: number;
}

export interface PolicyOutcome {
  readonly parameter:
    | "commission_rate"
    | "founding_duration"
    | "deposit_caps"
    | "fund_parameters"
    | "relocation_limits"
    | "payout_tiers";
  readonly outcome: "validate" | "change";
  readonly affectedAdr: string;
  readonly rationale: string;
  readonly proposedValue?: string | number;
}

export interface UnitEconomicsReport {
  readonly netPlatformRevenueKobo: number;
  readonly totalCostsKobo: number;
  readonly contributionMarginKobo: number;
  readonly isViable: boolean;
}

/**
 * ADR 0016, ADR 0026, ADR 0027, ADR 0028, ADR 0062 & Issue 42:
 * Quantitative unit-economics model and operator usability walkthrough finding recorder.
 */
export class OperatorUsabilityAndUnitEconomicsValidator {
  readonly #findings: UsabilityFinding[] = [];
  readonly #outcomes = new Map<string, PolicyOutcome>();

  /**
   * AC 1: Record scenario-based walkthrough findings with severity and frequency.
   */
  recordUsabilityFinding(finding: UsabilityFinding): UsabilityFinding {
    if (!finding.description || !finding.area) {
      throw new Error("Usability finding must include description and area");
    }
    const frozen = Object.freeze({ ...finding });
    this.#findings.push(frozen);
    return frozen;
  }

  getUsabilityFindings(): readonly UsabilityFinding[] {
    return Object.freeze([...this.#findings]);
  }

  /**
   * AC 2: Quantitative unit-economics model including all cost components and booking mix.
   */
  modelUnitEconomics(inputs: UnitEconomicsInputs): UnitEconomicsReport {
    const gbv = inputs.grossBookingValueKobo;

    const commissionKobo = Math.round(gbv * (inputs.platformCommissionRate / 100));
    const pspFeeKobo = Math.round(gbv * (inputs.pspFeePercent / 100));
    const refundCostKobo = Math.round(gbv * (inputs.expectedRefundRate / 100));
    const fraudCostKobo = Math.round(gbv * (inputs.fraudLossRate / 100));
    const protectionFundKobo = Math.round(gbv * (inputs.protectionFundContributionRate / 100));
    const vatKobo = Math.round(commissionKobo * (inputs.taxVatRate / 100));

    const totalCostsKobo =
      pspFeeKobo +
      refundCostKobo +
      fraudCostKobo +
      inputs.inspectionAmortizationKobo +
      inputs.supportCostPerStayKobo +
      inputs.relocationExposureKobo +
      protectionFundKobo +
      vatKobo;

    const netPlatformRevenueKobo = commissionKobo;
    const contributionMarginKobo = netPlatformRevenueKobo - totalCostsKobo;
    const isViable = contributionMarginKobo > 0;

    return Object.freeze({
      netPlatformRevenueKobo,
      totalCostsKobo,
      contributionMarginKobo,
      isViable
    });
  }

  /**
   * AC 3 & AC 4: Explicit validate/change outcomes referencing affected ADR without reopening unrelated policy.
   */
  evaluatePolicyOutcome(outcome: PolicyOutcome): PolicyOutcome {
    const validAdrs: Record<PolicyOutcome["parameter"], string> = {
      commission_rate: "ADR 0062",
      founding_duration: "ADR 0062",
      deposit_caps: "ADR 0016",
      fund_parameters: "ADR 0027",
      relocation_limits: "ADR 0028",
      payout_tiers: "ADR 0026"
    };

    const expectedAdr = validAdrs[outcome.parameter];
    if (outcome.affectedAdr !== expectedAdr) {
      throw new Error(
        `Policy parameter '${outcome.parameter}' must affect ${expectedAdr} (got '${outcome.affectedAdr}')`
      );
    }

    if (!outcome.rationale || (outcome.outcome === "change" && outcome.proposedValue === undefined)) {
      throw new Error("Change outcome requires rationale and proposedValue");
    }

    const frozen = Object.freeze({ ...outcome });
    this.#outcomes.set(outcome.parameter, frozen);
    return frozen;
  }

  getPolicyOutcomes(): readonly PolicyOutcome[] {
    return Object.freeze(Array.from(this.#outcomes.values()));
  }
}
