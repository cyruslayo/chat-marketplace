import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../../web/src/conditional-offer-actions.js";
import type { ConditionalOfferArtifact } from "../../web/src/conditional-offer-artifact.js";

function formatAmount(amountKobo: number, currency: string): string {
  const amount = (amountKobo / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "NGN" ? `₦${amount}` : `${currency} ${amount}`;
}

export function conditionalOfferArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: ConditionalOfferArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "accept");
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["conditional-offer-title", "conditional-offer-status", "conditional-offer-unit", "conditional-offer-dates", "conditional-offer-occupants", "conditional-offer-total", "conditional-offer-deposit", "conditional-offer-due", "conditional-offer-cancellation", "conditional-offer-conduct", "conditional-offer-disclosures", "conditional-offer-expiry", "conditional-offer-actions"] },
    { id: "conditional-offer-title", component: "Text", text: "Conditional Booking Offer", variant: "h2" },
    { id: "conditional-offer-status", component: "Text", text: `Status: ${facts.status}` },
    { id: "conditional-offer-unit", component: "Text", text: `Unit: ${facts.unitTitle}` },
    { id: "conditional-offer-dates", component: "Text", text: `Stay: ${facts.checkIn} to ${facts.checkOut} (${facts.nights} nights)` },
    { id: "conditional-offer-occupants", component: "Text", text: `Named occupants: ${facts.occupants.join(", ") || "None listed"}` },
    { id: "conditional-offer-total", component: "Text", text: `All-In Stay Total: ${formatAmount(facts.allInStayTotalKobo, facts.currency)}` },
    { id: "conditional-offer-deposit", component: "Text", text: `Refundable Security Deposit: ${formatAmount(facts.refundableSecurityDepositKobo, facts.currency)}` },
    { id: "conditional-offer-due", component: "Text", text: `Amount Due Now: ${formatAmount(facts.totalAmountDueNowKobo, facts.currency)} (${facts.currency})` },
    { id: "conditional-offer-cancellation", component: "Text", text: `Cancellation: ${facts.cancellationPolicy.summary} (${facts.cancellationPolicy.version})` },
    { id: "conditional-offer-conduct", component: "Text", text: `Guest conduct: ${facts.guestConductRules.join("; ")}` },
    { id: "conditional-offer-disclosures", component: "Text", text: `Disclosures: ${artifact.disclosures.join("; ")}` },
    { id: "conditional-offer-expiry", component: "Text", text: `Payment Window expires: ${facts.paymentWindowExpiresAt}` },
    { id: "conditional-offer-actions", component: "Row", children: action ? ["conditional-offer-accept-button"] : [] },
    ...(action ? [
      { id: "conditional-offer-accept-button", component: "Button" as const, child: "conditional-offer-accept-label", variant: "primary" as const, action: { event: { name: CONDITIONAL_OFFER_ACCEPT_EVENT, context: { artifactId: action.artifactId, offerId: action.offerId, expectedStatus: action.expectedStatus, offerVersion: action.offerVersion, projectionVersion: action.projectionVersion, confirmationToken: action.confirmationToken } } }, accessibility: { label: "Accept Conditional Booking Offer" } },
      { id: "conditional-offer-accept-label", component: "Text" as const, text: "Accept" },
    ] : []),
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}
