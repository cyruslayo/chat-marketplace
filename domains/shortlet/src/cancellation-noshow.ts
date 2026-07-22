import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type CancellationPolicyType = "flexible" | "standard" | "firm";
export type CancellationLiability = "guest" | "operator_failure" | "platform_failure" | "force_majeure" | "legal_override";

export interface BookingCancellationDetails {
  bookingId: string;
  policyType: CancellationPolicyType;
  checkInIso: string;
  cancellationBaseKobo: number;
  cleaningFeeKobo: number;
  unprovidedServicesKobo: number;
  securityDepositKobo: number;
  attributableTaxKobo: number;
  duplicatePaymentKobo?: number;
}

export interface CancellationRefundBreakdown {
  bookingId: string;
  liability: CancellationLiability;
  fundingSource: string;
  refundPercentage: number;
  cancellationBaseRefundKobo: number;
  cleaningFeeRefundKobo: number;
  unprovidedServicesRefundKobo: number;
  securityDepositRefundKobo: number;
  attributableTaxRefundKobo: number;
  duplicatePaymentRefundKobo: number;
  totalRefundKobo: number;
}

export interface NoShowDetermination {
  bookingId: string;
  status: "no_show_confirmed";
  humanConfirmed: boolean;
  contactAttemptsFailed: boolean;
  confirmedAtIso: string;
}

/**
 * ADR 0014, ADR 0015, ADR 0016, ADR 0058:
 * Standardized cancellation policies, non-base refund exclusions, liability attribution, and No-Show determination.
 */
export class CancellationNoShowManager {
  /**
   * ADR 0058: Policy boundary calculations for Flexible, Standard, and Firm policies.
   */
  calculateGuestCancellation({
    policyType,
    checkInIso,
    cancellationBaseKobo,
    cancelledAtIso
  }: {
    policyType: CancellationPolicyType;
    checkInIso: string;
    cancellationBaseKobo: number;
    cancelledAtIso: string;
  }): { refundPercentage: number; cancellationBaseRefundKobo: number } {
    const checkInTime = new Date(checkInIso).getTime();
    const cancelledTime = new Date(cancelledAtIso).getTime();
    const hoursDiff = (checkInTime - cancelledTime) / (3600 * 1000);

    let refundPercentage = 0;

    if (policyType === "flexible") {
      if (hoursDiff >= 72) {
        refundPercentage = 100;
      } else if (hoursDiff >= 24) {
        refundPercentage = 50;
      } else {
        refundPercentage = 0;
      }
    } else if (policyType === "standard") {
      if (hoursDiff >= 14 * 24) {
        // T-14d
        refundPercentage = 100;
      } else if (hoursDiff >= 7 * 24) {
        // T-7d
        refundPercentage = 50;
      } else {
        refundPercentage = 0;
      }
    } else if (policyType === "firm") {
      if (hoursDiff >= 30 * 24) {
        // T-30d
        refundPercentage = 100;
      } else if (hoursDiff >= 14 * 24) {
        // T-14d
        refundPercentage = 50;
      } else {
        refundPercentage = 0;
      }
    }

    const cancellationBaseRefundKobo = Math.floor(cancellationBaseKobo * (refundPercentage / 100));

    return {
      refundPercentage,
      cancellationBaseRefundKobo
    };
  }

