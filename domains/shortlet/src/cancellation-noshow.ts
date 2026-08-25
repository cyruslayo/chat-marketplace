import type { BookingContract, Reservation } from "./card-payment.js";
import type { BookingStateRepository } from "./booking-state.js";

export type CancellationPolicyType = "flexible" | "standard" | "firm";
export type CancellationLiability = "guest" | "operator_failure" | "platform_failure" | "force_majeure" | "legal_override";
export type FundingSource = "policy_refund" | "operator" | "platform" | "force_majeure_fund" | "statutory_override";

export interface CancellationPolicySnapshot { readonly type: CancellationPolicyType; readonly version: string; readonly policySummary: string; }
export interface CancellationEconomics {
  readonly version: string; readonly currency: "NGN";
  readonly cancellationBaseKobo: number; readonly refundableCleaningKobo: number;
  readonly refundableUnprovidedServicesKobo: number; readonly refundableSecurityDepositKobo: number;
  readonly refundableAttributableTaxKobo: number; readonly refundableDuplicatePaymentKobo: number;
  readonly commissionRate: number;
}
export interface CancellationRefundBreakdown {
  readonly bookingId: string; readonly liability: CancellationLiability; readonly fundingSource: FundingSource;
  readonly refundPercentage: number; readonly cancellationBaseRefundKobo: number;
  readonly cleaningFeeRefundKobo: number; readonly unprovidedServicesRefundKobo: number;
  readonly securityDepositRefundKobo: number; readonly attributableTaxRefundKobo: number;
  readonly duplicatePaymentRefundKobo: number; readonly totalRefundKobo: number;
  readonly retainedCancellationBaseKobo: number; readonly retainedCommissionKobo: number;
}
export interface CancellationEconomicsProvider { getEconomics(input: { reservationId: string; contract: BookingContract }): CancellationEconomics; }
export interface CancellationArrivalStateProvider { getState(reservationId: string): { status: "awaiting_access" | "verified_access" | "late_voluntary_arrival" | "failed_access" | "under_human_review"; version: string }; }
export interface ContractualCheckInWindowProvider { getWindow(reservationId: string, contract: BookingContract): { startIso: string; timezone: "Africa/Lagos" }; }
export interface CancellationLiabilityAuthority { getDecision(input: { reservationId: string }): { decisionId: string; decisionVersion: string; liability: CancellationLiability; valid: boolean }; }
export interface NoShowContactAttemptProvider { getStatus(reservationId: string): { version: string; requiredAttemptsCompleted: boolean; contactFailed: boolean }; }

export interface CancellationCalculationInput { readonly reservationId: string; readonly contract: BookingContract; readonly economics: CancellationEconomics; readonly policy: CancellationPolicySnapshot; readonly checkInWindowStartIso: string; readonly at: Date; readonly liability: CancellationLiability; }

function validKobo(value: number): boolean { return Number.isFinite(value) && Number.isInteger(value) && value >= 0; }
export function validateCancellationEconomics(value: CancellationEconomics): void {
  const amounts = [value.cancellationBaseKobo, value.refundableCleaningKobo, value.refundableUnprovidedServicesKobo, value.refundableSecurityDepositKobo, value.refundableAttributableTaxKobo, value.refundableDuplicatePaymentKobo];
  if (value.currency !== "NGN" || !value.version.trim() || amounts.some((amount) => !validKobo(amount)) || !Number.isFinite(value.commissionRate) || value.commissionRate < 0 || value.commissionRate > 1) throw new Error("Invalid authoritative cancellation economics");
}
export function validateCancellationPolicy(policy: unknown): CancellationPolicySnapshot {
  if (!policy || typeof policy !== "object") throw new Error("Captured cancellation policy is required");
  const candidate = policy as { type?: unknown; version?: unknown; policySummary?: unknown; summary?: unknown };
  if (candidate.type !== "flexible" && candidate.type !== "standard" && candidate.type !== "firm") throw new Error("Invalid cancellation policy");
  if (typeof candidate.version !== "string" || candidate.version.trim() === "") throw new Error("Captured cancellation policy version is required");
  return Object.freeze({ type: candidate.type, version: candidate.version, policySummary: typeof candidate.policySummary === "string" ? candidate.policySummary : typeof candidate.summary === "string" ? candidate.summary : "" });
}

