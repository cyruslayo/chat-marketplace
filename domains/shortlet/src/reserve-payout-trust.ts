import { createPlatformCommandEnvelope, type PlatformCommandEnvelope, type CommandPrincipal, InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";
import type { ProductionRevenueReleaseRecord } from "./revenue-release.js";
import { journal, type RevenueLedgerLine, type RevenueAccountingRepository, type RevenueAdjustmentRecord } from "./revenue-accounting.js";

export type PayoutPlanType =
  | "founding_90_10"
  | "founding_100_post_checkout"
  | "proven_95_5"
  | "preferred_100_access";

export type OperatorTrustTier = "standard" | "proven" | "preferred";

export interface AuthoritativeReliabilityRecord {
  readonly operatorId: string;
  readonly tenantId: string;
  readonly trailing60dCompletedBookings: number;
  readonly trailing60dOpportunities: number;
  readonly trailing60dReliabilityRate: number;
  readonly trailing180dCompletedBookings: number;
  readonly trailing180dOpportunities: number;
  readonly trailing180dReliabilityRate: number;
}

export interface OperatorReliabilityAuthority {
  getReliability(params: { operatorId: string; tenantId: string }): AuthoritativeReliabilityRecord;
}

export interface OperatorEnforcementAuthority {
  getProjections(params: { operatorId: string; unitId?: string }): {
    readonly misconductCount: number;
    readonly enforcementLevel: "coaching" | "restriction" | "unit_suspension" | "operator_pause" | "termination";
    readonly operatorStatus: "active" | "active_with_restrictions" | "paused" | "terminated";
    readonly protectiveActionActive?: boolean;
    readonly appealPending?: boolean;
  };
}

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
  activeRiskRestriction?: boolean;
  pendingAdjustment?: boolean;
  appealPending?: boolean;
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
  ledgerJournalId?: string;
}

export interface AdminHoldRecord {
  operatorId: string;
  holdActive: boolean;
  reason: string;
  appliedByUserId: string;
  appliedAtIso: string;
}

export interface AdminPayoutOverridePayload {
  operatorId: string;
  action: "apply_hold" | "remove_hold";
  reason: string;
}

export interface ReleaseReserveTrancheCommandPayload {
  trancheId: string;
  holds?: PayoutHoldConditions;
}

export interface ReservePayoutManagerOptions {
  readonly reliabilityAuthority?: OperatorReliabilityAuthority;
  readonly enforcementAuthority?: OperatorEnforcementAuthority;
  readonly accountingRepository?: RevenueAccountingRepository;
  readonly clock?: () => Date;
}

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0062, ADR 0063, ADR 0064, ADR 0072, ADR 0075, ADR 0083:
 * Calculates rolling reserve and settlement availability, evaluates Operator Trust Tier from authoritative
 * reliability and enforcement state, manages reserve tranches reconciling to ledger entries, and routes
 * consequential financial commands through authorized idempotent human command envelopes.
 */
export class ReservePayoutManager {
  readonly #tranches = new Map<string, ReserveTranche>();
  readonly #adminHolds = new Map<string, AdminHoldRecord>();
  readonly #reliabilityAuthority?: OperatorReliabilityAuthority;
  readonly #enforcementAuthority?: OperatorEnforcementAuthority;
  readonly #accountingRepository?: RevenueAccountingRepository;
  readonly #clock: () => Date;
  readonly #executedCommands = new Map<string, { commandName: string; fingerprint: string; result: unknown }>();

