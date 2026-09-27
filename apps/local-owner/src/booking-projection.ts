import { paymentProcessingGraceEndsAt, type BookingPaymentJourney } from "../../../domains/shortlet/src/index.js";

/**
 * Where a confirmed Booking Request stands, projected from its authoritative records on every read (B4).
 * Pure: no command, no write, no background job. Deadlines are evaluated lazily against the injected clock.
 */

export type BookingStage = "offer_not_issued" | "offer_issued" | "awaiting_payment" | "reservation_confirmed" | "ended";

export type BookingPaymentMethod = "card" | "paystack_transfer";

export type BookingEndedReason =
  | "offer_expired"
  | "payment_window_expired"
  | "offer_withdrawn"
  | "late_payment"
  | "refund_owed"
  | "refund_started"
  | "refunded"
  | "reservation_cancelled"
  | "no_show";

/** Operator-facing words for each ended reason. Money wording follows ADR 0044/0045: a started refund is never described as received. */
export const BOOKING_ENDED_REASONS: Readonly<Record<BookingEndedReason, string>> = Object.freeze({
  offer_expired: "The offer expired before the Guest accepted it",
  payment_window_expired: "The Payment Window ended without a verified payment",
  offer_withdrawn: "The offer was withdrawn",
  late_payment: "Payment arrived after the deadline; a full refund is owed to the Guest",
  refund_owed: "A full refund is owed to the Guest",
  refund_started: "Refund started; not yet received by the Guest",
  refunded: "Payment refunded in full",
  reservation_cancelled: "Reservation cancelled",
  no_show: "No-show",
});

export const BOOKING_STAGE_LABELS: Readonly<Record<BookingStage, string>> = Object.freeze({
  offer_not_issued: "Confirmed; no offer issued",
  offer_issued: "Offer issued",
  awaiting_payment: "Awaiting payment",
  reservation_confirmed: "Reservation confirmed",
  ended: "Ended",
});

export const BOOKING_PAYMENT_METHOD_LABELS: Readonly<Record<BookingPaymentMethod, string>> = Object.freeze({
  card: "Card",
  paystack_transfer: "Paystack transfer",
});

/** The fields of a stored Conditional Booking Offer this projection reads. */
export interface OfferRecord {
  readonly offerId: string;
  readonly status: string;
  readonly paymentWindowExpiresAt: string;
  readonly allInStayTotalKobo: number | null;
}

export function offerRecordFromJson(json: string): OfferRecord | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!isRecord(parsed) || typeof parsed.offerId !== "string" || typeof parsed.status !== "string") return null;
  const paymentWindow = isRecord(parsed.paymentWindow) ? parsed.paymentWindow : {};
  if (typeof paymentWindow.expiresAt !== "string" || Number.isNaN(Date.parse(paymentWindow.expiresAt))) return null;
  const quote = isRecord(parsed.quote) ? parsed.quote : {};
  return Object.freeze({
    offerId: parsed.offerId,
    status: parsed.status,
    paymentWindowExpiresAt: paymentWindow.expiresAt,
    allInStayTotalKobo: typeof quote.allInStayTotalKobo === "number" ? quote.allInStayTotalKobo : null,
  });
}

export interface BookingStageInput {
  readonly offer: OfferRecord | null;
  readonly journey: BookingPaymentJourney | null;
  /** The method of the Live Payment Attempt, when one was opened before any journey was recorded. */
  readonly attemptMethod: string | null;
  /** The current status of the committed Reservation, if one exists. */
  readonly reservationStatus: string | null;
  readonly now: Date;
}

export interface BookingStageProjection {
  readonly stage: BookingStage;
  readonly paymentMethod: BookingPaymentMethod | null;
  /** The Payment Window deadline from the offer, never recalculated (ADR 0077). */
  readonly paymentDeadlineAt: string | null;
  /** Set only while a designated in-flight transaction holds its one Payment-Processing Grace (ADR 0044). */
  readonly graceEndsAt: string | null;
  readonly endedReason: BookingEndedReason | null;
}

function paymentMethod(journey: BookingPaymentJourney | null, attemptMethod: string | null): BookingPaymentMethod | null {
  const method = journey?.paymentMethod ?? attemptMethod;
  if (method === "fresh_card") return "card";
  if (method === "bank_transfer") return "paystack_transfer";
  return null;
}

const PROCESSING_STAGES: ReadonlySet<string> = new Set(["stay_payment_processing", "deposit_payment_processing"]);

export function projectBookingStage(input: BookingStageInput): BookingStageProjection {
  const { offer, journey, now } = input;
  const method = paymentMethod(journey, input.attemptMethod);
  const deadline = offer?.paymentWindowExpiresAt ?? null;
  const result = (stage: BookingStage, endedReason: BookingEndedReason | null = null, graceEndsAt: string | null = null): BookingStageProjection =>
    Object.freeze({ stage, paymentMethod: method, paymentDeadlineAt: deadline, graceEndsAt, endedReason });

  // ADR 0005: a Reservation exists only after verified payment, so only a committed Reservation is "confirmed".
  if (input.reservationStatus === "confirmed") return result("reservation_confirmed");
  if (input.reservationStatus === "cancelled") return result("ended", "reservation_cancelled");
  if (input.reservationStatus === "no_show") return result("ended", "no_show");
  if (!offer || deadline === null) return result("offer_not_issued");

  // Money already returned or owed back ends the booking, whatever the clock says (ADR 0045).
  const compensation = journey?.compensation;
  if (compensation?.status === "pending") return result("ended", "refund_started");
  if (compensation?.status === "settled") return result("ended", "refunded");
  if (compensation?.status === "reconciliation_required") {
    return result("ended", compensation.stay.obligationId?.startsWith("payment-reconciliation:") ? "late_payment" : "refund_owed");
  }
  if (offer.status === "stale" || offer.status === "revoked") return result("ended", "offer_withdrawn");

  // ADR 0044: the Payment Window ends at its deadline; only a PSP-confirmed in-flight transaction keeps its grace.
  const processing = journey !== null && PROCESSING_STAGES.has(journey.stage);
  const graceEndsAt = processing ? paymentProcessingGraceEndsAt(deadline) : null;
  const expired = graceEndsAt !== null ? now.getTime() > Date.parse(graceEndsAt) : now.getTime() >= Date.parse(deadline);
  if (expired || offer.status === "expired" || journey?.stage === "expired") {
    if (journey?.stay.status === "settled") return result("ended", "refund_owed");
    return result("ended", offer.status === "issued" ? "offer_expired" : "payment_window_expired");
  }

  if (journey !== null && journey.stage !== "ready") return result("awaiting_payment", null, graceEndsAt);
  if (method !== null) return result("awaiting_payment");
  return result("offer_issued");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
