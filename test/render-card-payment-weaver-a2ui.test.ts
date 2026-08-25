import test from "node:test";
import assert from "node:assert/strict";
import { cardPaymentArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { A2UI_V091_BASIC_CATALOG_ID } from "@weaver/core";
import type { CardPaymentArtifact } from "../apps/web/src/card-payment-artifact.js";

function artifact(status: CardPaymentArtifact["facts"]["status"], authorized = true): CardPaymentArtifact {
  const base = { id: "card-payment:offer", kind: "shortlet.card-payment" as const, schemaVersion: "shortlet.card-payment/v1" as const, projectionVersion: status === "ready" ? 1 : status === "checkout_initiated" ? 2 : 3, facts: { offerId: "offer", status, unit: "Unit", unitId: "unit", checkIn: "2026-08-10", checkOut: "2026-08-12", amountDueNowKobo: 10000, currency: "NGN" as const, paymentWindowExpiresAt: "2026-08-01T12:20:00.000Z", ...(status === "checkout_initiated" ? { checkoutId: "checkout", checkoutUrl: "https://checkout.example/pay" } : {}), ...(status === "confirmed" ? { reservationId: "reservation", contractId: "contract", contractVersion: 1, amountPaidKobo: 10000, paidAt: "2026-08-01T12:10:00.000Z", cardMetadata: { brand: "Mastercard", last4: "8888" } } : {}) }, actions: authorized && status === "ready" ? [{ type: "initialize_checkout" as const, artifactId: "card-payment:offer", offerId: "offer", expectedStatus: "ready" as const, projectionVersion: 1 }] : [], sensitivity: "booking-sensitive" as const };
  return base;
}
function text(messages: ReturnType<typeof cardPaymentArtifactToA2UI>): string { return JSON.stringify(messages); }

test("Card payment A2UI is deterministic, v0.9.1 Basic Catalog, and never renders card credentials", () => {
  const ready = cardPaymentArtifactToA2UI({ artifact: artifact("ready"), surfaceId: "surface" });
  assert.equal(ready[0] && "createSurface" in ready[0] ? ready[0].createSurface.catalogId : undefined, A2UI_V091_BASIC_CATALOG_ID);
  assert.deepEqual(ready, cardPaymentArtifactToA2UI({ artifact: artifact("ready"), surfaceId: "surface" }));
  assert.match(text(ready), /NGN 100.00/);
  assert.match(text(ready), /Start secure checkout/);
  assert.doesNotMatch(text(ready), /pan|cvv|cvc|pin|otp|token|mark paid/i);
  assert.doesNotMatch(text(cardPaymentArtifactToA2UI({ artifact: artifact("ready", false), surfaceId: "surface" })), /Start secure checkout/);
  assert.match(text(cardPaymentArtifactToA2UI({ artifact: artifact("checkout_initiated"), surfaceId: "surface" })), /https:\/\/checkout\.example/);
  assert.doesNotMatch(text(cardPaymentArtifactToA2UI({ artifact: artifact("checkout_initiated"), surfaceId: "surface" })), /mark paid|card number|cvv/i);
  const confirmed = text(cardPaymentArtifactToA2UI({ artifact: artifact("confirmed"), surfaceId: "surface" }));
  assert.match(confirmed, /Booking confirmed|reservation|contract|Mastercard|8888/i);
});
