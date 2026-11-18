import assert from "node:assert/strict";
import { unitDetailArtifactFromProjection } from "../../apps/web/src/index.js";
import { StayDateRange, UnitRepository, seedIssue01Units, toDiscoveryProjection, type Unit } from "../../domains/shortlet/src/index.js";

/**
 * The chargeable Old Ikoyi fixture Unit, quoted for 1–3 Oct 2026, as the chat's unit detail surface receives it.
 * `changes` overrides Unit fields (photos, bedrooms, title) to exercise the typed unit detail components.
 */
export function quotedUnitDetailArtifact(changes: Partial<Unit> = {}) {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findById("unit-lagos-001");
  assert.ok(unit);
  repository.save({ ...unit, photoUrls: ["https://images.example/living-room.jpg", "https://images.example/bedroom.jpg"], ...changes });
  const projection = toDiscoveryProjection(repository.findById("unit-lagos-001")!, new StayDateRange("2026-10-01", "2026-10-03", new Date("2026-09-21T10:00:00.000Z")));
  return unitDetailArtifactFromProjection({
    unit: projection,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    projectionVersion: 4,
    viewer: { id: "guest-1", role: "guest", tenantId: "tenant-1" },
  });
}
