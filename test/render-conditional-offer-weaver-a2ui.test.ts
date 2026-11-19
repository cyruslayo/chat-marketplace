import assert from "node:assert/strict";
import test from "node:test";
import { conditionalOfferArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { SHORTLET_BOOKING_CATALOG_ID } from "../apps/web-agent/src/shortlet-catalogs.js";
import { validateShortletMessages } from "../apps/web-agent/src/validate-shortlet-messages.js";
import type { ConditionalOfferArtifact } from "../apps/web/src/index.js";
import { surfaceCatalogId, typedComponent } from "./helpers/booking-components.js";

function artifact(status: "issued" | "accepted", withAction: boolean): ConditionalOfferArtifact {
  return {
    id: "conditional-offer:offer-render",
    kind: "shortlet.conditional-booking-offer",
    schemaVersion: "shortlet.conditional-booking-offer/v1",
    projectionVersion: status === "issued" ? 11 : 12,
    domainReferences: [{ type: "conditional-offer", id: "offer-render" }],
    policyVersions: { quoteVersion: "v1" },
    disclosures: ["Payment is due within the Payment Window."],
    facts: {
      offerId: "offer-render", requestId: "req-render", unitId: "unit-1", unitTitle: "Lagos Entire Place", status,
      offerVersion: 1, checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2, primaryGuestName: "Guest Name", occupants: ["Guest Name"],
      currency: "NGN", allInStayTotalKobo: 10000000, refundableSecurityDepositKobo: 2000000, totalAmountDueNowKobo: 12000000,
      cancellationPolicy: { type: "standard", version: "cancellation-v1", summary: "Standard cancellation terms" }, guestConductRules: ["No parties."],
      paymentWindowExpiresAt: "2026-07-22T10:20:00.000Z", aggregateVersions: { offerVersion: 1, quoteVersion: "v1" },
    },
    amounts: [], acknowledgements: [], sensitivity: "booking-sensitive",
    actions: withAction ? [{ type: "accept", artifactId: "conditional-offer:offer-render", offerId: "offer-render", expectedStatus: "issued", offerVersion: 1, projectionVersion: 11, confirmationToken: "capability-not-visible" }] : [],
  };
}

test("Conditional Offer A2UI is deterministic, Basic Catalog v0.9.1, and only authorized active offers have Accept", () => {
  const active = artifact("issued", true);
  const first = conditionalOfferArtifactToA2UI({ artifact: active, surfaceId: "conditional-offer-surface" });
  assert.deepEqual(first, conditionalOfferArtifactToA2UI({ artifact: active, surfaceId: "conditional-offer-surface" }));
  // Weaver catalogues issue 04: the surface is on the shortlet booking catalogue.
  assert.equal(surfaceCatalogId(first), SHORTLET_BOOKING_CATALOG_ID);
  assert.match(JSON.stringify(first), /Conditional Booking Offer/);
  // Weaver catalogues issue 04: the ticket and money are typed StayTicket / PriceBreakdown props.
  const breakdown = typedComponent(first, "PriceBreakdown");
  assert.equal(breakdown.total, "₦100,000");
  assert.equal(breakdown.deposit, "₦20,000");
  assert.equal(breakdown.due, "₦120,000");
  assert.match(JSON.stringify(first), /Pay by .* WAT/);
  assert.match(JSON.stringify(first), /Accept/);
  const visibleText = first.flatMap((message) => "updateComponents" in message ? message.updateComponents.components : []).filter((component) => component.component === "Text").map((component) => "text" in component ? component.text : "").join(" ");
  assert.doesNotMatch(visibleText, /capability-not-visible/);
  const terminal = conditionalOfferArtifactToA2UI({ artifact: artifact("accepted", false), surfaceId: "conditional-offer-surface" });
  assert.doesNotMatch(JSON.stringify(terminal), /Accept/);

  // Weaver catalogues issue 04: validated against the shortlet runtime's catalogue set.
  assert.equal(validateShortletMessages(first).ok, true);
});
