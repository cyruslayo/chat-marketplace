import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GenerativeSurfaceManager,
  APPROVED_CATALOGUES,
  IndependentReferenceClient
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

test("recorded surface events normalize deterministically through the framework-independent reference path", () => {
  const streamEvents = [
    { type: "surface.created", surfaceId: "surf-101", catalogue: "discovery/v1", revision: 1, facts: { unitId: "unit-lagos-001", title: "Luxury Flat" } },
    { type: "surface.updated", surfaceId: "surf-101", revision: 2, facts: { unitId: "unit-lagos-001", title: "Luxury Flat - Updated" } }
  ];

  const referenceClient = new IndependentReferenceClient();
  const normalized = referenceClient.renderRecordedStream(streamEvents);
  const repeated = new IndependentReferenceClient().renderRecordedStream(streamEvents);

  assert.deepEqual(normalized, repeated);
  assert.equal(normalized!.surfaceId, "surf-101");
  assert.equal(normalized!.revision, 2);
  assert.equal(normalized!.facts.unitId, "unit-lagos-001");
  assert.equal(normalized!.facts.title, "Luxury Flat - Updated");
});
