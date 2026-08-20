import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GenerativeSurfaceManager,
  APPROVED_CATALOGUES,
  IndependentReferenceClient,
  RecordedSurfaceCreatedEvent,
  RecordedSurfaceExpiredEvent,
  RecordedSurfaceUpdatedEvent,
  RecordedSurfaceProjector
} from "../packages/platform-core/src/index.js";

test("surface requires no interaction protocol profile and validates approved catalogue", () => {
  const manager = new GenerativeSurfaceManager();

  assert.throws(
    () => manager.createSurface({ catalogue: "unapproved/v99" }),
    /Unsupported catalogue/
  );

  const surface = manager.createSurface({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    facts: { totalResults: 2 },
    textFallback: "2 stays found",
    conventionalRoute: "/stays/search"
  });

  assert.equal(surface.status, "active");
  assert.equal(surface.revision, 1);
  assert.equal(surface.catalogue, "discovery/v1");
  assert.equal("profile" in surface, false);
});

test("surface source has no AG-UI profile or HTTPS POST-SSE coupling", () => {
  const source = readFileSync(new URL("../packages/platform-core/src/surface.ts", import.meta.url), "utf8");

  assert.equal(source.includes("AG_UI_PROFILE"), false);
  assert.equal(source.includes("ag-ui/0.0.57-shortlet-launch-v1"), false);
  assert.equal(source.includes("https-post-sse"), false);
});

test("revisions correlate to authoritative projection versions and stale or expired actions fail closed", () => {
  const manager = new GenerativeSurfaceManager();

  const surface = manager.createSurface({
    catalogue: "booking/v1",
    projectionVersion: 2,
    facts: { priceKobo: 8500000 }
  });

  // Stale projection update (older version version 1 < current 2) marks surface stale
  manager.updateSurfaceProjection(surface.surfaceId, { projectionVersion: 1, facts: { priceKobo: 7000000 } });
  const staleSurface = manager.getSurface(surface.surfaceId);
  assert.equal(staleSurface.status, "stale");

  // Executing action on stale surface throws error (fails closed)
  assert.throws(
    () => manager.executeSurfaceAction(surface.surfaceId, { actionName: "confirm-booking" }),
    /Action authority revoked: surface is stale/
  );

  // Expire surface
  manager.expireSurface(surface.surfaceId);
  const expiredSurface = manager.getSurface(surface.surfaceId);
  assert.equal(expiredSurface.status, "expired");

  assert.throws(
    () => manager.executeSurfaceAction(surface.surfaceId, { actionName: "confirm-booking" }),
    /Action authority revoked: surface is expired/
  );
});

test("valid projection updates keep the surface active and usable", () => {
  const manager = new GenerativeSurfaceManager();
  const surface = manager.createSurface({ catalogue: "booking/v1", projectionVersion: 2, facts: { priceKobo: 8500000 } });

  manager.updateSurfaceProjection(surface.surfaceId, { projectionVersion: 2, facts: { priceKobo: 8500000 } });
  const equalRevisionSurface = manager.getSurface(surface.surfaceId);
  assert.equal(equalRevisionSurface.revision, 2);
  assert.deepEqual(equalRevisionSurface.facts, { priceKobo: 8500000 });

  manager.updateSurfaceProjection(surface.surfaceId, { projectionVersion: 3, facts: { priceKobo: 9000000 } });

  const updatedSurface = manager.getSurface(surface.surfaceId);
  assert.equal(updatedSurface.revision, 3);
  assert.deepEqual(updatedSurface.facts, { priceKobo: 9000000 });
  assert.equal(updatedSurface.status, "active");
  assert.equal(manager.executeSurfaceAction(surface.surfaceId, { actionName: "confirm-booking" }).success, true);
});

test("unsupported or invalid rich UI produces safe text plus conventional route without losing workflow state", () => {
  const manager = new GenerativeSurfaceManager();

  const workflowState = { draftId: "draft-999", selectedDates: { checkIn: "2026-08-10", checkOut: "2026-08-12" } };

  // Render surface with fallback
  const surface = manager.renderWithFallback({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    workflowState,
    textFallback: "Unit summary for Lagos stay",
    conventionalRoute: "/stays/search?location=Lagos"
  });

  assert.equal(surface.isFallback, true);
  assert.equal(surface.textFallback, "Unit summary for Lagos stay");
  assert.equal(surface.conventionalRoute, "/stays/search?location=Lagos");
  assert.deepEqual(surface.workflowState, workflowState);
  assert.equal(surface.status, "active");
  assert.equal("profile" in surface, false);
});

function createRecordedSurface(
  surfaceId: string,
  revision: number,
  facts: Readonly<Record<string, unknown>> = { unitId: surfaceId }
): RecordedSurfaceCreatedEvent {
  return {
    type: "surface.created",
    surfaceId,
    catalogue: "discovery/v1",
    revision,
    facts
  };
}

function updateRecordedSurface(
  surfaceId: string,
  revision: number,
  facts: Readonly<Record<string, unknown>>
): RecordedSurfaceUpdatedEvent {
  return { type: "surface.updated", surfaceId, revision, facts };
}

function expireRecordedSurface(surfaceId: string): RecordedSurfaceExpiredEvent {
  return { type: "surface.expired", surfaceId };
}

test("AC1: RecordedSurfaceProjector requires no client or framework argument", () => {
  assert.ok(new RecordedSurfaceProjector() instanceof RecordedSurfaceProjector);
});

