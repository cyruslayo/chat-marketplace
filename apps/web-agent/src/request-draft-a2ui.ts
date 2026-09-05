import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { RequestDraftArtifact } from "../../web/src/request-draft-artifact.js";

export const REQUEST_DRAFT_REVIEW_EVENT = "shortlet.request-draft.review";
export const REQUEST_DRAFT_SUBMIT_EVENT = "shortlet.request-draft.submit";

function amount(kobo: number): string { return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export function requestDraftArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: RequestDraftArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const action = artifact.actions[0];
  const isReview = action?.type === "submit";
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["draft-title", "draft-unit", "draft-provider", "draft-dates", "draft-party", "draft-total", "draft-deposit", "draft-due", "draft-cancellation", "draft-reservation", "draft-disclosures", "draft-actions"] },
    { id: "draft-title", component: "Text", text: isReview ? "Review Booking Request" : "Request Draft", variant: "h2" },
    { id: "draft-unit", component: "Text", text: `Unit: ${facts.unitTitle}` },
    { id: "draft-provider", component: "Text", text: `Accommodation Provider: ${facts.operatorName}` },
    { id: "draft-dates", component: "Text", text: `Stay: ${facts.checkIn} to ${facts.checkOut} (${facts.nights} nights)` },
    { id: "draft-party", component: "Text", text: `Primary Guest: ${facts.primaryGuestName}; Guests: ${facts.occupants.join(", ")}` },
    { id: "draft-total", component: "Text", text: `All-In Stay Total: ${amount(facts.allInStayTotalKobo)} NGN` },
    { id: "draft-deposit", component: "Text", text: `Refundable Security Deposit: ${amount(facts.refundableSecurityDepositKobo)} NGN` },
    { id: "draft-due", component: "Text", text: `Amount Due Now if confirmed: ${amount(facts.amountDueNowKobo)} NGN` },
    { id: "draft-cancellation", component: "Text", text: `Cancellation: ${facts.cancellationPolicy.type} (${facts.cancellationPolicy.version}) — ${facts.cancellationPolicy.summary}` },
    { id: "draft-reservation", component: "Text", text: "Inventory is not reserved. This is not a Booking Request or Reservation." },
    { id: "draft-disclosures", component: "Text", text: artifact.disclosures.join(" ") || "Terms will be revalidated before submission." },
    { id: "draft-actions", component: "Row", children: action ? ["draft-action-button"] : ["draft-blocked"] },
    ...(!action ? [{ id: "draft-blocked", component: "Text" as const, text: facts.guestIdentityVerified ? "This Request Draft is not actionable in the current session." : "Guest Identity Verification is required before a Booking Request can be disclosed. Use the conventional verification route when available." }] : []),
    ...(action ? [{ id: "draft-action-button", component: "Button" as const, child: "draft-action-label", variant: "primary" as const, action: { event: { name: action.type === "submit" ? REQUEST_DRAFT_SUBMIT_EVENT : REQUEST_DRAFT_REVIEW_EVENT, context: { artifactId: action.artifactId, draftId: action.draftId, expectedStatus: action.expectedStatus, projectionVersion: action.projectionVersion } } }, accessibility: { label: action.type === "submit" ? "Submit Booking Request" : "Review Booking Request" } }, { id: "draft-action-label", component: "Text" as const, text: action.type === "submit" ? "Submit Booking Request" : "Review Request" }] : []),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
