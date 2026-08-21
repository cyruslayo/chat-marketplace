import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebServerEventHandoff } from "@weaver/web";
import { Window } from "happy-dom";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import {
  createDiscoveryInteractions,
  createWeaverWebHost,
  executeDiscoveryNavigationEffect,
  resolveDiscoveryServerEvent,
  type ApplicationNavigator,
  type AuthoritativeDiscoveryArtifact,
  type DiscoveryServerEventRejection,
} from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const SURFACE_ID = "task-6-discovery-surface";
const UNIT_ID = "unit-lagos-001";

function discoveryArtifact(): ReturnType<UnitDiscoveryQuery["search"]> & AuthoritativeDiscoveryArtifact {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const artifact = new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => "task-6-artifact",
  }).search({ location: "Lagos" });
  return artifact as unknown as ReturnType<UnitDiscoveryQuery["search"]> & AuthoritativeDiscoveryArtifact;
}

function event(artifactId: string, unitId: string, context: unknown = { artifactId, unitId }): WebServerEventHandoff {
  return {
    message: {
      version: "v0.9.1",
      action: {
        name: "shortlet.discovery.view-unit",
        surfaceId: SURFACE_ID,
        sourceComponentId: `unit-${unitId}-view-button`,
        timestamp: FIXED_NOW.toISOString(),
        context,
      },
    },
  } as unknown as WebServerEventHandoff;
}

class RecordingNavigator implements ApplicationNavigator {
  readonly routes: string[] = [];
  openInternalRoute(route: string): void { this.routes.push(route); }
}

function authorizedAction(artifact: ReturnType<typeof discoveryArtifact>) {
  const action = artifact.actions.find((candidate) => candidate.type === "view-unit" && candidate.unitId === UNIT_ID);
  assert.ok(action);
  return action;
}

test("AC1 — Trusted effect invokes navigator", () => {
  const artifact = discoveryArtifact();
  const action = authorizedAction(artifact);
  const result = resolveDiscoveryServerEvent({ event: event(artifact.id, UNIT_ID), artifact });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const navigator = new RecordingNavigator();
  executeDiscoveryNavigationEffect({ effect: result.effect, navigator });
  assert.deepEqual(navigator.routes, [action.conventionalRoute]);
  assert.equal(navigator.routes[0], result.effect.route);
});

test("AC2 — Composition exposes Weaver-compatible callback", () => {
  const artifact = discoveryArtifact();
  const interactions = createDiscoveryInteractions({ getArtifact: () => artifact, navigator: new RecordingNavigator() });
  const host = createWeaverWebHost({ onServerEvent: interactions.onServerEvent });
  assert.ok(host.catalogId);
  assert.deepEqual(Object.keys(interactions), ["onServerEvent"]);
});

test("AC3 — Real Weaver click reaches navigator", () => {
  const artifact = discoveryArtifact();
  const action = authorizedAction(artifact);
  const navigator = new RecordingNavigator();
  const { onServerEvent } = createDiscoveryInteractions({
    getArtifact: (artifactId) => artifactId === artifact.id ? artifact : undefined,
    navigator,
  });
  const host = createWeaverWebHost({ onServerEvent });
  assert.equal(host.process(discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID })).ok, true);
  const window = new Window({ url: "https://app.example/stays/search" });
  const target = window.document.createElement("div") as unknown as Element;
  assert.equal(host.mount({ surfaceId: SURFACE_ID, target }).ok, true);
  const button = [...target.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("View Unit"));
  assert.ok(button);
  button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
  assert.deepEqual(navigator.routes, [action.conventionalRoute]);
});

test("AC4 — Rejected event never navigates", () => {
  const artifact = discoveryArtifact();
  const navigator = new RecordingNavigator();
  const rejections: DiscoveryServerEventRejection[] = [];
  const { onServerEvent } = createDiscoveryInteractions({ getArtifact: () => artifact, navigator, onRejected: (value) => rejections.push(value) });
  onServerEvent(event(artifact.id, "unknown-unit"));
  assert.deepEqual(navigator.routes, []);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]?.code, "ACTION_NOT_AUTHORIZED");
});

test("AC5 — Artifact mismatch never navigates", () => {
  const artifact = discoveryArtifact();
  const navigator = new RecordingNavigator();
  const rejections: DiscoveryServerEventRejection[] = [];
  const { onServerEvent } = createDiscoveryInteractions({ getArtifact: () => artifact, navigator, onRejected: (value) => rejections.push(value) });
  onServerEvent(event("wrong-artifact", UNIT_ID));
  assert.deepEqual(navigator.routes, []);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]?.code, "ARTIFACT_MISMATCH");
});

test("AC6 — Malformed context never navigates", () => {
  const artifact = discoveryArtifact();
  const navigator = new RecordingNavigator();
  const rejections: DiscoveryServerEventRejection[] = [];
  let lookups = 0;
  const { onServerEvent } = createDiscoveryInteractions({
    getArtifact: () => { lookups += 1; return artifact; }, navigator, onRejected: (value) => rejections.push(value),
  });
  onServerEvent(event(artifact.id, UNIT_ID, { unitId: UNIT_ID }));
  assert.deepEqual(navigator.routes, []);
  assert.equal(lookups, 0);
  assert.equal(rejections[0]?.code, "INVALID_CONTEXT");
});

test("AC7 — Client-supplied route never navigates", () => {
  const artifact = discoveryArtifact();
  const navigator = new RecordingNavigator();
  const rejections: DiscoveryServerEventRejection[] = [];
  const maliciousRoute = "https://evil.example";
  const { onServerEvent } = createDiscoveryInteractions({ getArtifact: () => artifact, navigator, onRejected: (value) => rejections.push(value) });
  onServerEvent(event(artifact.id, UNIT_ID, { artifactId: artifact.id, unitId: UNIT_ID, route: maliciousRoute }));
  assert.equal(navigator.routes.includes(maliciousRoute), false);
  assert.deepEqual(navigator.routes, []);
  assert.equal(rejections[0]?.code, "INVALID_CONTEXT");
});

test("AC8 — Navigation port is framework-independent", () => {
  const source = readFileSync(new URL("../apps/web/src/navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@weaver\/core|@weaver\/web|domains\/shortlet|packages\/platform-core|react|next(?:\.js)?|vite/i);
});

test("AC9 — Composition does not use browser globals", () => {
  const sources = ["navigation.ts", "discovery-interactions.ts"].map((file) =>
    readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), "utf8")
  ).join("\n");
  assert.doesNotMatch(sources, /window\.location|document\.location|history\.pushState|history\.replaceState|window\.open/);
});

test("AC10 — View Unit still does not use PlatformCommandEnvelope", () => {
  const sources = ["navigation.ts", "discovery-interactions.ts"].map((file) =>
    readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), "utf8")
  ).join("\n");
  assert.doesNotMatch(sources, /createPlatformCommandEnvelope|packages\/platform-core|platform-core\/src\/envelope/);
});
