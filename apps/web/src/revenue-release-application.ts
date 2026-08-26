import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingStateRepository } from "../../../domains/shortlet/src/booking-state.js";
import type { BookingContract, Reservation } from "../../../domains/shortlet/src/card-payment.js";
import { RevenueReleaseManager, type AuthoritativeRevenueEconomics, type ProductionRevenueReleaseRecord } from "../../../domains/shortlet/src/revenue-release.js";
import type { RevenueAccountingRepository, RevenueAdjustmentRecord } from "../../../domains/shortlet/src/revenue-accounting.js";
import { journal } from "../../../domains/shortlet/src/revenue-accounting.js";
import { revenueReleaseArtifact, type RevenueReleaseArtifact } from "./revenue-release-artifact.js";

export interface RevenueReleaseAccessProvider { getAccess(reservationId: string): { readonly version: string; readonly status: "awaiting_access" | "verified_access" | "late_voluntary_arrival" | "failed_access" | "under_human_review"; readonly verifiedAt?: string; readonly protectionWindowStartsAt?: string }; }
export interface RevenueReleaseHoldProvider { getHold(reservationId: string): { readonly holdVersion: string; readonly blocked: boolean; readonly reasonCodes: readonly string[] }; }
export interface OperatorPaymentAccountProvider { getStatus(operatorId: string): { readonly version: string; readonly active: boolean }; }
export interface RevenueEconomicsProvider { getEconomics(input: { reservationId: string; contract: BookingContract }): AuthoritativeRevenueEconomics; }
export interface RevenuePayoutPlanProvider { getPlan(input: { reservationId: string; operatorId: string; contract: BookingContract }): { readonly planVersion: string; readonly plan: "fast_payout" | "full_post_stay" }; }
export interface RevenueReleaseCheckoutTermsProvider { getTerms(reservationId: string): { readonly checkoutIso: string; readonly version: string }; }
export interface RevenueRiskHoldProvider { getHold(input: { reservationId: string; operatorId: string }): { readonly version: string; readonly amountKobo: number }; }
export interface RevenueAdjustmentAuthority { getAdjustment(adjustmentRef: string): RevenueAdjustmentRecord; }
export interface RevenueReleaseApplicationOptions { readonly bookingState: BookingStateRepository; readonly manager: RevenueReleaseManager; readonly accounting: RevenueAccountingRepository; readonly access: RevenueReleaseAccessProvider; readonly complaints: { hasUnresolvedBlockingComplaint(reservationId: string): boolean }; readonly holds: RevenueReleaseHoldProvider; readonly accounts: OperatorPaymentAccountProvider; readonly economics: RevenueEconomicsProvider; readonly payoutPlans: RevenuePayoutPlanProvider; readonly checkout: RevenueReleaseCheckoutTermsProvider; readonly risk: RevenueRiskHoldProvider; readonly adjustments: RevenueAdjustmentAuthority; readonly consequence?: { isAccommodationActive(reservationId: string): boolean }; readonly audit?: { record(entry: Record<string, unknown>): void }; readonly clock: () => Date; }
export type RevenueEligibilityStatus = "awaiting_access" | "pending_protection_window" | "blocked" | "eligible" | "released";
export interface RevenueEligibilityEvaluation { readonly status: RevenueEligibilityStatus; readonly blockerReasonCodes: readonly string[]; readonly protectionWindowStartsAt?: string; readonly protectionWindowEndsAt?: string; readonly access: RevenueReleaseAccessProvider["getAccess"] extends (id: string) => infer R ? R : never; readonly economics?: AuthoritativeRevenueEconomics; readonly plan?: ReturnType<RevenuePayoutPlanProvider["getPlan"]>; readonly account?: ReturnType<OperatorPaymentAccountProvider["getStatus"]>; readonly hold?: ReturnType<RevenueReleaseHoldProvider["getHold"]>; readonly risk?: ReturnType<RevenueRiskHoldProvider["getHold"]>; readonly checkout?: ReturnType<RevenueReleaseCheckoutTermsProvider["getTerms"]>; }
const trustedRoles = new Set<CommandPrincipal["role"]>(["system", "admin", "authorized_staff"]);
function deny(): never { throw new Error("Access denied or reservation not found"); }
function backend(principal: CommandPrincipal, tenantId: string): void { if (!trustedRoles.has(principal.role) || !principal.id || !tenantId || principal.tenantId !== tenantId) throw new Error("Trusted backend principal with matching tenant is required"); }
function load(state: BookingStateRepository, id: string): { reservation: Reservation; contract: BookingContract } { const reservation = state.findReservationById(id); if (!reservation) deny(); const contract = state.findContractById(reservation.contractId); if (!contract || contract.reservationId !== id || contract.contractId !== reservation.contractId) deny(); return { reservation, contract }; }
function paid(c: BookingContract): void { if (!c.paymentDetails || c.paymentDetails.currency !== "NGN" || !Number.isInteger(c.paymentDetails.amountKobo) || c.paymentDetails.amountKobo <= 0 || !c.paymentDetails.paidAt || (c.paymentDetails.paymentMethod !== "fresh_card" && c.paymentDetails.paymentMethod !== "bank_transfer")) throw new Error("Booking Contract payment is not authoritative and successful"); }
function authorizeView(contract: BookingContract, principal: CommandPrincipal): void { if (principal.role === "operator") { if (!principal.id || principal.id !== contract.parties.operator.id || principal.tenantId !== contract.tenantId) deny(); return; } if ((principal.role === "authorized_staff" || principal.role === "admin") && principal.tenantId === contract.tenantId) return; deny(); }
function releaseMatches(release: ProductionRevenueReleaseRecord, reservation: Reservation, contract: BookingContract): boolean { return release.reservationId === reservation.reservationId && release.contractId === contract.contractId && release.tenantId === contract.tenantId && release.operatorId === contract.parties.operator.id; }

