import test from "node:test";
import assert from "node:assert/strict";
import {
  GenerativeSurfaceManager,
  AG_UI_PROFILE,
  APPROVED_CATALOGUES,
  IndependentReferenceClient
} from "../packages/platform-core/src/index.js";
import { createCopilotKitRuntime } from "../apps/web-agent/src/index.js";

test("surface uses pinned interaction profile and approved catalogue known at deploy time", () => {
  const manager = new GenerativeSurfaceManager();

  assert.throws(
    () => manager.createSurface({ catalogue: "unapproved/v99", profile: AG_UI_PROFILE }),
    /Unsupported catalogue/
  );

  assert.throws(
    () => manager.createSurface({ catalogue: "discovery/v1", profile: { id: "wrong-profile" } }),
    /Pinned interaction profile mismatch/
  );

  const surface = manager.createSurface({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    profile: AG_UI_PROFILE,
    facts: { totalResults: 2 },
    textFallback: "2 stays found",
    conventionalRoute: "/stays/search"
  });

  assert.equal(surface.status, "active");
  assert.equal(surface.revision, 1);
  assert.equal(surface.profile.id, AG_UI_PROFILE.id);
});

test("revisions correlate to authoritative projection versions and stale or expired actions fail closed", () => {
  const manager = new GenerativeSurfaceManager();

  const surface = manager.createSurface({
    catalogue: "booking/v1",
    projectionVersion: 2,
    profile: AG_UI_PROFILE,
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

test("unsupported or invalid rich UI produces safe text plus conventional route without losing workflow state", () => {
  const manager = new GenerativeSurfaceManager();

  const workflowState = { draftId: "draft-999", selectedDates: { checkIn: "2026-08-10", checkOut: "2026-08-12" } };

  // Render surface with fallback
  const surface = manager.renderWithFallback({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    profile: AG_UI_PROFILE,
    workflowState,
    textFallback: "Unit summary for Lagos stay",
    conventionalRoute: "/stays/search?location=Lagos"
  });

  assert.equal(surface.isFallback, true);
  assert.equal(surface.textFallback, "Unit summary for Lagos stay");
  assert.equal(surface.conventionalRoute, "/stays/search?location=Lagos");
  assert.deepEqual(surface.workflowState, workflowState);
  assert.equal(surface.status, "active");
});

test("same recorded stream renders equivalent normalized meaning in CopilotKit and independent reference client", async () => {
  const streamEvents = [
    { type: "surface.created", surfaceId: "surf-101", catalogue: "discovery/v1", revision: 1, facts: { unitId: "unit-lagos-001", title: "Luxury Flat" } },
    { type: "surface.updated", surfaceId: "surf-101", revision: 2, facts: { unitId: "unit-lagos-001", title: "Luxury Flat - Updated" } }
  ];

  const copilotRuntime = createCopilotKitRuntime({
    coreFactory: () => ({
      connect() {}, getAgent: () => ({ addMessage() {} }), subscribe: () => ({ unsubscribe() {} }), runAgent: async () => {}
    })
  });
  const copilotNormalized = await copilotRuntime.renderRecordedStream(streamEvents);

  const referenceClient = new IndependentReferenceClient();
  const referenceNormalized = referenceClient.renderRecordedStream(streamEvents);

  assert.deepEqual(copilotNormalized, referenceNormalized);
  assert.equal(copilotNormalized!.surfaceId, "surf-101");
  assert.equal(copilotNormalized!.revision, 2);
  assert.equal(copilotNormalized!.facts.title, "Luxury Flat - Updated");
});
