import assert from "node:assert/strict";
import test from "node:test";
import {
  A2UI_V091_BASIC_CATALOG_ID,
  createBasicCatalogV091Registration,
  createWeaverRuntime,
  type A2UIComponent,
  type A2UIServerMessage,
  type HydratedComponentInstance,
  type WeaverRuntime,
} from "@weaver/core";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const SURFACE_ID = "discovery-surface-1";

function createQuery(): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => "artifact-1",
  });
}

function createRuntime(): WeaverRuntime {
  const result = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Weaver runtime creation failed");
  return result.value;
}

function processMessages(messages: readonly A2UIServerMessage[]): WeaverRuntime {
  const runtime = createRuntime();
  for (const message of messages) {
    const result = runtime.process(message);
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  }
  return runtime;
}

function collectInstances(root: HydratedComponentInstance | undefined): HydratedComponentInstance[] {
  if (!root) return [];
  return [root, ...root.relationships.flatMap((relationship) =>
    relationship.kind === "single"
      ? collectInstances(relationship.child)
      : relationship.children.flatMap((child) => collectInstances(child)))];
}

function resolvedText(runtime: WeaverRuntime): string[] {
  const result = runtime.resolveSurface(SURFACE_ID);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Surface resolution failed");
  return collectInstances(result.value.tree.root)
    .filter((instance) => instance.component === "Text")
    .map((instance) => instance.properties.text)
    .filter((value): value is string => typeof value === "string");
}

function updateComponents(messages: readonly A2UIServerMessage[]): readonly A2UIComponent[] {
  const message = messages.find((candidate) => "updateComponents" in candidate);
  assert.ok(message && "updateComponents" in message);
  return message.updateComponents.components;
}

function datedArtifact() {
  return createQuery().search({
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    partySize: 3,
    location: "Lagos",
  });
}

test("AC1: a valid discovery artifact produces valid A2UI v0.9.1 messages", () => {
  const messages = discoveryArtifactToA2UI({ artifact: datedArtifact(), surfaceId: SURFACE_ID });
  assert.deepEqual(messages.map((message) => message.version), ["v0.9.1", "v0.9.1"]);
  processMessages(messages);
});

test("AC2: a non-empty artifact resolves to a ready Weaver surface with meaningful Unit content", () => {
  const runtime = processMessages(discoveryArtifactToA2UI({ artifact: datedArtifact(), surfaceId: SURFACE_ID }));
  const surface = runtime.resolveSurface(SURFACE_ID);
  assert.equal(surface.ok, true);
  if (!surface.ok) throw new Error("Surface resolution failed");
  assert.equal(surface.value.tree.ready, true);
  const text = resolvedText(runtime).join("\n");
  assert.match(text, /1 eligible Unit/);
  assert.match(text, /Sunlit 2-bedroom apartment in Ikeja/);
  assert.match(text, /Ikeja, Lagos/);
  assert.match(text, /4 guests/);
  assert.match(text, /wifi, generator, parking/);
  assert.match(text, /Inspection: current/);
});

test("AC3: dated pricing displays the canonical All-In Stay Total", () => {
  const artifact = datedArtifact();
  assert.equal(artifact.facts.results[0].price.allInStayTotalKobo, 18_000_000);
  const text = resolvedText(processMessages(discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID }))).join("\n");
  assert.match(text, /All-In Stay Total: ₦180,000/);
  assert.doesNotMatch(text, /All-In Stay Total: ₦85,000/);
});

test("AC4: undated pricing is clearly indicative", () => {
  const artifact = createQuery().search({ location: "Lagos" });
  assert.equal(artifact.facts.results[0].price.allInStayTotalKobo, null);
  const text = resolvedText(processMessages(discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID }))).join("\n");
  assert.match(text, /Indicative nightly rate: ₦85,000/);
  assert.doesNotMatch(text, /All-In Stay Total: ₦85,000/);
  assert.match(text, /Rates without dates and party size are indicative/);
});

test("AC5: a zero-result artifact resolves successfully without View Unit actions", () => {
  const artifact = createQuery().search({ location: "Abuja" });
  const messages = discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID });
  const runtime = processMessages(messages);
  assert.equal(runtime.resolveSurface(SURFACE_ID).ok, true);
  assert.match(resolvedText(runtime).join("\n"), /No eligible Units match those requirements/);
  assert.equal(updateComponents(messages).some((component) => component.component === "Button"), false);
});

test("AC6: the View Unit event contains only approved correlation context", () => {
  const artifact = datedArtifact();
  const buttons = updateComponents(discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID }))
    .filter((component) => component.component === "Button");
  assert.equal(buttons.length, 1);
  assert.deepEqual(buttons[0].action, {
    event: {
      name: "shortlet.discovery.view-unit",
      context: { artifactId: artifact.id, unitId: "unit-lagos-001" },
    },
  });
});

test("AC7: the presenter does not mutate the frozen artifact", () => {
  const artifact = datedArtifact();
  const before = structuredClone(artifact);
  discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID });
  assert.deepEqual(artifact, before);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.facts.results[0]), true);
});

test("AC8: the presenter is deterministic", () => {
  const artifact = datedArtifact();
  assert.deepEqual(
    discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID }),
    discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID }),
  );
});

test("AC9: the conventional artifact remains unchanged after A2UI conversion", () => {
  const artifact = datedArtifact();
  const before = structuredClone(artifact);
  discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID });
  assert.deepEqual(artifact, before);
  assert.equal(artifact.actions[0].conventionalRoute, "/stays/unit-lagos-001");
});

test("AC10: the generated surface uses the canonical Basic Catalog identifier", () => {
  const [message] = discoveryArtifactToA2UI({ artifact: datedArtifact(), surfaceId: SURFACE_ID });
  assert.ok("createSurface" in message);
  assert.equal(message.createSurface.catalogId, A2UI_V091_BASIC_CATALOG_ID);
});
