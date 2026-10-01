import type { ConditionalOfferArtifact } from "../../web/src/conditional-offer-artifact.js";
import {
  accommodationProviderLine,
  GUEST_GLOSSARY,
  guestDisclosure,
  guestReservationStatus,
  guestWaitingCopy,
} from "./guest-content.js";

/** Presentation only: eligibility and expiry have already been projected by the application (ADR-0077). */
export interface OfferScreenContent {
  readonly state: "live" | "expired" | "accepted" | "closed";
  readonly title: string;
  readonly status: string;
  readonly deadlineIso: string;
  readonly serverNow: string;
  readonly provider: string;
  readonly consequence: string;
  readonly steps: readonly string[];
  readonly notes: readonly string[];
  readonly policies: readonly string[];
  readonly amount: string;
  readonly accept?: { readonly path: string; readonly surfaceId: string };
  readonly conversationPath: string;
  readonly searchPath?: string;
}

export function offerScreenContent(
  artifact: ConditionalOfferArtifact,
  path: string,
  surfaceId: string,
  now: Date,
  amount: string,
): OfferScreenContent {
  const facts = artifact.facts;
  const state =
    facts.status === "issued"
      ? "live"
      : facts.status === "expired"
        ? "expired"
        : facts.status === "accepted"
          ? "accepted"
          : "closed";
  const copy = guestWaitingCopy("offer-payment-window", facts.operatorName);
  return {
    state,
    title:
      state === "live"
        ? GUEST_GLOSSARY.offerReadyHeading
        : state === "expired"
          ? "This offer has expired"
          : GUEST_GLOSSARY.conditionalBookingOffer,
    status:
      state === "live"
        ? "The provider confirmed your dates"
        : state === "expired"
          ? "Conditional Booking Offer expired"
          : state === "accepted"
            ? "Offer accepted · Payment required"
            : "Offer no longer current",
    deadlineIso: facts.paymentWindowExpiresAt,
    serverNow: now.toISOString(),
    provider: accommodationProviderLine(facts.operatorName),
    // An unaccepted offer cannot have a payment attempt; do not make this claim about an accepted payment window (ADR-0044).
    consequence:
      state === "expired"
        ? `No payment was taken. ${guestReservationStatus("offer-closed")}`
        : copy.outcomes[1]!,
    steps: state === "live" ? copy.outcomes : [],
    notes:
      state === "live"
        ? [...copy.meanwhile, guestReservationStatus("offer-issued")]
        : [],
    policies: [
      `Cancellation: ${facts.cancellationPolicy.summary} (${facts.cancellationPolicy.version})`,
      `Guest conduct: ${facts.guestConductRules.join("; ")}`,
      ...artifact.disclosures.map(guestDisclosure),
    ],
    amount,
    ...(artifact.actions.some((action) => action.type === "accept") && surfaceId
      ? { accept: { path: `${path}/accept`, surfaceId } }
      : {}),
    conversationPath: `${path}/conversation`,
    ...(state === "expired" || state === "closed"
      ? { searchPath: `${path}/search` }
      : {}),
  };
}
