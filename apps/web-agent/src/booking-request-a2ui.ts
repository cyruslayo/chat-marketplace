import {
  type A2UIComponent,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import {
  BOOKING_REQUEST_CONFIRM_EVENT,
  BOOKING_REQUEST_DECLINE_EVENT,
} from "../../web/src/booking-request-actions.js";
import type { BookingRequestArtifact } from "../../web/src/booking-request-artifact.js";
import { bookingProgressText, bookingTicketComponents, formatBookingDateTime, formatBookingDeadline, formatBookingMoney, guestRequestStatus, priceBreakdownComponent } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY } from "./guest-content.js";
import { surfaceMessages } from "./a2ui-surface.js";
import { SHORTLET_BOOKING_CATALOG_ID } from "./shortlet-catalogs.js";

export interface BookingRequestArtifactToA2UIInput {
  readonly artifact: BookingRequestArtifact;
  readonly surfaceId: string;
}

function actionButton(
  artifact: BookingRequestArtifact,
  action: "confirm" | "decline",
): readonly A2UIComponent[] {
  const prefix = `booking-request-${action}`;
  const eventName = action === "confirm" ? BOOKING_REQUEST_CONFIRM_EVENT : BOOKING_REQUEST_DECLINE_EVENT;
  const candidate = artifact.actions.find((item) => item.type === action);
  if (!candidate) return [];
  return [
    {
      id: `${prefix}-button`,
      component: "Button",
      child: `${prefix}-label`,
      variant: action === "confirm" ? "primary" : "default",
      action: {
        event: {
          name: eventName,
          context: {
            artifactId: candidate.artifactId,
            requestId: candidate.requestId,
            expectedStatus: candidate.expectedStatus,
            projectionVersion: candidate.projectionVersion,
          },
        },
      },
      accessibility: { label: action === "confirm" ? "Confirm Booking Request" : "Decline Booking Request" },
    },
    { id: `${prefix}-label`, component: "Text", text: action === "confirm" ? "Confirm" : "Decline" },
  ];
}

export function bookingRequestArtifactToA2UI({
  artifact,
  surfaceId,
}: BookingRequestArtifactToA2UIInput): readonly A2UIServerMessage[] {
  const facts = artifact.facts;
  const quote = facts.quote;
  const status = guestRequestStatus(facts.status, facts.delivered);
  const deadlineText = facts.status === "disclosed" && facts.delivered
    ? `Operator response deadline: ${formatBookingDeadline(facts.operatorResponseDeadlineAt).replace(/^Pay by /, "")}`
    : facts.status === "disclosed"
      ? `Request delivery update due by ${formatBookingDeadline(facts.deliveryDeadlineAt).replace(/^Pay by /, "")}`
      : "";
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  const ticket = bookingTicketComponents("booking-request", facts.unitTitle ?? `Your selected ${GUEST_GLOSSARY.unit}`, { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: facts.nights, guestCount: facts.occupantCount ?? facts.occupants.length });
  const details: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-request-title", "booking-request-status", ...ticket.ids, ...(quote ? ["booking-request-breakdown"] : []), ...(facts.status === "disclosed" && facts.delivered ? ["booking-request-sent"] : []), ...(status.progress ? ["booking-request-progress"] : []), "booking-request-detail", ...(deadlineText ? ["booking-request-deadline"] : []), "booking-request-actions"] },
    { id: "booking-request-title", component: "Text", text: facts.status === "declined" ? "Request declined" : facts.status === "expired" ? "Request expired" : GUEST_GLOSSARY.bookingRequest, variant: "h2" },
    { id: "booking-request-status", component: "Text", text: status.label },
    ...ticket.components,
    // Weaver catalogues issue 04 (ADR 0102): the money lines are one typed PriceBreakdown (parts: condition, total, deposit, due).
    ...(quote ? [priceBreakdownComponent("booking-request", { condition: GUEST_FACT_LABELS.ifRequestAccepted, total: formatBookingMoney(quote.allInStayTotalKobo, quote.currency), ...(quote.refundableSecurityDepositKobo > 0 ? { deposit: formatBookingMoney(quote.refundableSecurityDepositKobo, quote.currency) } : {}), due: formatBookingMoney(quote.totalAmountDueNowKobo, quote.currency) })] : []),
    ...(status.progress ? [{ id: "booking-request-progress", component: "Text" as const, text: bookingProgressText(status.progress) }] : []),
    ...(facts.status === "disclosed" && facts.delivered ? [{ id: "booking-request-sent", component: "Text" as const, text: `Request sent: ${formatBookingDateTime(facts.disclosedAt)}` }] : []),
    { id: "booking-request-detail", component: "Text", text: status.detail },
    ...(deadlineText ? [{ id: "booking-request-deadline", component: "Text" as const, text: deadlineText }] : []),
    { id: "booking-request-actions", component: "Row", children: [...actionButton(artifact, "confirm"), ...actionButton(artifact, "decline")].filter((component) => component.component === "Button").map((component) => component.id) },
    ...actionButton(artifact, "confirm"),
    ...actionButton(artifact, "decline"),
  ];
  // Weaver catalogues issue 04 (ADR 0102): typed StayTicket / PriceBreakdown in place of label-prefixed Texts.
  return surfaceMessages(surfaceId, SHORTLET_BOOKING_CATALOG_ID, details);
}
