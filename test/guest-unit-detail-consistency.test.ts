import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { A2UIComponent } from "@weaver/core";
import { unitDetailArtifactToA2UI, unitTiles } from "../apps/web-agent/src/index.js";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { renderConventionalUnitDetailHtml } from "../apps/local-guest/src/guest-server.js";
import { unitDetailArtifactFromProjection } from "../apps/web/src/index.js";
import { StayDateRange, UnitRepository, seedIssue01Units, toDiscoveryProjection } from "../domains/shortlet/src/index.js";

/** The chargeable Old Ikoyi fixture Unit, quoted for 1–3 Oct 2026, as the chat surface receives it. */
function quotedArtifact(bedrooms: number | undefined) {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findById("unit-lagos-001");
  assert.ok(unit);
  repository.save({ ...unit, bedrooms, photoUrls: ["https://images.example/living-room.jpg", "https://images.example/bedroom.jpg"] });
  const projection = toDiscoveryProjection(repository.findById("unit-lagos-001")!, new StayDateRange("2026-10-01", "2026-10-03", new Date("2026-09-21T10:00:00.000Z")));
  return unitDetailArtifactFromProjection({
    unit: projection,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    projectionVersion: 4,
    viewer: { id: "guest-1", role: "guest", tenantId: "tenant-1" },
  });
}

function componentsOf(messages: readonly unknown[]): readonly A2UIComponent[] {
  return messages.flatMap((message) => message !== null && typeof message === "object" && "updateComponents" in message
    ? (message as { updateComponents: { components: readonly A2UIComponent[] } }).updateComponents.components
    : []);
}

test("AC2: with a quote the price block shows the All-In Stay Total for the dates before the deposit; without one it shows only the labelled indicative nightly rate", () => {
  // Quoted: the chat's builder prices the stay for its dates, and the deposit follows the total (ADR 0015).
  const components = componentsOf(unitDetailArtifactToA2UI({ artifact: quotedArtifact(2), surfaceId: "unit-detail-ac2" }));
  const labelIndex = components.findIndex((component) => component.id === "unit-detail-price-label");
  const priceIndex = components.findIndex((component) => component.id === "unit-detail-price");
  const depositIndex = components.findIndex((component) => component.id === "unit-detail-deposit");
  assert.ok(labelIndex >= 0 && priceIndex === labelIndex + 1, "the total's label leads its amount");
  assert.equal(components[labelIndex]!.text, "All-In Stay Total · 1–3 Oct 2026 · 2 nights");
  assert.ok(depositIndex > priceIndex, "the All-In Stay Total precedes the separate deposit");
  assert.doesNotMatch(JSON.stringify(components), /Total to complete booking|Indicative nightly rate/, "no second amount line and no un-quoted rate on a quoted stay");

  // Un-quoted: the public page shows only the labelled indicative nightly rate (ADR 0015).
  const directory = mkdtempSync(join(tmpdir(), "unit-detail-ac2-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  try {
    const unit = environment.unitRepository.findAll()[0]!;
    const page = renderConventionalUnitDetailHtml(unit);
    assert.match(page, /Price per night \(indicative\)/);
    assert.match(page, /per night · dates not yet quoted/);
    assert.ok(page.includes(formatNgnKobo(unit.price.nightlyKobo)), "the indicative rate is the authoritative nightly price");
    assert.doesNotMatch(page, /All-In Stay Total/, "no all-in total before the stay is quoted");
  } finally {
    environment.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC3: the tiles show bedrooms, bathrooms and capacity from the unit record, and a missing bedroom count shows Not provided", () => {
  assert.deepEqual(unitTiles(2, 2, 4), [
    { icon: "bed", text: "2 bedrooms" },
    { icon: "bath", text: "2 bathrooms" },
    { icon: "users", text: "Sleeps 4" },
  ]);
  assert.deepEqual(unitTiles(undefined, 1, 2).map((tile) => tile.text), ["Not provided", "1 bathroom", "Sleeps 2"]);
  const missingBedroomComponents = componentsOf(unitDetailArtifactToA2UI({ artifact: quotedArtifact(undefined), surfaceId: "unit-detail-ac3" }));
  assert.equal(missingBedroomComponents.find((component) => component.id === "unit-detail-bedrooms")?.text, "Bedrooms: Not provided");
  assert.equal(missingBedroomComponents.find((component) => component.id === "unit-detail-bathrooms")?.text, "Bathrooms: 2 bathrooms");
  assert.equal(missingBedroomComponents.find((component) => component.id === "unit-detail-sleeps")?.text, "Sleeps: Sleeps 4");

  const directory = mkdtempSync(join(tmpdir(), "unit-detail-ac3-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  try {
    const unit = environment.unitRepository.findAll()[0]!;
    const page = renderConventionalUnitDetailHtml(unit);
    assert.match(page, /<ul class="ui-tiles" aria-label="Stay facts">/, "the facility tiles are one list");
    assert.ok(page.includes(`${unit.bathrooms} ${unit.bathrooms === 1 ? "bathroom" : "bathrooms"}`), "the bathroom count comes from the record");
    assert.ok(page.includes(`Sleeps ${unit.capacity}`), "the capacity comes from the record");

    const bare = renderConventionalUnitDetailHtml({ ...unit, bedrooms: undefined });
    assert.match(bare, /<li class="ui-tiles__tile">.*Not provided<\/li>/, "a missing bedroom count reads Not provided");
  } finally {
    environment.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
