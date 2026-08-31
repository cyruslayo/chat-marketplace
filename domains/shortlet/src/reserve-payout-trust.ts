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

export interface OperatorScopeAuthority {
  isOperatorInTenant(params: { operatorId: string; tenantId: string }): boolean;
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

export interface PayoutPlanResult {
  reservationId: string;
  operatorId: string;
  tenantId: string;
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
  tenantId: string;
  holdActive: boolean;
  reason: string;
  appliedByUserId: string;
  appliedAtIso: string;
}

export interface AdminPayoutOverridePayload {
  operatorId: string;
  tenantId: string;
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
  readonly scopeAuthority?: OperatorScopeAuthority;
  readonly accountingRepository?: RevenueAccountingRepository;
  readonly clock?: () => Date;
}

/**
 * ADR 0021, ADR 0024, ADR 0025, ADR 0026, ADR 0062, ADR 0063, ADR 0064, ADR 0072, ADR 0075, ADR 0083:
 * Calculates rolling reserve and settlement availability consuming authoritative Revenue Release economics,
 * evaluates Operator Trust Tier strictly from mandatory reliability and enforcement authorities,
 * commits explicit balanced ledger reclassifications for Trust Tier settlement changes and Full Post-Stay eligibility,
 * manages reserve tranches with atomic ledger adjustments, and enforces mandatory idempotency and authoritative tenant scope.
 */
export class ReservePayoutManager {
  readonly #tranches = new Map<string, ReserveTranche>();
  readonly #adminHolds = new Map<string, AdminHoldRecord>();
  readonly #reliabilityAuthority?: OperatorReliabilityAuthority;
  readonly #enforcementAuthority?: OperatorEnforcementAuthority;
  readonly #scopeAuthority?: OperatorScopeAuthority;
  readonly #accountingRepository?: RevenueAccountingRepository;
  readonly #clock: () => Date;
  readonly #executedCommands = new Map<string, { commandName: string; fingerprint: string; result: unknown }>();

