import assert from "node:assert/strict";
import test from "node:test";
import {
  CatalogueRegistry,
  GenerativeSurfaceManager,
  HumanHandoffManager,
  InteractionSecurityEngine,
  InteractionThreadManager,
  type SecurityContext,
} from "../packages/platform-core/src/index.js";

const context: SecurityContext = { principalId: "guest", tenantId: "tenant", sessionId: "session" };

test("AC1: A catalogue not registered by any pack is rejected", () => {
  const registry = new CatalogueRegistry();
  registry.register("commerce", ["commerce-discovery/v1", "commerce-cart/v1"]);
  const manager = new GenerativeSurfaceManager({ catalogues: registry });

  // A catalogue the pack registered is accepted.
  assert.equal(manager.createSurface({ catalogue: "commerce-cart/v1" }).catalogue, "commerce-cart/v1");

  // A catalogue no pack registered fails closed, on both create and fallback.
  assert.throws(() => manager.createSurface({ catalogue: "shortlet-discovery/v1" }), /Unsupported catalogue/);
  assert.throws(() => manager.renderWithFallback({ catalogue: "commerce-order/v1" }), /Unsupported catalogue/);
});

test("AC1: An empty registry rejects every catalogue", () => {
  const manager = new GenerativeSurfaceManager({ catalogues: new CatalogueRegistry() });
  assert.throws(() => manager.createSurface({ catalogue: "discovery/v1" }), /Unsupported catalogue/);
});

test("The registry records which pack owns each catalogue", () => {
  const registry = new CatalogueRegistry();
  registry.register("shortlet", ["shortlet-discovery/v1"]);
  assert.equal(registry.has("shortlet-discovery/v1"), true);
  assert.equal(registry.ownerOf("shortlet-discovery/v1"), "shortlet");
  assert.deepEqual(registry.ids(), ["shortlet-discovery/v1"]);
  assert.throws(() => registry.register("", ["x/v1"]), /owner/);
  assert.throws(() => registry.register("shortlet", [""]), /catalogue id/);
});

test("AC3: Shortlet catalogues, handoff routing and summary kinds keep their existing values", () => {
  const surfaces = new GenerativeSurfaceManager();
  assert.equal(surfaces.createSurface({ catalogue: "discovery/v1" }).catalogue, "discovery/v1");

  const threads = new InteractionThreadManager();
  const generalThread = threads.createThread(context).threadId;
  const emergencyThread = threads.createThread(context).threadId;
  const handoff = new HumanHandoffManager(threads);
  const general = handoff.initiateHandoff(generalThread, context, { trigger: "user_request", category: "general_billing", activeStay: false });
  assert.equal(general.supportPath, "general_support");
  assert.equal(general.targetQueue, "General Support (8 AM - 8 PM WAT)");
  const emergency = handoff.initiateHandoff(emergencyThread, context, { trigger: "failed_access", category: "safety_or_access", activeStay: true });
  assert.equal(emergency.supportPath, "active_stay_emergency_support");
  assert.equal(emergency.targetQueue, "Active-Stay Emergency Support (24/7)");

  const security = new InteractionSecurityEngine({ summaryKinds: ["surface_render", "booking_summary", "confirmation_card", "status_display"] });
  assert.equal(security.renderTypedA2UI({ kind: "booking_summary", title: "Lekki Apartment Stay" }).kind, "booking_summary");
});
