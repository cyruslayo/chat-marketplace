import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { BANK_TRANSFER_INITIALIZE_EVENT } from "../../web/src/bank-transfer-actions.js";
import type { BankTransferArtifact } from "../../web/src/bank-transfer-artifact.js";
import { formatBookingDeadline, formatBookingMoney, nightsBetween, ticketFactComponents, ticketFactIds } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, guestFact } from "./guest-content.js";

/** Guest words for each transfer state (P3). The raw status stays in the artifact, never in guest copy. */
const TRANSFER_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ready: "Choose how to pay",
  transfer_initiated: "Waiting for your transfer",
  processing_in_grace: "Your transfer is processing",
  deposit_required: `Next: ${GUEST_GLOSSARY.refundableSecurityDeposit}`,
  confirmed: `${GUEST_GLOSSARY.reservation} confirmed`,
  late_payment_refund_pending: "Payment arrived after the deadline",
  late_payment_refunded: "Payment arrived after the deadline",
  expired: "Transfer account expired",
});

export function bankTransferArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BankTransferArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const money = (kobo: number) => formatBookingMoney(kobo, facts.currency);
  // ADR 0005: never "confirmed" before a Reservation; ADR 0045: a refund is never described as received.
  const content = facts.status === "deposit_required" ? `Stay payment received. Continue with the separate ${GUEST_GLOSSARY.refundableSecurityDeposit} transfer.`
    : facts.status === "transfer_initiated" ? `Transfer the exact amount to ${facts.bankName ?? "the bank shown"}, account ${facts.accountNumber ?? ""}. Your booking confirms automatically once the transfer arrives.`
      : facts.status === "processing_in_grace" ? `Your bank has started the transfer. It has not arrived yet and no ${GUEST_GLOSSARY.reservation} exists yet.`
        : facts.status === "confirmed" ? `Your transfer arrived and your ${GUEST_GLOSSARY.reservation} is confirmed.`
          : facts.status === "late_payment_refund_pending" || facts.status === "late_payment_refunded" ? `Your payment arrived after the deadline, so no ${GUEST_GLOSSARY.reservation} was made. Refund of the full amount: ${facts.status === "late_payment_refunded" ? "completed" : "started"}.`
            : facts.status === "expired" ? `The transfer account expired. No ${GUEST_GLOSSARY.reservation} was made.`
              : "Transfer the exact amount shown before the deadline.";
  // Guest UI consistency issue 04: each amount is its own label-prefixed Text, in canonical order (ADR 0015):
  // All-In Stay Total, the separate deposit, then one amount line (or what was paid once confirmed).
  const moneyComponents: A2UIComponent[] = [
    ...(facts.allInStayTotalKobo === undefined ? [] : [{ id: "bank-transfer-total", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.allInStayTotal, money(facts.allInStayTotalKobo)) }]),
    ...(facts.refundableSecurityDepositKobo ? [{ id: "bank-transfer-deposit", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.refundableSecurityDeposit, money(facts.refundableSecurityDepositKobo)) }] : []),
    facts.status === "confirmed"
      ? { id: "bank-transfer-paid", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.amountPaid, money(facts.amountPaidKobo ?? 0)) }
      : { id: "bank-transfer-due", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.amountDueNow, money(facts.amountDueNowKobo)) },
    ...(facts.status !== "confirmed" && facts.currentComponent ? [{ id: "bank-transfer-next", component: "Text" as const, text: `${GUEST_FACT_LABELS.nextPayment}: ${facts.currentComponent === "stay" ? "stay payment" : GUEST_GLOSSARY.refundableSecurityDeposit} · ${money(facts.currentComponentAmountKobo ?? 0)}` }] : []),
  ];
  const moneyIds = moneyComponents.map((component) => component.id);
  const components: A2UIComponent[] = [
    { id: "bank-transfer-root", component: "Column", children: ["bank-transfer-title", "bank-transfer-status", "bank-transfer-unit", ...ticketFactIds("bank-transfer"), ...moneyIds, "bank-transfer-deadline", "bank-transfer-content", "bank-transfer-actions"] },
    { id: "bank-transfer-title", component: "Text", text: facts.status === "confirmed" ? `${GUEST_GLOSSARY.reservation} confirmed` : "Bank transfer payment", variant: "h2" },
    { id: "bank-transfer-status", component: "Text", text: TRANSFER_STATUS_LABELS[facts.status] ?? "Bank transfer payment" },
    { id: "bank-transfer-unit", component: "Text", text: facts.unit, variant: "h3" },
    ...ticketFactComponents("bank-transfer", { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: nightsBetween(facts.checkIn, facts.checkOut), ...(facts.occupantCount === undefined ? {} : { guestCount: facts.occupantCount }) }),
    ...moneyComponents,
    { id: "bank-transfer-deadline", component: "Text", text: formatBookingDeadline(facts.paymentWindowExpiresAt) },
    { id: "bank-transfer-content", component: "Text", text: content },
    { id: "bank-transfer-actions", component: "Row", children: artifact.actions.length ? ["bank-transfer-initialize"] : [] },
    ...(artifact.actions.length ? [{ id: "bank-transfer-initialize", component: "Button" as const, child: "bank-transfer-initialize-label", variant: "primary" as const, action: { event: { name: BANK_TRANSFER_INITIALIZE_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: artifact.actions[0]?.expectedStatus ?? "ready", expectedPurpose: artifact.actions[0]?.expectedPurpose ?? "stay", expectedJourneyVersion: facts.journeyVersion ?? 1, expectedStage: facts.journeyStage ?? facts.status, depositPolicyVersion: facts.depositPolicyVersion ?? "", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: facts.status === "deposit_required" ? "Continue to refundable deposit transfer" : "Initialize bank transfer" } }, { id: "bank-transfer-initialize-label", component: "Text" as const, text: "Show transfer instructions" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