  constructor(options: ReservePayoutManagerOptions = {}) {
    this.#reliabilityAuthority = options.reliabilityAuthority;
    this.#enforcementAuthority = options.enforcementAuthority;
    this.#scopeAuthority = options.scopeAuthority;
    this.#accountingRepository = options.accountingRepository;
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * ADR 0063, ADR 0064, ADR 0083:
   * Evaluates Operator Trust Tier strictly from mandatory platform reliability and enforcement authorities.
   */
  evaluateOperatorTrustTier(context: { operatorId: string; tenantId: string }): TrustTierEvaluation {
    if (!context || !context.operatorId || !context.tenantId) {
      throw new Error("operatorId and tenantId are required to evaluate trust tier");
    }
    if (!this.#reliabilityAuthority) {
      throw new Error("Authoritative reliability authority is required to evaluate trust tier");
    }
    if (!this.#enforcementAuthority) {
      throw new Error("Authoritative enforcement authority is required to evaluate trust tier");
    }

    const { operatorId, tenantId } = context;
    const policyVersion = "v1.0-launch";
    const evaluatedAtIso = this.#clock().toISOString();
    const reasons: string[] = [];
    let activeEnforcementBlocked = false;

    const proj = this.#enforcementAuthority.getProjections({ operatorId });
    if (proj.enforcementLevel !== "coaching" || proj.operatorStatus !== "active" || proj.protectiveActionActive || proj.appealPending) {
      activeEnforcementBlocked = true;
      reasons.push(`Active operator enforcement: level=${proj.enforcementLevel}, status=${proj.operatorStatus}`);
    }

    const rel = this.#reliabilityAuthority.getReliability({ operatorId, tenantId });
    const completedBookings60d = rel.trailing60dCompletedBookings;
    const completedBookings180d = rel.trailing180dCompletedBookings;
    const reliabilityScore60d = rel.trailing60dReliabilityRate;
    const reliabilityScore180d = rel.trailing180dReliabilityRate;

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
   * Calculates settlement classification, commits explicit balanced ledger adjustments for Trust Tier
   * settlement changes and Full Post-Stay timing eligibility, and ensures returned projection agrees with ledger state.
   */
  calculatePayoutPlanAndReserve({
    revenueRelease,
    standardPayoutPreference = "fast_payout",
    holds
  }: {
    revenueRelease: ProductionRevenueReleaseRecord;
    standardPayoutPreference?: "fast_payout" | "full_post_stay";
    holds?: PayoutHoldConditions;
  }): PayoutPlanResult {
    if (!revenueRelease) {
      throw new Error("Authoritative ProductionRevenueReleaseRecord is mandatory for settlement calculation");
    }

    const { reservationId, operatorId, tenantId, commissionBaseKobo, commissionRate, commissionKobo, operatorNetKobo, releaseId } = revenueRelease;
    const policyVersion = "v1.0-launch";
    const nowIso = this.#clock().toISOString();
    const nowTime = this.#clock().getTime();

    // Evaluate authoritative Trust Tier
    const trustTierEval = this.evaluateOperatorTrustTier({ operatorId, tenantId });
    const tier = trustTierEval.tier;

    // Check hold overrides (ADR 0026, ADR 0063, ADR 0083)
    const overrideReasons: string[] = [];
    const adminHold = this.#adminHolds.get(operatorId);
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

    const hasHolds = overrideReasons.length > 0;

    let payoutPlan: PayoutPlanType;
    let payableNowKobo = 0;
    let reserveTrancheKobo = 0;
    let payoutAccelerated = true;

    // Determine target settlement classification based on Trust Tier & plan preference
    if (tier === "preferred") {
      payoutPlan = "preferred_100_access";
      if (hasHolds) {
        payoutAccelerated = false;
        payableNowKobo = 0;
        reserveTrancheKobo = 0;
      } else {
        // Preferred target: 100% payable now, 0 reserve
        payableNowKobo = operatorNetKobo;
        reserveTrancheKobo = 0;

        // Reconcile with ledger: If initial release was fast_payout with routine reserve, post adjustment
        if (this.#accountingRepository && revenueRelease.routineReserveTrancheKobo > 0) {
          const adjId = `adj-reclass-preferred-${reservationId}`;
          const lines: RevenueLedgerLine[] = [
            { lineId: `${adjId}:1`, account: "rolling_reserve", side: "debit", amountKobo: revenueRelease.routineReserveTrancheKobo, currency: "NGN" },
            { lineId: `${adjId}:2`, account: "operator_payable", side: "credit", amountKobo: revenueRelease.routineReserveTrancheKobo, currency: "NGN" }
          ];
          const adjJournal = journal({ correlationId: releaseId, lines, createdAt: nowIso });
          const adj: RevenueAdjustmentRecord = {
            adjustmentId: adjId,
            adjustmentVersion: 1,
            reservationId,
            releaseId,
            source: "other_accepted_source",
            sourceReference: `tier_reclassification_preferred_${tier}`,
            reasonCode: "trust_tier_preferred_reclassification",
            journal: adjJournal
          };
          this.#accountingRepository.postAdjustment({ adjustment: adj });
        }
      }
    } else if (tier === "proven") {
      payoutPlan = "proven_95_5";
      if (hasHolds) {
        payoutAccelerated = false;
        payableNowKobo = 0;
        reserveTrancheKobo = 0;
      } else {
        // Proven target: 95% payable, 5% reserve
        payableNowKobo = Math.floor(operatorNetKobo * 0.95);
        reserveTrancheKobo = operatorNetKobo - payableNowKobo;

        // Reconcile with ledger: Move additional 5% from reserve to payable if initial release had 10% reserve
        const initialReserve = revenueRelease.routineReserveTrancheKobo;
        const reclassAmount = initialReserve - reserveTrancheKobo;
        if (this.#accountingRepository && reclassAmount > 0) {
          const adjId = `adj-reclass-proven-${reservationId}`;
          const lines: RevenueLedgerLine[] = [
            { lineId: `${adjId}:1`, account: "rolling_reserve", side: "debit", amountKobo: reclassAmount, currency: "NGN" },
            { lineId: `${adjId}:2`, account: "operator_payable", side: "credit", amountKobo: reclassAmount, currency: "NGN" }
          ];
          const adjJournal = journal({ correlationId: releaseId, lines, createdAt: nowIso });
          const adj: RevenueAdjustmentRecord = {
            adjustmentId: adjId,
            adjustmentVersion: 1,
            reservationId,
            releaseId,
            source: "other_accepted_source",
            sourceReference: `tier_reclassification_proven_${tier}`,
            reasonCode: "trust_tier_proven_reclassification",
            journal: adjJournal
          };
          this.#accountingRepository.postAdjustment({ adjustment: adj });
        }
      }
    } else {
      // Standard Tier
      if (revenueRelease.payoutPlan === "full_post_stay" || standardPayoutPreference === "full_post_stay") {
        payoutPlan = "founding_100_post_checkout";
        const eligibleTime = revenueRelease.postStayPayableEligibleAt ? new Date(revenueRelease.postStayPayableEligibleAt).getTime() : 0;
        const isEligibleTimePassed = eligibleTime > 0 && nowTime >= eligibleTime;

        if (hasHolds || !isEligibleTimePassed) {
          payoutAccelerated = false;
          payableNowKobo = 0;
          reserveTrancheKobo = 0;
          if (!isEligibleTimePassed && !hasHolds) {
            overrideReasons.push("post_stay_deferred_active");
          }
        } else {
          // At or after post-stay eligibility boundary (+24h checkout)
          payableNowKobo = operatorNetKobo;
          reserveTrancheKobo = 0;

          // Transition ledger from post_stay_deferred to operator_payable
          if (this.#accountingRepository && revenueRelease.deferredPostStayKobo > 0) {
            const adjId = `adj-post-stay-payable-${reservationId}`;
            const lines: RevenueLedgerLine[] = [
              { lineId: `${adjId}:1`, account: "post_stay_deferred", side: "debit", amountKobo: revenueRelease.deferredPostStayKobo, currency: "NGN" },
              { lineId: `${adjId}:2`, account: "operator_payable", side: "credit", amountKobo: revenueRelease.deferredPostStayKobo, currency: "NGN" }
            ];
            const adjJournal = journal({ correlationId: releaseId, lines, createdAt: nowIso });
            const adj: RevenueAdjustmentRecord = {
              adjustmentId: adjId,
              adjustmentVersion: 1,
              reservationId,
              releaseId,
              source: "other_accepted_source",
              sourceReference: `post_stay_eligible_${reservationId}`,
              reasonCode: "post_stay_deferred_released_to_payable",
              journal: adjJournal
            };
            this.#accountingRepository.postAdjustment({ adjustment: adj });
          }
        }
      } else {
        payoutPlan = "founding_90_10";
        if (hasHolds) {
          payoutAccelerated = false;
          payableNowKobo = 0;
          reserveTrancheKobo = 0;
        } else {
          payableNowKobo = Math.floor(operatorNetKobo * 0.9);
          reserveTrancheKobo = operatorNetKobo - payableNowKobo;
        }
      }
    }

    let heldAmountKobo = 0;
    if (overrideReasons.length > 0) {
      payoutAccelerated = false;
      heldAmountKobo = operatorNetKobo;
      payableNowKobo = 0;
      reserveTrancheKobo = 0;
    }

    return {
      reservationId,
      operatorId,
      tenantId,
      payoutPlan,
      tier,
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
      calculatedAtIso: nowIso
    };
  }

  /**
   * Registers a reserve tranche for tracking.
   */
  registerReserveTranche(tranche: ReserveTranche): ReserveTranche {
    this.#tranches.set(tranche.trancheId, { ...tranche });
    return { ...tranche };
  }

  getReserveTranche(trancheId: string): ReserveTranche | undefined {
    return this.#tranches.get(trancheId);
  }

  /**
   * ADR 0024, ADR 0025, ADR 0026, ADR 0083:
   * Releases or forfeits a reserve tranche after maturity date, checking for duplicate releases,
   * open liabilities, active holds, and committing balanced ledger movements before updating state.
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

    if (!this.#accountingRepository) {
      throw new Error("Authoritative RevenueAccountingRepository is required for reserve movements");
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

    const releaseId = `revenue-release:${tranche.reservationId}`;

    // Open liabilities offset case
    if (holds?.openLiabilitiesKobo && holds.openLiabilitiesKobo > 0) {
      const lines: RevenueLedgerLine[] = [
        { lineId: `tranche-forfeit:${trancheId}:1`, account: "rolling_reserve", side: "debit", amountKobo: tranche.amountKobo, currency: "NGN" },
        { lineId: `tranche-forfeit:${trancheId}:2`, account: "operator_costs_and_offsets", side: "credit", amountKobo: tranche.amountKobo, currency: "NGN" }
      ];
      const j = journal({ correlationId: releaseId, lines, createdAt: currentIso });
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

      // Atomic commit to ledger first. If it throws, tranche remains held.
      this.#accountingRepository.postAdjustment({ adjustment: adj });

      // Ledger write succeeded -> update state
      tranche.status = "forfeited_for_liability";
      tranche.releasedAtIso = currentIso;
      tranche.ledgerJournalId = j.journalId;
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
    const lines: RevenueLedgerLine[] = [
      { lineId: `tranche-release:${trancheId}:1`, account: "rolling_reserve", side: "debit", amountKobo: tranche.amountKobo, currency: "NGN" },
      { lineId: `tranche-release:${trancheId}:2`, account: "operator_payable", side: "credit", amountKobo: tranche.amountKobo, currency: "NGN" }
    ];
    const j = journal({ correlationId: releaseId, lines, createdAt: currentIso });
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

    // Atomic commit to ledger first. If it throws, tranche remains held.
    this.#accountingRepository.postAdjustment({ adjustment: adj });

    // Ledger write succeeded -> update state
    tranche.status = "released";
    tranche.releasedAtIso = currentIso;
    tranche.ledgerJournalId = j.journalId;
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
   * Process manual admin payout override command using strongly typed envelope, mandatory idempotency,
   * and authoritative operator scope verification.
   */
  processAdminPayoutOverride(envelope: PlatformCommandEnvelope<AdminPayoutOverridePayload>): AdminHoldRecord {
    if (envelope.commandName !== "reserve.override_payout_hold") {
      throw new Error(`Invalid command for admin payout override: ${envelope.commandName}`);
    }

    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") {
      throw new Error("Admin authority required for payout hold override");
    }

    const { operatorId, tenantId, action, reason } = envelope.payload ?? {};
    if (!operatorId || !tenantId || !action || !reason) {
      throw new Error("Complete payload required for admin payout override");
    }

    // Strict tenant match check
    if (!envelope.principal.tenantId || envelope.principal.tenantId !== tenantId) {
      throw new Error("Principal tenant does not match resource tenant");
    }

    // Authoritative Operator/Tenant relationship check
    if (this.#scopeAuthority && !this.#scopeAuthority.isOperatorInTenant({ operatorId, tenantId })) {
      throw new Error(`Operator ${operatorId} does not belong to tenant ${tenantId}`);
    }

    // Mandatory idempotency key
    const idempotencyKey = envelope.idempotencyKey;
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new Error("Idempotency key is required for admin payout override");
    }

    const fingerprint = JSON.stringify({
      commandName: envelope.commandName,
      principalId: envelope.principal.id,
      tenantId: envelope.principal.tenantId,
      payload: envelope.payload
    });

    const existing = this.#executedCommands.get(idempotencyKey);
    if (existing) {
      if (existing.commandName !== envelope.commandName || existing.fingerprint !== fingerprint) {
        throw new Error("Idempotency key was reused for a different command");
      }
      return existing.result as AdminHoldRecord;
    }

    const record: AdminHoldRecord = {
      operatorId,
      tenantId,
      holdActive: action === "apply_hold",
      reason,
      appliedByUserId: envelope.principal.id,
      appliedAtIso: this.#clock().toISOString()
    };

    this.#adminHolds.set(operatorId, record);

    this.#executedCommands.set(idempotencyKey, {
      commandName: envelope.commandName,
      fingerprint,
      result: record
    });

