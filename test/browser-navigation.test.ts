import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebServerEventHandoff } from "@weaver/web";
import { Window } from "happy-dom";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import {
  createBrowserNavigator,
  createDiscoveryInteractions,
  createWeaverWebHost,
  type AuthoritativeDiscoveryArtifact,
  type DiscoveryServerEventRejection,
} from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const SURFACE_ID = "task-7-browser-navigation";
const UNIT_ID = "unit-lagos-001";
const START_URL = "https://app.example/stays/search";

function discoveryArtifact(): ReturnType<UnitDiscoveryQuery["search"]> & AuthoritativeDiscoveryArtifact {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const artifact = new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => "task-7-artifact",
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

function authorizedAction(artifact: ReturnType<typeof discoveryArtifact>) {
  const action = artifact.actions.find((candidate) => candidate.type === "view-unit" && candidate.unitId === UNIT_ID);
  assert.ok(action);
  return action;
}

function createBrowserFlow() {
  const artifact = discoveryArtifact();
  const window = new Window({ url: START_URL });
  const rejections: DiscoveryServerEventRejection[] = [];
  const interactions = createDiscoveryInteractions({
    getArtifact: (artifactId) => artifactId === artifact.id ? artifact : undefined,
    navigator: createBrowserNavigator({ location: window.location }),
    onRejected: (rejection) => rejections.push(rejection),
  });
  const host = createWeaverWebHost({ onServerEvent: interactions.onServerEvent });
  assert.equal(host.process(discoveryArtifactToA2UI({ artifact, surfaceId: SURFACE_ID })).ok, true);
  const target = window.document.createElement("div") as unknown as Element;
  assert.equal(host.mount({ surfaceId: SURFACE_ID, target }).ok, true);
  return { artifact, host, interactions, rejections, target, window };
}

test("AC1 — Browser adapter implements ApplicationNavigator", () => {
  const assigned: string[] = [];
  const navigator = createBrowserNavigator({ location: { assign: (url) => assigned.push(url) } });
  navigator.openInternalRoute("/stays/unit-lagos-001");
  assert.deepEqual(assigned, ["/stays/unit-lagos-001"]);
});

test("AC2 — No route derivation occurs", () => {
  const route = "/stays/unit-lagos-001?source=conversation";
  const assigned: string[] = [];
  createBrowserNavigator({ location: { assign: (url) => assigned.push(url) } }).openInternalRoute(route);
  assert.deepEqual(assigned, [route]);
});

test("AC3 — Real browser Location can be supplied", () => {
  const window = new Window({ url: START_URL });
  createBrowserNavigator({ location: window.location }).openInternalRoute("/stays/unit-lagos-001");
  assert.equal(window.location.pathname, "/stays/unit-lagos-001");
});

test("AC4 — Complete Weaver flow performs actual browser navigation", () => {
  const { artifact, target, window } = createBrowserFlow();
  const action = authorizedAction(artifact);
  const button = [...target.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("View Unit"));
  assert.ok(button);
  button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
  assert.equal(window.location.pathname, new URL(action.conventionalRoute, START_URL).pathname);
});

test("AC5 — Rejected event cannot navigate browser", () => {
  const { artifact, interactions, rejections, window } = createBrowserFlow();
  interactions.onServerEvent(event(artifact.id, "unauthorized-unit"));
  assert.equal(window.location.href, START_URL);
  assert.equal(rejections[0]?.code, "ACTION_NOT_AUTHORIZED");
});

test("AC6 — Malicious client route cannot navigate browser", () => {
  const { artifact, interactions, rejections, window } = createBrowserFlow();
  interactions.onServerEvent(event(artifact.id, UNIT_ID, {
    artifactId: artifact.id,
    unitId: UNIT_ID,
    route: "https://evil.example",
  }));
  assert.equal(rejections[0]?.code, "INVALID_CONTEXT");
  assert.equal(window.location.href, START_URL);
  assert.notEqual(window.location.origin, "https://evil.example");
});

test("AC7 — Browser adapter is presentation infrastructure only", () => {
  const source = readFileSync(new URL("../apps/web/src/browser-navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@weaver\/core|@weaver\/web|domains\/shortlet|packages\/platform-core|createPlatformCommandEnvelope/);
});

test("AC8 — No routing framework", () => {
  const source = readFileSync(new URL("../apps/web/src/browser-navigation.ts", import.meta.url), "utf8");
  const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(`${source}\n${packageJson}`, /react-router|next\/router|next\/navigation|vue-router|@angular\/router/i);
});
