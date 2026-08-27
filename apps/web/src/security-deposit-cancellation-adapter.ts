import type { SecurityDepositAccountingRepository } from "../../../domains/shortlet/src/security-deposit-accounting.js";
import type { SecurityDepositCancellationRefundPort } from "./cancellation-application.js";

export interface SecurityDepositOriginalSourceRefundProvider {
  refundOrGet(input: { readonly obligationId: string; readonly offerId: string; readonly paymentMethod: "fresh_card" | "bank_transfer"; readonly originalPaymentReference: string; readonly amountKobo: number; readonly currency: "NGN" }): { readonly refundId: string; readonly status: "pending" | "settled" | "failed"; readonly amountKobo: number; readonly currency: "NGN" };
}
/** Production cancellation adapter: reloads the bound collection and never accepts caller money/reference authority. */
export function createSecurityDepositCancellationRefundAdapter(input: { readonly accounting: SecurityDepositAccountingRepository; readonly refunds: SecurityDepositOriginalSourceRefundProvider; readonly clock?: () => Date }): SecurityDepositCancellationRefundPort {
  return { initiateOrGetRefund: ({ cancellationId, reservationId, collectionId, amountKobo, currency }) => {
    const collection = input.accounting.getByCollectionId(collectionId);
    if (!collection || collection.reservationId !== reservationId || (collection.status !== "held" && collection.status !== "refund_pending") || collection.amountKobo !== amountKobo || collection.currency !== currency) throw new Error("Held security deposit invariant failed");
    const record = input.accounting.getByOfferId(collection.collectionId.replace(/^security-deposit:/, ""));
    if (!record?.providerReference) throw new Error("Successful deposit payment source is missing");
    const result = input.refunds.refundOrGet({ obligationId: `security-deposit-cancellation:${reservationId}`, offerId: record.offerId, paymentMethod: record.paymentMethod, originalPaymentReference: record.providerReference, amountKobo: collection.amountKobo, currency: "NGN" });
    if (result.amountKobo !== collection.amountKobo || result.currency !== "NGN") throw new Error("Deposit refund provider mismatch");
    if (result.status === "pending") input.accounting.markRefundPending(collection.collectionId);
    const updated = result.status === "pending" ? collection : input.accounting.refund(collection.collectionId, { refundedAt: (input.clock?.() ?? new Date()).toISOString(), refundSucceeded: result.status === "settled" });
    return { refundId: result.refundId, status: result.status, amountKobo: updated.amountKobo, currency: "NGN" };
  } };
}
