import assert from "node:assert/strict";
import test from "node:test";
import { A2UI_V091_BASIC_CATALOG_ID, createBasicCatalogV091Registration, createWeaverRuntime } from "@weaver/core";
import { conditionalOfferArtifactToA2UI } from "../apps/web-agent/src/index.js";
import type { ConditionalOfferArtifact } from "../apps/web/src/index.js";

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
  assert.equal(first[0] && "createSurface" in first[0] ? first[0].createSurface.catalogId : undefined, A2UI_V091_BASIC_CATALOG_ID);
  assert.match(JSON.stringify(first), /Conditional Booking Offer/);
  assert.match(JSON.stringify(first), /All-In Stay Total: ₦100,000\.00/);
  assert.match(JSON.stringify(first), /Refundable Security Deposit: ₦20,000\.00/);
  assert.match(JSON.stringify(first), /Amount Due Now: ₦120,000\.00/);
  assert.match(JSON.stringify(first), /Payment Window expires/);
  assert.match(JSON.stringify(first), /Accept/);
  const visibleText = first.flatMap((message) => "updateComponents" in message ? message.updateComponents.components : []).filter((component) => component.component === "Text").map((component) => "text" in component ? component.text : "").join(" ");
  assert.doesNotMatch(visibleText, /capability-not-visible/);
  const terminal = conditionalOfferArtifactToA2UI({ artifact: artifact("accepted", false), surfaceId: "conditional-offer-surface" });
  assert.doesNotMatch(JSON.stringify(terminal), /Accept/);

  const runtimeResult = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(runtimeResult.ok, true);
  if (!runtimeResult.ok) return;
  for (const message of first) assert.equal(runtimeResult.value.process(message).ok, true);
});
