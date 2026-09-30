import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { RequestDraftArtifact } from "../../web/src/request-draft-artifact.js";
import { bookingProgressText, formatBookingMoney, ticketFactComponents, ticketFactIds } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, accommodationProviderLine, guestDisclosure, guestFact, guestReservationStatus } from "./guest-content.js";

export const REQUEST_DRAFT_REVIEW_EVENT = "shortlet.request-draft.review";
export const REQUEST_DRAFT_SUBMIT_EVENT = "shortlet.request-draft.submit";

export function requestDraftArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: RequestDraftArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions[0];
  const isReview = action?.type === "submit";
  // ADR-0015/0016/0077: the draft's amountDueNow is the total requirement,
  // not an authorization to charge both components in one checkout.
  // Named occupants stay visible as their own labelled line (the ticket itself shows only the count).
  const guestNames = facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["draft-title", "draft-status", "draft-unit", ...(isReview ? ["draft-provider"] : []), ...ticketFactIds("draft"), ...(guestNames.length > 0 ? ["draft-guests"] : []), "draft-condition", "draft-total", ...(facts.refundableSecurityDepositKobo > 0 ? ["draft-deposit"] : []), ...(isReview ? ["draft-due", "draft-revalidation"] : []), "draft-progress", "draft-cancellation", "draft-disclosures", "draft-actions"] },
    { id: "draft-title", component: "Text", text: isReview ? `Review ${GUEST_GLOSSARY.bookingRequest}` : "Request Draft", variant: "h2" },
    // Issue 07 AC1: the one reservation-status line on this surface.
    { id: "draft-status", component: "Text", text: guestReservationStatus("draft") },
    { id: "draft-unit", component: "Text", text: facts.unitTitle, variant: "h3" },
    // ADR-0006: the contracting party is named on review, where the request can lead to a contract.
    ...(isReview ? [{ id: "draft-provider", component: "Text" as const, text: accommodationProviderLine(facts.operatorName) }] : []),
    // Guest UI consistency issue 04: the ticket and money facts are separate label-prefixed Texts, in canonical order.
    ...ticketFactComponents("draft", { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: facts.nights, guestCount: facts.occupants.length }),
    ...(guestNames.length > 0 ? [{ id: "draft-guests", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.guests, guestNames.join(", ")) }] : []),
    { id: "draft-condition", component: "Text", text: GUEST_FACT_LABELS.ifRequestAccepted },
    { id: "draft-total", component: "Text", text: guestFact(GUEST_FACT_LABELS.allInStayTotal, formatBookingMoney(facts.allInStayTotalKobo)), variant: "h3" },
    { id: "draft-deposit", component: "Text", text: guestFact(GUEST_FACT_LABELS.refundableSecurityDeposit, formatBookingMoney(facts.refundableSecurityDepositKobo)) },
    { id: "draft-due", component: "Text", text: guestFact(GUEST_FACT_LABELS.amountDueNow, formatBookingMoney(facts.amountDueNowKobo)) },
    { id: "draft-progress", component: "Text", text: `What happens next: ${bookingProgressText("request").replace(/^Next:\s*/, "")}` },
    { id: "draft-cancellation", component: "Text", text: `Cancellation terms: ${facts.cancellationPolicy.summary}` },
    ...(isReview ? [{ id: "draft-revalidation", component: "Text" as const, text: `${GUEST_GLOSSARY.revalidation}.` }] : []),
    { id: "draft-disclosures", component: "Text", text: artifact.disclosures.map(guestDisclosure).join(" ") || `${GUEST_GLOSSARY.revalidation}.` },
    { id: "draft-actions", component: "Row", children: action ? ["draft-action-button"] : ["draft-blocked"] },
    ...(!action ? [{ id: "draft-blocked", component: "Text" as const, text: "This request cannot be continued in the current session." }] : []),
    ...(action ? [{ id: "draft-action-button", component: "Button" as const, child: "draft-action-label", variant: "primary" as const, action: { event: { name: action.type === "submit" ? REQUEST_DRAFT_SUBMIT_EVENT : REQUEST_DRAFT_REVIEW_EVENT, context: { artifactId: action.artifactId, draftId: action.draftId, expectedStatus: action.expectedStatus, projectionVersion: action.projectionVersion } } }, accessibility: { label: action.type === "submit" ? "Submit Booking Request" : "Review request" } }, { id: "draft-action-label", component: "Text" as const, text: action.type === "submit" ? "Submit Booking Request" : "Review request" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
