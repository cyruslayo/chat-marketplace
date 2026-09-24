import {
  A2UI_V091_BASIC_CATALOG_ID,
  type A2UIComponent,
  type A2UIServerMessage,
} from "@weaver/core";
import {
  BOOKING_REQUEST_CONFIRM_EVENT,
  BOOKING_REQUEST_DECLINE_EVENT,
} from "../../web/src/booking-request-actions.js";
import type { BookingRequestArtifact } from "../../web/src/booking-request-artifact.js";
import { bookingProgressText, formatBookingDateTime, formatBookingDeadline, formatBookingMoney, formatStayDates, guestRequestStatus } from "./booking-presentation.js";

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
  const details: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-request-title", "booking-request-status", "booking-request-unit", "booking-request-dates", "booking-request-party", ...(quote ? ["booking-request-total", ...(quote.refundableSecurityDepositKobo > 0 ? ["booking-request-deposit"] : [])] : []), ...(facts.status === "disclosed" && facts.delivered ? ["booking-request-sent"] : []), ...(status.progress ? ["booking-request-progress"] : []), "booking-request-detail", ...(deadlineText ? ["booking-request-deadline"] : []), "booking-request-actions"] },
    { id: "booking-request-title", component: "Text", text: facts.status === "declined" ? "Request declined" : facts.status === "expired" ? "Request expired" : "Booking Request", variant: "h2" },
    { id: "booking-request-status", component: "Text", text: status.label },
    { id: "booking-request-unit", component: "Text", text: facts.unitTitle ?? "Your selected Unit", variant: "h3" },
    { id: "booking-request-dates", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)} (${facts.nights} nights)` },
    { id: "booking-request-party", component: "Text", text: `${facts.occupantCount ?? facts.occupants.length} ${(facts.occupantCount ?? facts.occupants.length) === 1 ? "guest" : "guests"}` },
    ...(quote ? [{ id: "booking-request-total", component: "Text" as const, text: `All-In Stay Total: ${formatBookingMoney(quote.allInStayTotalKobo, quote.currency)}`, variant: "h3" as const }, ...(quote.refundableSecurityDepositKobo > 0 ? [{ id: "booking-request-deposit", component: "Text" as const, text: `Refundable Security Deposit (separate): ${formatBookingMoney(quote.refundableSecurityDepositKobo, quote.currency)}` }] : [])] : []),
    ...(status.progress ? [{ id: "booking-request-progress", component: "Text" as const, text: bookingProgressText(status.progress) }] : []),
    ...(facts.status === "disclosed" && facts.delivered ? [{ id: "booking-request-sent", component: "Text" as const, text: `Request sent: ${formatBookingDateTime(facts.disclosedAt)}` }] : []),
    { id: "booking-request-detail", component: "Text", text: status.detail },
    ...(deadlineText ? [{ id: "booking-request-deadline", component: "Text" as const, text: deadlineText }] : []),
    { id: "booking-request-actions", component: "Row", children: [...actionButton(artifact, "confirm"), ...actionButton(artifact, "decline")].filter((component) => component.component === "Button").map((component) => component.id) },
    ...actionButton(artifact, "confirm"),
    ...actionButton(artifact, "decline"),
  ];
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components: details } },
  ];
}
