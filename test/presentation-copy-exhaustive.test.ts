import assert from "node:assert/strict";
import test from "node:test";
import type { CardPaymentArtifact, CardPaymentStatus } from "../apps/web/src/card-payment-artifact.js";
import type { ConditionalOfferArtifact } from "../apps/web/src/conditional-offer-artifact.js";
import { GUEST_PAYMENT_STATUS_COPY, guestPaymentStatus } from "../apps/web-agent/src/booking-presentation.js";
import { cardPaymentCopy } from "../apps/web-agent/src/payment-presentation.js";
import { offerScreenContent } from "../apps/web-agent/src/offer-presentation.js";

// Issue 09 (Track B, no behaviour change, no copy change): the presentation mappers keep their exact output for every
// status. These expectations were captured from the code before the satisfies Record refactor and are hard-coded here.

type PaymentCopy = { readonly label: string; readonly detail: string; readonly progress?: string };

const GUEST_PAYMENT_EXPECTED: readonly (readonly [CardPaymentStatus, boolean, PaymentCopy])[] = [
  ["ready", false, { label: "Payment required", detail: "Continue to the designated payment checkout. Payment has not succeeded and the booking is not confirmed.", progress: "payment" }],
  ["ready", true, { label: "Payment required", detail: "Continue to the designated payment checkout. Payment has not succeeded and the booking is not confirmed.", progress: "payment" }],
  ["checkout_initiated", false, { label: "Payment handoff ready · Payment not yet verified", detail: "Continue the current payment attempt. Payment has not succeeded and your booking is not confirmed. Your booking details will be retained when you return. Do not start another payment while this attempt is pending.", progress: "payment" }],
  ["checkout_initiated", true, { label: "Payment processing · Checking payment", detail: "We are checking the provider’s payment confirmation. Do not submit another payment while this result is pending. The booking is not confirmed until payment is verified and a Reservation exists.", progress: "payment-processing" }],
  ["deposit_required", false, { label: "Payment required · Refundable Security Deposit", detail: "The stay payment is verified. A separate Refundable Security Deposit payment is still required before a Reservation can exist.", progress: "payment" }],
  ["deposit_required", true, { label: "Payment required · Refundable Security Deposit", detail: "The stay payment is verified. A separate Refundable Security Deposit payment is still required before a Reservation can exist.", progress: "payment" }],
  ["compensation_pending", false, { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["compensation_pending", true, { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["compensated", false, { label: "Payment review update available", detail: "The payment attempt is closed and no Reservation exists. Check the current booking details before taking another action." }],
  ["compensated", true, { label: "Payment review update available", detail: "The payment attempt is closed and no Reservation exists. Check the current booking details before taking another action." }],
  ["reconciliation_required", false, { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["reconciliation_required", true, { label: "Payment requires review · Booking not confirmed", detail: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["confirmed", false, { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" }],
  ["confirmed", true, { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" }],
  ["expired", false, { label: "Payment window expired · Booking not confirmed", detail: "The Payment Window expired. This payment action is no longer available; no Reservation exists." }],
  ["expired", true, { label: "Payment window expired · Booking not confirmed", detail: "The Payment Window expired. This payment action is no longer available; no Reservation exists." }],
  ["failed", false, { label: "Payment was not verified · Booking not confirmed", detail: "Payment was not verified. No Reservation was created. Check the current booking status before retrying." }],
  ["failed", true, { label: "Payment was not verified · Booking not confirmed", detail: "Payment was not verified. No Reservation was created. Check the current booking status before retrying." }],
];

const CARD_PAYMENT_COPY_EXPECTED: readonly (readonly [CardPaymentStatus, string, { readonly title: string; readonly status: string; readonly content: string }])[] = [
  ["ready", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["ready", "stay_settled", { title: "Payment required", status: "Secure checkout is available", content: "The Refundable Security Deposit is charged separately when one applies." }],
  ["checkout_initiated", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["checkout_initiated", "stay_settled", { title: "Payment status", status: "Payment handoff ready · Payment not yet verified", content: "Continue the current payment attempt. Payment has not succeeded and your booking is not confirmed. Your booking details will be retained when you return. Do not start another payment while this attempt is pending." }],
  ["deposit_required", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["deposit_required", "stay_settled", { title: "Payment required", status: "Stay payment verified", content: "Pay the Refundable Security Deposit to complete the booking." }],
  ["compensation_pending", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["compensation_pending", "stay_settled", { title: "Payment under review", status: "Payment requires review · Booking not confirmed", content: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["compensated", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["compensated", "stay_settled", { title: "Payment status", status: "Payment review update available", content: "The payment attempt is closed and no Reservation exists. Check the current booking details before taking another action." }],
  ["reconciliation_required", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["reconciliation_required", "stay_settled", { title: "Payment under review", status: "Payment requires review · Booking not confirmed", content: "This payment needs review. Your booking is not confirmed. Do not submit another payment while this payment is under review." }],
  ["confirmed", "stay_payment_processing", { title: "Booking confirmed", status: "Payment verified", content: "Payment verified and Reservation confirmed. Booking reference is available in your booking details." }],
  ["confirmed", "stay_settled", { title: "Booking confirmed", status: "Payment verified", content: "Payment verified and Reservation confirmed. Booking reference is available in your booking details." }],
  ["expired", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["expired", "stay_settled", { title: "Payment status", status: "Payment window expired · Booking not confirmed", content: "The Payment Window expired. This payment action is no longer available; no Reservation exists." }],
  ["failed", "stay_payment_processing", { title: "Payment being checked", status: "Payment processing", content: "We’re checking the payment result. Don’t submit another payment while it’s pending." }],
  ["failed", "stay_settled", { title: "Payment status", status: "Payment was not verified · Booking not confirmed", content: "Payment was not verified. No Reservation was created. Check the current booking status before retrying." }],
];

const OFFER_STATE_EXPECTED: readonly (readonly [ConditionalOfferArtifact["facts"]["status"], string])[] = [
  ["issued", "live"],
  ["accepted", "accepted"],
  ["expired", "expired"],
  ["stale", "closed"],
  ["revoked", "closed"],
];

function paymentFacts(status: CardPaymentStatus, journeyStage: string): CardPaymentArtifact["facts"] {
  return {
    offerId: "o1", status, unit: "Unit", unitId: "u1", checkIn: "2026-11-01", checkOut: "2026-11-03",
    amountDueNowKobo: 1, paymentWindowExpiresAt: "2026-10-27T10:20:00.000Z", journeyStage,
  } as unknown as CardPaymentArtifact["facts"];
}

function offerArtifact(status: ConditionalOfferArtifact["facts"]["status"]): ConditionalOfferArtifact {
  return {
    facts: {
      status, paymentWindowExpiresAt: "2026-10-27T10:20:00.000Z", operatorName: "Operator",
      cancellationPolicy: { summary: "Standard terms" }, guestConductRules: [],
    },
    disclosures: [], actions: [],
  } as unknown as ConditionalOfferArtifact;
}

test("AC1: for every member of CardPaymentStatus, with processing true and false, guestPaymentStatus returns the same label, detail and progress as before", () => {
  for (const [status, processing, expected] of GUEST_PAYMENT_EXPECTED) {
    assert.deepStrictEqual(guestPaymentStatus(status, processing), expected, `${status} processing=${processing}`);
  }
});

test("AC1 (cardPaymentCopy): for every CardPaymentStatus, with and without the processing stage, cardPaymentCopy returns the same title, status and content as before", () => {
  for (const [status, stage, expected] of CARD_PAYMENT_COPY_EXPECTED) {
    assert.deepStrictEqual(cardPaymentCopy(paymentFacts(status, stage)), expected, `${status} ${stage}`);
  }
});

test("AC2: offerScreenContent's state is the same as before for every offer status", () => {
  for (const [status, expectedState] of OFFER_STATE_EXPECTED) {
    const screen = offerScreenContent(offerArtifact(status), "/payments/offers/o1", "s1", new Date("2026-10-27T10:00:00.000Z"), "₦1");
    assert.equal(screen.state, expectedState, status);
  }
});

const ALL_CARD_PAYMENT_STATUSES: readonly CardPaymentStatus[] = [
  "ready", "checkout_initiated", "deposit_required", "compensation_pending", "compensated",
  "reconciliation_required", "confirmed", "expired", "failed",
];

test("AC3: adding a member to CardPaymentStatus without copy fails npm run check", () => {
  // Compile-time proof: a copy map missing a status is rejected by satisfies Record<CardPaymentStatus, ...>.
  // @ts-expect-error a partial copy map without every CardPaymentStatus fails the Record check
  const partial = { ready: GUEST_PAYMENT_STATUS_COPY.ready } satisfies Record<CardPaymentStatus, { readonly label: string; readonly detail: string }>;
  assert.deepEqual(Object.keys(partial), ["ready"]);
  // Compile-time guard on the real map: any CardPaymentStatus with no key here makes this `true` a type error.
  const everyStatusHasCopy: Exclude<CardPaymentStatus, keyof typeof GUEST_PAYMENT_STATUS_COPY> extends never ? true : false = true;
  assert.equal(everyStatusHasCopy, true);
  // Runtime: the real map has exactly one entry per status.
  assert.deepEqual(Object.keys(GUEST_PAYMENT_STATUS_COPY).sort(), [...ALL_CARD_PAYMENT_STATUSES].sort());
});

test("a runtime status outside CardPaymentStatus keeps today's cardPaymentCopy title and status pill (issue 12 changes it)", () => {
  const outside = "not_a_status" as unknown as CardPaymentStatus;
  const copy = cardPaymentCopy(paymentFacts(outside, "stay_settled"));
  assert.equal(copy.title, "Payment status");
  assert.equal(copy.status, "Booking confirmed");
});

test("a runtime value outside CardPaymentStatus keeps today's confirmed copy (issue 12 changes it)", () => {
  const outside = "not_a_status" as unknown as CardPaymentStatus;
  assert.deepStrictEqual(guestPaymentStatus(outside), { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" });
  assert.deepStrictEqual(guestPaymentStatus(outside, true), { label: "Booking confirmed", detail: "Payment verified and Reservation confirmed.", progress: "confirmed" });
});
