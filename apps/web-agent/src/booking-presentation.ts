import { formatNgnKobo } from "./discovery-a2ui.js";
import type { CardPaymentStatus } from "../../web/src/card-payment-artifact.js";
import type { A2UIComponent } from "@cylayo/weaver-core";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, guestFact, guestReservationStatus } from "./guest-content.js";
import { formatWatDateTime } from "../../web/src/ui-kit.js";

export type BookingProgressStage = "request" | "operator-review" | "offer" | "payment" | "payment-processing" | "confirmed";

/** Shortlet's name for the neutral WAT formatter in ui-kit; the output is unchanged. */
export function formatBookingDateTime(iso: string): string {
  return formatWatDateTime(iso);
}

export function formatBookingDeadline(iso: string): string {
  const dateTime = formatBookingDateTime(iso);
  return dateTime === "time unavailable" ? "Payment deadline unavailable" : `Pay by ${dateTime}`;
}

export function formatStayDates(checkIn: string, checkOut: string): string {
  const formatDate = (value: string): { readonly day: string; readonly month: string; readonly year: string } | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-NG", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
    return { day: part("day"), month: part("month"), year: part("year") };
  };
  const start = formatDate(checkIn);
  const end = formatDate(checkOut);
  if (!start || !end) return `${checkIn} to ${checkOut}`;
  if (start.month === end.month && start.year === end.year) return `${start.day}–${end.day} ${end.month} ${end.year}`;
  if (start.year === end.year) return `${start.day} ${start.month}–${end.day} ${end.month} ${end.year}`;
  return `${start.day} ${start.month} ${start.year}–${end.day} ${end.month} ${end.year}`;
}

export function bookingProgressText(stage: BookingProgressStage): string {
  const sequences: Readonly<Record<BookingProgressStage, string>> = {
    request: "Next: Send your request to ask the Operator to confirm availability.",
    "operator-review": "The Operator is reviewing your request.",
    offer: "Next: Review the offer and decide whether to accept it.",
    payment: "Next: Complete secure payment in the hosted checkout to confirm your stay.",
    "payment-processing": "Payment is being checked. Your stay is not confirmed yet; do not submit another payment.",
    confirmed: "Payment verified. Your stay is confirmed.",
  };
  return sequences[stage];
}

// Issue 07 AC1: the detail carries the surface's single reservation-status line.
export function guestRequestStatus(status: string, delivered: boolean): { readonly label: string; readonly progress?: BookingProgressStage; readonly detail: string } {
  if (status === "disclosed" && delivered) return { label: "Request sent · Waiting for Operator response", progress: "operator-review", detail: guestReservationStatus("request-sent") };
  if (status === "disclosed") return { label: `Sending ${GUEST_GLOSSARY.bookingRequest}`, progress: "operator-review", detail: guestReservationStatus("request-delivering") };
  if (status === "confirmed") return { label: "Operator confirmed availability · Offer being prepared", progress: "offer", detail: guestReservationStatus("operator-confirmed") };
  if (status === "declined") return { label: "Request declined", detail: guestReservationStatus("request-declined") };
  if (status === "expired") return { label: "Request expired", detail: guestReservationStatus("request-expired") };
  if (status === "delivery_failed") return { label: "Request could not be delivered", detail: guestReservationStatus("request-not-delivered") };
  if (status === "draft") return { label: GUEST_GLOSSARY.requestDraftStatus, progress: "request", detail: guestReservationStatus("draft") };
  return { label: `${GUEST_GLOSSARY.bookingRequest} status unavailable`, detail: "Refresh the current booking status before taking another action." };
}

export interface GuestPaymentCopy {
  readonly label: string;
  readonly detail: string;
  readonly progress?: BookingProgressStage;
}

/** Issue 09: `checkout_initiated` alone splits on the processing stage; every other status has one copy. */
interface GuestCheckoutCopy {
  readonly processing: GuestPaymentCopy;
  readonly handoff: GuestPaymentCopy;
}

/**
 * Issue 09 (ADR 0074): one entry per CardPaymentStatus. A new status without copy fails `npm run check` (satisfies).
 * Copy is unchanged from the ternary chain this replaced.
 */
