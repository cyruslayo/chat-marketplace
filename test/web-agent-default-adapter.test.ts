import assert from "node:assert/strict";
import test from "node:test";
import {
  createBasicCatalogV091Registration,
  createWeaverRuntime,
} from "@weaver/core";
import {
  createWebAgentAdapter,
  createWeaverWebAgentAdapter,
} from "../apps/web-agent/src/index.js";
import * as webAgent from "../apps/web-agent/src/index.js";
import { conventionalSearch, conventionalSearchRoute } from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FILTERS = Object.freeze({
  checkIn: "2026-08-10",
  checkOut: "2026-08-12",
  partySize: 3,
  location: "Lagos",
});
const SURFACE_ID = "task-9-surface";

function createQuery(id = "task-9-artifact"): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => new Date("2026-07-22T00:00:00Z"),
    idFactory: () => id,
  });
}

function createDefaultAdapter(query = createQuery()) {
  return createWebAgentAdapter({ query, createSurfaceId: () => SURFACE_ID });
}

test("AC1 — Framework-neutral default points to Weaver", () => {
  assert.equal(createWebAgentAdapter, createWeaverWebAgentAdapter);
});

test("AC2 — Default output is Weaver-native", () => {
  const result = createDefaultAdapter().search(FILTERS);
  assert.equal(result.channel, "web-agent");
  assert.ok(result.artifact);
  assert.equal(result.surfaceId, SURFACE_ID);
  assert.ok(result.a2uiMessages.length > 0);
  assert.ok(result.fallback);
  assert.equal("agentRun" in result, false);
});

test("AC3 — Default path requires no runtime", () => {
  const adapter = createWebAgentAdapter({ query: createQuery(), createSurfaceId: () => SURFACE_ID });
  assert.equal(typeof adapter.search, "function");
});

test("AC4 — Default A2UI validates through real Weaver Core", () => {
  const result = createDefaultAdapter().search(FILTERS);
  const runtime = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(runtime.ok, true);
  if (!runtime.ok) throw new Error("Weaver runtime creation failed");
  for (const message of result.a2uiMessages) {
    const processed = runtime.value.process(message);
    assert.equal(processed.ok, true, processed.ok ? "" : JSON.stringify(processed.error));
  }
  const surface = runtime.value.resolveSurface(result.surfaceId);
  assert.equal(surface.ok, true);
  if (!surface.ok) throw new Error("Surface resolution failed");
  assert.equal(surface.value.tree.ready, true);
});

test("AC5 — Conventional parity remains intact", () => {
  const query = createQuery();
  const result = createDefaultAdapter(query).search(FILTERS);
  assert.deepEqual(result.artifact.facts, conventionalSearch(query, FILTERS).artifact.facts);
  assert.equal(result.fallback.conventionalRoute, conventionalSearchRoute(FILTERS));
});

test("AC6 — Web-agent public barrel exposes no CopilotKit runtime factory", () => {
  assert.equal("createCopilotKitRuntime" in webAgent, false);
  assert.equal("createCopilotKitWebAgentAdapter" in webAgent, false);
});

test("AC7 — Default construction requires no runtime or provider", () => {
  const adapter = createWebAgentAdapter({ query: createQuery(), createSurfaceId: () => SURFACE_ID });
  assert.equal(typeof adapter.search, "function");
});

test("AC8 — Default Weaver results preserve current-artifact and caller-surface correlation", () => {
  const first = createWebAgentAdapter({ query: createQuery("artifact-1"), createSurfaceId: () => "surface-1" }).search(FILTERS);
  const firstSnapshot = structuredClone(first);
  const second = createWebAgentAdapter({ query: createQuery("artifact-2"), createSurfaceId: () => "surface-2" }).search({ location: "Abuja" });

  assert.equal(first.artifact.id, "search-artifact-1");
  assert.equal(first.surfaceId, "surface-1");
  assert.equal(second.artifact.id, "search-artifact-2");
  assert.equal(second.surfaceId, "surface-2");
  assert.notEqual(second.artifact.id, first.artifact.id);
  assert.notEqual(second.surfaceId, first.surfaceId);
  assert.deepEqual(first, firstSnapshot);
  assert.notDeepEqual(second.a2uiMessages, first.a2uiMessages);
});
