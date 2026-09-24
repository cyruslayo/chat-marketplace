import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../../web/src/conditional-offer-actions.js";
import type { ConditionalOfferArtifact } from "../../web/src/conditional-offer-artifact.js";
import { bookingProgressText, formatBookingDeadline, formatBookingMoney, formatStayDates } from "./booking-presentation.js";

export function conditionalOfferArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: ConditionalOfferArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "accept");
  const statusLabel = facts.status === "issued" ? "Offer available · Operator confirmed availability"
    : facts.status === "accepted" ? "Offer accepted · Payment required"
      : facts.status === "expired" ? "Offer expired"
        : facts.status === "stale" ? "Offer no longer current"
          : "Offer withdrawn";
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["conditional-offer-title", "conditional-offer-status", "conditional-offer-unit", "conditional-offer-dates", "conditional-offer-occupants", "conditional-offer-total", ...(facts.refundableSecurityDepositKobo > 0 ? ["conditional-offer-deposit"] : []), "conditional-offer-due", "conditional-offer-expiry", "conditional-offer-progress", "conditional-offer-consequence", "conditional-offer-cancellation", "conditional-offer-conduct", "conditional-offer-disclosures", "conditional-offer-actions"] },
    { id: "conditional-offer-title", component: "Text", text: "Conditional Booking Offer", variant: "h2" },
    { id: "conditional-offer-status", component: "Text", text: statusLabel },
    { id: "conditional-offer-unit", component: "Text", text: facts.unitTitle, variant: "h3" },
    { id: "conditional-offer-dates", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)} (${facts.nights} nights)` },
    { id: "conditional-offer-occupants", component: "Text", text: `Guests: ${facts.occupants.length}` },
    { id: "conditional-offer-expiry", component: "Text", text: `${formatBookingDeadline(facts.paymentWindowExpiresAt)}. This deadline comes from the current offer.` },
    { id: "conditional-offer-total", component: "Text", text: `All-In Stay Total: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" },
    { id: "conditional-offer-deposit", component: "Text", text: `Refundable Security Deposit (separate): ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` },
    { id: "conditional-offer-due", component: "Text", text: `Amount Due Now: ${formatBookingMoney(facts.totalAmountDueNowKobo)}` },
    { id: "conditional-offer-progress", component: "Text", text: bookingProgressText("offer") },
    { id: "conditional-offer-consequence", component: "Text", text: facts.status === "issued" ? "Accept this Conditional Offer to continue to payment. The booking is not confirmed until payment is verified and a Reservation exists." : "A confirmed Reservation exists only after payment is verified and the application creates it." },
    { id: "conditional-offer-cancellation", component: "Text", text: `Cancellation: ${facts.cancellationPolicy.summary} (${facts.cancellationPolicy.version})` },
    { id: "conditional-offer-conduct", component: "Text", text: `Guest conduct: ${facts.guestConductRules.join("; ")}` },
    { id: "conditional-offer-disclosures", component: "Text", text: `Disclosures: ${artifact.disclosures.join("; ")}` },
    { id: "conditional-offer-actions", component: "Row", children: action ? ["conditional-offer-accept-button"] : [] },
    ...(action ? [
      { id: "conditional-offer-accept-button", component: "Button" as const, child: "conditional-offer-accept-label", variant: "primary" as const, action: { event: { name: CONDITIONAL_OFFER_ACCEPT_EVENT, context: { artifactId: action.artifactId, offerId: action.offerId, expectedStatus: action.expectedStatus, offerVersion: action.offerVersion, projectionVersion: action.projectionVersion, confirmationToken: action.confirmationToken } } }, accessibility: { label: "Accept Conditional Booking Offer" } },
      { id: "conditional-offer-accept-label", component: "Text" as const, text: "Accept Offer" },
    ] : []),
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}