/** Authoritative calculation and No-Show rules. State-changing orchestration remains in the application boundary. */
export class CancellationNoShowManager {
  calculateGuestCancellation(input: { policyType: CancellationPolicyType; checkInIso: string; cancellationBaseKobo: number; cancelledAtIso: string }): { refundPercentage: number; cancellationBaseRefundKobo: number } {
    const checkIn = new Date(input.checkInIso).getTime(); const cancelled = new Date(input.cancelledAtIso).getTime();
    if (!Number.isFinite(checkIn) || !Number.isFinite(cancelled) || !validKobo(input.cancellationBaseKobo)) throw new Error("Invalid cancellation calculation input");
    const elapsed = checkIn - cancelled;
    const full = input.policyType === "flexible" ? 72 * 3600_000 : input.policyType === "standard" ? 14 * 86400_000 : 30 * 86400_000;
    const partial = input.policyType === "flexible" ? 24 * 3600_000 : input.policyType === "standard" ? 7 * 86400_000 : 14 * 86400_000;
    const refundPercentage = elapsed >= full ? 100 : elapsed >= partial ? 50 : 0;
    return { refundPercentage, cancellationBaseRefundKobo: Math.floor(input.cancellationBaseKobo * refundPercentage / 100) };
  }

  calculateAuthoritative(input: CancellationCalculationInput): CancellationRefundBreakdown {
    validateCancellationEconomics(input.economics); const policy = validateCancellationPolicy(input.policy);
    const basePercentage = input.liability === "guest" ? this.calculateGuestCancellation({ policyType: policy.type, checkInIso: input.checkInWindowStartIso, cancellationBaseKobo: input.economics.cancellationBaseKobo, cancelledAtIso: input.at.toISOString() }).refundPercentage : 100;
    const baseRefund = Math.floor(input.economics.cancellationBaseKobo * basePercentage / 100);
    const always = input.economics.refundableCleaningKobo + input.economics.refundableUnprovidedServicesKobo + input.economics.refundableSecurityDepositKobo + input.economics.refundableAttributableTaxKobo + input.economics.refundableDuplicatePaymentKobo;
    const fundingSource: FundingSource = input.liability === "operator_failure" ? "operator" : input.liability === "platform_failure" ? "platform" : input.liability === "force_majeure" ? "force_majeure_fund" : input.liability === "legal_override" ? "statutory_override" : "policy_refund";
    return { bookingId: input.reservationId, liability: input.liability, fundingSource, refundPercentage: basePercentage, cancellationBaseRefundKobo: baseRefund, cleaningFeeRefundKobo: input.economics.refundableCleaningKobo, unprovidedServicesRefundKobo: input.economics.refundableUnprovidedServicesKobo, securityDepositRefundKobo: input.economics.refundableSecurityDepositKobo, attributableTaxRefundKobo: input.economics.refundableAttributableTaxKobo, duplicatePaymentRefundKobo: input.economics.refundableDuplicatePaymentKobo, totalRefundKobo: baseRefund + always, retainedCancellationBaseKobo: input.economics.cancellationBaseKobo - baseRefund, retainedCommissionKobo: Math.floor((input.economics.cancellationBaseKobo - baseRefund) * input.economics.commissionRate) };
  }

  noShowDeadline(checkInDate: string): string {
    const date = new Date(`${checkInDate}T00:00:00.000Z`); if (!Number.isFinite(date.getTime())) throw new Error("Invalid check-in date");
    date.setUTCDate(date.getUTCDate() + 1); return `${date.toISOString().slice(0, 10)}T09:00:00.000Z`;
  }

