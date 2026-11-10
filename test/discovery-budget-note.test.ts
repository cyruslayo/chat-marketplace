import assert from "node:assert/strict";
import test from "node:test";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { discoveryArtifactToA2UI, type DiscoveryArtifactProjection, type DiscoveryUnitProjection } from "../apps/web-agent/src/discovery-a2ui.js";

// Issue 10 (ADR 0015, 0102; guideline §10): the discovery budget note renders the server-projected amount due now,
// never a presentation-level sum of the All-In Stay Total and the deposit.

function texts(messages: readonly A2UIServerMessage[]): string[] {
  return messages
    .flatMap((message) => "updateComponents" in message ? message.updateComponents.components as readonly { readonly component: string; readonly text?: unknown }[] : [])
    .filter((component) => component.component === "Text" && typeof component.text === "string")
    .map((component) => component.text as string);
}

const unit: DiscoveryUnitProjection = {
  id: "unit-lekki-1",
  title: "Serene 1-Bedroom Suite",
  location: { city: "Lagos", neighbourhood: "Lekki Phase 1" },
  capacity: 2,
  bedrooms: 1,
  bathrooms: 1,
  description: "A quiet suite.",
  amenities: ["wifi"],
  photoUrls: [],
  price: {
    nightlyKobo: 10_000_000,
    allInStayTotalKobo: 30_000_000,
    mandatoryFeesKobo: 1_000_000,
    refundableSecurityDepositKobo: 2_000_000,
    // Deliberately differs from allInStayTotalKobo + deposit (₦320,000) so the test proves which field is rendered.
    amountDueNowKobo: 99_999_999,
    currency: "NGN",
    pricingVersion: "p1",
  },
  trust: {
    inspection: { status: "current", inspectedAt: "2026-09-01", expiresAt: "2027-09-01", scope: ["entire-place"] },
    managementAuthority: { status: "verified", verifiedAt: "2026-09-01" },
    occupancyModel: "entire-place",
  },
};

function artifactFor(next: DiscoveryUnitProjection, budgetKobo: number): DiscoveryArtifactProjection {
  return {
    id: "search-1",
    kind: "shortlet.discovery",
    schemaVersion: "shortlet.discovery/v1",
    projectionVersion: 1,
    domainReferences: [],
    policyVersions: {},
    disclosures: [],
    facts: { filters: { city: "Lagos", neighbourhood: "Lekki Phase 1", maxPriceKobo: budgetKobo }, results: [next] },
    amounts: [],
    actions: [],
    acknowledgements: [],
    sensitivity: "public",
  };
}

test("AC3 (option 1 pinning): The discovery budget note renders the projected amount due now, not a sum of two amounts", () => {
  const note = texts(discoveryArtifactToA2UI({ artifact: artifactFor(unit, 40_000_000), surfaceId: "surface-1" })).find((text) => text.startsWith("Within your"));
  assert.ok(note, "the budget note is present");
  assert.match(note, /₦999,999\.99/, "the projected amount due now is shown");
  assert.doesNotMatch(note, /₦320,000/, "the presentation does not add the total and the deposit");
  assert.match(note, /total to complete booking/i);
});

test("AC3 (option 1 pinning): A null projected amount due now omits the amount sentence", () => {
  const next: DiscoveryUnitProjection = { ...unit, price: { ...unit.price, amountDueNowKobo: null } };
  const note = texts(discoveryArtifactToA2UI({ artifact: artifactFor(next, 40_000_000), surfaceId: "surface-1" })).find((text) => text.startsWith("Within your"));
  assert.ok(note);
  assert.doesNotMatch(note, /paid separately/);
  assert.match(note, /Within your ₦400,000 budget/);
});

test("AC3 (option 1 pinning): An amount due now within the budget omits the amount sentence", () => {
  const next: DiscoveryUnitProjection = { ...unit, price: { ...unit.price, amountDueNowKobo: 31_000_000 } };
  const note = texts(discoveryArtifactToA2UI({ artifact: artifactFor(next, 40_000_000), surfaceId: "surface-1" })).find((text) => text.startsWith("Within your"));
  assert.ok(note);
  assert.doesNotMatch(note, /paid separately/);
});
