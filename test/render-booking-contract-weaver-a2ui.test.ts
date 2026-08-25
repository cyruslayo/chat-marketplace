import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { A2UI_V091_BASIC_CATALOG_ID } from "@weaver/core";
import { bookingContractArtifactToA2UI } from "../apps/web-agent/src/booking-contract-a2ui.js";
import type { BookingContractArtifact } from "../apps/web/src/booking-contract-artifact.js";

const artifact = { id: "booking-contract:ctr-a2ui", kind: "shortlet.booking-contract", schemaVersion: "shortlet.booking-contract/v1", projectionVersion: 12, domainReferences: [], policyVersions: { contract: "2" }, disclosures: ["Captured disclosure"], facts: { contractId: "ctr-a2ui", reservationId: "res-a2ui", offerId: "off-a2ui", unitId: "unit-a2ui", primaryGuest: { id: "guest", name: "Guest" }, accommodationProvider: { id: "operator", name: "Provider" }, checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2, occupants: ["Guest"], allInStayTotalKobo: 20000, refundableSecurityDepositKobo: 5000, amountPaidKobo: 25000, currency: "NGN", paymentMethod: "fresh_card", cardMetadata: { brand: "Visa", last4: "4242" }, cancellationPolicy: { version: "v2", summary: "Captured cancellation terms" }, guestConductRules: ["Be considerate"], contractVersion: 2, addressAvailability: "available", accessAvailability: "locked", locationReferenceId: "opaque-location", accessReferenceId: "opaque-access" }, sensitivity: "booking-sensitive" } satisfies BookingContractArtifact;

describe("Booking Contract Weaver presentation", () => {
  it("uses the Basic Catalog and contains the same safe meaning without protected values", () => {
    const messages = bookingContractArtifactToA2UI({ artifact, surfaceId: "surface-a2ui" });
    assert.equal(messages[0] && "createSurface" in messages[0] ? messages[0].createSurface.catalogId : undefined, A2UI_V091_BASIC_CATALOG_ID);
    const text = JSON.stringify(messages);
    assert.match(text, /Booking confirmed|Provider|2026-09-01|Visa|Captured cancellation terms/);
    assert.match(text, /available in secure booking details|will be released/);
    assert.doesNotMatch(text, /fullAddress|accessInstructions|SECRET|door code|gate code/i);
    assert.deepEqual(messages, bookingContractArtifactToA2UI({ artifact, surfaceId: "surface-a2ui" }));
  });
});
