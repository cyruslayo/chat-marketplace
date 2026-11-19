import { type A2UIComponent, type A2UIServerMessage } from "@cylayo/weaver-core";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../../web/src/conditional-offer-actions.js";
import type { ConditionalOfferArtifact } from "../../web/src/conditional-offer-artifact.js";
import { bookingProgressText, bookingTicketComponents, formatBookingDeadline, formatBookingMoney, formatStayDates, priceBreakdownComponent } from "./booking-presentation.js";
import { billingPeriodLines } from "./extended-stay-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, GUEST_PAYMENT_COPY, accommodationProviderLine, guestDisclosure, guestReservationStatus } from "./guest-content.js";
import { surfaceMessages } from "./a2ui-surface.js";
import { SHORTLET_BOOKING_CATALOG_ID } from "./shortlet-catalogs.js";

export function conditionalOfferArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: ConditionalOfferArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions.find((candidate) => candidate.type === "accept");
  const statusLabel = facts.status === "issued" ? "Offer available · Operator confirmed availability"
    : facts.status === "accepted" ? "Offer accepted · Payment required"
      : facts.status === "expired" ? "Offer expired"
        : facts.status === "stale" ? "Offer no longer current"
          : "Offer withdrawn";
  // Issue 27 (ADR 0092): an Extended Stay shows its full contracted range and every Billing Period, from the projection.
  const schedulePeriods = billingPeriodLines(facts.billingPeriods);
  const extendedRange = facts.stayType === "extended" ? formatStayDates(facts.checkIn, facts.checkOut) : undefined;
  const scheduleIds = schedulePeriods.map((_, index) => `conditional-offer-period-${index}`);
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  const ticket = bookingTicketComponents("conditional-offer", facts.unitTitle, { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: facts.nights, guestCount: facts.occupants.length });
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["conditional-offer-title", "conditional-offer-status", ...ticket.ids, "conditional-offer-provider", "conditional-offer-breakdown", "conditional-offer-expiry", "conditional-offer-progress", "conditional-offer-consequence", ...(schedulePeriods.length > 0 ? ["conditional-offer-schedule-heading", ...scheduleIds, "conditional-offer-first-period"] : []), "conditional-offer-cancellation", "conditional-offer-conduct", "conditional-offer-disclosures", "conditional-offer-actions"] },
    { id: "conditional-offer-title", component: "Text", text: facts.status === "issued" ? GUEST_GLOSSARY.offerReadyHeading : GUEST_GLOSSARY.conditionalBookingOffer, variant: "h2" },
    { id: "conditional-offer-status", component: "Text", text: statusLabel },
    // ADR-0006: accepting this offer and paying forms the contract with this Operator.
    { id: "conditional-offer-provider", component: "Text", text: accommodationProviderLine(facts.operatorName) },
    ...ticket.components,
    { id: "conditional-offer-expiry", component: "Text", text: `${formatBookingDeadline(facts.paymentWindowExpiresAt)}. This deadline comes from the current offer.` },
    // Weaver catalogues issue 04 (ADR 0102): the money lines are one typed PriceBreakdown (parts: total, deposit, due).
    priceBreakdownComponent("conditional-offer", { total: formatBookingMoney(facts.allInStayTotalKobo), ...(facts.refundableSecurityDepositKobo > 0 ? { deposit: formatBookingMoney(facts.refundableSecurityDepositKobo) } : {}), due: formatBookingMoney(facts.totalAmountDueNowKobo) }),
    { id: "conditional-offer-progress", component: "Text", text: bookingProgressText("offer") },
    { id: "conditional-offer-consequence", component: "Text", text: guestReservationStatus(facts.status === "issued" ? "offer-issued" : facts.status === "accepted" ? "offer-accepted" : "offer-closed") },
    ...(extendedRange === undefined ? [] : [{ id: "conditional-offer-extended-range", component: "Text" as const, text: `${GUEST_FACT_LABELS.stayDates}: ${extendedRange}` }]),
    ...(schedulePeriods.length > 0 ? [
      { id: "conditional-offer-schedule-heading", component: "Text" as const, text: GUEST_FACT_LABELS.paymentSchedule, variant: "h3" as const },
      ...schedulePeriods.map((text, index) => ({ id: `conditional-offer-period-${index}`, component: "Text" as const, text })),
      { id: "conditional-offer-first-period", component: "Text" as const, text: GUEST_FACT_LABELS.firstPeriodOnly, variant: "caption" as const },
    ] : []),
    { id: "conditional-offer-cancellation", component: "Text", text: `Cancellation: ${facts.cancellationPolicy.summary}` },
    { id: "conditional-offer-conduct", component: "Text", text: `Guest conduct: ${facts.guestConductRules.join("; ")}` },
    { id: "conditional-offer-disclosures", component: "Text", text: `Disclosures: ${artifact.disclosures.map(guestDisclosure).join("; ")}` },
    { id: "conditional-offer-actions", component: "Row", children: action ? ["conditional-offer-accept-button"] : [] },
    ...(action ? [
      { id: "conditional-offer-accept-button", component: "Button" as const, child: "conditional-offer-accept-label", variant: "primary" as const, action: { event: { name: CONDITIONAL_OFFER_ACCEPT_EVENT, context: { artifactId: action.artifactId, offerId: action.offerId, expectedStatus: action.expectedStatus, offerVersion: action.offerVersion, projectionVersion: action.projectionVersion, confirmationToken: action.confirmationToken } } }, accessibility: { label: GUEST_PAYMENT_COPY.accept } },
      { id: "conditional-offer-accept-label", component: "Text" as const, text: GUEST_PAYMENT_COPY.accept },
    ] : []),
  ];
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  return surfaceMessages(surfaceId, SHORTLET_BOOKING_CATALOG_ID, components);
}
