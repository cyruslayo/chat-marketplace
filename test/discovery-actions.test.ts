import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebServerEventHandoff } from "@weaver/web";
import { Window } from "happy-dom";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import {
  createDiscoveryServerEventHandler,
  createWeaverWebHost,
  resolveDiscoveryServerEvent,
  type AuthoritativeDiscoveryArtifact,
  type DiscoveryRouteEffect,
  type DiscoveryServerEventRejection,
} from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const ARTIFACT_ID = "search-task-5-artifact";
const UNIT_ID = "unit-lagos-001";

function discoveryArtifact(): ReturnType<UnitDiscoveryQuery["search"]> & AuthoritativeDiscoveryArtifact {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const artifact = new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => "task-5-artifact",
  }).search({ location: "Lagos" });
  return artifact as unknown as ReturnType<UnitDiscoveryQuery["search"]> & AuthoritativeDiscoveryArtifact;
}

function event(context: unknown = { artifactId: ARTIFACT_ID, unitId: UNIT_ID }, name = "shortlet.discovery.view-unit"): WebServerEventHandoff {
  return {
    message: {
      version: "v0.9.1",
      action: {
        name,
        surfaceId: "task-5-surface",
        sourceComponentId: `unit-${UNIT_ID}-view-button`,
        timestamp: "2026-07-22T00:00:00.000Z",
        context,
      },
    },
  } as unknown as WebServerEventHandoff;
}

function assertRejected(result: ReturnType<typeof resolveDiscoveryServerEvent>, code: DiscoveryServerEventRejection["code"]): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, code);
  assert.equal("effect" in result, false);
}

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
}

test("AC1 — Valid event resolves trusted route", () => {
  const artifact = discoveryArtifact();
  const action = artifact.actions.find((candidate) => candidate.type === "view-unit" && candidate.unitId === UNIT_ID);
  assert.ok(action);
  const result = resolveDiscoveryServerEvent({ event: event(), artifact });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.effect.unitId, UNIT_ID);
  assert.equal(result.effect.artifactId, artifact.id);
  assert.equal(result.effect.route, action.conventionalRoute);
});

test("AC2 — Route never comes from client context", () => {
  const maliciousRoute = "https://evil.example";
  for (const routeField of ["route", "conventionalRoute"]) {
    const result = resolveDiscoveryServerEvent({
      event: event({ artifactId: ARTIFACT_ID, unitId: UNIT_ID, [routeField]: maliciousRoute }),
      artifact: discoveryArtifact(),
    });
    assertRejected(result, "INVALID_CONTEXT");
    assert.equal(JSON.stringify(result).includes(maliciousRoute), false);
  }
});

test("AC3 — Artifact mismatch fails closed", () => {
  assertRejected(resolveDiscoveryServerEvent({
    event: event({ artifactId: "search-other", unitId: UNIT_ID }),
    artifact: discoveryArtifact(),
  }), "ARTIFACT_MISMATCH");
});

test("AC4 — Unknown Unit fails closed", () => {
  assertRejected(resolveDiscoveryServerEvent({
    event: event({ artifactId: ARTIFACT_ID, unitId: "unit-not-authorized" }),
    artifact: discoveryArtifact(),
  }), "ACTION_NOT_AUTHORIZED");
});

test("AC5 — Unsupported action fails closed", () => {
  assertRejected(resolveDiscoveryServerEvent({ event: event(undefined, "shortlet.discovery.other"), artifact: discoveryArtifact() }), "UNSUPPORTED_ACTION");
});

test("AC6 — Missing or malformed context fails closed", () => {
  const artifact = discoveryArtifact();
  for (const context of [{ unitId: UNIT_ID }, { artifactId: ARTIFACT_ID }, { artifactId: ARTIFACT_ID, unitId: 42 }]) {
    assertRejected(resolveDiscoveryServerEvent({ event: event(context), artifact }), "INVALID_CONTEXT");
  }
});

