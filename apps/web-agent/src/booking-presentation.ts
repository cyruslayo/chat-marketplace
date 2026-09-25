import { formatNgnKobo } from "./discovery-a2ui.js";
import type { CardPaymentStatus } from "../../web/src/card-payment-artifact.js";
import { GUEST_GLOSSARY, guestReservationStatus } from "./guest-content.js";

export type BookingProgressStage = "request" | "operator-review" | "offer" | "payment" | "payment-processing" | "confirmed";

export function formatBookingDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  const parts = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  const dateText = `${value("day")} ${value("month")} ${value("year")}`;
  const timeText = `${value("hour")}:${value("minute")} ${value("dayPeriod")}`;
  return `${timeText} WAT, ${dateText}`;
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
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).formatToParts(date);
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

export function guestPaymentStatus(status: CardPaymentStatus, processing = false): { readonly label: string; readonly detail: string; readonly progress?: BookingProgressStage } {
  if (status === "ready") return { label: "Payment required", detail: "Continue to the designated payment checkout. Payment has not succeeded and the booking is not confirmed.", progress: "payment" };
  if (status === "checkout_initiated" && processing) return { label: "Payment processing · Checking payment", detail: "We are checking the provider’s payment confirmation. Do not submit another payment while this result is pending. The booking is not confirmed until payment is verified and a Reservation exists.", progress: "payment-processing" };
  if (status === "checkout_initiated") return { label: "Payment handoff ready · Payment not yet verified", detail: "Continue the current payment attempt. Payment has not succeeded and your booking is not confirmed. Your booking details will be retained when you return. Do not start another payment while this attempt is pending.", progress: "payment" };
  if (status === "deposit_required") return { label: `Payment required · ${GUEST_GLOSSARY.refundableSecurityDeposit}`, detail: `The stay payment is verified. A separate ${GUEST_GLOSSARY.refundableSecurityDeposit} payment is still required before a Reservation can exist.`, progress: "payment" };
  if (status === "reconciliation_required" || status === "compensation_pending") return { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." };
  if (status === "compensated") return { label: "Payment review update available", detail: "The payment attempt is closed and no Reservation exists. Check the current booking details before taking another action." };
  if (status === "expired") return { label: "Payment window expired · Booking not confirmed", detail: "The Payment Window expired. This payment action is no longer available; no Reservation exists." };
  if (status === "failed") return { label: "Payment was not verified · Booking not confirmed", detail: "Payment was not verified. No Reservation was created. Check the current booking status before retrying." };
  return { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" };
}

export function formatBookingMoney(kobo: number, currency = "NGN"): string {
  const ngnAmount = formatNgnKobo(kobo);
  return currency === "NGN" ? ngnAmount : `${currency} ${ngnAmount.slice(1)}`;
}
