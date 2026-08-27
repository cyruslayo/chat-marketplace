import { createHash } from "node:crypto";
import type { SecurityDepositPolicySnapshot } from "./security-deposit.js";

export type BookingPaymentStage = "ready" | "stay_payment_active" | "stay_payment_processing" | "stay_settled" | "deposit_payment_active" | "deposit_payment_processing" | "both_settled" | "confirmed" | "compensation_pending" | "compensated" | "reconciliation_required" | "failed" | "expired";
export interface BookingPaymentCompensationPort { refundOrGet(input: { obligationId: string; offerId: string; paymentMethod: "fresh_card" | "bank_transfer"; originalPaymentReference: string; amountKobo: number; currency: "NGN" }): { refundId: string; status: "pending" | "settled" | "failed"; amountKobo: number; currency: string }; }
export type PaymentComponentStatus = "unpaid" | "active" | "processing" | "settled" | "failed";
export type CompensationComponentStatus = "not_required" | "pending" | "settled" | "reconciliation_required";
export interface BookingPaymentCompensationComponent { readonly required: boolean; readonly status: CompensationComponentStatus; readonly obligationId?: string; readonly refundId?: string; readonly originalPaymentReference?: string; readonly amountKobo?: number; readonly currency?: "NGN"; readonly collectionId?: string; }
export interface BookingPaymentJourney {
  readonly offerId: string; readonly journeyVersion: number; readonly paymentMethod: "fresh_card" | "bank_transfer"; readonly originalPaymentDeadline: string;
  readonly requiredDeposit: SecurityDepositPolicySnapshot | null; readonly stage: BookingPaymentStage;
  readonly stay: { readonly amountKobo: number; readonly status: PaymentComponentStatus; readonly providerReference?: string; readonly paidAt?: string };
  readonly deposit: { readonly amountKobo: number; readonly status: PaymentComponentStatus; readonly providerReference?: string; readonly paidAt?: string; readonly policyVersion: string };
  readonly compensation: { readonly status: CompensationComponentStatus; readonly stay: BookingPaymentCompensationComponent; readonly deposit: BookingPaymentCompensationComponent; };
  readonly finalReservationId?: string; readonly finalContractId?: string;
}
export interface BookingPaymentJourneyRepository { findByOfferId(offerId: string): BookingPaymentJourney | null; createIfAbsent(input: { offerId: string; paymentMethod: "fresh_card" | "bank_transfer"; originalPaymentDeadline: string; stayAmountKobo: number; deposit: SecurityDepositPolicySnapshot | null }): BookingPaymentJourney; update(offerId: string, expectedJourneyVersion: number, mutation: (current: BookingPaymentJourney) => BookingPaymentJourney): BookingPaymentJourney; }
export function deriveCompensationStatus(compensation: BookingPaymentJourney["compensation"]): CompensationComponentStatus { const components = [compensation.stay, compensation.deposit].filter((component) => component.required); if (components.some((component) => component.status === "reconciliation_required")) return "reconciliation_required"; if (components.some((component) => component.status === "pending")) return "pending"; if (components.every((component) => component.status === "settled")) return "settled"; return "not_required"; }
const clone = (j: BookingPaymentJourney): BookingPaymentJourney => Object.freeze({ ...j, stay: Object.freeze({ ...j.stay }), deposit: Object.freeze({ ...j.deposit }), compensation: Object.freeze({ ...j.compensation, stay: Object.freeze({ ...j.compensation.stay }), deposit: Object.freeze({ ...j.compensation.deposit }) }) });
export class InMemoryBookingPaymentJourneyRepository implements BookingPaymentJourneyRepository {
  readonly #journeys = new Map<string, BookingPaymentJourney>();
  findByOfferId(offerId: string): BookingPaymentJourney | null { return this.#journeys.get(offerId) ?? null; }
  createIfAbsent(input: { offerId: string; paymentMethod: "fresh_card" | "bank_transfer"; originalPaymentDeadline: string; stayAmountKobo: number; deposit: SecurityDepositPolicySnapshot | null }): BookingPaymentJourney {
    const old = this.#journeys.get(input.offerId); if (old) return old;
    const d = input.deposit; const journey = clone({ offerId: input.offerId, journeyVersion: 1, paymentMethod: input.paymentMethod, originalPaymentDeadline: input.originalPaymentDeadline, requiredDeposit: d, stage: "ready", stay: { amountKobo: input.stayAmountKobo, status: "unpaid" }, deposit: { amountKobo: d?.amountKobo ?? 0, status: "unpaid", policyVersion: d?.policyVersion ?? "not-required" }, compensation: { status: "not_required", stay: { required: true, status: "not_required" }, deposit: { required: false, status: "not_required" } } }); this.#journeys.set(input.offerId, journey); return journey;
  }
  update(offerId: string, expected: number, mutation: (current: BookingPaymentJourney) => BookingPaymentJourney): BookingPaymentJourney { const current = this.#journeys.get(offerId); if (!current || current.journeyVersion !== expected) throw new Error("STALE_ACTION"); const next = clone({ ...mutation(current), journeyVersion: expected + 1 }); this.#journeys.set(offerId, next); return next; }
}
export function journeyId(offerId: string): string { return `payment-journey:${createHash("sha256").update(offerId).digest("hex").slice(0, 20)}`; }
