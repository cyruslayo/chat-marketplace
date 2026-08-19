import assert from "node:assert/strict";
import test from "node:test";
import { A2UI_V091_BASIC_CATALOG_ID, type A2UIServerMessage } from "@weaver/core";
import { type BasicResourcePolicy, type WebServerEventHandoff } from "@weaver/web";
import { Window } from "happy-dom";
import { discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { createWeaverWebHost } from "../apps/web/src/index.js";
import { UnitDiscoveryQuery, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

const FIXED_NOW = new Date("2026-07-22T00:00:00Z");
const DISCOVERY_SURFACE_ID = "task-4-discovery-surface";

function createQuery(): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return new UnitDiscoveryQuery({
    repository,
    audit: new InMemoryAuditLog(),
    telemetry: new InMemoryTelemetry(),
    clock: () => FIXED_NOW,
    idFactory: () => "task-4-artifact",
  });
}

function datedArtifact() {
  return createQuery().search({
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    partySize: 3,
    location: "Lagos",
  });
}

function targetElement(): { window: Window; target: Element } {
  const window = new Window();
  return { window, target: window.document.createElement("div") as unknown as Element };
}

function processSuccessfully(host: ReturnType<typeof createWeaverWebHost>, messages: readonly A2UIServerMessage[]): void {
  const result = host.process(messages);
  if (!result.ok) assert.fail(JSON.stringify(result.error));
}

function simpleTextSurface(surfaceId: string, text: string): readonly A2UIServerMessage[] {
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components: [
      { id: "root", component: "Text", text },
    ] } },
  ];
}

function imageSurface(surfaceId: string, urls: readonly string[]): readonly A2UIServerMessage[] {
  const imageIds = urls.map((_, index) => `image-${index}`);
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components: [
      { id: "root", component: "Column", children: imageIds },
      ...urls.map((url, index) => ({ id: imageIds[index]!, component: "Image" as const, url, description: `Test image ${index}` })),
    ] } },
  ];
}

test("AC1 — Host creation", () => {
  const host = createWeaverWebHost({ onServerEvent: () => undefined });
  assert.equal(host.catalogId, A2UI_V091_BASIC_CATALOG_ID);
});

test("AC2 — Real discovery rendering", () => {
  const host = createWeaverWebHost({});
  processSuccessfully(host, discoveryArtifactToA2UI({ artifact: datedArtifact(), surfaceId: DISCOVERY_SURFACE_ID }));
  const { target } = targetElement();
  const mounted = host.mount({ surfaceId: DISCOVERY_SURFACE_ID, target });
  assert.equal(mounted.ok, true);
  assert.match(target.textContent ?? "", /Sunlit 2-bedroom apartment in Ikeja/);
  assert.match(target.textContent ?? "", /Ikeja, Lagos/);
  assert.match(target.textContent ?? "", /All-In Stay Total: ₦180,000/);
  assert.match(target.textContent ?? "", /View Unit/);
});

test("AC3 — View Unit event handoff", () => {
  const events: WebServerEventHandoff[] = [];
  const host = createWeaverWebHost({ onServerEvent: (event) => events.push(event) });
  const artifact = datedArtifact();
  processSuccessfully(host, discoveryArtifactToA2UI({ artifact, surfaceId: DISCOVERY_SURFACE_ID }));
  const { window, target } = targetElement();
  assert.equal(host.mount({ surfaceId: DISCOVERY_SURFACE_ID, target }).ok, true);
  const button = [...target.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("View Unit"));
  assert.ok(button);
  button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
  assert.equal(events.length, 1);
  assert.equal(events[0].message.action.name, "shortlet.discovery.view-unit");
  assert.deepEqual(events[0].message.action.context, {
    artifactId: artifact.id,
    unitId: "unit-lagos-001",
  });
  assert.equal("unit" in events[0].message.action.context, false);
});

test("AC4 — Zero results", () => {
  const host = createWeaverWebHost({});
  const artifact = createQuery().search({ location: "Abuja" });
  processSuccessfully(host, discoveryArtifactToA2UI({ artifact, surfaceId: DISCOVERY_SURFACE_ID }));
  const { target } = targetElement();
  assert.equal(host.mount({ surfaceId: DISCOVERY_SURFACE_ID, target }).ok, true);
  assert.match(target.textContent ?? "", /No eligible Units match those requirements/);
  assert.equal([...target.querySelectorAll("button")].some((button) => button.textContent?.includes("View Unit")), false);
});

test("AC5 — Invalid A2UI fails closed", () => {
  const host = createWeaverWebHost({});
  const invalid = { version: "v0.9.1", createSurface: { surfaceId: "invalid" } } as unknown as A2UIServerMessage;
  const laterSurfaceId = "must-not-be-processed";
  const result = host.process([invalid, ...simpleTextSurface(laterSurfaceId, "observable later message")]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failedMessageIndex, 0);
  assert.ok(result.error);
  const { target } = targetElement();
  assert.equal(host.mount({ surfaceId: laterSurfaceId, target }).ok, false);
  assert.doesNotMatch(target.textContent ?? "", /observable later message/);
});

test("AC6 — Mount isolation", () => {
  const first = createWeaverWebHost({});
  const second = createWeaverWebHost({});
  const sharedSurfaceId = "isolated-surface";
  processSuccessfully(first, simpleTextSurface(sharedSurfaceId, "first host only"));
  processSuccessfully(second, simpleTextSurface(sharedSurfaceId, "second host only"));
  const firstTarget = targetElement().target;
  const secondTarget = targetElement().target;
  assert.equal(first.mount({ surfaceId: sharedSurfaceId, target: firstTarget }).ok, true);
  assert.equal(second.mount({ surfaceId: sharedSurfaceId, target: secondTarget }).ok, true);
  assert.match(firstTarget.textContent ?? "", /first host only/);
  assert.doesNotMatch(firstTarget.textContent ?? "", /second host only/);
  assert.match(secondTarget.textContent ?? "", /second host only/);
  assert.doesNotMatch(secondTarget.textContent ?? "", /first host only/);
});

test("AC7 — Media remains denied by default", () => {
  const host = createWeaverWebHost({});
  const surfaceId = "default-denied-image";
  const untrustedUrl = "https://untrusted.example/image.jpg";
  processSuccessfully(host, imageSurface(surfaceId, [untrustedUrl]));
  const { target } = targetElement();
  assert.equal(host.mount({ surfaceId, target }).ok, true);
  const image = target.querySelector("img");
  assert.ok(image);
  assert.notEqual(image.getAttribute("src"), untrustedUrl);
  assert.equal(image.getAttribute("data-a2ui-resource-state"), "blocked");
});

test("AC8 — Explicit policy is respected", () => {
  const approvedUrl = "https://media.example/approved.jpg";
  const blockedUrl = "https://media.example/blocked.jpg";
  const resourcePolicy: BasicResourcePolicy = ({ kind, url }) => kind === "image" && url === approvedUrl ? url : undefined;
  const host = createWeaverWebHost({ resourcePolicy });
  const surfaceId = "narrow-policy-images";
  processSuccessfully(host, imageSurface(surfaceId, [approvedUrl, blockedUrl]));
  const { target } = targetElement();
  assert.equal(host.mount({ surfaceId, target }).ok, true);
  const images = [...target.querySelectorAll("img")];
  assert.equal(images.length, 2);
  assert.equal(images[0].getAttribute("src"), approvedUrl);
  assert.notEqual(images[1].getAttribute("src"), blockedUrl);
  assert.equal(images[1].getAttribute("data-a2ui-resource-state"), "blocked");
});