    return { ...record };
  }

  /**
   * ADR 0072, ADR 0083:
   * Process release reserve tranche command via platform command envelope with mandatory idempotency and tenant verification.
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

    const { trancheId, holds } = envelope.payload ?? {};
    if (!trancheId) {
      throw new Error("Tranche ID required for reserve release command");
    }

    const tranche = this.#tranches.get(trancheId);
    if (!tranche) {
      throw new Error(`Reserve tranche not found: ${trancheId}`);
    }

    // Tenant check against tranche resource
    if (!envelope.principal.tenantId || envelope.principal.tenantId !== tranche.tenantId) {
      throw new Error("Principal tenant does not match tranche tenant");
    }

    // Mandatory idempotency key
    const idempotencyKey = envelope.idempotencyKey;
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new Error("Idempotency key is required for reserve release command");
    }

    const fingerprint = JSON.stringify({
      commandName: envelope.commandName,
      principalId: envelope.principal.id,
      tenantId: envelope.principal.tenantId,
      payload: envelope.payload
    });

    const existing = this.#executedCommands.get(idempotencyKey);
    if (existing) {
      if (existing.commandName !== envelope.commandName || existing.fingerprint !== fingerprint) {
        throw new Error("Idempotency key was reused for a different command");
      }
      return existing.result as ReserveTranche;
    }

    const result = this.releaseReserveTranche(trancheId, this.#clock().toISOString(), holds, auditLog);

    this.#executedCommands.set(idempotencyKey, {
      commandName: envelope.commandName,
      fingerprint,
      result
    });

    return result;
  }
}
