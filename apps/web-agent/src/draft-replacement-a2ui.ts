import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { formatBookingMoney, formatStayDates } from "./booking-presentation.js";
import { GUEST_GLOSSARY, guestReservationStatus } from "./guest-content.js";

/** Issue 14: accept the proposed replacement Request Draft. */
export const DRAFT_REPLACEMENT_ACCEPT_EVENT = "shortlet.request-draft.replacement.accept";
/** Issue 14: keep the current Request Draft unchanged. */
export const DRAFT_REPLACEMENT_KEEP_EVENT = "shortlet.request-draft.replacement.keep";

export interface DraftStayTerms {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly partySize: number;
  readonly allInStayTotalKobo: number;
  readonly refundableSecurityDepositKobo: number;
  readonly amountDueNowKobo: number;
}

export interface DraftReplacementProposal {
  readonly draftId: string;
  /** Fingerprint of the proposed terms; accepting stale terms fails closed. */
  readonly basedOn: string;
  readonly unitTitle: string;
  readonly current: DraftStayTerms;
  readonly proposed: DraftStayTerms;
}

function stayLine(terms: DraftStayTerms): string {
  return `${formatStayDates(terms.checkIn, terms.checkOut)} · ${terms.nights} ${terms.nights === 1 ? "night" : "nights"} · ${terms.partySize} ${terms.partySize === 1 ? "guest" : "guests"}`;
}

/** Plain-text proposal for fallbacks and the no-JavaScript page. */
export function draftReplacementFallback(proposal: DraftReplacementProposal): string {
  const { current, proposed } = proposal;
  return `${guestReservationStatus("draft")}. ${proposal.unitTitle}. Current draft: ${stayLine(current)}, ${GUEST_GLOSSARY.allInStayTotal} ${formatBookingMoney(current.allInStayTotalKobo)}. New details: ${stayLine(proposed)}, ${GUEST_GLOSSARY.allInStayTotal} ${formatBookingMoney(proposed.allInStayTotalKobo)}.${proposed.refundableSecurityDepositKobo > 0 ? ` ${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatBookingMoney(proposed.refundableSecurityDepositKobo)}.` : ""} Total to complete booking if confirmed: ${formatBookingMoney(proposed.amountDueNowKobo)}. Nothing changes until you choose; keeping your current draft costs nothing.`;
}

/**
 * Issue 14 AC3 / ADR-0015: a fully explained replacement quote the Guest may
 * accept or decline without penalty. Both sets of terms come from the same
 * deterministic quote; the current draft stays valid until Accept.
 */
export function draftReplacementToA2UI({ proposal, surfaceId }: { readonly proposal: DraftReplacementProposal; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { current, proposed } = proposal;
  const components: A2UIComponent[] = [
    {
      id: "root",
      component: "Column",
      children: ["replacement-title", "replacement-status", "replacement-unit", "replacement-current-label", "replacement-current", "replacement-new-label", "replacement-new",
        ...(proposed.refundableSecurityDepositKobo > 0 ? ["replacement-deposit"] : []), "replacement-due", "replacement-note", "replacement-actions"],
    },
    { id: "replacement-title", component: "Text", text: "Change your Request Draft?", variant: "h2" },
    // Issue 07 AC1: the one reservation-status line on this surface.
    { id: "replacement-status", component: "Text", text: guestReservationStatus("draft") },
    { id: "replacement-unit", component: "Text", text: proposal.unitTitle, variant: "h3" },
    { id: "replacement-current-label", component: "Text", text: "Current draft", variant: "caption" },
    { id: "replacement-current", component: "Text", text: `${stayLine(current)} · ${GUEST_GLOSSARY.allInStayTotal}: ${formatBookingMoney(current.allInStayTotalKobo)}` },
    { id: "replacement-new-label", component: "Text", text: "New details", variant: "caption" },
    { id: "replacement-new", component: "Text", text: `${stayLine(proposed)} · ${GUEST_GLOSSARY.allInStayTotal}: ${formatBookingMoney(proposed.allInStayTotalKobo)}`, variant: "h3" },
    { id: "replacement-deposit", component: "Text", text: `${GUEST_GLOSSARY.refundableSecurityDeposit} (separate): ${formatBookingMoney(proposed.refundableSecurityDepositKobo)}` },
    { id: "replacement-due", component: "Text", text: `Total to complete booking if confirmed: ${formatBookingMoney(proposed.amountDueNowKobo)}` },
    { id: "replacement-note", component: "Text", text: "Nothing changes until you choose. Keeping your current draft costs nothing.", variant: "caption" },
    { id: "replacement-actions", component: "Row", children: ["replacement-accept", "replacement-keep"] },
    {
      id: "replacement-accept",
      component: "Button",
      child: "replacement-accept-label",
      variant: "primary",
      action: { event: { name: DRAFT_REPLACEMENT_ACCEPT_EVENT, context: { draftId: proposal.draftId, basedOn: proposal.basedOn } } },
    },
    { id: "replacement-accept-label", component: "Text", text: "Use the new details" },
    {
      id: "replacement-keep",
      component: "Button",
      child: "replacement-keep-label",
      action: { event: { name: DRAFT_REPLACEMENT_KEEP_EVENT, context: { draftId: proposal.draftId } } },
    },
    { id: "replacement-keep-label", component: "Text", text: "Keep my current draft" },
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ];
}
