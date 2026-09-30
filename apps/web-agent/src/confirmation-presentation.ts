import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import { accommodationProviderLine, GUEST_FACT_LABELS, guestFact } from "./guest-content.js";

export interface ConfirmationContent {
  readonly bookingReference: string;
  readonly depositCollected: boolean;
  readonly steps: readonly string[];
  readonly conversationHref: string;
  readonly detailsHref: string;
  readonly details: string;
}

/** ADR-0085: a confirmed Reservation never grants physical-access authority. */
export function confirmationSteps(facts: BookingContractArtifact["facts"]): readonly string[] {
  return [...(facts.accessAvailability === "available"
    ? ["Your access details are in secure booking details."]
    : ["Check-in details will be shared when they are ready.", "A confirmed booking does not itself grant physical access."]),
  "Booking reference and full contract are in your booking details."];
}

/** Reservation ID is the reference by the user's issue-10 decision; it is not a payment credential. */
export function confirmationContent(artifact: BookingContractArtifact, threadId: string, route: string, details: string): ConfirmationContent {
  const guestNames = artifact.facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  return {
    bookingReference: artifact.facts.reservationId,
    depositCollected: artifact.facts.securityDeposit?.status === "held" && (artifact.facts.refundableSecurityDepositKobo ?? 0) > 0,
    steps: confirmationSteps(artifact.facts),
    conversationHref: `/conversation?threadId=${encodeURIComponent(threadId)}`,
    detailsHref: `${route}#booking-details`,
    details: [details, accommodationProviderLine(artifact.facts.accommodationProvider.name),
      ...(guestNames.length ? [guestFact(GUEST_FACT_LABELS.guests, guestNames.join(", "))] : []),
      `Checkout time: ${artifact.facts.checkout?.time ?? "11:00"} WAT`,
      `Cancellation terms: ${artifact.facts.cancellationPolicy?.summary ?? "See your Booking Contract."} House rules: ${artifact.facts.guestConductRules.join("; ") || "See your Booking Contract."}`,
      ...(artifact.facts.cardMetadata ? [`Card ending ${artifact.facts.cardMetadata.last4}.`] : [])].join("\n"),
  };
}
