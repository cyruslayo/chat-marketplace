import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { discoveryArtifactToA2UI, unitDetailToA2UI } from "../apps/web-agent/src/index.js";
import { createWeaverWebHost } from "../apps/web/src/index.js";
import { renderConventionalUnitDetailHtml } from "../apps/local-guest/src/guest-server.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";

const PHOTO_URLS = [
  "https://images.example/cover.jpg",
  "https://images.example/living-room.jpg",
  "https://images.example/bedroom.jpg",
] as const;

function artifactWithPhotos(photoUrls: readonly string[]) {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findById("unit-lagos-001");
  assert.ok(unit);
  repository.save({
    ...unit,
    description: "A bright, quiet apartment with a spacious living room and reliable power.",
    bathrooms: 2,
    photoUrls: [...photoUrls],
  });
  return new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => new Date("2026-09-21T10:00:00.000Z"),
    idFactory: () => "photo-artifact",
  }).search({ location: "Lagos" });
}

function components(messages: readonly unknown[]): readonly Record<string, unknown>[] {
  const update = messages.find((message): message is { updateComponents: { components: readonly Record<string, unknown>[] } } =>
    typeof message === "object" && message !== null && "updateComponents" in message);
  assert.ok(update);
  return update.updateComponents.components;
}

test("AC13 — discovery shows the primary photo when present", () => {
  const artifact = artifactWithPhotos(PHOTO_URLS);
  const images = components(discoveryArtifactToA2UI({ artifact, surfaceId: "photo-discovery" }))
    .filter((component) => component.component === "Image");
  assert.equal(images.length, 1);
  assert.equal(images[0]?.url, PHOTO_URLS[0]);
  assert.match(String(images[0]?.description), /Sunlit 2-bedroom apartment in Ikeja/);
});

test("AC14 — discovery remains usable with zero photos", () => {
  const artifact = artifactWithPhotos([]);
  const messages = discoveryArtifactToA2UI({ artifact, surfaceId: "photo-discovery-empty" });
  assert.equal(components(messages).some((component) => component.component === "Image"), false);
  assert.match(JSON.stringify(messages), /Sunlit 2-bedroom apartment in Ikeja/);
});

test("AC15/AC17 — failed media leaves critical listing text and Request to Book available", () => {
  const artifact = artifactWithPhotos(PHOTO_URLS.slice(0, 1));
  const messages = unitDetailToA2UI({
    unit: artifact.facts.results[0]!,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    surfaceId: "photo-detail",
    action: { artifactId: artifact.id, unitId: artifact.facts.results[0]!.id, projectionVersion: artifact.projectionVersion },
  });
  const host = createWeaverWebHost({ resourcePolicy: ({ kind, url }) => kind === "image" ? url : undefined });
  const processed = host.process(messages);
  assert.equal(processed.ok, true);
  const window = new Window();
  const target = window.document.createElement("div");
  assert.equal(host.mount({ surfaceId: "photo-detail", target: target as unknown as Element }).ok, true);
  assert.match(target.textContent ?? "", /Sunlit 2-bedroom apartment in Ikeja/);
  assert.match(target.textContent ?? "", /Ikeja, Lagos/);
  assert.match(target.textContent ?? "", /Request to Book/);
});

test("AC16 — Unit detail presents all stored photos in order", () => {
  const artifact = artifactWithPhotos(PHOTO_URLS);
  const unit = artifact.facts.results[0]!;
  const images = components(unitDetailToA2UI({
    unit,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    surfaceId: "photo-detail-all",
    action: { artifactId: artifact.id, unitId: unit.id, projectionVersion: artifact.projectionVersion },
  })).filter((component) => component.component === "Image");
  assert.deepEqual(images.map((image) => image.url), PHOTO_URLS);
});

test("AC14/AC15 — Unit detail presents description and bathroom count", () => {
  const artifact = artifactWithPhotos([]);
  const unit = artifact.facts.results[0]!;
  const messages = unitDetailToA2UI({
    unit,
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    surfaceId: "photo-detail-facts",
    action: { artifactId: artifact.id, unitId: unit.id, projectionVersion: artifact.projectionVersion },
  });
  const text = JSON.stringify(messages);
  assert.match(text, /A bright, quiet apartment with a spacious living room and reliable power/);
  assert.match(text, /Bathrooms: 2/);
});

test("AC18/AC19/AC22 — conventional detail exposes the same photos with safe referrer policy and no secrets", () => {
  const artifact = artifactWithPhotos(PHOTO_URLS);
  const unit = artifact.facts.results[0]!;
  const html = renderConventionalUnitDetailHtml(unit);
  for (const photoUrl of PHOTO_URLS) assert.match(html, new RegExp(photoUrl.replaceAll(".", "\\.")));
  assert.equal((html.match(/<img\b/g) ?? []).length, PHOTO_URLS.length);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(html, /guest-demo|operator-001|booking-|payment-/i);
  assert.match(html, /Sunlit 2-bedroom apartment in Ikeja/);
  assert.match(html, /Ikeja/);
  assert.match(html, /₦/);
  assert.match(html, /A bright, quiet apartment with a spacious living room and reliable power/);
  assert.match(html, /Bathrooms: 2/);
});
