import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { RequestDraftArtifact } from "../../web/src/request-draft-artifact.js";
import { bookingProgressText, formatBookingMoney, formatStayDates } from "./booking-presentation.js";

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
    { id: "root", component: "Column", children: ["draft-title", "draft-status", "draft-unit", "draft-provider", "draft-dates", "draft-party", "draft-total", ...(facts.refundableSecurityDepositKobo > 0 ? ["draft-deposit"] : []), ...(isReview ? ["draft-due"] : []), "draft-progress", "draft-reservation", "draft-cancellation", "draft-disclosures", "draft-actions"] },
    { id: "draft-title", component: "Text", text: isReview ? "Review Booking Request" : "Request Draft", variant: "h2" },
    { id: "draft-status", component: "Text", text: isReview ? "Review · Not submitted" : "Draft · Not reserved" },
    { id: "draft-unit", component: "Text", text: facts.unitTitle, variant: "h3" },
    { id: "draft-provider", component: "Text", text: `Accommodation Provider: ${facts.operatorName}` },
    { id: "draft-dates", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)} (${facts.nights} ${facts.nights === 1 ? "night" : "nights"})` },
    { id: "draft-party", component: "Text", text: guestSummary },
    { id: "draft-total", component: "Text", text: `All-In Stay Total: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" },
    { id: "draft-deposit", component: "Text", text: `Refundable Security Deposit (separate): ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` },
    { id: "draft-due", component: "Text", text: `Total to complete booking if confirmed: ${formatBookingMoney(facts.amountDueNowKobo)}` },
    { id: "draft-progress", component: "Text", text: `What happens next: ${bookingProgressText("request").replace(/^Next:\s*/, "")}` },
    { id: "draft-cancellation", component: "Text", text: `Cancellation terms: ${facts.cancellationPolicy.summary}` },
    { id: "draft-reservation", component: "Text", text: isReview ? "Submitting this request does not yet confirm the stay or create a Reservation. Availability and price are checked again when submitted." : "The Operator must confirm availability after you send this request. Dates are not held yet." },
    { id: "draft-disclosures", component: "Text", text: artifact.disclosures.join(" ") || "Terms will be revalidated before submission." },
    { id: "draft-actions", component: "Row", children: action ? ["draft-action-button"] : ["draft-blocked"] },
    ...(!action ? [{ id: "draft-blocked", component: "Text" as const, text: "This Request Draft is not actionable in the current session." }] : []),
    ...(action ? [{ id: "draft-action-button", component: "Button" as const, child: "draft-action-label", variant: "primary" as const, action: { event: { name: action.type === "submit" ? REQUEST_DRAFT_SUBMIT_EVENT : REQUEST_DRAFT_REVIEW_EVENT, context: { artifactId: action.artifactId, draftId: action.draftId, expectedStatus: action.expectedStatus, projectionVersion: action.projectionVersion } } }, accessibility: { label: action.type === "submit" ? "Submit Booking Request" : "Review request" } }, { id: "draft-action-label", component: "Text" as const, text: action.type === "submit" ? "Submit Booking Request" : "Review request" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
