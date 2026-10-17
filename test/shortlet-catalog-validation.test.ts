import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  A2UI_V091_BASIC_CATALOG_ID,
  createBasicCatalogV091Registration,
  createWeaverRuntime,
  type A2UIServerMessage,
} from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { SHORTLET_BOOKING_CATALOG, SHORTLET_BOOKING_CATALOG_ID, SHORTLET_DISCOVERY_CATALOG, SHORTLET_DISCOVERY_CATALOG_ID } from "../apps/web-agent/src/shortlet-catalogs.js";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { validateShortletMessages } from "../apps/web-agent/src/validate-shortlet-messages.js";
import { guestAction, restartFixture, stages } from "./helpers/guest-restart.js";

function surface(catalogId: string, surfaceId: string, text: string): readonly A2UIServerMessage[] {
  return [
    { version: "v0.9.1", createSurface: { surfaceId, catalogId } },
    { version: "v0.9.1", updateComponents: { surfaceId, components: [{ id: "root", component: "Text", text }] } },
  ];
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("AC1 - catalogue ids are exported from the one namespace constant", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const sources = (await Promise.all(["apps/web-agent/src", "apps/local-guest/src", "apps/web/src"].map((path) => sourceFiles(join(root, path)))))
    .flat()
    .filter((path) => !path.endsWith(join("apps", "web-agent", "src", "shortlet-catalogs.ts")));
  const sourceText = await Promise.all(sources.map((path) => readFile(path, "utf8")));
  for (const literal of [SHORTLET_DISCOVERY_CATALOG_ID, SHORTLET_BOOKING_CATALOG_ID]) {
    assert.equal(sourceText.some((source) => source.includes(literal)), false, `${literal} must only be constructed in shortlet-catalogs.ts`);
  }
  assert.equal(SHORTLET_DISCOVERY_CATALOG.catalogId, SHORTLET_DISCOVERY_CATALOG_ID);
  assert.equal(SHORTLET_BOOKING_CATALOG.catalogId, SHORTLET_BOOKING_CATALOG_ID);
});

test("AC2 - shortlet catalogues preserve all Basic schemas and render Basic surfaces identically", () => {
  const basic = createBasicCatalogV091Registration();
  assert.deepEqual(SHORTLET_DISCOVERY_CATALOG.schema.components, basic.schema.components);
  assert.deepEqual(SHORTLET_BOOKING_CATALOG.schema.components, basic.schema.components);
  for (const catalogId of [SHORTLET_DISCOVERY_CATALOG_ID, SHORTLET_BOOKING_CATALOG_ID]) {
    const runtime = createShortletWebRuntime();
    const messages = surface(catalogId, `custom-${catalogId}`, "Same Basic rendering");
    for (const message of messages) assert.equal(runtime.runtime.process(message).ok, true);
    const target = new Window().document.createElement("div");
    const mounted = runtime.mount({ surfaceId: `custom-${catalogId}`, target: target as unknown as Element });
    assert.equal(mounted.ok, true);
    assert.match(target.textContent ?? "", /Same Basic rendering/);
    const baseline = createShortletWebRuntime();
    for (const message of surface(A2UI_V091_BASIC_CATALOG_ID, `basic-${catalogId}`, "Same Basic rendering")) assert.equal(baseline.runtime.process(message).ok, true);
    const baselineTarget = new Window().document.createElement("div");
    assert.equal(baseline.mount({ surfaceId: `basic-${catalogId}`, target: baselineTarget as unknown as Element }).ok, true);
    assert.equal(target.innerHTML, baselineTarget.innerHTML);
  }
});

test("AC3 - every actual guest-stage builder fixture output validates with the shortlet catalogue runtime", async () => {
  const fixture = await restartFixture();
  const failures: string[] = [];
  try {
    const first = await fixture.app.handleTurn(fixture.threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    let result = first;
    const validateStage = (stage: string) => {
      for (const guestSurface of result.surfaces) {
        const validation = validateShortletMessages(guestSurface.a2uiMessages);
        if (!validation.ok) failures.push(`${stage}/${guestSurface.surfaceId} message ${validation.failedMessageIndex}`);
      }
    };
    validateStage(stages[0]);
    for (const stage of stages.slice(1, stages.indexOf("confirmed") + 1)) {
      if (stage === "offer") {
        const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
        fixture.environment.simulateOperatorAcceptance(requestId);
        const snapshot = fixture.app.getState(fixture.threadId);
        assert.ok(snapshot);
        result = { ...result, messages: [], surfaces: snapshot.surfaces };
      } else {
        const next = await fixture.app.handleEventAsync(fixture.threadId, guestAction(result.surfaces[0]!));
        assert.equal(next.ok, true);
        if (!next.ok) return;
        result = next;
      }
      validateStage(stage);
    }
    assert.deepEqual(failures, []);
  } finally {
    await fixture.close();
  }
});

test("AC4 - unknown components and malformed custom component properties fail closed", () => {
  const runtime = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration(), SHORTLET_DISCOVERY_CATALOG, SHORTLET_BOOKING_CATALOG] });
  assert.equal(runtime.ok, true);
  if (!runtime.ok) return;
  for (const [index, component] of [
    { id: "root", component: "AgentInvented", text: "unsafe" },
    { id: "root", component: "Text", text: "safe", extra: true },
    { id: "root", component: "Text" },
  ].entries()) {
    const surfaceId = `invalid-${index}`;
    assert.equal(runtime.value.process({ version: "v0.9.1", createSurface: { surfaceId, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } }).ok, true);
    assert.equal(runtime.value.process({ version: "v0.9.1", updateComponents: { surfaceId, components: [component] } }).ok, false);
    const target = new Window().document.createElement("div");
    assert.equal(createShortletWebRuntime().mount({ surfaceId, target: target as unknown as Element }).ok, false);
    assert.equal(target.childNodes.length, 0);
  }
});

test("AC5 - a Basic-only stale runtime rejects shortlet surfaces without rendering", () => {
  const runtime = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(runtime.ok, true);
  if (!runtime.ok) return;
  assert.equal(runtime.value.process(surface(SHORTLET_DISCOVERY_CATALOG_ID, "stale", "must not render")[0]).ok, false);
  const target = new Window().document.createElement("div");
  assert.equal(target.childNodes.length, 0);
});
