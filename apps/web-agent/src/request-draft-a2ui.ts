import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { RequestDraftArtifact } from "../../web/src/request-draft-artifact.js";
import { bookingProgressText, formatBookingMoney, formatStayDates } from "./booking-presentation.js";
import { GUEST_GLOSSARY, accommodationProviderLine, guestDisclosure, guestReservationStatus } from "./guest-content.js";

export const REQUEST_DRAFT_REVIEW_EVENT = "shortlet.request-draft.review";
export const REQUEST_DRAFT_SUBMIT_EVENT = "shortlet.request-draft.submit";

export function requestDraftArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: RequestDraftArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions[0];
  const isReview = action?.type === "submit";
  // ADR-0015/0016/0077: the draft's amountDueNow is the total requirement,
  // not an authorization to charge both components in one checkout.
  const meaningfulNames = facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  const guestSummary = meaningfulNames.length > 0 ? `Guests: ${meaningfulNames.join(", ")}` : `${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}`;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["draft-title", "draft-status", "draft-unit", ...(isReview ? ["draft-provider"] : []), "draft-dates", "draft-party", "draft-total", ...(facts.refundableSecurityDepositKobo > 0 ? ["draft-deposit"] : []), ...(isReview ? ["draft-due", "draft-revalidation"] : []), "draft-progress", "draft-cancellation", "draft-disclosures", "draft-actions"] },
    { id: "draft-title", component: "Text", text: isReview ? `Review ${GUEST_GLOSSARY.bookingRequest}` : "Request Draft", variant: "h2" },
    // Issue 07 AC1: the one reservation-status line on this surface.
    { id: "draft-status", component: "Text", text: guestReservationStatus("draft") },
    { id: "draft-unit", component: "Text", text: facts.unitTitle, variant: "h3" },
    // ADR-0006: the contracting party is named on review, where the request can lead to a contract.
    ...(isReview ? [{ id: "draft-provider", component: "Text" as const, text: accommodationProviderLine(facts.operatorName) }] : []),
    { id: "draft-dates", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)} (${facts.nights} ${facts.nights === 1 ? "night" : "nights"})` },
    { id: "draft-party", component: "Text", text: guestSummary },
    { id: "draft-total", component: "Text", text: `${GUEST_GLOSSARY.allInStayTotal}: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" },
    { id: "draft-deposit", component: "Text", text: `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` },
    { id: "draft-due", component: "Text", text: `Total to complete booking if confirmed: ${formatBookingMoney(facts.amountDueNowKobo)}` },
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
