import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, CARD_PAYMENT_VERIFY_RETURN_EVENT } from "../../web/src/card-payment-actions.js";
import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";

import { bookingProgressText, formatBookingDeadline, formatBookingMoney, formatStayDates, guestPaymentStatus } from "./booking-presentation.js";

export function cardPaymentArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CardPaymentArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const isProcessing = facts.journeyStage === "stay_payment_processing" || facts.journeyStage === "deposit_payment_processing";
  const paymentStatus = guestPaymentStatus(facts.status, isProcessing);
  // ADR-0015/0016/0077: show the quoted full requirement separately from the
  // exact component amount on the current server-authorized checkout stage.
  const component = facts.currentComponent ?? (facts.status === "deposit_required" ? "security_deposit" : facts.status === "ready" ? "stay" : undefined);
  const componentAmount = facts.currentComponentAmountKobo ?? (facts.status === "ready"
    ? facts.allInStayTotalKobo
    : facts.status === "deposit_required"
      ? facts.refundableSecurityDepositKobo
      : undefined);
  const componentLabel = component === "security_deposit" ? "refundable deposit" : "stay payment";
  const componentText = component && componentAmount !== undefined
    ? `${isProcessing ? (component === "security_deposit" ? "Refundable deposit" : "Stay payment") + " being checked" : `Next payment: ${componentLabel}`} · ${formatBookingMoney(componentAmount)}`
    : undefined;
  const showTotalRequirement = facts.status === "ready" || facts.status === "deposit_required";
  const paymentBody = facts.status === "confirmed"
    ? `${paymentStatus.detail} Booking reference is available in your booking details.`
    : paymentStatus.detail;
  const stage = paymentStatus.progress;
  const action = artifact.actions[0];
  const actionAmount = componentAmount ?? facts.amountDueNowKobo;
  const actionLabel = action?.type === "verify_return"
    ? "Check payment status"
    : facts.status === "deposit_required"
      ? `Continue to refundable deposit · ${formatBookingMoney(actionAmount)}`
      : `Continue to stay payment · ${formatBookingMoney(actionAmount)}`;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: [
      "card-payment-title", "card-payment-status", "card-payment-unit", "card-payment-dates",
      ...(facts.allInStayTotalKobo === undefined ? [] : ["card-payment-total"]),
      ...(facts.refundableSecurityDepositKobo === undefined || facts.refundableSecurityDepositKobo <= 0 ? [] : ["card-payment-deposit"]),
      ...(showTotalRequirement ? ["card-payment-amount-due"] : []),
      ...(componentText ? ["card-payment-component"] : []),
      "card-payment-deadline", ...(stage ? ["card-payment-progress"] : []), "card-payment-content", "card-payment-actions",
    ] },
    { id: "card-payment-title", component: "Text", text: facts.status === "confirmed" ? "Booking confirmed" : isProcessing ? "Payment being checked" : facts.status === "ready" || facts.status === "deposit_required" ? "Payment required" : facts.status === "reconciliation_required" || facts.status === "compensation_pending" ? "Payment under review" : "Payment status", variant: "h2" },
    { id: "card-payment-status", component: "Text", text: facts.status === "confirmed" ? "Payment verified" : isProcessing ? "Payment processing" : facts.status === "ready" ? "Secure checkout is available" : facts.status === "deposit_required" ? "Stay payment verified" : paymentStatus.label },
    { id: "card-payment-unit", component: "Text", text: facts.unit, variant: "h3" },
    { id: "card-payment-dates", component: "Text", text: formatStayDates(facts.checkIn, facts.checkOut) },
    ...(facts.allInStayTotalKobo === undefined ? [] : [{ id: "card-payment-total", component: "Text" as const, text: `Stay total: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" as const }]),
    ...(facts.refundableSecurityDepositKobo === undefined || facts.refundableSecurityDepositKobo <= 0 ? [] : [{ id: "card-payment-deposit", component: "Text" as const, text: `Refundable deposit: ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` }]),
    ...(showTotalRequirement ? [{ id: "card-payment-amount-due", component: "Text" as const, text: `Total to complete booking: ${formatBookingMoney(facts.amountDueNowKobo)}` }] : []),
    ...(componentText ? [{ id: "card-payment-component", component: "Text" as const, text: componentText }] : []),
    { id: "card-payment-deadline", component: "Text", text: formatBookingDeadline(facts.paymentWindowExpiresAt) },
    ...(stage ? [{ id: "card-payment-progress", component: "Text" as const, text: bookingProgressText(stage) }] : []),
    { id: "card-payment-content", component: "Text", text: facts.status === "confirmed"
      ? paymentBody
      : isProcessing
        ? "We’re checking the payment result. Don’t submit another payment while it’s pending."
        : facts.status === "deposit_required"
          ? "Pay the refundable deposit to complete the booking."
          : facts.status === "ready"
            ? "The refundable deposit is charged separately when one applies."
            : paymentBody },
    { id: "card-payment-actions", component: "Row", children: action ? ["card-payment-action"] : [] },
    ...(action ? [
      { id: "card-payment-action", component: "Button" as const, child: "card-payment-action-label", variant: "primary" as const, action: { event: { name: action.type === "verify_return" ? CARD_PAYMENT_VERIFY_RETURN_EVENT : CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: action.expectedStatus, expectedPurpose: action.expectedPurpose ?? "stay", ...(facts.journeyVersion === undefined ? {} : { expectedJourneyVersion: facts.journeyVersion }), ...(facts.journeyStage === undefined ? {} : { expectedStage: facts.journeyStage }), depositPolicyVersion: facts.depositPolicyVersion ?? "", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: actionLabel } },
      { id: "card-payment-action-label", component: "Text" as const, text: actionLabel },
    ] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