export const GUEST_PAYMENT_STATUS_COPY = {
  ready: { label: "Payment required", detail: "Continue to the designated payment checkout. Payment has not succeeded and the booking is not confirmed.", progress: "payment" },
  checkout_initiated: {
    processing: { label: "Payment processing · Checking payment", detail: "We are checking the provider’s payment confirmation. Do not submit another payment while this result is pending. The booking is not confirmed until payment is verified and a Reservation exists.", progress: "payment-processing" },
    handoff: { label: "Payment handoff ready · Payment not yet verified", detail: "Continue the current payment attempt. Payment has not succeeded and your booking is not confirmed. Your booking details will be retained when you return. Do not start another payment while this attempt is pending.", progress: "payment" },
  },
  deposit_required: { label: `Payment required · ${GUEST_GLOSSARY.refundableSecurityDeposit}`, detail: `The stay payment is verified. A separate ${GUEST_GLOSSARY.refundableSecurityDeposit} payment is still required before a Reservation can exist.`, progress: "payment" },
  compensation_pending: { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." },
  reconciliation_required: { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." },
  compensated: { label: "Payment review update available", detail: "The payment attempt is closed and no Reservation exists. Check the current booking details before taking another action." },
  expired: { label: "Payment window expired · Booking not confirmed", detail: "The Payment Window expired. This payment action is no longer available; no Reservation exists." },
  failed: { label: "Payment was not verified · Booking not confirmed", detail: "Payment was not verified. No Reservation was created. Check the current booking status before retrying." },
  confirmed: { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" },
} satisfies Record<CardPaymentStatus, GuestPaymentCopy | GuestCheckoutCopy>;

/** Issue 12 (ADR 0074, fail closed): a runtime value outside CardPaymentStatus; mirrors guestRequestStatus's fallback. */
const GUEST_PAYMENT_STATUS_UNAVAILABLE: GuestPaymentCopy = { label: "Payment status unavailable", detail: "Refresh the current booking status before taking another action." };

export function guestPaymentStatus(status: CardPaymentStatus, processing = false): GuestPaymentCopy {
  if (!Object.hasOwn(GUEST_PAYMENT_STATUS_COPY, status)) return { ...GUEST_PAYMENT_STATUS_UNAVAILABLE };
  const entry: GuestPaymentCopy | GuestCheckoutCopy = GUEST_PAYMENT_STATUS_COPY[status];
  if ("processing" in entry) return { ...(processing ? entry.processing : entry.handoff) };
  return { ...entry };
}

export function formatBookingMoney(kobo: number, currency = "NGN"): string {
  const ngnAmount = formatNgnKobo(kobo);
  return currency === "NGN" ? ngnAmount : `${currency} ${ngnAmount.slice(1)}`;
}

/** "Sat, 3 Oct 2026" for a plain calendar date; anything else is shown as given. */
export function formatTicketDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** The ticket's foot line, shared by the standalone pages and the A2UI builders: "3 nights · 2 guests". */
export function formatStayFoot(nights: number, guestCount?: number): string {
  const guests = guestCount === undefined ? "" : ` · ${guestCount} ${guestCount === 1 ? "guest" : "guests"}`;
  return `${nights} ${nights === 1 ? "night" : "nights"}${guests}`;
}

/** The three ticket facts of a booking surface as separate Text components: check-in, check-out, stay and party. */
export function ticketFactComponents(prefix: string, stay: { readonly checkIn: string; readonly checkOut: string; readonly nights: number; readonly guestCount?: number }): readonly A2UIComponent[] {
  return [
    { id: `${prefix}-check-in`, component: "Text", text: guestFact(GUEST_FACT_LABELS.checkIn, formatTicketDate(stay.checkIn)) },
    { id: `${prefix}-check-out`, component: "Text", text: guestFact(GUEST_FACT_LABELS.checkOut, formatTicketDate(stay.checkOut)) },
    { id: `${prefix}-stay`, component: "Text", text: guestFact(GUEST_FACT_LABELS.stay, formatStayFoot(stay.nights, stay.guestCount)) },
  ];
}

export function ticketFactIds(prefix: string): readonly string[] {
  return [`${prefix}-check-in`, `${prefix}-check-out`, `${prefix}-stay`];
}

/** Whole nights between two plain calendar dates (0 when they are not a valid stay). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
}

/** One facility tile of the unit-detail sheet (issue 06): bedrooms, bathrooms and capacity, each with its icon. */
export interface UnitTile {
  readonly icon: "bed" | "bath" | "users";
  readonly text: string;
}

/**
 * Guest UI consistency issue 06: the unit-detail sheet's facility tiles, in one canonical order. A missing bedroom
 * count shows "Not provided" (as the page always has). The page and the chat's builder both read this, so the tiles
 * are one source.
 */
export function unitTiles(bedrooms: number | undefined, bathrooms: number, capacity: number): readonly UnitTile[] {
  return [
    { icon: "bed", text: bedrooms === undefined ? "Not provided" : `${bedrooms} ${bedrooms === 1 ? "bedroom" : "bedrooms"}` },
    { icon: "bath", text: `${bathrooms} ${bathrooms === 1 ? "bathroom" : "bathrooms"}` },
    { icon: "users", text: `Sleeps ${capacity}` },
  ];
}

/** Issue 06: the unit-detail quoted price label, "All-In Stay Total · 10–13 Sept 2026 · 3 nights" (ADR 0015). */
export function unitStayTotalLabel(stayDates: string, nights: number): string {
  return `${GUEST_GLOSSARY.allInStayTotal} · ${stayDates} · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