test("AC2: surface.created creates an active normalized projection", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { unitId: "unit-a", title: "First" })
  ]);

  assert.deepEqual(projection, {
    surfaceId: "surf-a",
    catalogue: "discovery/v1",
    revision: 1,
    status: "active",
    facts: { unitId: "unit-a", title: "First" }
  });
});

test("AC3: equal and newer updates replace revision and facts while active remains active", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "First" }),
    updateRecordedSurface("surf-a", 1, { title: "Equal" }),
    updateRecordedSurface("surf-a", 2, { title: "Newer" })
  ]);

  assert.equal(projection?.revision, 2);
  assert.deepEqual(projection?.facts, { title: "Newer" });
  assert.equal(projection?.status, "active");
});

test("AC4: an older update marks the projection stale and retains revision and facts", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 2, { title: "Current" }),
    updateRecordedSurface("surf-a", 1, { title: "Older" })
  ]);

  assert.equal(projection?.status, "stale");
  assert.equal(projection?.revision, 2);
  assert.deepEqual(projection?.facts, { title: "Current" });
});

test("AC5: a newer update does not repair stale status", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 2, { title: "Current" }),
    updateRecordedSurface("surf-a", 1, { title: "Older" }),
    updateRecordedSurface("surf-a", 3, { title: "Newer" })
  ]);

  assert.equal(projection?.status, "stale");
  assert.equal(projection?.revision, 3);
  assert.deepEqual(projection?.facts, { title: "Newer" });
});

test("AC6: matching surface.expired sets expired while retaining projected state", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "First" }),
    updateRecordedSurface("surf-a", 2, { title: "Updated" }),
    expireRecordedSurface("surf-a")
  ]);

  assert.deepEqual(projection, {
    surfaceId: "surf-a",
    catalogue: "discovery/v1",
    revision: 2,
    status: "expired",
    facts: { title: "Updated" }
  });
});

test("AC7: a newer update does not repair expired status", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "First" }),
    expireRecordedSurface("surf-a"),
    updateRecordedSurface("surf-a", 2, { title: "Updated" })
  ]);

  assert.equal(projection?.status, "expired");
  assert.equal(projection?.revision, 2);
  assert.deepEqual(projection?.facts, { title: "Updated" });
});

test("AC8: wrong-surface updates and expiry events are ignored", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "A" }),
    updateRecordedSurface("surf-b", 2, { title: "B" }),
    expireRecordedSurface("surf-b")
  ]);

  assert.deepEqual(projection, {
    surfaceId: "surf-a",
    catalogue: "discovery/v1",
    revision: 1,
    status: "active",
    facts: { title: "A" }
  });
});

test("AC9: pre-create updates and expiry events leave the projection null", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    updateRecordedSurface("surf-a", 1, { title: "Before" }),
    expireRecordedSurface("surf-a")
  ]);

  assert.equal(projection, null);
});

test("AC10: unknown event types are ignored without throwing", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "A" }),
    { type: "surface.unknown", surfaceId: "surf-a", title: "Ignored" },
    updateRecordedSurface("surf-a", 2, { title: "B" })
  ]);

  assert.equal(projection?.revision, 2);
  assert.deepEqual(projection?.facts, { title: "B" });
});

test("AC11: the latest create replaces the prior normalized projection", () => {
  const projection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 5, { title: "A" }),
    updateRecordedSurface("surf-a", 6, { title: "Updated A" }),
    createRecordedSurface("surf-b", 1, { title: "B" })
  ]);

  assert.deepEqual(projection, {
    surfaceId: "surf-b",
    catalogue: "discovery/v1",
    revision: 1,
    status: "active",
    facts: { title: "B" }
  });
});

test("AC12: equivalent event sequences produce deterministic projections", () => {
  const events = [
    createRecordedSurface("surf-a", 1, { title: "A" }),
    updateRecordedSurface("surf-a", 2, { title: "B" })
  ];

  const first = new RecordedSurfaceProjector().renderRecordedStream(events);
  const second = new RecordedSurfaceProjector().renderRecordedStream(events);

  assert.deepEqual(first, second);
});

test("AC13: projection does not mutate caller-provided events or facts", () => {
  const facts = Object.freeze({ title: "A" });
  const created = Object.freeze({
    ...createRecordedSurface("surf-a", 1, facts),
    facts
  });

  const projection = new RecordedSurfaceProjector().renderRecordedStream([created]);

  assert.deepEqual(created, {
    type: "surface.created",
    surfaceId: "surf-a",
    catalogue: "discovery/v1",
    revision: 1,
    facts: { title: "A" }
  });
  assert.deepEqual(facts, { title: "A" });
  assert.deepEqual(projection?.facts, { title: "A" });
});

test("AC14: the recorded surface projector contract and implementation contain no any", () => {
  const source = readFileSync(new URL("../packages/platform-core/src/surface.ts", import.meta.url), "utf8");
  const projectorStart = source.indexOf("export interface RecordedSurfaceCreatedEvent");
  const compatibilityStart = source.indexOf("// Temporary compatibility export");

  assert.ok(projectorStart >= 0);
  assert.ok(compatibilityStart > projectorStart);
  assert.equal(source.slice(projectorStart, compatibilityStart).includes("any"), false);
});

test("AC15: the compatibility alias constructs the same implementation", () => {
  assert.equal(IndependentReferenceClient, RecordedSurfaceProjector);

  const compatibilityProjection = new IndependentReferenceClient().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "A" })
  ]);
  const currentProjection = new RecordedSurfaceProjector().renderRecordedStream([
    createRecordedSurface("surf-a", 1, { title: "A" })
  ]);

  assert.deepEqual(compatibilityProjection, currentProjection);
});
