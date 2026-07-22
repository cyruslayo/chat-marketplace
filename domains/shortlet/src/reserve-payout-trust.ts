import { PlatformCommandEnvelope, InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";

export type PayoutPlanType =
  | "founding_90_10"
  | "founding_100_post_checkout"
  | "proven_95_5"
  | "preferred_100_access";

export type OperatorTrustTier = "standard" | "proven" | "preferred";

export interface OperatorActivity {
  operatorId: string;
  tenantId: string;
  completedBookings60d: number;
  completedBookings180d: number;
  reliabilityScore60d: number;
  reliabilityScore180d: number;
  activeEnforcementState: "none" | "warning" | "restriction" | "suspension" | "termination";
}

export interface TrustTierEvaluation {
  operatorId: string;
  tier: OperatorTrustTier;
  policyVersion: string;
  evaluatedAtIso: string;
  overriddenByEnforcement: boolean;
  reasons: string[];
}

export interface PayoutHoldConditions {
  openRisk?: boolean;
  openLiabilitiesKobo?: number;
  legalHold?: boolean;
  providerRestriction?: boolean;
}

export interface PayoutCalculationInput {
  reservationId: string;
  operatorId: string;
  tenantId: string;
  operatorTier?: OperatorTrustTier;
  accommodationKobo: number;
  mandatoryChargesKobo: number;
  securityDepositKobo: number;
  checkoutDateIso: string;
}

export interface PayoutPlanResult {
  reservationId: string;
  operatorId: string;
  payoutPlan: PayoutPlanType;
  tier: OperatorTrustTier;
  policyVersion: string;
  commissionBaseKobo: number;
  commissionRate: number;
  commissionKobo: number;
  operatorNetKobo: number;
  payableNowKobo: number;
  reserveTrancheKobo: number;
  heldAmountKobo: number;
  payoutAccelerated: boolean;
  overrideReasons: string[];
  calculatedAtIso: string;
}

export interface ReserveTranche {
  trancheId: string;
  reservationId: string;
  operatorId: string;
  tenantId: string;
  amountKobo: number;
  checkoutDateIso: string;
  maturityDateIso: string;
  status: "held" | "released" | "forfeited_for_liability";
  releasedAtIso?: string;
  policyVersion: string;
}

export interface AdminHoldRecord {
  operatorId: string;
  holdActive: boolean;
  reason: string;
  appliedByUserId: string;
  appliedAtIso: string;
}

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0063, ADR 0064, ADR 0066:
 * Calculates rolling reserve, assigns provisional Payout Plan, evaluates Operator Trust Tier,
 * manages reserve tranches, and applies open risk/liability hold overrides.
 */
export class ReservePayoutManager {
  readonly #tranches = new Map<string, ReserveTranche>();
  readonly #adminHolds = new Map<string, AdminHoldRecord>();

  /**
   * ADR 0063 & ADR 0066:
   * Evaluates Operator Trust Tier from completed bookings, observation periods,
   * reliability thresholds, and enforcement state.
   */
  evaluateOperatorTrustTier(activity: OperatorActivity): TrustTierEvaluation {
    const policyVersion = "v1.0-launch";
    const evaluatedAtIso = new Date().toISOString();
    const reasons: string[] = [];

    // Active enforcement overrides tier progression and forces standard tier (ADR 0064)
    if (activity.activeEnforcementState !== "none") {
      reasons.push(`Active operator enforcement state: ${activity.activeEnforcementState}`);
      return {
        operatorId: activity.operatorId,
        tier: "standard",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: true,
        reasons
      };
    }

    // Preferred tier evaluation (ADR 0063: >= 30 bookings / 180d, reliability >= 0.98)
    if (activity.completedBookings180d >= 30 && activity.reliabilityScore180d >= 0.98) {
      reasons.push("Meets Preferred tier requirements (>=30 bookings/180d, >=98% reliability)");
      return {
        operatorId: activity.operatorId,
        tier: "preferred",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: false,
        reasons
      };
    }

    // Proven tier evaluation (ADR 0063: >= 10 bookings / 60d, reliability >= 0.95)
    if (activity.completedBookings60d >= 10 && activity.reliabilityScore60d >= 0.95) {
      reasons.push("Meets Proven tier requirements (>=10 bookings/60d, >=95% reliability)");
      return {
        operatorId: activity.operatorId,
        tier: "proven",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: false,
        reasons
      };
    }

    reasons.push("Does not meet Proven or Preferred criteria; remains Standard");
    return {
      operatorId: activity.operatorId,
      tier: "standard",
      policyVersion,
      evaluatedAtIso,
      overriddenByEnforcement: false,
      reasons
    };
  }

  /**
   * ADR 0026 & ADR 0063:
   * Calculates Payout Plan breakdown, Commission, Operator Net, Reserve Tranche,
   * and applies hold overrides for open risk, liabilities, or legal/provider restrictions.
   */
  calculatePayoutPlanAndReserve({
    booking,
    payoutPlan,
    tier,
    holds
  }: {
    booking: PayoutCalculationInput;
    payoutPlan: PayoutPlanType;
    tier: OperatorTrustTier;
    holds?: PayoutHoldConditions;
  }): PayoutPlanResult {
    const policyVersion = "v1.0-launch";
    const commissionBaseKobo = booking.accommodationKobo + booking.mandatoryChargesKobo;

    // Commission rate: standard 12%, founding 8%, preferred 10% (ADR 0062)
    const effectiveTier = booking.operatorTier ?? tier;
    let commissionRate = 0.12;
    if (effectiveTier === "preferred") {
      commissionRate = 0.1;
    }

    const commissionKobo = Math.floor(commissionBaseKobo * commissionRate);
    const operatorNetKobo = commissionBaseKobo - commissionKobo;

    let payableNowKobo = 0;
    let reserveTrancheKobo = 0;
    let payoutAccelerated = true;

    // Base Payout Plan calculation
    if (payoutPlan === "founding_90_10") {
      payableNowKobo = Math.floor(operatorNetKobo * 0.9);
      reserveTrancheKobo = operatorNetKobo - payableNowKobo;
    } else if (payoutPlan === "founding_100_post_checkout") {
      payableNowKobo = operatorNetKobo;
      reserveTrancheKobo = 0;
    } else if (payoutPlan === "proven_95_5") {
      payableNowKobo = Math.floor(operatorNetKobo * 0.95);
      reserveTrancheKobo = operatorNetKobo - payableNowKobo;
    } else if (payoutPlan === "preferred_100_access") {
      payableNowKobo = operatorNetKobo;
      reserveTrancheKobo = 0;
    }

    // Check hold overrides (ADR 0026 & ADR 0063)
    const overrideReasons: string[] = [];
    const adminHold = this.#adminHolds.get(booking.operatorId);
    if (adminHold && adminHold.holdActive) {
      overrideReasons.push(`admin_hold: ${adminHold.reason}`);
    }
    if (holds?.openRisk) {
      overrideReasons.push("open_risk");
    }
    if (holds?.openLiabilitiesKobo && holds.openLiabilitiesKobo > 0) {
      overrideReasons.push("open_liabilities");
    }
    if (holds?.legalHold) {
      overrideReasons.push("legal_hold");
    }
    if (holds?.providerRestriction) {
      overrideReasons.push("provider_restriction");
    }

    let heldAmountKobo = 0;
    if (overrideReasons.length > 0) {
      payoutAccelerated = false;
      heldAmountKobo = operatorNetKobo;
      payableNowKobo = 0;
      reserveTrancheKobo = 0;
    }

    return {
      reservationId: booking.reservationId,
      operatorId: booking.operatorId,
      payoutPlan,
      tier: effectiveTier,
      policyVersion,
      commissionBaseKobo,
      commissionRate,
      commissionKobo,
      operatorNetKobo,
      payableNowKobo,
      reserveTrancheKobo,
      heldAmountKobo,
      payoutAccelerated,
      overrideReasons,
      calculatedAtIso: new Date().toISOString()
    };
  }

  /**
   * Registers a reserve tranche for tracking.
   */
  registerReserveTranche(tranche: ReserveTranche): ReserveTranche {
    this.#tranches.set(tranche.trancheId, { ...tranche });
    return { ...tranche };
  }

  /**
   * ADR 0025 & ADR 0026:
   * Releases or forfeits a reserve tranche after maturity date, checking for duplicate releases,
   * open liabilities, or active holds.
   */
  releaseReserveTranche(
    trancheId: string,
    currentIso: string,
    holds?: PayoutHoldConditions,
    auditLog?: InMemoryAuditLog
  ): ReserveTranche {
    const tranche = this.#tranches.get(trancheId);
    if (!tranche) {
      throw new Error(`Reserve tranche not found: ${trancheId}`);
    }

    // Behavioral check: Duplicate release
    if (tranche.status !== "held") {
      throw new Error(`Duplicate release attempted for tranche ${trancheId} (current status: ${tranche.status})`);
    }

    // Behavioral check: Maturity date
    const currentTime = new Date(currentIso).getTime();
    const maturityTime = new Date(tranche.maturityDateIso).getTime();
    if (currentTime < maturityTime) {
      throw new Error(`Tranche ${trancheId} has not reached maturity date ${tranche.maturityDateIso}`);
    }

    // Behavioral check: Open legal hold or provider restriction
    if (holds?.legalHold || holds?.providerRestriction) {
      throw new Error(`Tranche release paused due to legal hold or open appeal for tranche ${trancheId}`);
    }

    // Behavioral check: Open liabilities offset
    if (holds?.openLiabilitiesKobo && holds.openLiabilitiesKobo > 0) {
      tranche.status = "forfeited_for_liability";
      tranche.releasedAtIso = currentIso;
      this.#tranches.set(trancheId, tranche);

      auditLog?.record({
        action: "reserve_tranche_forfeited",
        trancheId,
        operatorId: tranche.operatorId,
        amountKobo: tranche.amountKobo,
        reason: "Applied to open operator liability"
      });

      return { ...tranche };
    }

    // Normal release
    tranche.status = "released";
    tranche.releasedAtIso = currentIso;
    this.#tranches.set(trancheId, tranche);

    auditLog?.record({
      action: "reserve_tranche_released",
      trancheId,
      operatorId: tranche.operatorId,
      amountKobo: tranche.amountKobo
    });

    return { ...tranche };
  }

  /**
   * ADR 0072 & ADR 0064:
   * Process manual admin payout override command.
   */
  processAdminPayoutOverride(envelope: PlatformCommandEnvelope<any>): AdminHoldRecord {
    if (envelope.commandName !== "reserve.override_payout_hold") {
      throw new Error(`Invalid command for admin payout override: ${envelope.commandName}`);
    }

    if (envelope.principal.role !== "admin") {
      throw new Error("Admin authority required for payout hold override");
    }

    const { operatorId, action, reason } = envelope.payload;
    const record: AdminHoldRecord = {
      operatorId,
      holdActive: action === "apply_hold",
      reason,
      appliedByUserId: envelope.principal.id,
      appliedAtIso: new Date().toISOString()
    };

    this.#adminHolds.set(operatorId, record);
    return { ...record };
  }
}
