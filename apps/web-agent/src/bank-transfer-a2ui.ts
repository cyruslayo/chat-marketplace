import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { BANK_TRANSFER_INITIALIZE_EVENT } from "../../web/src/bank-transfer-actions.js";
import type { BankTransferArtifact } from "../../web/src/bank-transfer-artifact.js";
function amount(kobo: number, currency: string): string { return `${currency} ${(kobo / 100).toFixed(2)}`; }
export function bankTransferArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BankTransferArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact; const content = facts.status === "transfer_initiated" ? `Transfer to ${facts.bankName ?? "the instructed bank"}, account ${facts.accountNumber ?? ""}. Use exact reference ${facts.transferReference ?? ""}. This is not confirmation.` : facts.status === "processing_in_grace" ? `Payment processing. Booking is not confirmed yet. Grace deadline: ${facts.graceEndsAt}` : facts.status === "confirmed" ? `Booking confirmed. Reservation: ${facts.reservationId ?? ""}; Booking Contract: ${facts.contractId ?? ""}. Payment method: bank_transfer.` : facts.status === "late_payment_refund_pending" || facts.status === "late_payment_refunded" ? `Payment received after booking deadline. Booking not formed. Refund ${facts.refundId ?? ""} ${facts.reconciliationStatus ?? "initiated"}.` : facts.status === "expired" ? "Payment attempt expired. Booking not formed." : "Use the exact bank-transfer instructions before the Payment Window deadline.";
  const components: A2UIComponent[] = [
    { id: "bank-transfer-root", component: "Column", children: ["bank-transfer-title", "bank-transfer-status", "bank-transfer-amount", "bank-transfer-deadline", "bank-transfer-content", "bank-transfer-actions"] },
    { id: "bank-transfer-title", component: "Text", text: facts.status === "confirmed" ? "Booking confirmed" : "Bank transfer payment", variant: "h2" },
    { id: "bank-transfer-status", component: "Text", text: `Payment status: ${facts.status}` },
    { id: "bank-transfer-amount", component: "Text", text: facts.status === "confirmed" ? `Paid: ${amount(facts.amountPaidKobo ?? 0, facts.currency)}` : `Amount due: ${amount(facts.amountDueNowKobo, facts.currency)}` },
    { id: "bank-transfer-deadline", component: "Text", text: `Payment Window deadline: ${facts.paymentWindowExpiresAt}` },
    { id: "bank-transfer-content", component: "Text", text: content },
    { id: "bank-transfer-actions", component: "Row", children: artifact.actions.length ? ["bank-transfer-initialize"] : [] },
    ...(artifact.actions.length ? [{ id: "bank-transfer-initialize", component: "Button" as const, child: "bank-transfer-initialize-label", variant: "primary" as const, action: { event: { name: BANK_TRANSFER_INITIALIZE_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: "ready", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: "Initialize bank transfer" } }, { id: "bank-transfer-initialize-label", component: "Text" as const, text: "Show transfer instructions" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