test("AC7 — Unsafe authoritative route fails closed", () => {
  const artifact = discoveryArtifact();
  for (const route of [`https://evil.example/stays/${UNIT_ID}`, `//evil.example/stays/${UNIT_ID}`]) {
    const unsafeArtifact: AuthoritativeDiscoveryArtifact = {
      id: artifact.id,
      kind: artifact.kind,
      schemaVersion: artifact.schemaVersion,
      projectionVersion: artifact.projectionVersion,
      actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: route }],
    };
    assertRejected(resolveDiscoveryServerEvent({ event: event(), artifact: unsafeArtifact }), "INVALID_ROUTE");
  }
});

test("AC13 — Raw dot-segment traversal is rejected", () => {
  const artifact = discoveryArtifact();
  const unsafeArtifact: AuthoritativeDiscoveryArtifact = {
    ...artifact,
    actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: "/stays/../admin" }],
  };
  assertRejected(resolveDiscoveryServerEvent({ event: event(), artifact: unsafeArtifact }), "INVALID_ROUTE");
});

test("AC14 — Percent-encoded dot traversal is rejected regardless of encoding case", () => {
  const artifact = discoveryArtifact();
  for (const route of ["/stays/%2e%2e/admin", "/stays/%2E%2E/admin"]) {
    const unsafeArtifact: AuthoritativeDiscoveryArtifact = {
      ...artifact,
      actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: route }],
    };
    assertRejected(resolveDiscoveryServerEvent({ event: event(), artifact: unsafeArtifact }), "INVALID_ROUTE");
  }
});

test("AC15 — Unit and normalized route identity must agree", () => {
  const artifact = discoveryArtifact();
  const mismatchedArtifact: AuthoritativeDiscoveryArtifact = {
    ...artifact,
    actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: "/stays/some-other-unit" }],
  };
  assertRejected(resolveDiscoveryServerEvent({ event: event(), artifact: mismatchedArtifact }), "INVALID_ROUTE");
});

test("AC16 — Canonical same-Unit route succeeds unchanged", () => {
  const artifact = discoveryArtifact();
  const route = `/stays/${UNIT_ID}`;
  const canonicalArtifact: AuthoritativeDiscoveryArtifact = {
    ...artifact,
    actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: route }],
  };
  const result = resolveDiscoveryServerEvent({ event: event(), artifact: canonicalArtifact });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.effect.route, route);
});

test("AC18 — Query strings and fragments are permitted only on the canonical same-Unit pathname", () => {
  const artifact = discoveryArtifact();
  for (const route of [`/stays/${UNIT_ID}?source=agent`, `/stays/${UNIT_ID}#details`]) {
    const routedArtifact: AuthoritativeDiscoveryArtifact = {
      ...artifact,
      actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: route }],
    };
    const result = resolveDiscoveryServerEvent({ event: event(), artifact: routedArtifact });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.effect.route, route);
  }
});

test("AC19 — WHATWG URL parsing normalizes encoded traversal outside the stays route", () => {
  assert.equal(new URL("/stays/%2e%2e/admin", "https://app.example").pathname, "/admin");
});

test("Route validation rejects empty, malformed, non-relative, and backslash-normalized inputs", () => {
  const artifact = discoveryArtifact();
  for (const route of ["", "   ", `stays/${UNIT_ID}`, "%", `/stays/..\\admin`, `/stays/%2e%2e\\admin`]) {
    const unsafeArtifact: AuthoritativeDiscoveryArtifact = {
      ...artifact,
      actions: [{ type: "view-unit", unitId: UNIT_ID, conventionalRoute: route }],
    };
    assertRejected(resolveDiscoveryServerEvent({ event: event(), artifact: unsafeArtifact }), "INVALID_ROUTE");
  }
});

