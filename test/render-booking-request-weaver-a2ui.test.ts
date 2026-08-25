import assert from "node:assert/strict";
import test from "node:test";
import { A2UI_V091_BASIC_CATALOG_ID, createBasicCatalogV091Registration, createWeaverRuntime } from "@weaver/core";
import { bookingRequestArtifactToA2UI } from "../apps/web-agent/src/index.js";
import type { BookingRequestArtifact } from "../apps/web/src/index.js";

function artifact(
  status: string,
  actions: BookingRequestArtifact["actions"] = [],
  delivered = true,
  currency = "NGN",
): BookingRequestArtifact {
  const projectionVersion = status === "disclosed" ? (delivered ? 3 : 2) : ({ confirmed: 4, declined: 5, expired: 6, delivery_failed: 7 }[status] ?? 0);
  return {
    id: "booking-request:req-render",
    kind: "shortlet.booking-request",
    schemaVersion: "shortlet.booking-request/v1",
    projectionVersion,
    domainReferences: [{ type: "booking-request", id: "req-render" }, { type: "unit", id: "unit-1" }],
    policyVersions: {},
    disclosures: [],
    facts: {
      requestId: "req-render", unitId: "unit-1", status, checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2,
      occupants: [],
      quote: { currency, allInStayTotalKobo: 10000000, refundableSecurityDepositKobo: 2000000, totalAmountDueNowKobo: 12000000 },
      disclosedAt: "2026-07-22T10:00:00.000Z", delivered, deliveredAt: delivered ? "2026-07-22T10:00:00.000Z" : null,
      deliveryDeadlineAt: "2026-07-22T10:05:00.000Z", operatorResponseDeadlineAt: "2026-07-22T10:30:00.000Z",
    },
    amounts: [],
    actions,
    acknowledgements: [],
    sensitivity: "booking-sensitive",
  };
}

test("Booking Request A2UI is deterministic, Basic Catalog v0.9.1, and status-aware", () => {
  const pending = artifact("disclosed", [{ type: "confirm", artifactId: "booking-request:req-render", requestId: "req-render", expectedStatus: "disclosed", projectionVersion: 3 }, { type: "decline", artifactId: "booking-request:req-render", requestId: "req-render", expectedStatus: "disclosed", projectionVersion: 3 }]);
  assert.equal(pending.projectionVersion, 3);
  assert.deepEqual(pending.actions.map((action) => action.projectionVersion), [3, 3]);
  const first = bookingRequestArtifactToA2UI({ artifact: pending, surfaceId: "booking-surface" });
  assert.deepEqual(first, bookingRequestArtifactToA2UI({ artifact: pending, surfaceId: "booking-surface" }));
  assert.equal(first[0] && "createSurface" in first[0] ? first[0].createSurface.catalogId : undefined, A2UI_V091_BASIC_CATALOG_ID);
  assert.match(JSON.stringify(first), /Operator response deadline/);
  assert.match(JSON.stringify(first), /Confirm/);
  assert.match(JSON.stringify(first), /Decline/);

  const undeliveredArtifact = artifact("disclosed", [], false);
  assert.equal(undeliveredArtifact.projectionVersion, 2);
  const undelivered = bookingRequestArtifactToA2UI({ artifact: undeliveredArtifact, surfaceId: "booking-surface" });
  assert.match(JSON.stringify(undelivered), /Delivery: pending/);
  assert.doesNotMatch(JSON.stringify(undelivered), /Confirm|Decline/);

  assert.match(JSON.stringify(first), /All-In Stay Total: ₦100,000\.00/);
  const usd = bookingRequestArtifactToA2UI({ artifact: artifact("disclosed", [], true, "USD"), surfaceId: "booking-surface" });
  assert.match(JSON.stringify(usd), /USD 100,000\.00/);
  assert.doesNotMatch(JSON.stringify(usd), /₦/);

  for (const status of ["confirmed", "declined", "expired", "delivery_failed"]) {
    const terminal = bookingRequestArtifactToA2UI({ artifact: artifact(status), surfaceId: "booking-surface" });
    assert.match(JSON.stringify(terminal), new RegExp(status));
    assert.doesNotMatch(JSON.stringify(terminal), /Confirm|Decline/);
  }

  const runtimeResult = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(runtimeResult.ok, true);
  if (!runtimeResult.ok) return;
  for (const message of first) {
    const processed = runtimeResult.value.process(message);
    assert.equal(processed.ok, true, processed.ok ? "" : JSON.stringify(processed.error));
  }
});
