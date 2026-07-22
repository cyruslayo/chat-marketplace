import test from "node:test";
import assert from "node:assert/strict";
import {
  AG_UI_PROFILE,
  APPROVED_CATALOGUES,
  GenerativeSurfaceManager,
  IndependentReferenceClient
} from "../packages/platform-core/src/index.js";
import { createCopilotKitRuntime } from "../apps/web-agent/src/copilotkit-runtime.js";

test("surface uses pinned interaction profile and approved catalogue known at deploy time", () => {
  const manager = new GenerativeSurfaceManager();
  
  // Valid approved surface
  const surface = manager.createSurface({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    profile: AG_UI_PROFILE,
    facts: { item: "unit-lagos-001" },
    workflowState: { step: "exploring" },
    textFallback: "View Unit 001",
    conventionalRoute: "/stays/unit-lagos-001"
  });

  assert.equal(surface.catalogue, "discovery/v1");
  assert.equal(surface.status, "active");
  assert.equal(surface.profile.id, "ag-ui/0.0.57-shortlet-launch-v1");
  assert.deepEqual(APPROVED_CATALOGUES, [
    "common/v1",
    "discovery/v1",
    "booking/v1",
    "incident/v1",
    "operator/v1"
  ]);

  // Reject unapproved catalogue
  assert.throws(
    () => manager.createSurface({ catalogue: "unapproved/v99", profile: AG_UI_PROFILE }),
    /unsupported catalogue/i
  );

  // Reject unpinned/mismatched profile
  assert.throws(
    () => manager.createSurface({ catalogue: "discovery/v1", profile: { id: "ag-ui/invalid" } }),
    /pinned interaction profile mismatch/i
  );
});

test("revisions correlate to authoritative projection versions and stale or expired actions fail closed", () => {
  const manager = new GenerativeSurfaceManager();
  const surface = manager.createSurface({
    catalogue: "booking/v1",
    projectionVersion: 10,
    profile: AG_UI_PROFILE,
    facts: { quoteKobo: 5000000 },
    workflowState: { quoteId: "q-1" },
    textFallback: "Quote details",
    conventionalRoute: "/booking/quote/q-1"
  });

  assert.equal(surface.revision, 10);

  // Execute valid active action
  const actionResult = manager.executeSurfaceAction(surface.surfaceId, {
    actionName: "accept-quote",
    payload: { confirm: true }
  });
  assert.equal(actionResult.success, true);

  // Update projection to revision 11
  manager.updateSurfaceProjection(surface.surfaceId, {
    projectionVersion: 11,
    facts: { quoteKobo: 5500000 }
  });
  const updated = manager.getSurface(surface.surfaceId);
  assert.equal(updated.revision, 11);

  // Attempt stale update (revision 9 < 11) -> status becomes stale
  manager.updateSurfaceProjection(surface.surfaceId, {
    projectionVersion: 9,
    facts: { quoteKobo: 4000000 }
  });
  const staleSurface = manager.getSurface(surface.surfaceId);
  assert.equal(staleSurface.status, "stale");

  // Stale action fails closed
  assert.throws(
    () => manager.executeSurfaceAction(surface.surfaceId, { actionName: "accept-quote" }),
    /action authority revoked: surface is stale/i
  );

  // Expired surface fails closed
  manager.expireSurface(surface.surfaceId);
  const expiredSurface = manager.getSurface(surface.surfaceId);
  assert.equal(expiredSurface.status, "expired");

  assert.throws(
    () => manager.executeSurfaceAction(surface.surfaceId, { actionName: "accept-quote" }),
    /action authority revoked: surface is expired/i
  );
});

test("unsupported or invalid rich UI produces safe text plus conventional route without losing workflow state", () => {
  const manager = new GenerativeSurfaceManager();
  
  const workflowState = { draftId: "draft-999", selectedDates: { checkIn: "2026-08-10", checkOut: "2026-08-12" } };

  // Render surface with invalid rich UI structure
  const surface = manager.renderWithFallback({
    catalogue: "discovery/v1",
    projectionVersion: 1,
    profile: AG_UI_PROFILE,
    invalidRichUiPayload: { badProp: "<script>alert(1)</script>" },
    workflowState,
    textFallback: "Unit summary for Lagos stay",
    conventionalRoute: "/stays/search?location=Lagos"
  });

  assert.equal(surface.isFallback, true);
  assert.equal(surface.textFallback, "Unit summary for Lagos stay");
  assert.equal(surface.conventionalRoute, "/stays/search?location=Lagos");
  // Workflow state preserved!
  assert.deepEqual(surface.workflowState, workflowState);
  assert.equal(surface.status, "active");
});

test("same recorded stream renders equivalent normalized meaning in CopilotKit and independent reference client", async () => {
  const streamEvents = [
    { type: "surface.created", surfaceId: "surf-101", catalogue: "discovery/v1", revision: 1, facts: { unitId: "unit-lagos-001", title: "Luxury Flat" } },
    { type: "surface.updated", surfaceId: "surf-101", revision: 2, facts: { unitId: "unit-lagos-001", title: "Luxury Flat - Updated" } }
  ];

  // CopilotKit runtime processing stream
  const copilotRuntime = createCopilotKitRuntime({
    coreFactory: () => ({
      connect() {}, getAgent: () => ({ addMessage() {} }), subscribe: () => ({ unsubscribe() {} }), runAgent: async () => {}
    })
  });
  const copilotNormalized = await copilotRuntime.renderRecordedStream(streamEvents);

  // Independent reference client processing stream
  const referenceClient = new IndependentReferenceClient();
  const referenceNormalized = referenceClient.renderRecordedStream(streamEvents);

  assert.deepEqual(copilotNormalized, referenceNormalized);
  assert.equal(copilotNormalized.surfaceId, "surf-101");
  assert.equal(copilotNormalized.revision, 2);
  assert.equal(copilotNormalized.facts.title, "Luxury Flat - Updated");
});