  assertNoShowEligible(input: { reservation: Reservation; checkInDate: string; now: Date; arrival: ReturnType<CancellationArrivalStateProvider["getState"]>; contact: ReturnType<NoShowContactAttemptProvider["getStatus"]> }): void {
    if (input.reservation.status !== "confirmed") throw new Error("Reservation is not eligible for No-Show");
    if (input.now.getTime() < new Date(this.noShowDeadline(input.checkInDate)).getTime()) throw new Error("No-Show can only be determined at or after 10:00 AM WAT the day after scheduled arrival");
    if (["verified_access", "late_voluntary_arrival", "failed_access", "under_human_review"].includes(input.arrival.status)) throw new Error("Arrival evidence contradicts No-Show");
    if (!input.contact.requiredAttemptsCompleted || !input.contact.contactFailed) throw new Error("No-Show determination requires failed contact attempts");
  }

  // Compatibility calculation retained for existing callers; production application uses calculateAuthoritative.
  processCancellationCommand(envelope: { commandName: string; commandId: string; principal: { id: string }; payload: unknown }, booking: { bookingId: string; policyType: CancellationPolicyType; checkInIso: string; cancellationBaseKobo: number; cleaningFeeKobo: number; unprovidedServicesKobo: number; securityDepositKobo: number; attributableTaxKobo: number; duplicatePaymentKobo?: number }, cancelledAtIso: string) {
    if (envelope.commandName !== "cancellation.process") throw new Error("Invalid command for cancellation");
    // Client payload never supplies liability. Reviewed overrides use the trusted
    // CancellationLiabilityAuthority in the application boundary.
    const liability: CancellationLiability = "guest";
    const calculation = this.calculateFullCancellationRefund({ booking, cancelledAtIso, liability });
    return { calculation, ledgerEntry: { ledgerId: `ledger_cxl_${booking.bookingId}`, bookingId: booking.bookingId, type: "cancellation_refund", amountKobo: calculation.totalRefundKobo, fundingSource: calculation.fundingSource, currency: "NGN", processedAt: cancelledAtIso }, auditRecord: { commandId: envelope.commandId, commandName: envelope.commandName, principalId: envelope.principal.id, result: calculation } };
  }

  determineNoShow(input: { bookingId: string; checkInDate: string; attemptIso: string; contactAttemptsFailed: boolean; humanConfirmed: boolean }): { bookingId: string; status: "no_show_confirmed"; humanConfirmed: true; contactAttemptsFailed: true; confirmedAtIso: string } {
    if (new Date(input.attemptIso).getTime() < new Date(this.noShowDeadline(input.checkInDate)).getTime()) throw new Error("No-Show can only be determined at or after 10:00 AM WAT the day after scheduled arrival");
    if (!input.contactAttemptsFailed) throw new Error("No-Show determination requires failed contact attempts");
    if (!input.humanConfirmed) throw new Error("No-Show determination requires explicit human confirmation");
    return { bookingId: input.bookingId, status: "no_show_confirmed", humanConfirmed: true, contactAttemptsFailed: true, confirmedAtIso: input.attemptIso };
  }

  calculateFullCancellationRefund(input: { booking: { bookingId: string; policyType: CancellationPolicyType; checkInIso: string; cancellationBaseKobo: number; cleaningFeeKobo: number; unprovidedServicesKobo: number; securityDepositKobo: number; attributableTaxKobo: number; duplicatePaymentKobo?: number }; cancelledAtIso: string; liability: CancellationLiability }): CancellationRefundBreakdown {
    return this.calculateAuthoritative({ reservationId: input.booking.bookingId, contract: {} as BookingContract, policy: { type: input.booking.policyType, version: "legacy", policySummary: "" }, checkInWindowStartIso: input.booking.checkInIso, at: new Date(input.cancelledAtIso), liability: input.liability, economics: { version: "legacy", currency: "NGN", cancellationBaseKobo: input.booking.cancellationBaseKobo, refundableCleaningKobo: input.booking.cleaningFeeKobo, refundableUnprovidedServicesKobo: input.booking.unprovidedServicesKobo, refundableSecurityDepositKobo: input.booking.securityDepositKobo, refundableAttributableTaxKobo: input.booking.attributableTaxKobo, refundableDuplicatePaymentKobo: input.booking.duplicatePaymentKobo ?? 0, commissionRate: 0 } });
  }
}

export type { BookingStateRepository };