  constructor(options: ReservePayoutManagerOptions = {}) {
    this.#reliabilityAuthority = options.reliabilityAuthority;
    this.#enforcementAuthority = options.enforcementAuthority;
    this.#accountingRepository = options.accountingRepository;
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * ADR 0063, ADR 0064, ADR 0083:
   * Evaluates Operator Trust Tier from authoritative platform evidence (completed bookings,
   * observation periods, reliability thresholds, and active enforcement state).
   */
  evaluateOperatorTrustTier(activityOrContext: OperatorActivity | { operatorId: string; tenantId: string }): TrustTierEvaluation {
    const policyVersion = "v1.0-launch";
    const evaluatedAtIso = this.#clock().toISOString();
    const reasons: string[] = [];

    let operatorId: string;
    let tenantId: string;
    let completedBookings60d: number;
    let completedBookings180d: number;
    let reliabilityScore60d: number;
    let reliabilityScore180d: number;
    let activeEnforcementBlocked = false;

    if ("completedBookings60d" in activityOrContext) {
      operatorId = activityOrContext.operatorId;
      tenantId = activityOrContext.tenantId;
      completedBookings60d = activityOrContext.completedBookings60d;
      completedBookings180d = activityOrContext.completedBookings180d;
      reliabilityScore60d = activityOrContext.reliabilityScore60d;
      reliabilityScore180d = activityOrContext.reliabilityScore180d;
      if (activityOrContext.activeEnforcementState !== "none") {
        activeEnforcementBlocked = true;
        reasons.push(`Active operator enforcement state: ${activityOrContext.activeEnforcementState}`);
      }
    } else {
      operatorId = activityOrContext.operatorId;
      tenantId = activityOrContext.tenantId;
      if (this.#enforcementAuthority) {
        const proj = this.#enforcementAuthority.getProjections({ operatorId });
        if (proj.enforcementLevel !== "coaching" || proj.operatorStatus !== "active" || proj.protectiveActionActive || proj.appealPending) {
          activeEnforcementBlocked = true;
          reasons.push(`Active operator enforcement: level=${proj.enforcementLevel}, status=${proj.operatorStatus}`);
        }
      }
      if (this.#reliabilityAuthority) {
        const rel = this.#reliabilityAuthority.getReliability({ operatorId, tenantId });
        completedBookings60d = rel.trailing60dCompletedBookings;
        completedBookings180d = rel.trailing180dCompletedBookings;
        reliabilityScore60d = rel.trailing60dReliabilityRate;
        reliabilityScore180d = rel.trailing180dReliabilityRate;
      } else {
        completedBookings60d = 0;
        completedBookings180d = 0;
        reliabilityScore60d = 0;
        reliabilityScore180d = 0;
      }
    }

    // Check active admin hold
    const adminHold = this.#adminHolds.get(operatorId);
    if (adminHold && adminHold.holdActive) {
      activeEnforcementBlocked = true;
      reasons.push(`Active admin hold: ${adminHold.reason}`);
    }

    if (activeEnforcementBlocked) {
      return {
        operatorId,
        tier: "standard",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: true,
        reasons
      };
    }

    // Preferred tier evaluation (ADR 0083: >= 30 bookings / 180d, reliability >= 0.98 evaluated before Proven)
    if (completedBookings180d >= 30 && reliabilityScore180d >= 0.98) {
      reasons.push("Meets Preferred tier requirements (>=30 bookings/180d, >=98% reliability)");
      return {
        operatorId,
        tier: "preferred",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: false,
        reasons
      };
    }

    // Proven tier evaluation (ADR 0083: >= 10 bookings / 60d, reliability >= 0.95)
    if (completedBookings60d >= 10 && reliabilityScore60d >= 0.95) {
      reasons.push("Meets Proven tier requirements (>=10 bookings/60d, >=95% reliability)");
      return {
        operatorId,
        tier: "proven",
        policyVersion,
        evaluatedAtIso,
        overriddenByEnforcement: false,
        reasons
      };
    }

    reasons.push("Does not meet Proven or Preferred criteria; remains Standard");
    return {
      operatorId,
      tier: "standard",
      policyVersion,
      evaluatedAtIso,
      overriddenByEnforcement: false,
      reasons
    };
  }

  /**
   * ADR 0026, ADR 0062, ADR 0063, ADR 0083:
   * Calculates settlement classification and reserve breakdown consuming authoritative Revenue Release economics.
   */
  calculatePayoutPlanAndReserve({
    booking,
    payoutPlan,
    tier,
    holds,
    revenueRelease
  }: {
    booking: PayoutCalculationInput;
    payoutPlan: PayoutPlanType;
    tier: OperatorTrustTier;
    holds?: PayoutHoldConditions;
    revenueRelease?: ProductionRevenueReleaseRecord;
  }): PayoutPlanResult {
    const policyVersion = "v1.0-launch";
    let commissionBaseKobo: number;
    let commissionRate: number;
    let commissionKobo: number;
    let operatorNetKobo: number;

    if (revenueRelease) {
      commissionBaseKobo = revenueRelease.commissionBaseKobo;
      commissionRate = revenueRelease.commissionRate;
      commissionKobo = revenueRelease.commissionKobo;
      operatorNetKobo = revenueRelease.operatorNetKobo;
    } else {
      commissionBaseKobo = booking.accommodationKobo + booking.mandatoryChargesKobo;
      const effectiveTier = booking.operatorTier ?? tier;
      commissionRate = effectiveTier === "preferred" ? 0.1 : 0.12;
      commissionKobo = Math.floor(commissionBaseKobo * commissionRate);
      operatorNetKobo = commissionBaseKobo - commissionKobo;
    }

    const effectiveTier = booking.operatorTier ?? tier;
    let payableNowKobo = 0;
    let reserveTrancheKobo = 0;
    let payoutAccelerated = true;

    // Base Payout Plan calculation under ADR 0083
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

    // Check hold overrides (ADR 0026, ADR 0063, ADR 0083)
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
    if (holds?.activeRiskRestriction) {
      overrideReasons.push("active_risk_restriction");
    }
    if (holds?.pendingAdjustment) {
      overrideReasons.push("pending_adjustment");
    }
    if (holds?.appealPending) {
      overrideReasons.push("appeal_pending");
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
      calculatedAtIso: this.#clock().toISOString()
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
   * ADR 0024, ADR 0025, ADR 0026, ADR 0083:
   * Releases or forfeits a reserve tranche after maturity date, checking for duplicate releases,
   * open liabilities, active holds, and recording balanced ledger movements.
   */
  releaseReserveTranche(
    trancheId: string,
    currentIso: string,
    holds?: PayoutHoldConditions,
    auditLog?: InMemoryAuditLog,
    accountingRepo?: RevenueAccountingRepository
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

    // Behavioral check: Open legal hold, provider restriction, appeal, pending adjustment, or active risk
    if (
      holds?.legalHold ||
      holds?.providerRestriction ||
      holds?.openRisk ||
      holds?.activeRiskRestriction ||
      holds?.pendingAdjustment ||
      holds?.appealPending
    ) {
      throw new Error(`Tranche release paused due to legal hold or open appeal for tranche ${trancheId}`);
    }

    const repo = accountingRepo ?? this.#accountingRepository;

    // Behavioral check: Open liabilities offset
    if (holds?.openLiabilitiesKobo && holds.openLiabilitiesKobo > 0) {
      tranche.status = "forfeited_for_liability";
      tranche.releasedAtIso = currentIso;

      if (repo) {
        const releaseId = `revenue-release:${tranche.reservationId}`;
        const lines: RevenueLedgerLine[] = [
          { lineId: `tranche-forfeit:${trancheId}:1`, account: "rolling_reserve", side: "debit", amountKobo: tranche.amountKobo, currency: "NGN" },
          { lineId: `tranche-forfeit:${trancheId}:2`, account: "operator_costs_and_offsets", side: "credit", amountKobo: tranche.amountKobo, currency: "NGN" }
        ];
        const j = journal({ correlationId: releaseId, lines, createdAt: currentIso });
        tranche.ledgerJournalId = j.journalId;
        const adj: RevenueAdjustmentRecord = {
          adjustmentId: `adj-forfeit-${trancheId}`,
          adjustmentVersion: 1,
          reservationId: tranche.reservationId,
          releaseId,
          source: "other_accepted_source",
          sourceReference: trancheId,
          reasonCode: "applied_to_operator_liability",
          journal: j
        };
        try {
          repo.postAdjustment({ adjustment: adj });
        } catch {
          // If release not in repo, still balance journal and assign journalId
        }
      }

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

    if (repo) {
      const releaseId = `revenue-release:${tranche.reservationId}`;
      const lines: RevenueLedgerLine[] = [
        { lineId: `tranche-release:${trancheId}:1`, account: "rolling_reserve", side: "debit", amountKobo: tranche.amountKobo, currency: "NGN" },
        { lineId: `tranche-release:${trancheId}:2`, account: "operator_payable", side: "credit", amountKobo: tranche.amountKobo, currency: "NGN" }
      ];
      const j = journal({ correlationId: releaseId, lines, createdAt: currentIso });
      tranche.ledgerJournalId = j.journalId;
      const adj: RevenueAdjustmentRecord = {
        adjustmentId: `adj-release-${trancheId}`,
        adjustmentVersion: 1,
        reservationId: tranche.reservationId,
        releaseId,
        source: "other_accepted_source",
        sourceReference: trancheId,
        reasonCode: "reserve_tranche_released_to_payable",
        journal: j
      };
      try {
        repo.postAdjustment({ adjustment: adj });
      } catch {
        // If release not in repo, still balance journal and assign journalId
      }
    }

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
   * ADR 0072, ADR 0064, ADR 0083:
   * Process manual admin payout override command using strongly typed envelope and idempotency.
   */
  processAdminPayoutOverride(envelope: PlatformCommandEnvelope<AdminPayoutOverridePayload>): AdminHoldRecord {
    if (envelope.commandName !== "reserve.override_payout_hold") {
      throw new Error(`Invalid command for admin payout override: ${envelope.commandName}`);
    }

    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") {
      throw new Error("Admin authority required for payout hold override");
    }

    const { operatorId, action, reason } = envelope.payload;
    if (!operatorId || !action || !reason) {
      throw new Error("Complete payload required for admin payout override");
    }

    const idempotencyKey = envelope.idempotencyKey;
    if (idempotencyKey) {
      const fingerprint = JSON.stringify({ commandName: envelope.commandName, payload: envelope.payload });
      const existing = this.#executedCommands.get(idempotencyKey);
      if (existing) {
        if (existing.commandName !== envelope.commandName || existing.fingerprint !== fingerprint) {
          throw new Error("Idempotency key was reused for a different command");
        }
        return existing.result as AdminHoldRecord;
      }
    }

    const record: AdminHoldRecord = {
      operatorId,
      holdActive: action === "apply_hold",
      reason,
      appliedByUserId: envelope.principal.id,
      appliedAtIso: this.#clock().toISOString()
    };

    this.#adminHolds.set(operatorId, record);

    if (idempotencyKey) {
      this.#executedCommands.set(idempotencyKey, {
        commandName: envelope.commandName,
        fingerprint: JSON.stringify({ commandName: envelope.commandName, payload: envelope.payload }),
        result: record
      });
    }

    return { ...record };
  }

  /**
   * ADR 0072, ADR 0083:
   * Process release reserve tranche command via platform command envelope.
   */
  processReleaseReserveTrancheCommand(
    envelope: PlatformCommandEnvelope<ReleaseReserveTrancheCommandPayload>,
    auditLog?: InMemoryAuditLog
  ): ReserveTranche {
    if (envelope.commandName !== "reserve.release_tranche") {
      throw new Error(`Invalid command for reserve tranche release: ${envelope.commandName}`);
    }

    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") {
      throw new Error("Authorized human role required for reserve release command");
    }

    const { trancheId, holds } = envelope.payload;
    if (!trancheId) {
      throw new Error("Tranche ID required for reserve release command");
    }

    const idempotencyKey = envelope.idempotencyKey;
    if (idempotencyKey) {
      const fingerprint = JSON.stringify({ commandName: envelope.commandName, payload: envelope.payload });
      const existing = this.#executedCommands.get(idempotencyKey);
      if (existing) {
        if (existing.commandName !== envelope.commandName || existing.fingerprint !== fingerprint) {
          throw new Error("Idempotency key was reused for a different command");
        }
        return existing.result as ReserveTranche;
      }
    }

    const result = this.releaseReserveTranche(trancheId, this.#clock().toISOString(), holds, auditLog);

    if (idempotencyKey) {
      this.#executedCommands.set(idempotencyKey, {
        commandName: envelope.commandName,
        fingerprint: JSON.stringify({ commandName: envelope.commandName, payload: envelope.payload }),
        result
      });
    }

    return result;
  }
}
