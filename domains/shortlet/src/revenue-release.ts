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

export interface LedgerAdjustment {
  adjustmentId: string;
  reservationId: string;
  type: "ledger_adjustment";
  reason: string;
  adjustmentKobo: number;
  recordedAtIso: string;
}

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