  /**
   * ADR 0014, ADR 0015, ADR 0016:
   * Calculates complete cancellation refund by excluding non-base items (deposits, cleaning, unprovided services, taxes).
   */
  calculateFullCancellationRefund({
    booking,
    cancelledAtIso,
    liability
  }: {
    booking: BookingCancellationDetails;
    cancelledAtIso: string;
    liability: CancellationLiability;
  }): CancellationRefundBreakdown {
    const cleaningFeeRefundKobo = booking.cleaningFeeKobo;
    const unprovidedServicesRefundKobo = booking.unprovidedServicesKobo;
    const securityDepositRefundKobo = booking.securityDepositKobo;
    const attributableTaxRefundKobo = booking.attributableTaxKobo;
    const duplicatePaymentRefundKobo = booking.duplicatePaymentKobo ?? 0;

    let refundPercentage = 0;
    let cancellationBaseRefundKobo = 0;
    let fundingSource = "policy_refund";

    if (liability === "guest") {
      const calc = this.calculateGuestCancellation({
        policyType: booking.policyType,
        checkInIso: booking.checkInIso,
        cancellationBaseKobo: booking.cancellationBaseKobo,
        cancelledAtIso
      });
      refundPercentage = calc.refundPercentage;
      cancellationBaseRefundKobo = calc.cancellationBaseRefundKobo;
      fundingSource = "policy_refund";
    } else if (liability === "operator_failure") {
      refundPercentage = 100;
      cancellationBaseRefundKobo = booking.cancellationBaseKobo;
      fundingSource = "operator";
    } else if (liability === "platform_failure") {
      refundPercentage = 100;
      cancellationBaseRefundKobo = booking.cancellationBaseKobo;
      fundingSource = "platform";
    } else if (liability === "force_majeure") {
      refundPercentage = 100;
      cancellationBaseRefundKobo = booking.cancellationBaseKobo;
      fundingSource = "force_majeure_fund";
    } else if (liability === "legal_override") {
      refundPercentage = 100;
      cancellationBaseRefundKobo = booking.cancellationBaseKobo;
      fundingSource = "statutory_override";
    }

    const totalRefundKobo =
      cancellationBaseRefundKobo +
      cleaningFeeRefundKobo +
      unprovidedServicesRefundKobo +
      securityDepositRefundKobo +
      attributableTaxRefundKobo +
      duplicatePaymentRefundKobo;

    return {
      bookingId: booking.bookingId,
      liability,
      fundingSource,
      refundPercentage,
      cancellationBaseRefundKobo,
      cleaningFeeRefundKobo,
      unprovidedServicesRefundKobo,
      securityDepositRefundKobo,
      attributableTaxRefundKobo,
      duplicatePaymentRefundKobo,
      totalRefundKobo
    };
  }

  /**
   * ADR 0072 & ADR 0080:
   * Process cancellation via Platform Command Envelope with deterministic parity.
   */
  processCancellationCommand(
    envelope: PlatformCommandEnvelope<any>,
    booking: BookingCancellationDetails,
    cancelledAtIso: string
  ) {
    if (envelope.commandName !== "cancellation.process") {
      throw new Error(`Invalid command for cancellation: ${envelope.commandName}`);
    }

    const liability: CancellationLiability = envelope.payload?.liability ?? "guest";
    const calculation = this.calculateFullCancellationRefund({
      booking,
      cancelledAtIso,
      liability
    });

    const ledgerEntry = {
      ledgerId: `ledger_cxl_${booking.bookingId}`,
      bookingId: booking.bookingId,
      type: "cancellation_refund",
      amountKobo: calculation.totalRefundKobo,
      fundingSource: calculation.fundingSource,
      currency: "NGN",
      processedAt: new Date().toISOString()
    };

    const auditRecord = {
      commandId: envelope.commandId,
      commandName: envelope.commandName,
      principalId: envelope.principal.id,
      tenantId: envelope.principal.tenantId,
      result: calculation
    };

    return {
      calculation,
      ledgerEntry,
      auditRecord
    };
  }

  /**
   * ADR 0058:
   * No-Show requires failed contact and human confirmation at 10:00 AM WAT the next day.
   */
  determineNoShow({
    bookingId,
    checkInDate,
    attemptIso,
    contactAttemptsFailed,
    humanConfirmed
  }: {
    bookingId: string;
    checkInDate: string;
    attemptIso: string;
    contactAttemptsFailed: boolean;
    humanConfirmed: boolean;
  }): NoShowDetermination {
    // 10:00 AM WAT on day after checkInDate
    // Lagos is UTC+1. So 10:00 AM WAT = 09:00 AM UTC.
    const checkInDateObj = new Date(`${checkInDate}T00:00:00.000Z`);
    const nextDayObj = new Date(checkInDateObj.getTime() + 24 * 3600 * 1000);
    const year = nextDayObj.getUTCFullYear();
    const month = String(nextDayObj.getUTCMonth() + 1).padStart(2, "0");
    const day = String(nextDayObj.getUTCDate()).padStart(2, "0");

    const noShowDeadlineIso = `${year}-${month}-${day}T09:00:00.000Z`;

    if (new Date(attemptIso).getTime() < new Date(noShowDeadlineIso).getTime()) {
      throw new Error("No-Show can only be determined at or after 10:00 AM WAT the day after scheduled arrival");
    }

    if (!contactAttemptsFailed) {
      throw new Error("No-Show determination requires failed contact attempts");
    }

    if (!humanConfirmed) {
      throw new Error("No-Show determination requires explicit human confirmation");
    }

    return {
      bookingId,
      status: "no_show_confirmed",
      humanConfirmed: true,
      contactAttemptsFailed: true,
      confirmedAtIso: attemptIso
    };
  }
}
