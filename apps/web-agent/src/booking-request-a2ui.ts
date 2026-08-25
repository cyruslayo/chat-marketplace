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

export interface BookingRequestArtifactToA2UIInput {
  readonly artifact: BookingRequestArtifact;
  readonly surfaceId: string;
}

function formatAmount(amountKobo: number, currency: string): string {
  const amount = (amountKobo / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "NGN" ? `₦${amount}` : `${currency} ${amount}`;
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
  const deadlineText = facts.status === "disclosed" && !facts.delivered
    ? `Delivery deadline: ${facts.deliveryDeadlineAt}`
    : facts.status === "disclosed"
      ? `Operator response deadline: ${facts.operatorResponseDeadlineAt}`
      : "";
  const statusText = `Booking Request status: ${facts.status}`;
  const details: A2UIComponent[] = [
    { id: "booking-request-root", component: "Column", children: ["booking-request-title", "booking-request-status", "booking-request-dates", "booking-request-nights", "booking-request-delivery", ...(quote ? ["booking-request-amount"] : []), ...(deadlineText ? ["booking-request-deadline"] : []), "booking-request-actions"] },
    { id: "booking-request-title", component: "Text", text: "Booking Request", variant: "h2" },
    { id: "booking-request-status", component: "Text", text: statusText },
    { id: "booking-request-dates", component: "Text", text: `Stay: ${facts.checkIn} to ${facts.checkOut}` },
    { id: "booking-request-nights", component: "Text", text: `Nights: ${facts.nights}` },
    { id: "booking-request-delivery", component: "Text", text: `Delivery: ${facts.delivered ? `delivered${facts.deliveredAt ? ` at ${facts.deliveredAt}` : ""}` : "pending"}` },
    ...(quote ? [{ id: "booking-request-amount", component: "Text" as const, text: `All-In Stay Total: ${formatAmount(quote.allInStayTotalKobo, quote.currency)}; Refundable Security Deposit: ${formatAmount(quote.refundableSecurityDepositKobo, quote.currency)}` }] : []),
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
