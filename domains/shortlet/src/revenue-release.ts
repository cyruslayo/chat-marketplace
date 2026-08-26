import { journal, type RevenueLedgerLine, type RevenueAccountingRepository, type EarnedCommissionRecord } from "./revenue-accounting.js";

export interface RevenueBookingData {
  reservationId: string;
  unitId: string;
  tenantId: string;
  operatorId: string;
  operatorTier?: "standard" | "founding" | "preferred";
  accommodationKobo: number;
  mandatoryChargesKobo: number;
  securityDepositKobo: number;
  attributableTaxKobo: number;
  payoutPlan?: "fast_payout" | "full_post_stay";
}

export interface CommissionAndNetCalculation {
  commissionBaseKobo: number;
  commissionRate: number;
  commissionKobo: number;
  operatorNetKobo: number;
}

export interface BlockingComplaintQuery { hasUnresolvedBlockingComplaint(reservationId: string): boolean; }

export interface RevenueReleaseRecord {
  releaseId: string;
  reservationId: string;
  unitId: string;
  tenantId: string;
  operatorId: string;
  status: "released";
  isPayable: boolean;
  commissionBaseKobo: number;
  commissionRate: number;
  commissionKobo: number;
  operatorNetKobo: number;
  payableNetKobo: number;
  reserveTrancheKobo: number;
  balanced: boolean;
  releasedAtIso: string;
}

export interface AuthoritativeRevenueEconomics {
  readonly economicsVersion: string; readonly currency: "NGN"; readonly commissionPolicyVersion: string; readonly capturedCommissionRate: 0.08 | 0.1 | 0.12;
  readonly commissionableOperatorRevenueKobo: number; readonly operatorBorneProcessorCostsKobo: number; readonly applicableWithholdingKobo: number; readonly preReleaseRefundOrCreditKobo: number; readonly bookingOffsetsKobo: number;
  readonly securityDepositKobo: number; readonly platformRemittedTaxesKobo: number; readonly platformOwnedFeesKobo: number; readonly passThroughKobo: number; readonly undeliveredExtrasKobo: number;
}
export interface AuthoritativeReleaseInput {
  readonly reservationId: string; readonly contractId: string; readonly contractVersion: number; readonly unitId: string; readonly tenantId: string; readonly operatorId: string;
  readonly accessVersion: string; readonly accessStatus: "verified_access" | "late_voluntary_arrival"; readonly verifiedAccessAt: string; readonly economics: AuthoritativeRevenueEconomics;
  readonly payoutPlan: "fast_payout" | "full_post_stay"; readonly payoutPlanVersion: string; readonly effectiveCheckoutAt: string; readonly effectiveCheckoutVersion: string; readonly riskHoldVersion: string; readonly riskHoldKobo: number; readonly now: Date;
}
export interface ProductionRevenueReleaseRecord {
  readonly releaseId: string; readonly releaseVersion: 1; readonly reservationId: string; readonly contractId: string; readonly contractVersion: number; readonly unitId: string; readonly tenantId: string; readonly operatorId: string; readonly accessVersion: string; readonly verifiedAccessAt: string; readonly protectionWindowEndsAt: string; readonly economicsVersion: string; readonly commissionPolicyVersion: string; readonly commissionRate: 0.08 | 0.1 | 0.12; readonly commissionBaseKobo: number; readonly commissionKobo: number; readonly operatorNetKobo: number; readonly payoutPlan: "fast_payout" | "full_post_stay"; readonly payoutPlanVersion: string; readonly payableNowKobo: number; readonly routineReserveTrancheKobo: number; readonly reserveReviewEligibleAt?: string; readonly deferredPostStayKobo: number; readonly postStayPayableEligibleAt?: string; readonly riskHoldVersion: string; readonly riskHoldKobo: number; readonly ledgerJournalId: string; readonly earnedCommissionRecordId: string; readonly effectiveCheckoutVersion: string; readonly releasedAt: string; readonly currency: "NGN";
}
export interface LedgerAdjustment { adjustmentId: string; reservationId: string; type: "ledger_adjustment"; reason: string; adjustmentKobo: number; recordedAtIso: string; }