test("AC8 — Resolver is pure", () => {
  const artifact = discoveryArtifact();
  const inputEvent = event();
  const beforeEvent = structuredClone(inputEvent);
  const beforeArtifact = structuredClone(artifact);
  deepFreeze(inputEvent);
  deepFreeze(artifact);
  assert.equal(resolveDiscoveryServerEvent({ event: inputEvent, artifact }).ok, true);
  assert.deepEqual(inputEvent, beforeEvent);
  assert.deepEqual(artifact, beforeArtifact);
});

test("AC9 — Handler loads artifact through host boundary", () => {
  const artifact = discoveryArtifact();
  const requested: string[] = [];
  const effects: DiscoveryRouteEffect[] = [];
  const rejected: DiscoveryServerEventRejection[] = [];
  const handler = createDiscoveryServerEventHandler({
    getArtifact: (artifactId) => { requested.push(artifactId); return artifact; },
    onEffect: (effect) => effects.push(effect),
    onRejected: (failure) => rejected.push(failure),
  });
  handler(event());
  assert.deepEqual(requested, [ARTIFACT_ID]);
  assert.equal(effects.length, 1);
  assert.equal(rejected.length, 0);
});

test("AC10 — Missing artifact is rejected", () => {
  const effects: DiscoveryRouteEffect[] = [];
  const rejected: DiscoveryServerEventRejection[] = [];
  createDiscoveryServerEventHandler({
    getArtifact: () => undefined,
    onEffect: (effect) => effects.push(effect),
    onRejected: (failure) => rejected.push(failure),
  })(event());
  assert.equal(effects.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.code, "INVALID_ARTIFACT");
});

test("AC11 — Malformed event never calls artifact loader when artifactId cannot be safely extracted", () => {
  let calls = 0;
  const rejected: DiscoveryServerEventRejection[] = [];
  createDiscoveryServerEventHandler({
    getArtifact: () => { calls += 1; return discoveryArtifact(); },
    onEffect: () => assert.fail("effect must not be called"),
    onRejected: (failure) => rejected.push(failure),
  })(event({ unitId: UNIT_ID }));
  assert.equal(calls, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.code, "INVALID_CONTEXT");
});

test("AC12 — Real Weaver click resolves through handler", () => {
  const artifact = discoveryArtifact();
  const authorizedAction = artifact.actions.find((candidate) => candidate.type === "view-unit" && candidate.unitId === UNIT_ID);
  assert.ok(authorizedAction);
  const effects: DiscoveryRouteEffect[] = [];
  const handler = createDiscoveryServerEventHandler({
    getArtifact: (artifactId) => artifactId === artifact.id ? artifact : undefined,
    onEffect: (effect) => effects.push(effect),
  });
  const host = createWeaverWebHost({ onServerEvent: handler });
  const processed = host.process(discoveryArtifactToA2UI({ artifact, surfaceId: "task-5-real-click" }));
  assert.equal(processed.ok, true);
  const window = new Window({ url: "https://app.example/stays/search" });
  const target = window.document.createElement("div") as unknown as Element;
  assert.equal(host.mount({ surfaceId: "task-5-real-click", target }).ok, true);
  const button = [...target.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("View Unit"));
  assert.ok(button);
  const locationBefore = window.location.href;
  button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
  assert.deepEqual(effects, [{
    kind: "open-conventional-route",
    route: authorizedAction.conventionalRoute,
    artifactId: artifact.id,
    unitId: UNIT_ID,
  }]);
  assert.equal(window.location.href, locationBefore);
});

test("View Unit is a presentation effect and does not use PlatformCommandEnvelope", () => {
  const source = readFileSync(new URL("../apps/web/src/discovery-actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /platform-core|PlatformCommandEnvelope|createPlatformCommandEnvelope/);
  const result = resolveDiscoveryServerEvent({ event: event(), artifact: discoveryArtifact() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.effect).sort(), ["artifactId", "kind", "route", "unitId"]);
});
