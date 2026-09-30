import type { RequestDraftArtifact } from "../../web/src/request-draft-artifact.js";
import type { BookingRequestArtifact } from "../../web/src/booking-request-artifact.js";
import { bookingProgressText, formatBookingDateTime, guestRequestStatus } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, accommodationProviderLine, guestDisclosure, guestFact, guestReservationStatus, guestWaitingCopy } from "./guest-content.js";

/** Presentation-only request content, projected once for the chat and the conventional page (ADR 0077). */
export interface RequestScreenContent {
  readonly state: "draft" | "review" | "sent" | "not-accepted";
  readonly title: string;
  readonly status: string;
  readonly tone: "neutral" | "warning" | "danger";
  readonly steps: readonly string[];
  readonly notes: readonly string[];
  readonly banner?: string;
  readonly provider?: string;
  readonly guests?: string;
  readonly selfBooking?: boolean;
  readonly changeHref?: string;
  readonly deadline?: { readonly iso: string; readonly text: string };
  readonly sentAt?: string;
  readonly primary: { readonly path: string; readonly label: string; readonly surfaceId?: string };
  readonly secondary?: { readonly path: string; readonly label: string };
}

export function draftScreenContent(artifact: RequestDraftArtifact, route: string, surfaceId: string, threadId: string): RequestScreenContent {
  const review = artifact.actions[0]?.type === "submit";
  const facts = artifact.facts;
  const names = facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  return {
    state: review ? "review" : "draft",
    title: review ? `Review ${GUEST_GLOSSARY.bookingRequest}` : "Request Draft",
    status: guestReservationStatus("draft"), tone: "neutral",
    steps: review ? guestWaitingCopy("operator-response", facts.operatorName).outcomes : ["Review these details before you send the request.", bookingProgressText("request").replace(/^Next:\s*/, "")],
    notes: [...(review && names.length > 0 ? [guestFact(GUEST_FACT_LABELS.guests, names.join(", "))] : []), `Cancellation terms: ${facts.cancellationPolicy.summary}`, ...(review ? [`${GUEST_GLOSSARY.revalidation}.`] : []), ...artifact.disclosures.map(guestDisclosure)],
    ...(review ? { provider: accommodationProviderLine(facts.operatorName) } : {
      guests: names.length ? names.join(", ") : `${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}`,
      ...(facts.selfBookingAttestation === undefined ? {} : { selfBooking: facts.selfBookingAttestation.accepted }),
      changeHref: `/conversation?threadId=${encodeURIComponent(threadId)}`,
    }),
    primary: { path: `${route}/${review ? "submit" : "review"}`, label: review ? "Submit Booking Request" : "Review request", surfaceId },
  };
}

export function requestScreenContent(artifact: BookingRequestArtifact, route: string, operatorName: string | undefined): RequestScreenContent {
  const facts = artifact.facts;
  const status = guestRequestStatus(facts.status, facts.delivered);
  const failed = ["declined", "expired", "delivery_failed"].includes(facts.status);
  const waiting = guestWaitingCopy("operator-response", operatorName);
  const deadline = facts.status !== "disclosed" ? undefined : facts.delivered
    ? { iso: facts.operatorResponseDeadlineAt, text: `Response due by ${formatBookingDateTime(facts.operatorResponseDeadlineAt)}` }
    : { iso: facts.deliveryDeadlineAt, text: `Request delivery update due by ${formatBookingDateTime(facts.deliveryDeadlineAt)}` };
  return {
    state: failed ? "not-accepted" : "sent",
    title: failed ? status.label : GUEST_GLOSSARY.bookingRequest,
    status: status.label, tone: failed ? "danger" : "warning",
    banner: failed ? status.detail : waiting.meanwhile[0]!,
    steps: failed ? [status.detail] : waiting.outcomes,
    notes: failed ? [] : [status.detail, ...waiting.meanwhile.slice(1)],
    ...(!failed ? { provider: accommodationProviderLine(operatorName) } : {}),
    ...(deadline === undefined ? {} : { deadline }),
    ...(facts.status === "disclosed" && facts.delivered ? { sentAt: `Request sent: ${formatBookingDateTime(facts.disclosedAt)}` } : {}),
    primary: { path: `${route}/${failed ? "search" : "conversation"}`, label: failed ? "Find other stays" : "Back to your conversation" },
    ...(failed ? { secondary: { path: `${route}/conversation`, label: "Back to your conversation" } } : {}),
  };
}
