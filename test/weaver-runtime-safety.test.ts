import assert from "node:assert/strict";
import test from "node:test";
import {
  createBasicCatalogV091Registration,
  createWeaverRuntime,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import { createBasicWebRuntime } from "@cylayo/weaver-web";
import { renderWeaverSurfaceFallback } from "../apps/local-guest/src/surface-fallback.js";
import { compareArtifactToA2UI, discoveryArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { Window } from "happy-dom";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createLargestFixture() {
  const directory = mkdtempSync(join(tmpdir(), "weaver-safety-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "fixture.sqlite") });
  const first = environment.unitRepository.findAll()[0];
  assert.ok(first);
  environment.unitRepository.save({ ...first, id: "unit-lagos-ikoyi-003", title: "Garden 2-Bedroom Apartment in Old Ikoyi" });
  const artifact = environment.discoveryQuery.search({
    location: "Lagos",
    checkIn: "2026-09-10",
    checkOut: "2026-09-13",
    partySize: 2,
  });
  return {
    artifact,
    close() {
      environment.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function processMessages(runtime: { process(message: unknown): { ok: boolean; error?: unknown } }, messages: readonly A2UIServerMessage[]): void {
  for (const message of messages) {
    const result = runtime.process(message);
    assert.equal(result.ok, true, JSON.stringify(result.error));
  }
}

function runtimeWithDefaultBudgets() {
  const created = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("Weaver runtime creation failed");
  return created.value;
}

function containsBudgetFailure(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("code" in value && value.code === "RESOLUTION_BUDGET_EXCEEDED") return true;
  return Object.values(value).some(containsBudgetFailure);
}

test("AC4 — Existing largest discovery and comparison fixtures resolve within Weaver's default budgets", () => {
  const { artifact, close } = createLargestFixture();
  try {
    assert.equal(artifact.facts.results.length, 3, "the largest existing discovery fixture has three result cards");
    const discoveryMessages = discoveryArtifactToA2UI({ artifact, surfaceId: "largest-existing-discovery" });
    const compareMessages = compareArtifactToA2UI({
      artifact,
      unitIds: [artifact.facts.results[0]!.id, artifact.facts.results[1]!.id],
      surfaceId: "largest-existing-comparison",
    });

    for (const messages of [discoveryMessages, compareMessages]) {
      const runtime = runtimeWithDefaultBudgets();
      processMessages(runtime, messages);
      const surfaceId = messages.find((message) => "createSurface" in message);
      assert.ok(surfaceId && "createSurface" in surfaceId);
      const resolved = runtime.resolveSurface(surfaceId.createSurface.surfaceId);
      assert.equal(resolved.ok, true, resolved.ok ? "" : JSON.stringify(resolved.error));
      if (!resolved.ok) continue;
      assert.equal(resolved.value.tree.ready, true);
    }
  } finally {
    close();
  }
});

test("AC4 — A synthetic discovery larger than the host budget fails instead of rendering partial content", () => {
  const { artifact, close } = createLargestFixture();
  try {
    const oversizedArtifact = {
      ...artifact,
      facts: {
        ...artifact.facts,
        results: Array.from({ length: 100 }, (_, index) => ({ ...artifact.facts.results[0]!, id: `synthetic-unit-${index}` })),
      },
    };
    const messages = discoveryArtifactToA2UI({ artifact: oversizedArtifact, surfaceId: "synthetic-over-budget" });
    const runtime = runtimeWithDefaultBudgets();
    processMessages(runtime, messages);
    const resolved = runtime.resolveSurface("synthetic-over-budget");
    assert.equal(resolved.ok, false);
    assert.match(JSON.stringify(resolved), /RESOLUTION_BUDGET_EXCEEDED/);
  } finally {
    close();
  }
});

test("AC5 — A resolution budget failure shows complete text and a conventional route without partial content", () => {
  const { artifact, close } = createLargestFixture();
  try {
    const oversizedArtifact = {
      ...artifact,
      facts: {
        ...artifact.facts,
        results: Array.from({ length: 100 }, (_, index) => ({ ...artifact.facts.results[0]!, id: `default-budget-unit-${index}` })),
      },
    };
    const oversizedRuntime = runtimeWithDefaultBudgets();
    processMessages(oversizedRuntime, discoveryArtifactToA2UI({ artifact: oversizedArtifact, surfaceId: "over-default-budget" }));
    const oversizedResult = oversizedRuntime.resolveSurface("over-default-budget");
    assert.equal(oversizedResult.ok, false);
    assert.equal(containsBudgetFailure(oversizedResult), true);
  } finally {
    close();
  }

  const created = createBasicWebRuntime({ runtime: { safety: { maxResolvedInstances: 1 } } });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("Weaver web runtime creation failed");

  const messages: readonly A2UIServerMessage[] = [
    { version: "v0.9.1", createSurface: { surfaceId: "over-budget", catalogId: created.value.catalogId } },
    { version: "v0.9.1", updateComponents: { surfaceId: "over-budget", components: [
      { id: "root", component: "Column", children: ["visible-child", "overflow-child"] },
      { id: "visible-child", component: "Text", text: "must not render partially" },
      { id: "overflow-child", component: "Text", text: "over budget" },
    ] } },
  ];
  processMessages(created.value.runtime, messages);

  const window = new Window();
  const target = window.document.createElement("div") as unknown as HTMLElement;
  const resolved = created.value.runtime.resolveSurface("over-budget");
  assert.equal(resolved.ok, false);
  assert.equal(containsBudgetFailure(resolved), true);
  const mounted = created.value.mount({ surfaceId: "over-budget", target: target as unknown as Element });
  assert.equal(mounted.ok, false);
  if (!mounted.ok) assert.equal(mounted.error.code, "SURFACE_RESOLUTION_FAILED");
  renderWeaverSurfaceFallback({
    mount: target,
    text: "The full stay details remain available.",
    conventionalRoute: "/stays/unit-lagos-001",
    conventionalRouteLabel: "Open stay details",
  });
  assert.equal(target.dataset.renderer, "fallback");
  assert.equal(target.querySelector("p")?.textContent, "The full stay details remain available.");
  assert.equal((target.querySelector("a") as HTMLAnchorElement | null)?.getAttribute("href"), "/stays/unit-lagos-001");
  assert.equal(target.querySelectorAll("button").length, 0);
  assert.doesNotMatch(target.textContent ?? "", /must not render partially|over budget/);
});
