import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBasicCatalogV091Registration,
  createWeaverRuntime,
  type A2UIServerMessage,
} from "@weaver/core";
import {
  createCopilotKitWebAgentAdapter,
  createWeaverWebAgentAdapter,
  discoveryArtifactToA2UI,
  type WeaverDiscoveryQueryPort,
} from "../apps/web-agent/src/index.js";
import { conventionalSearchRoute } from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const SURFACE_ID = "surface-test-001";
const DATED_FILTERS = Object.freeze({
  checkIn: "2026-08-10",
  checkOut: "2026-08-12",
  partySize: 3,
  location: "Lagos",
});

function createQuery(id = "task-8-artifact"): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => id,
  });
}

function createAdapter(
  query: WeaverDiscoveryQueryPort = createQuery(),
  createSurfaceId: (artifactId: string) => string = () => SURFACE_ID,
) {
  return createWeaverWebAgentAdapter({ query, createSurfaceId });
}

function processMessages(messages: readonly A2UIServerMessage[], surfaceId = SURFACE_ID) {
  const created = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("Weaver runtime creation failed");
  for (const message of messages) {
    const processed = created.value.process(message);
    assert.equal(processed.ok, true, processed.ok ? "" : JSON.stringify(processed.error));
  }
  const surface = created.value.resolveSurface(surfaceId);
  assert.equal(surface.ok, true);
  if (!surface.ok) throw new Error("Surface resolution failed");
  assert.equal(surface.value.tree.ready, true);
}

function allMessageSurfaceIds(messages: readonly A2UIServerMessage[]): string[] {
  return messages.map((message) => {
    if ("createSurface" in message) return message.createSurface.surfaceId;
    if ("updateComponents" in message) return message.updateComponents.surfaceId;
    if ("updateDataModel" in message) return message.updateDataModel.surfaceId;
    if ("deleteSurface" in message) return message.deleteSurface.surfaceId;
    throw new Error("Unexpected A2UI message");
  });
}

async function weaverAdapterSource(): Promise<string> {
  const source = await readFile(new URL("../apps/web-agent/src/presentation.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function createWeaverWebAgentAdapter");
  const end = source.indexOf("export function createCopilotKitWebAgentAdapter", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("AC1 — Search delegates to authoritative query exactly once", () => {
  const canonical = createQuery().search(DATED_FILTERS);
  const calls: unknown[] = [];
  const query = { search(filters: Readonly<Record<string, unknown>>) { calls.push(filters); return canonical; } };
  const result = createAdapter(query).search(DATED_FILTERS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], DATED_FILTERS);
  assert.equal(result.artifact, canonical);
});

test("AC2 — Adapter produces deterministic Weaver surface", () => {
  const result = createAdapter().search(DATED_FILTERS);
  assert.equal(result.artifact.facts.results.length, 1);
  assert.equal(result.surfaceId, SURFACE_ID);
  assert.ok(result.a2uiMessages.length > 0);
  processMessages(result.a2uiMessages, result.surfaceId);
});

test("AC3 — A2UI output is delegated, not duplicated", () => {
  const result = createAdapter().search(DATED_FILTERS);
  assert.deepEqual(result.a2uiMessages, discoveryArtifactToA2UI({ artifact: result.artifact, surfaceId: result.surfaceId }));
});

test("AC4 — Caller owns surface identity", () => {
  const artifactIds: string[] = [];
  const result = createAdapter(createQuery(), (artifactId) => { artifactIds.push(artifactId); return SURFACE_ID; }).search(DATED_FILTERS);
  assert.deepEqual(artifactIds, [result.artifact.id]);
  assert.equal(result.surfaceId, SURFACE_ID);
  assert.deepEqual(allMessageSurfaceIds(result.a2uiMessages), result.a2uiMessages.map(() => SURFACE_ID));
});

test("AC5 — Canonical artifact facts remain unchanged", () => {
  const filters = { ...DATED_FILTERS };
  const result = createAdapter().search(filters);
  assert.deepEqual(filters, DATED_FILTERS);
  assert.deepEqual(result.artifact.facts.filters, DATED_FILTERS);
  assert.deepEqual(result.artifact.facts.results.map((unit) => unit.id), ["unit-lagos-001"]);
  assert.equal(result.artifact.facts.results[0]?.price.allInStayTotalKobo, 18_000_000);
  assert.equal(Object.isFrozen(result.artifact), true);
  assert.equal(Object.isFrozen(result.artifact.facts.results[0]), true);
});

test("AC6 — Deterministic fallback narration", () => {
  assert.equal(createAdapter().search(DATED_FILTERS).fallback.message, "Found 1 eligible Unit.");
  assert.equal(createAdapter().search({ location: "Abuja" }).fallback.message, "No eligible Units match those requirements.");
});

test("AC7 — Conventional parity retained", () => {
  const result = createAdapter().search(DATED_FILTERS);
  assert.equal(result.fallback.conventionalRoute, conventionalSearchRoute(DATED_FILTERS));
});

test("AC8 — Runtime/provider independence", async () => {
  const source = await weaverAdapterSource();
  assert.doesNotMatch(source, /@copilotkit\/core|@ag-ui\/core|CopilotKitCore|createCopilotKitRuntime|Gemini|OpenAI|Anthropic/i);
});

test("AC9 — Existing CopilotKit adapter remains available", () => {
  assert.equal(typeof createCopilotKitWebAgentAdapter, "function");
});

test("AC10 — Zero results still produce valid A2UI", () => {
  const result = createAdapter().search({ location: "Abuja" });
  assert.equal(result.artifact.facts.results.length, 0);
  assert.equal(result.fallback.message, "No eligible Units match those requirements.");
  processMessages(result.a2uiMessages, result.surfaceId);
});

test("AC11 — Same inputs are deterministic", () => {
  const first = createAdapter(createQuery("same")).search(DATED_FILTERS);
  const second = createAdapter(createQuery("same")).search({ ...DATED_FILTERS });
  assert.deepEqual(first, second);
});

test("AC12 — No application or domain authority moved into adapter", async () => {
  const source = await weaverAdapterSource();
  assert.doesNotMatch(source, /UnitRepository|JsonUnitRepository|isEligibleUnit|calculateTaxKobo|pricing|eligibility|PlatformCommandEnvelope|browser-navigation\.js/i);
});
