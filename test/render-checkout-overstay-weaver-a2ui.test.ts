import test from "node:test";
import assert from "node:assert/strict";
import { checkoutArtifactToA2UI } from "../apps/web-agent/src/checkout-overstay-a2ui.js";
import type { CheckoutArtifact } from "../apps/web/src/checkout-overstay-artifact.js";
const artifact: CheckoutArtifact = { id: "checkout:res-1", kind: "shortlet.checkout", schema: "shortlet.checkout/v1", projectionVersion: "stable-1", facts: { reservationId: "res-1", checkoutDate: "2026-08-25", timezone: "Africa/Lagos", effectiveCheckoutTime: "11:00", effectiveCheckoutIso: "2026-08-25T10:00:00.000Z", checkoutSource: "contractual", termVersion: "term-1", accessExpiryIso: "2026-08-25T10:00:00.000Z", turnoverStartIso: "2026-08-25T10:00:00.000Z", depositClaimDeadlineIso: "2026-08-26T10:00:00.000Z", remindersIso: ["2026-08-25T09:00:00.000Z"], lateCheckoutAvailable: true, lateCheckoutOptions: [{ requestedTime: "14:00", quoteId: "quote-14", feeKobo: 777777, currency: "NGN" }], overstayStatus: "none", humanSupportRequested: false, humanOwned: false }, actions: [{ type: "accept_late_checkout", artifactId: "checkout:res-1", reservationId: "res-1", requestedTime: "14:00", quoteId: "quote-14", expectedCheckoutTime: "11:00", expectedTermVersion: "term-1", projectionVersion: "stable-1" }], sensitivity: "booking-sensitive" };
test("Checkout Weaver projection uses A2UI v0.9.1 Basic Catalog and strict action context", () => {
  const messages = checkoutArtifactToA2UI({ artifact, surfaceId: "surface-1" }); const text = JSON.stringify(messages);
  assert.equal(messages[0].version, "v0.9.1"); assert.match(text, /a2ui\.org\/specification\/v0_9\/catalogs\/basic/); assert.match(text, /shortlet\.checkout\.accept-late-checkout/); assert.match(text, /7,777\.77/); assert.doesNotMatch(text, /principalId|tenantId|sessionId|deviceId/);
});
