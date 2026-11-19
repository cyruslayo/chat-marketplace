import { formatNgnKobo } from "./discovery-a2ui.js";
import type { CardPaymentStatus } from "../../web/src/card-payment-artifact.js";
import type { A2UIComponent } from "@cylayo/weaver-core";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, guestFact, guestReservationStatus } from "./guest-content.js";
import { formatWatDateTime } from "../../web/src/ui-kit.js";
import { PRICE_BREAKDOWN_COMPONENT, STAY_TICKET_COMPONENT } from "./shortlet-catalogs.js";

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

/** One end of the stay ticket. */
export interface TicketDatePart {
  readonly day: string;
  readonly date: string;
  readonly datetime?: string;
  /** Shown only when supplied by the policy projection (ADR 0031/0032). */
  readonly time?: string;
}

/** The ticket's display text, shared by the standalone pages (`stayTicketHtml`) and the chat's typed StayTicket. */
export interface TicketParts {
  readonly title: string;
  readonly checkIn: TicketDatePart;
  readonly checkOut: TicketDatePart;
  readonly foot: string;
}

/** The breakdown's display text: money already formatted, in the order the section shows it (ADR 0015). */
export interface BreakdownParts {
  readonly depositCollected?: boolean;
  readonly condition?: string;
  readonly total?: string;
  readonly totalLabel?: string;
  readonly deposit?: string;
  readonly due?: string;
  readonly thisPayment?: string;
  readonly paid?: string;
  readonly next?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A plain calendar date as a ticket end: the day of the month, the formatted date and the machine-readable datetime. */
export function ticketDatePart(iso: string): TicketDatePart {
  return { day: iso.slice(8, 10), date: formatTicketDate(iso), datetime: iso };
}

export interface TicketStay {
  readonly checkIn?: string;
  readonly checkOut?: string;
  readonly nights: number;
  readonly guestCount?: number;
}

/**
 * Weaver catalogues issue 04: the ticket parts, or undefined when either date is missing or not a calendar date. A ticket is
 * never drawn half built; the caller then shows the facts it has as text (ADR 0074).
 */
export function ticketParts(title: string, stay: TicketStay): TicketParts | undefined {
  if (title.trim() === "" || stay.checkIn === undefined || stay.checkOut === undefined || !ISO_DATE.test(stay.checkIn) || !ISO_DATE.test(stay.checkOut)) return undefined;
  return { title, checkIn: ticketDatePart(stay.checkIn), checkOut: ticketDatePart(stay.checkOut), foot: formatStayFoot(stay.nights, stay.guestCount) };
}

/**
 * Weaver catalogues issue 04 (ADR 0102): a booking surface's ticket as one typed StayTicket in the title's place. Without
 * both dates it falls back to the title and the facts it has as Basic Texts, so meaning is never dropped (ADR 0074).
 */
export function bookingTicketComponents(prefix: string, title: string, stay: TicketStay): { readonly ids: readonly string[]; readonly components: readonly A2UIComponent[] } {
  const parts = ticketParts(title, stay);
  if (parts) {
    return {
      ids: [`${prefix}-ticket`],
      components: [{ id: `${prefix}-ticket`, component: STAY_TICKET_COMPONENT, title: parts.title, checkIn: { ...parts.checkIn }, checkOut: { ...parts.checkOut }, foot: parts.foot }],
    };
  }
  const facts: A2UIComponent[] = [
    { id: `${prefix}-unit`, component: "Text", text: title, variant: "h3" },
    ...(stay.checkIn ? [{ id: `${prefix}-check-in`, component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.checkIn, formatTicketDate(stay.checkIn)) }] : []),
    ...(stay.checkOut ? [{ id: `${prefix}-check-out`, component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.checkOut, formatTicketDate(stay.checkOut)) }] : []),
    { id: `${prefix}-stay`, component: "Text", text: guestFact(GUEST_FACT_LABELS.stay, formatStayFoot(stay.nights, stay.guestCount)) },
  ];
  return { ids: facts.map((component) => component.id), components: facts };
}

/** Weaver catalogues issue 04: the surface's money lines as one typed PriceBreakdown, every amount formatted here (ADR 0077). */
export function priceBreakdownComponent(prefix: string, parts: BreakdownParts): A2UIComponent {
  return { id: `${prefix}-breakdown`, component: PRICE_BREAKDOWN_COMPONENT, ...parts };
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

