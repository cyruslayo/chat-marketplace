import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, CARD_PAYMENT_VERIFY_RETURN_EVENT } from "../../web/src/card-payment-actions.js";
import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";

import { bookingProgressText, formatBookingDeadline, formatBookingMoney, formatStayDates, guestPaymentStatus } from "./booking-presentation.js";

export function cardPaymentArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CardPaymentArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const isProcessing = facts.journeyStage === "stay_payment_processing" || facts.journeyStage === "deposit_payment_processing";
  const paymentStatus = guestPaymentStatus(facts.status, isProcessing);
  const currentPayment = facts.currentComponent && facts.currentComponentAmountKobo !== undefined
    ? `This checkout is for the ${facts.currentComponent === "stay" ? "stay payment" : "separate refundable security deposit"}: ${formatBookingMoney(facts.currentComponentAmountKobo)}.`
    : "Amount Due Now includes the stay payment and any separately disclosed deposit shown here.";
  const paymentBody = facts.status === "confirmed"
    ? `${paymentStatus.detail} Reservation reference: ${facts.reservationId ?? "available in booking details"}.`
    : paymentStatus.detail;
  const stage = paymentStatus.progress;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["card-payment-title", "card-payment-status", "card-payment-unit", "card-payment-dates", ...(facts.allInStayTotalKobo === undefined ? [] : ["card-payment-total"]), ...(facts.refundableSecurityDepositKobo === undefined || facts.refundableSecurityDepositKobo <= 0 ? [] : ["card-payment-deposit"]), "card-payment-amount-due", ...(facts.currentComponentAmountKobo === undefined ? [] : ["card-payment-component"]), "card-payment-deadline", ...(stage ? ["card-payment-progress"] : []), "card-payment-content", "card-payment-actions"] },
    { id: "card-payment-title", component: "Text", text: facts.status === "confirmed" ? "Booking confirmed" : facts.status === "ready" || facts.status === "deposit_required" ? "Payment required" : facts.status === "reconciliation_required" || facts.status === "compensation_pending" ? "Payment under review" : "Payment status", variant: "h2" },
    { id: "card-payment-status", component: "Text", text: paymentStatus.label },
    { id: "card-payment-unit", component: "Text", text: facts.unit, variant: "h3" },
    { id: "card-payment-dates", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)}` },
    ...(facts.allInStayTotalKobo === undefined ? [] : [{ id: "card-payment-total", component: "Text" as const, text: `All-In Stay Total: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" as const }]),
    ...(facts.refundableSecurityDepositKobo === undefined || facts.refundableSecurityDepositKobo <= 0 ? [] : [{ id: "card-payment-deposit", component: "Text" as const, text: `Refundable Security Deposit (separate): ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` }]),
    { id: "card-payment-amount-due", component: "Text", text: `Amount Due Now: ${formatBookingMoney(facts.amountDueNowKobo)}` },
    ...(facts.currentComponentAmountKobo === undefined ? [] : [{ id: "card-payment-component", component: "Text" as const, text: currentPayment }]),
    { id: "card-payment-deadline", component: "Text", text: `${formatBookingDeadline(facts.paymentWindowExpiresAt)}. This deadline is set by the current booking.` },
    ...(stage ? [{ id: "card-payment-progress", component: "Text" as const, text: bookingProgressText(stage) }] : []),
    { id: "card-payment-content", component: "Text", text: facts.status === "confirmed" ? paymentBody : `${paymentBody} ${currentPayment}` },
    { id: "card-payment-actions", component: "Row", children: artifact.actions.length ? ["card-payment-action"] : [] },
    ...(artifact.actions.length ? [{ id: "card-payment-action", component: "Button" as const, child: "card-payment-action-label", variant: "primary" as const, action: { event: { name: artifact.actions[0]?.type === "verify_return" ? CARD_PAYMENT_VERIFY_RETURN_EVENT : CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: artifact.actions[0]?.expectedStatus ?? facts.status, expectedPurpose: artifact.actions[0]?.expectedPurpose ?? "stay", ...(facts.journeyVersion === undefined ? {} : { expectedJourneyVersion: facts.journeyVersion }), ...(facts.journeyStage === undefined ? {} : { expectedStage: facts.journeyStage }), depositPolicyVersion: facts.depositPolicyVersion ?? "", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: artifact.actions[0]?.type === "verify_return" ? "Check payment status" : facts.status === "deposit_required" ? `Continue to refundable deposit · ${formatBookingMoney(facts.amountDueNowKobo)}` : `Continue to checkout · ${formatBookingMoney(facts.amountDueNowKobo)}` } }, { id: "card-payment-action-label", component: "Text" as const, text: artifact.actions[0]?.type === "verify_return" ? "Check payment status" : facts.status === "deposit_required" ? `Continue to refundable deposit · ${formatBookingMoney(facts.amountDueNowKobo)}` : `Continue to checkout · ${formatBookingMoney(facts.amountDueNowKobo)}` }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
