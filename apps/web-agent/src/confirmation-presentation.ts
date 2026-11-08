import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import { accommodationProviderLine, GUEST_FACT_LABELS, GUEST_NOTICE_COPY, guestFact, type NoticeFactsInput } from "./guest-content.js";

export interface ConfirmationContent {
  readonly bookingReference: string;
  readonly depositCollected: boolean;
  readonly steps: readonly string[];
  readonly conversationHref: string;
  readonly detailsHref: string;
  /** Demo-launch issue 12 AC4: present for an Extended Stay only; the page that lists its Billing Periods. */
  readonly scheduleHref?: string;
  readonly details: string;
  /**
   * Issue 18 (ADR 0060, 0077, 0080): the Notice to End block on a confirmed booking. A recorded notice shows its facts (the page's
   * helper); an Extended Stay without one offers the action that opens the card. The chat's confirmation screen replaces the Weaver
   * tree, so this block is what carries the notice into the chat.
   */
  readonly notice?: { readonly kind: "recorded"; readonly facts: NoticeFactsInput } | { readonly kind: "action" };
}

/** ADR-0085: a confirmed Reservation never grants physical-access authority. */
export function confirmationSteps(facts: BookingContractArtifact["facts"]): readonly string[] {
  return [...(facts.accessAvailability === "available"
    ? ["Access information is available. Ask about arrival for help."]
    : ["Check-in details will be shared when they are ready."]),
  "A confirmed booking does not itself grant physical access.",
  "Booking reference and full contract are in your booking details."];
}

/** Reservation ID is the reference by the user's issue-10 decision; it is not a payment credential. */
export function confirmationContent(artifact: BookingContractArtifact, threadId: string, route: string, _details: string): ConfirmationContent {
  const guestNames = artifact.facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  return {
    bookingReference: artifact.facts.reservationId,
    depositCollected: artifact.facts.securityDeposit?.status === "held" && (artifact.facts.refundableSecurityDepositKobo ?? 0) > 0,
    steps: confirmationSteps(artifact.facts),
    conversationHref: `/conversation?threadId=${encodeURIComponent(threadId)}`,
    detailsHref: `${route}#booking-details`,
    ...(artifact.facts.noticeToEndTerms ? { scheduleHref: `/bookings/periods/${encodeURIComponent(artifact.facts.offerId)}` } : {}),
    ...(artifact.facts.noticeToEnd ? { notice: { kind: "recorded" as const, facts: artifact.facts.noticeToEnd } } : artifact.facts.noticeToEndTerms ? { notice: { kind: "action" as const } } : {}),
    details: [accommodationProviderLine(artifact.facts.accommodationProvider.name),
      ...(guestNames.length ? [guestFact(GUEST_FACT_LABELS.guests, guestNames.join(", "))] : []),
      `Checkout time: ${artifact.facts.checkout?.time ?? "11:00"} WAT`,
      `Cancellation terms: ${artifact.facts.cancellationPolicy?.summary ?? "See your Booking Contract."} House rules: ${artifact.facts.guestConductRules.join("; ") || "See your Booking Contract."}`,
      ...(artifact.facts.noticeToEndTerms ? [`Notice to End: ${artifact.facts.noticeToEndTerms}`] : []),
      ...(artifact.facts.cardMetadata ? [`Card ending ${artifact.facts.cardMetadata.last4}.`] : [])].join("\n"),
  };
}
