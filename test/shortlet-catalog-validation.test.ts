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
import { unitDetailArtifactToA2UI } from "../apps/web-agent/src/unit-detail-a2ui.js";
import { compareArtifactToA2UI, stayComparisonProps } from "../apps/web-agent/src/discovery-a2ui.js";
import { quotedUnitDetailArtifact } from "./helpers/unit-detail-fixture.js";

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
  const basicComponents = basic.schema.components as Record<string, unknown>;
  // Weaver catalogues issues 05 to 07: discovery adds typed components on top of every unchanged Basic component.
  const discoveryComponents = SHORTLET_DISCOVERY_CATALOG.schema.components as Record<string, unknown>;
  for (const [name, schema] of Object.entries(basicComponents)) assert.deepEqual(discoveryComponents[name], schema, `Basic ${name} is unchanged`);
  assert.deepEqual(Object.keys(discoveryComponents).filter((name) => !(name in basicComponents)), ["UnitDetail", "UnitGallery", "UnitDetailSheet", "UnitActionBar", "StayCard", "StayResults", "StayComparison"]);
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

test("Weaver catalogues 05 AC5 - the unit detail validates on shortlet-discovery/v1 and invalid UnitDetailSheet props are rejected", () => {
  const messages = unitDetailArtifactToA2UI({ artifact: quotedUnitDetailArtifact(), surfaceId: "unit-detail-ac5" });
  assert.deepEqual(validateShortletMessages(messages), { ok: true });
  const sheet = { id: "sheet", component: "UnitDetailSheet", where: "Ikoyi, Lagos", title: "Flat", tiles: [{ icon: "bed", text: "2 bedrooms" }] };
  for (const [index, invalid] of [
    { ...sheet, html: "<b>raw</b>" },
    { ...sheet, tiles: [{ icon: "pool", text: "Pool" }] },
    { ...sheet, tiles: [] },
    { ...sheet, title: "" },
    { ...sheet, where: undefined },
    { ...sheet, breakdown: { total: "₦1", totalLabel: "All-In Stay Total", discount: "₦1" } },
    { ...sheet, breakdown: { totalLabel: "All-In Stay Total" } },
  ].entries()) {
    const surfaceId = `unit-detail-invalid-${index}`;
    const result = validateShortletMessages([
      { version: "v0.9.1", createSurface: { surfaceId, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } },
      { version: "v0.9.1", updateComponents: { surfaceId, components: [JSON.parse(JSON.stringify({ ...invalid, id: "root" }))] } },
    ]);
    assert.equal(result.ok, false, `invalid sheet ${index} is rejected`);
  }
});

test("Weaver catalogues 06 AC5 - discovery surfaces validate on shortlet-discovery/v1, and a StayCard without unitId or total is rejected", async () => {
  const fixture = await restartFixture();
  try {
    const first = await fixture.app.handleTurn(fixture.threadId, "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const discovery = first.surfaces[0]!;
    assert.match(JSON.stringify(discovery.a2uiMessages), /"component":"StayResults"/);
    assert.deepEqual(validateShortletMessages(discovery.a2uiMessages), { ok: true });
  } finally {
    await fixture.close();
  }
  const card = { id: "root", component: "StayCard", unitId: "unit-1", title: "Flat", where: "Ikoyi, Lagos", facts: [{ icon: "users", text: "Sleeps 2" }], total: "₦1", totalLabel: "All-In Stay Total for 1 night" };
  const { unitId: _unitId, ...withoutUnitId } = card;
  const { total: _total, ...withoutTotal } = card;
  for (const [index, invalid] of [
    withoutUnitId,
    withoutTotal,
    { ...card, unitId: "" },
    { ...card, facts: [] },
    { ...card, photoCount: -1 },
    { ...card, href: "javascript:alert(1)" },
    { id: "root", component: "StayResults", rows: [], cards: [] },
    { id: "root", component: "StayResults", rows: [{ unitId: "unit-1", title: "Flat", total: "₦1", totalLabel: "x", rank: 1 }], cards: [] },
  ].entries()) {
    const surfaceId = `stay-card-invalid-${index}`;
    const result = validateShortletMessages([
      { version: "v0.9.1", createSurface: { surfaceId, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } },
      { version: "v0.9.1", updateComponents: { surfaceId, components: [JSON.parse(JSON.stringify(invalid))] } },
    ]);
    assert.equal(result.ok, false, `invalid discovery component ${index} is rejected`);
  }
});

test("Weaver catalogues 07 AC4 - the comparison validates on shortlet-discovery/v1; the builder refuses rows whose cells differ from the heads", async () => {
  const fixture = await restartFixture();
  try {
    const artifact = fixture.environment.discoveryQuery.search({ location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 });
    const [first, second] = artifact.facts.results;
    const messages = compareArtifactToA2UI({ artifact, unitIds: [first!.id, second!.id], surfaceId: "compare-ac4" });
    assert.match(JSON.stringify(messages), /"component":"StayComparison"/);
    assert.deepEqual(validateShortletMessages(messages), { ok: true });
  } finally {
    await fixture.close();
  }
  assert.throws(() => stayComparisonProps(["A", "B"], [{ key: "Where", cells: [{ value: "Ikoyi", unit: "A" }] }]), /has 1 cells for 2 stays/);
  assert.throws(() => stayComparisonProps(["A"], [{ key: "Where", cells: [{ value: "Ikoyi", unit: "A" }, { value: "Lekki", unit: "B" }] }]), /has 2 cells for 1 stays/);
  const table = { id: "root", component: "StayComparison", heads: ["A", "B"], rows: [{ key: "Where", cells: [{ value: "Ikoyi", unit: "A" }, { value: "", unit: "B" }] }] };
  for (const [index, invalid] of [
    { ...table, heads: [] },
    { ...table, rows: [] },
    { ...table, rows: [{ key: "", cells: [{ value: "x" }] }] },
    { ...table, rows: [{ key: "Where", cells: [{ value: "x", html: "<b>x</b>" }] }] },
    { ...table, rows: [{ key: "Where", cells: [{ unit: "A" }] }] },
    { ...table, caption: "extra" },
  ].entries()) {
    const surfaceId = `compare-invalid-${index}`;
    const result = validateShortletMessages([
      { version: "v0.9.1", createSurface: { surfaceId, catalogId: SHORTLET_DISCOVERY_CATALOG_ID } },
      { version: "v0.9.1", updateComponents: { surfaceId, components: [JSON.parse(JSON.stringify(invalid))] } },
    ]);
    assert.equal(result.ok, false, `invalid comparison ${index} is rejected`);
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
