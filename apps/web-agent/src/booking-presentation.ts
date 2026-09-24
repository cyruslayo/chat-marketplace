import { formatNgnKobo } from "./discovery-a2ui.js";
import type { CardPaymentStatus } from "../../web/src/card-payment-artifact.js";

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
    request: "Booking progress: Request Draft → Booking Request → Operator review → Conditional Offer → Payment → Reservation. Current: Request Draft.",
    "operator-review": "Booking progress: Booking Request → Operator review → Conditional Offer → Payment → Reservation. Current: Operator review.",
    offer: "Booking progress: Conditional Offer → Payment → Reservation. Current: Conditional Offer.",
    payment: "Booking progress: Payment → Reservation. Current: Payment.",
    "payment-processing": "Booking progress: Payment → Reservation. Current: Payment processing; Reservation is not confirmed.",
    confirmed: "Booking progress complete: payment verified and Reservation confirmed.",
  };
  return sequences[stage];
}

export function guestRequestStatus(status: string, delivered: boolean): { readonly label: string; readonly progress?: BookingProgressStage; readonly detail: string } {
  if (status === "disclosed" && delivered) return { label: "Request sent · Waiting for Operator response", progress: "operator-review", detail: "This is not yet a Reservation. The disclosed Booking Request blocks the requested dates during its response window." };
  if (status === "disclosed") return { label: "Sending Booking Request", progress: "operator-review", detail: "The application is completing delivery. No Operator response is recorded yet." };
  if (status === "confirmed") return { label: "Operator confirmed availability · Offer being prepared", progress: "offer", detail: "This is not yet a Reservation. Payment is required after you accept the Conditional Offer." };
  if (status === "declined") return { label: "Request declined", detail: "No Reservation exists and no payment is due. You can continue searching for another stay." };
  if (status === "expired") return { label: "Request expired", detail: "The request response window ended. Inventory is no longer reserved and no Reservation exists." };
  if (status === "delivery_failed") return { label: "Request could not be delivered", detail: "Nothing remains reserved. This was not an Operator decline; no Reservation exists." };
  if (status === "draft") return { label: "Draft · Not reserved", progress: "request", detail: "This Request Draft is not a Reservation and does not block inventory." };
  return { label: "Booking Request status unavailable", detail: "Refresh the current booking status before taking another action." };
}

export function guestPaymentStatus(status: CardPaymentStatus, processing = false): { readonly label: string; readonly detail: string; readonly progress?: BookingProgressStage } {
  if (status === "ready") return { label: "Payment required", detail: "Continue to the designated payment checkout. Payment has not succeeded and the booking is not confirmed.", progress: "payment" };
  if (status === "checkout_initiated" && processing) return { label: "Payment processing · Checking payment", detail: "We are checking the provider’s payment confirmation. Do not submit another payment while this result is pending. The booking is not confirmed until payment is verified and a Reservation exists.", progress: "payment-processing" };
  if (status === "checkout_initiated") return { label: "Payment handoff ready · Payment not yet verified", detail: "Continue the current payment attempt. Payment has not succeeded and your booking is not confirmed. Your booking details will be retained when you return. Do not start another payment while this attempt is pending.", progress: "payment" };
  if (status === "deposit_required") return { label: "Payment required · Refundable Security Deposit", detail: "The stay payment is verified. A separate refundable security deposit payment is still required before a Reservation can exist.", progress: "payment" };
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
