import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT } from "../../web/src/card-payment-actions.js";
import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";

function amount(kobo: number, currency: string): string { return `${currency} ${(kobo / 100).toFixed(2)}`; }
export function cardPaymentArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CardPaymentArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["card-payment-title", "card-payment-status", "card-payment-unit", "card-payment-dates", "card-payment-amount", "card-payment-deadline", "card-payment-content", "card-payment-actions"] },
    { id: "card-payment-title", component: "Text", text: facts.status === "confirmed" ? "Booking confirmed" : "Secure card payment", variant: "h2" },
    { id: "card-payment-status", component: "Text", text: `Payment status: ${facts.status}` },
    { id: "card-payment-unit", component: "Text", text: `Unit: ${facts.unit}` },
    { id: "card-payment-dates", component: "Text", text: `Stay: ${facts.checkIn} to ${facts.checkOut}` },
    { id: "card-payment-amount", component: "Text", text: facts.status === "confirmed" ? `Paid: ${amount(facts.amountPaidKobo ?? 0, facts.currency)}` : `${facts.allInStayTotalKobo === undefined ? "" : `All-In Stay Total: ${amount(facts.allInStayTotalKobo, facts.currency)}; `}${facts.refundableSecurityDepositKobo === undefined ? "" : `Refundable Security Deposit: ${amount(facts.refundableSecurityDepositKobo, facts.currency)}; `}Total cash requirement: ${amount(facts.amountDueNowKobo, facts.currency)}${facts.currentComponent ? `; Current payment: ${facts.currentComponent === "stay" ? "Stay payment" : "Refundable Security Deposit"} — ${amount(facts.currentComponentAmountKobo ?? 0, facts.currency)}` : ""}` },

    { id: "card-payment-deadline", component: "Text", text: `Payment deadline: ${facts.paymentWindowExpiresAt}` },
    { id: "card-payment-content", component: "Text", text: facts.status === "deposit_required" ? "Stay payment settled. Continue with the separate refundable security deposit checkout." : facts.status === "checkout_initiated" ? `Secure checkout initialized. Continue at the hosted PSP checkout: ${facts.checkoutUrl ?? ""}` : facts.status === "confirmed" ? `Reservation: ${facts.reservationId ?? ""}; Booking Contract: ${facts.contractId ?? ""}${facts.cardMetadata ? `; Card: ${facts.cardMetadata.brand} ending ${facts.cardMetadata.last4}` : ""}` : facts.status === "ready" ? "Your card details are entered only on the secure hosted checkout." : `Payment is ${facts.status}.` },
    { id: "card-payment-actions", component: "Row", children: artifact.actions.length ? ["card-payment-initialize"] : [] },
    ...(artifact.actions.length ? [{ id: "card-payment-initialize", component: "Button" as const, child: "card-payment-initialize-label", variant: "primary" as const, action: { event: { name: CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT, context: { artifactId: artifact.id, offerId: facts.offerId, expectedStatus: artifact.actions[0]?.expectedStatus ?? facts.status, expectedPurpose: artifact.actions[0]?.expectedPurpose ?? "stay", ...(facts.journeyVersion === undefined ? {} : { expectedJourneyVersion: facts.journeyVersion }), ...(facts.journeyStage === undefined ? {} : { expectedStage: facts.journeyStage }), depositPolicyVersion: facts.depositPolicyVersion ?? "", projectionVersion: artifact.projectionVersion } } }, accessibility: { label: facts.status === "deposit_required" ? "Continue to refundable deposit" : "Start secure card checkout" } }, { id: "card-payment-initialize-label", component: "Text" as const, text: "Start secure checkout" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