/**
 * ADR 0021, ADR 0024, ADR 0026, ADR 0062:
 * Calculates commission and Operator Net, enforces Check-In Protection Window,
 * and posts single authoritative Revenue Release and ledger adjustments.
 */
export class RevenueReleaseManager {
  readonly #releases = new Map<string, RevenueReleaseRecord>();
  readonly #blockingComplaintQuery?: BlockingComplaintQuery;
  constructor(options: { readonly blockingComplaintQuery?: BlockingComplaintQuery } = {}) { this.#blockingComplaintQuery = options.blockingComplaintQuery; }
  readonly #adjustments: LedgerAdjustment[] = [];

  /**
   * ADR 0062: Commission rates (standard 12%, founding 8%, preferred 10%) on accommodation and mandatory charges.
   */
  calculateCommissionAndNet(booking: RevenueBookingData): CommissionAndNetCalculation {
    const commissionBaseKobo = booking.accommodationKobo + booking.mandatoryChargesKobo;
    const tier = booking.operatorTier ?? "standard";

    let commissionRate = 0.12;
    if (tier === "founding") {
      commissionRate = 0.08;
    } else if (tier === "preferred") {
      commissionRate = 0.1;
    }

    const commissionKobo = Math.floor(commissionBaseKobo * commissionRate);
    const operatorNetKobo = commissionBaseKobo - commissionKobo;

    return {
      commissionBaseKobo,
      commissionRate,
      commissionKobo,
      operatorNetKobo
    };
  }

  /**
   * ADR 0021 & ADR 0024 & ADR 0026:
   * Single Revenue Release after Verified Access + 24 hours without unresolved complaint.
   */
  processRevenueRelease({
    booking,
    verifiedAccessIso,
    currentIso,
    hasUnresolvedBlockingComplaint
  }: {
    booking: RevenueBookingData;
    verifiedAccessIso: string;
    currentIso: string;
    hasUnresolvedBlockingComplaint: boolean;
  }): RevenueReleaseRecord {
    if (this.#releases.has(booking.reservationId)) {
      throw new Error(`Revenue release already processed for reservation ${booking.reservationId}`);
    }

    const verifiedTime = new Date(verifiedAccessIso).getTime();
    const currentTime = new Date(currentIso).getTime();

    // Check-In Protection Window (24 hours after Verified Access)
    if (currentTime - verifiedTime < 24 * 3600 * 1000) {
      throw new Error("Check-In Protection Window active: Revenue release requires Verified Access plus 24 hours");
    }

    const complaintOpen = this.#blockingComplaintQuery?.hasUnresolvedBlockingComplaint(booking.reservationId) ?? hasUnresolvedBlockingComplaint;
    if (complaintOpen) {
      throw new Error("Revenue release blocked: Unresolved Blocking Fulfilment Complaint exists");
    }

    const calc = this.calculateCommissionAndNet(booking);
    const payoutPlan = booking.payoutPlan ?? "fast_payout";

    let payableNetKobo = calc.operatorNetKobo;
    let reserveTrancheKobo = 0;

    if (payoutPlan === "fast_payout") {
      // 90% payable, 10% rolling reserve tranche (ADR 0026)
      payableNetKobo = Math.floor(calc.operatorNetKobo * 0.9);
      reserveTrancheKobo = calc.operatorNetKobo - payableNetKobo;
    } else {
      // Full post-stay payout (100% payable)
      payableNetKobo = calc.operatorNetKobo;
      reserveTrancheKobo = 0;
    }

    const releaseId = `rev_rel_${booking.reservationId}`;
    const record: RevenueReleaseRecord = {
      releaseId,
      reservationId: booking.reservationId,
      unitId: booking.unitId,
      tenantId: booking.tenantId,
      operatorId: booking.operatorId,
      status: "released",
      isPayable: true,
      commissionBaseKobo: calc.commissionBaseKobo,
      commissionRate: calc.commissionRate,
      commissionKobo: calc.commissionKobo,
      operatorNetKobo: calc.operatorNetKobo,
      payableNetKobo,
      reserveTrancheKobo,
      balanced: payableNetKobo + reserveTrancheKobo === calc.operatorNetKobo,
      releasedAtIso: currentIso
    };

    this.#releases.set(booking.reservationId, record);
    return { ...record };
  }

  /** Production authority: providers supply trusted facts; this class applies only release policy and arithmetic. */
  buildProductionRelease(input: AuthoritativeReleaseInput): { release: ProductionRevenueReleaseRecord; journalLines: readonly RevenueLedgerLine[]; earnedCommission: EarnedCommissionRecord } {
    const e = input.economics;
    const amounts = [e.commissionableOperatorRevenueKobo, e.operatorBorneProcessorCostsKobo, e.applicableWithholdingKobo, e.preReleaseRefundOrCreditKobo, e.bookingOffsetsKobo, e.securityDepositKobo, e.platformRemittedTaxesKobo, e.platformOwnedFeesKobo, e.passThroughKobo, e.undeliveredExtrasKobo];
    if (e.currency !== "NGN" || !e.economicsVersion.trim() || !e.commissionPolicyVersion.trim() || amounts.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("Invalid authoritative revenue economics");
    if (input.accessStatus !== "verified_access" && input.accessStatus !== "late_voluntary_arrival") throw new Error("Revenue release requires valid access");
    if (e.capturedCommissionRate !== 0.08 && e.capturedCommissionRate !== 0.1 && e.capturedCommissionRate !== 0.12) throw new Error("Captured commission rate is invalid");
    const end = new Date(new Date(input.verifiedAccessAt).getTime() + 24 * 60 * 60 * 1000); if (!Number.isFinite(end.getTime()) || input.now.getTime() < end.getTime()) throw new Error("Check-In Protection Window active: Revenue release requires Verified Access plus 24 hours");
    const commissionKobo = Math.floor(e.commissionableOperatorRevenueKobo * e.capturedCommissionRate); const deductions = e.operatorBorneProcessorCostsKobo + e.applicableWithholdingKobo + e.preReleaseRefundOrCreditKobo + e.bookingOffsetsKobo; const operatorNetKobo = e.commissionableOperatorRevenueKobo - commissionKobo - deductions; if (operatorNetKobo < 0) throw new Error("Operator Net cannot be negative");
    let payableNowKobo = 0; let reserve = 0; let deferred = 0; let reserveReviewEligibleAt: string | undefined; let postStayPayableEligibleAt: string | undefined;
    if (input.payoutPlan === "fast_payout") { const beforeRisk = Math.floor(operatorNetKobo * 0.9); if (input.riskHoldKobo > beforeRisk) throw new Error("Risk hold exceeds Fast Payout payable amount"); payableNowKobo = beforeRisk - input.riskHoldKobo; reserve = operatorNetKobo - beforeRisk; reserveReviewEligibleAt = new Date(new Date(input.effectiveCheckoutAt).getTime() + 30 * 86400000).toISOString(); } else { if (input.riskHoldKobo > operatorNetKobo) throw new Error("Risk hold exceeds Operator Net"); deferred = operatorNetKobo; postStayPayableEligibleAt = new Date(new Date(input.effectiveCheckoutAt).getTime() + 24 * 3600000).toISOString(); }
    if (payableNowKobo + reserve + deferred + (input.payoutPlan === "fast_payout" ? input.riskHoldKobo : 0) !== operatorNetKobo) throw new Error("Operator Net settlement classification is unbalanced");
    const releaseId = `revenue-release:${input.reservationId}`; const earnedCommissionRecordId = `earned-commission:${releaseId}`;
    const base = { releaseId, releaseVersion: 1 as const, reservationId: input.reservationId, contractId: input.contractId, contractVersion: input.contractVersion, unitId: input.unitId, tenantId: input.tenantId, operatorId: input.operatorId, accessVersion: input.accessVersion, verifiedAccessAt: input.verifiedAccessAt, protectionWindowEndsAt: end.toISOString(), economicsVersion: e.economicsVersion, commissionPolicyVersion: e.commissionPolicyVersion, commissionRate: e.capturedCommissionRate, commissionBaseKobo: e.commissionableOperatorRevenueKobo, commissionKobo, operatorNetKobo, payoutPlan: input.payoutPlan, payoutPlanVersion: input.payoutPlanVersion, payableNowKobo, routineReserveTrancheKobo: reserve, ...(reserveReviewEligibleAt ? { reserveReviewEligibleAt } : {}), deferredPostStayKobo: deferred, ...(postStayPayableEligibleAt ? { postStayPayableEligibleAt } : {}), riskHoldVersion: input.riskHoldVersion, riskHoldKobo: input.riskHoldKobo, effectiveCheckoutVersion: input.effectiveCheckoutVersion, releasedAt: input.now.toISOString(), currency: "NGN" as const };
    const lines: RevenueLedgerLine[] = [{ lineId: `${releaseId}:1`, account: "revenue_pending", side: "debit", amountKobo: e.commissionableOperatorRevenueKobo, currency: "NGN" }, { lineId: `${releaseId}:2`, account: "platform_commission_earned", side: "credit", amountKobo: commissionKobo, currency: "NGN" }, { lineId: `${releaseId}:3`, account: "operator_net_recognized", side: "credit", amountKobo: operatorNetKobo, currency: "NGN" }, { lineId: `${releaseId}:3a`, account: "operator_costs_and_offsets", side: "credit", amountKobo: deductions, currency: "NGN" }, { lineId: `${releaseId}:4`, account: "operator_net_recognized", side: "debit", amountKobo: operatorNetKobo, currency: "NGN" }, { lineId: `${releaseId}:5`, account: "operator_payable", side: "credit", amountKobo: payableNowKobo, currency: "NGN" }, { lineId: `${releaseId}:6`, account: "rolling_reserve", side: "credit", amountKobo: reserve, currency: "NGN" }, { lineId: `${releaseId}:7`, account: "post_stay_deferred", side: "credit", amountKobo: deferred, currency: "NGN" }, ...(input.payoutPlan === "fast_payout" ? [{ lineId: `${releaseId}:8`, account: "risk_restricted" as const, side: "credit" as const, amountKobo: input.riskHoldKobo, currency: "NGN" as const }] : [])];
    const builtJournal = journal({ correlationId: releaseId, lines, createdAt: input.now.toISOString() }); const earnedCommission: EarnedCommissionRecord = { recordId: earnedCommissionRecordId, releaseId, reservationId: input.reservationId, commissionPolicyVersion: e.commissionPolicyVersion, earnedCommissionKobo: commissionKobo, currency: "NGN", earnedAt: input.now.toISOString() };
    return { release: Object.freeze({ ...base, ledgerJournalId: builtJournal.journalId, earnedCommissionRecordId }), journalLines: builtJournal.lines, earnedCommission: Object.freeze(earnedCommission) };
  }
  commitProductionRelease(input: AuthoritativeReleaseInput, repository: RevenueAccountingRepository): ProductionRevenueReleaseRecord { const built = this.buildProductionRelease(input); const existing = repository.findReleaseByReservationId(input.reservationId); if (existing) return existing as ProductionRevenueReleaseRecord; const committed = repository.commitRelease({ release: built.release, journal: journal({ correlationId: built.release.releaseId, lines: built.journalLines, createdAt: input.now.toISOString() }), earnedCommission: built.earnedCommission }); return committed as ProductionRevenueReleaseRecord; }

  /**
   * ADR 0024:
   * Explicit ledger adjustments for corrections.
   */
  postLedgerAdjustment({
    reservationId,
    reason,
    adjustmentKobo,
    recordedAtIso
  }: {
    reservationId: string;
    reason: string;
    adjustmentKobo: number;
    recordedAtIso: string;
  }): LedgerAdjustment {
    const adjustmentId = `adj_${reservationId}_${Math.random().toString(36).slice(2)}`;
    const record: LedgerAdjustment = {
      adjustmentId,
      reservationId,
      type: "ledger_adjustment",
      reason,
      adjustmentKobo,
      recordedAtIso
    };

    this.#adjustments.push(record);
    return { ...record };
  }
}