export class RevenueReleaseApplication {
  readonly #o: RevenueReleaseApplicationOptions;
  constructor(options: RevenueReleaseApplicationOptions) { this.#o = options; }
  #evaluate(reservation: Reservation, contract: BookingContract): RevenueEligibilityEvaluation {
    const access = this.#o.access.getAccess(reservation.reservationId);
    if (access.status === "awaiting_access") return { status: "awaiting_access", blockerReasonCodes: ["awaiting_access"], access };
    if (access.status === "failed_access" || access.status === "under_human_review") return { status: "blocked", blockerReasonCodes: [access.status], access };
    if (!access.verifiedAt || !access.protectionWindowStartsAt) return { status: "blocked", blockerReasonCodes: ["invalid_access_authority"], access };
    const end = new Date(new Date(access.protectionWindowStartsAt).getTime() + 86400000).toISOString();
    const common = { access, protectionWindowStartsAt: access.protectionWindowStartsAt, protectionWindowEndsAt: end };
    if (reservation.status === "cancelled") return { ...common, status: "blocked", blockerReasonCodes: ["cancelled_reservation"] };
    if (reservation.status === "no_show") return { ...common, status: "blocked", blockerReasonCodes: ["no_show_reservation"] };
    if (this.#o.consequence && !this.#o.consequence.isAccommodationActive(reservation.reservationId)) return { ...common, status: "blocked", blockerReasonCodes: ["permanent_original_accommodation_consequence"] };
    if (this.#o.complaints.hasUnresolvedBlockingComplaint(reservation.reservationId)) return { ...common, status: "blocked", blockerReasonCodes: ["blocking_fulfilment_complaint"] };
    const hold = this.#o.holds.getHold(reservation.reservationId); if (hold.blocked) return { ...common, status: "blocked", blockerReasonCodes: hold.reasonCodes.length ? hold.reasonCodes : ["financial_or_compliance_hold"], hold };
    const account = this.#o.accounts.getStatus(contract.parties.operator.id); if (!account.active) return { ...common, status: "blocked", blockerReasonCodes: ["inactive_operator_payment_account"], account };
    try { paid(contract); } catch { return { ...common, status: "blocked", blockerReasonCodes: ["unpaid_or_malformed_contract"], hold, account }; }
    const economics = this.#o.economics.getEconomics({ reservationId: reservation.reservationId, contract }); const plan = this.#o.payoutPlans.getPlan({ reservationId: reservation.reservationId, operatorId: contract.parties.operator.id, contract }); const checkout = this.#o.checkout.getTerms(reservation.reservationId); const risk = this.#o.risk.getHold({ reservationId: reservation.reservationId, operatorId: contract.parties.operator.id });
    if (!Number.isInteger(risk.amountKobo) || risk.amountKobo < 0) return { ...common, status: "blocked", blockerReasonCodes: ["invalid_risk_hold"], hold, account, economics, plan, checkout, risk };
    if (this.#o.clock().getTime() < new Date(end).getTime()) return { ...common, status: "pending_protection_window", blockerReasonCodes: ["protection_window_active"], hold, account, economics, plan, checkout, risk };
    return { ...common, status: "eligible", blockerReasonCodes: [], hold, account, economics, plan, checkout, risk };
  }
  getArtifact(reservationId: string, principal: CommandPrincipal): RevenueReleaseArtifact {
    const { reservation, contract } = load(this.#o.bookingState, reservationId); authorizeView(contract, principal); const release = this.#o.accounting.findReleaseByReservationId(reservationId) as ProductionRevenueReleaseRecord | null;
    if (release) return revenueReleaseArtifact({ reservation, contract, release, adjustments: this.#o.accounting.findAdjustmentsForRelease(release.releaseId) });
    const evaluation = this.#evaluate(reservation, contract); return revenueReleaseArtifact({ reservation, contract, release: null, evaluation, adjustments: [] });
  }
  releaseRevenue(reservationId: string, principal: CommandPrincipal): ProductionRevenueReleaseRecord {
    const { reservation, contract } = load(this.#o.bookingState, reservationId); backend(principal, contract.tenantId ?? "");
    const envelope = createPlatformCommandEnvelope({ commandName: "revenue_release.release", principal, payload: { reservationId }, idempotencyKey: `revenue-release:${reservationId}` });
    const existing = this.#o.accounting.findReleaseByReservationId(reservationId) as ProductionRevenueReleaseRecord | null;
    if (existing) { if (!releaseMatches(existing, reservation, contract)) throw new Error("Existing Revenue Release authority mismatch"); return existing; }
    if (reservation.status !== "confirmed") throw new Error("Revenue release requires a confirmed Reservation");
    const evaluation = this.#evaluate(reservation, contract); if (evaluation.status !== "eligible" || !evaluation.economics || !evaluation.plan || !evaluation.checkout || !evaluation.risk) { if (evaluation.status === "awaiting_access") throw new Error("Revenue release requires authoritative Verified Access"); throw new Error(`Revenue release blocked: ${evaluation.blockerReasonCodes.join(",")}`); }
    const result = this.#o.manager.commitProductionRelease({ reservationId, contractId: contract.contractId, contractVersion: contract.contractVersion, unitId: contract.unitId, tenantId: contract.tenantId ?? "", operatorId: contract.parties.operator.id, accessVersion: evaluation.access.version, accessStatus: evaluation.access.status as "verified_access" | "late_voluntary_arrival", verifiedAccessAt: evaluation.access.verifiedAt!, protectionWindowStartsAt: evaluation.access.protectionWindowStartsAt!, economics: evaluation.economics, payoutPlan: evaluation.plan.plan, payoutPlanVersion: evaluation.plan.planVersion, effectiveCheckoutAt: evaluation.checkout.checkoutIso, effectiveCheckoutVersion: evaluation.checkout.version, riskHoldVersion: evaluation.risk.version, riskHoldKobo: evaluation.risk.amountKobo, now: this.#o.clock() }, this.#o.accounting);
    this.#o.audit?.record({ type: "revenue_release.committed", releaseId: result.releaseId, reservationId, contractVersion: contract.contractVersion, accessVersion: evaluation.access.version, economicsVersion: evaluation.economics.economicsVersion, commissionPolicyVersion: evaluation.economics.commissionPolicyVersion, commissionRate: evaluation.economics.capturedCommissionRate, ledgerJournalId: result.ledgerJournalId, commandId: envelope.commandId, serverTimestamp: result.releasedAt }); return result;
  }
  postAdjustment(adjustmentRef: string, principal: CommandPrincipal): RevenueAdjustmentRecord {
    const adjustment = this.#o.adjustments.getAdjustment(adjustmentRef); const { contract } = load(this.#o.bookingState, adjustment.reservationId); backend(principal, contract.tenantId ?? ""); const release = this.#o.accounting.findReleaseByReservationId(adjustment.reservationId) as ProductionRevenueReleaseRecord | null;
    if (!release || release.releaseId !== adjustment.releaseId) throw new Error("Adjustment is not correlated to an existing Revenue Release");
    const envelope = createPlatformCommandEnvelope({ commandName: "revenue_release.post-adjustment", principal, payload: { adjustmentRef } });
    const canonical = journal({ correlationId: release.releaseId, lines: adjustment.journal.lines, createdAt: adjustment.journal.createdAt });
    const posted = this.#o.accounting.postAdjustment({ adjustment: { ...adjustment, journal: canonical } }); this.#o.audit?.record({ type: "revenue_release.adjustment_posted", adjustmentId: posted.adjustmentId, adjustmentVersion: posted.adjustmentVersion, reservationId: posted.reservationId, releaseId: posted.releaseId, ledgerJournalId: posted.journal.journalId, commandId: envelope.commandId, serverTimestamp: this.#o.clock().toISOString() }); return posted;
  }
}
