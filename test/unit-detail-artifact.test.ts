import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createWeaverWebHost, unitDetailArtifactFromProjection } from "../apps/web/src/index.js";
import { unitDetailArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";
import { StayDateRange, UnitDiscoveryQuery, UnitRepository, seedIssue01Units, toDiscoveryProjection } from "../domains/shortlet/src/index.js";

function detailArtifact() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findById("unit-lagos-001");
  assert.ok(unit);
  repository.save({ ...unit, photoUrls: ["https://images.example/living-room.jpg", "https://images.example/bedroom.jpg"] });
  const unitWithPhotos = repository.findById("unit-lagos-001");
  assert.ok(unitWithPhotos);
  const clock = () => new Date("2026-09-21T10:00:00.000Z");
  const projection = toDiscoveryProjection(unitWithPhotos, new StayDateRange("2026-10-01", "2026-10-03", clock()));
  return unitDetailArtifactFromProjection({
    unit: projection,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    projectionVersion: 4,
    viewer: { id: "guest-1", role: "guest", tenantId: "tenant-1" },
  });
}

test("AC6 — Unit detail is a canonical InteractionArtifact with authoritative facts and action references", () => {
  const artifact = detailArtifact();
  assert.equal(artifact.kind, "shortlet.unit-detail");
  assert.equal(artifact.schemaVersion, "shortlet.unit-detail/v1");
  assert.deepEqual(artifact.domainReferences, [{ type: "unit", id: artifact.facts.unitId }]);
  assert.equal(artifact.facts.title, "Sunlit 2-bedroom apartment in Ikeja");
  assert.equal(artifact.facts.neighbourhood, "Ikeja");
  assert.equal(artifact.facts.photos.length, 2);
  assert.equal(artifact.facts.bedrooms, 2);
  assert.equal(artifact.facts.bathrooms, 2);
  assert.equal(artifact.facts.capacity, 4);
  assert.ok(artifact.facts.amenities.includes("wifi"));
  assert.match(artifact.facts.description, /quiet living room/);
  assert.deepEqual(artifact.actions[0], {
    type: "request-to-book",
    artifactId: artifact.id,
    unitId: artifact.facts.unitId,
    projectionVersion: artifact.projectionVersion,
  });
});

test("AC6 — Unit detail artifact converts to valid A2UI and mounts in Weaver", () => {
  const artifact = detailArtifact();
  const messages = unitDetailArtifactToA2UI({ artifact, surfaceId: "unit-detail-proof" });
  const host = createWeaverWebHost();
  assert.deepEqual(host.process(messages), { ok: true, processedMessageCount: 2 });
  const target = new Window().document.createElement("div");
  assert.equal(host.mount({ surfaceId: "unit-detail-proof", target: target as unknown as Element }).ok, true);
  const text = target.textContent ?? "";
  assert.match(text, /Sunlit 2-bedroom apartment in Ikeja/);
  assert.match(text, /Lagos/);
  assert.match(text, /2 bedrooms/);
  assert.match(text, /2 bathrooms/);
  assert.match(text, /Sleeps 4/);
  assert.match(text, /Wi-Fi/);
  assert.match(text, /Request to Book/);
  assert.match(text, /Physical inspection completed on 15 Jan 2026/);
  assert.match(text, /entire place possession/);
  assert.doesNotMatch(text, /Management authority|24_7_power_generator|Refundable Security Deposit: ₦0/);
});

test("AC25 — Unit detail conventional presentation remains a separate parity path", () => {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const query = new UnitDiscoveryQuery({ repository, audit: new InMemoryAuditLog(), telemetry: new InMemoryTelemetry(), clock: () => new Date("2026-09-21T10:00:00.000Z"), idFactory: () => "parity-proof" });
  const conventional = query.search({ location: "Lagos", neighbourhood: "Ikeja", checkIn: "2026-10-01", checkOut: "2026-10-03", partySize: 2 });
  assert.equal(conventional.facts.results[0]?.id, detailArtifact().facts.unitId);
});
