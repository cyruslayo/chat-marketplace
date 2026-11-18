import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { A2UIClientActionMessage, A2UIServerMessage } from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { COMPARE_ATTRIBUTES, VIEW_UNIT_EVENT, compareArtifactToA2UI, type DiscoveryArtifactProjection } from "../apps/web-agent/src/discovery-a2ui.js";
import { SHORTLET_DISCOVERY_CATALOG_ID } from "../apps/web-agent/src/shortlet-catalogs.js";

/**
 * Weaver catalogues issue 07 (ADR 0102): the two-stay comparison renders through the typed StayComparison component of
 * `shortlet-discovery/v1`, mounted here on the guest browser's own runtime in happy-dom.
 */
const SURFACE_ID = "compare-test";

function lagosArtifact(): DiscoveryArtifactProjection {
  const directory = mkdtempSync(join(tmpdir(), "weaver-compare-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite"), clock: () => new Date("2026-09-03T10:00:00Z") });
  try {
    const artifact = environment.discoveryQuery.search({ location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 });
    assert.equal(artifact.facts.results.length, 2);
    return structuredClone(artifact) as DiscoveryArtifactProjection;
  } finally {
    environment.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function mount(messages: readonly A2UIServerMessage[]) {
  const events: A2UIClientActionMessage["action"][] = [];
  const web = createShortletWebRuntime({ onServerEvent: (event) => { events.push(event.message.action); } });
  for (const message of messages) assert.equal(web.runtime.process(message).ok, true, "the comparison message is valid");
  const window = new Window();
  const target = window.document.createElement("div");
  window.document.body.append(target);
  assert.equal(web.mount({ surfaceId: SURFACE_ID, target: target as unknown as Element }).ok, true, "the comparison mounts");
  return { target, events };
}

function compareMessages(artifact = lagosArtifact()) {
  const [first, second] = artifact.facts.results;
  return { artifact, messages: compareArtifactToA2UI({ artifact, unitIds: [first!.id, second!.id], surfaceId: SURFACE_ID }) };
}

/** Each row of the rendered table, except the actions row, as [rowheader, ...cell values]; the head row as its column headers. */
function tableOf(target: { querySelectorAll(selector: string): ArrayLike<unknown> }): readonly (readonly string[])[] {
  return Array.from(target.querySelectorAll(".ui-compare[role=table] > [role=row]:not(.ui-compare__row--actions)") as ArrayLike<{ querySelectorAll(selector: string): ArrayLike<{ textContent: string | null; querySelector(selector: string): { textContent: string | null } | null }> }>).map((row) =>
    Array.from(row.querySelectorAll(":scope > [role=columnheader], :scope > [role=rowheader], :scope > [role=cell]")).map((cell) =>
      cell.querySelector("p")?.textContent ?? cell.textContent ?? ""));
}

test("AC1: the comparison is a table with the stays as columns and one row per attribute", () => {
  const { artifact, messages } = compareMessages();
  const { target } = mount(messages);
  const [first, second] = artifact.facts.results;
  const table = tableOf(target);
  assert.deepEqual(table[0], ["", first!.title, second!.title], "an empty corner, then one column header per stay");
  assert.deepEqual(table.slice(1).map((row) => row[0]), COMPARE_ATTRIBUTES.map((attribute) => attribute.label), "one row header per attribute");
  COMPARE_ATTRIBUTES.forEach((attribute, index) => {
    assert.deepEqual(table[index + 1]!.slice(1), [attribute.value(first!), attribute.value(second!)], `${attribute.key} values are server-formatted`);
  });
  for (const cell of target.querySelectorAll(".compare-cell.ui-compare__cell[role=cell]")) {
    assert.ok(cell.querySelector("small.compare-cell__unit")?.textContent, "each cell names its stay, for the stacked layout");
  }
  assert.ok(target.querySelector(".ui-compare__row.compare-row.ui-compare__row--head"));
  assert.equal(target.querySelectorAll("h3.ui-compare__key[role=rowheader]").length, COMPARE_ATTRIBUTES.length);
});

test("AC2: the View buttons in the actions row dispatch the same platform events as before", () => {
  const { artifact, messages } = compareMessages();
  const { target, events } = mount(messages);
  const buttons = Array.from(target.querySelectorAll(".ui-compare__row--actions > button.ui-compare__cell")) as unknown as { click(): void }[];
  assert.equal(buttons.length, 2, "one View per stay, in the actions row");
  buttons.forEach((button) => button.click());
  assert.deepEqual(events.map((event) => ({ name: event.name, context: event.context })), artifact.facts.results.map((unit) => ({
    name: VIEW_UNIT_EVENT,
    context: { artifactId: artifact.id, unitId: unit.id },
  })));
});

test("AC3: a stay without a value for an attribute renders an empty cell in its own column, never shifting later cells", () => {
  const { messages } = compareMessages();
  // A server table whose second stay has no where value for this projection.
  const edited = messages.map((message) => "updateComponents" in message
    ? { ...message, updateComponents: { ...message.updateComponents, components: message.updateComponents.components.map((component) => {
      if (component.component !== "StayComparison") return component;
      const rows = (component as unknown as { rows: { key: string; cells: { value: string; unit: string }[] }[] }).rows;
      return { ...component, rows: rows.map((row) => row.key === "Where" ? { ...row, cells: [row.cells[0]!, { ...row.cells[1]!, value: "" }] } : row) };
    }) } }
    : message) as readonly A2UIServerMessage[];
  const { target } = mount(edited);
  const where = tableOf(target).find((row) => row[0] === "Where")!;
  assert.equal(where.length, 3, "the row still has a header and two cells");
  assert.notEqual(where[1], "");
  assert.equal(where[2], "", "the second stay's cell is empty, in the second column");
  const bedrooms = tableOf(target).find((row) => row[0] === "Bedrooms")!;
  assert.ok(bedrooms[1] !== "" && bedrooms[2] !== "", "later rows are unaffected");
});

test("typed comparison props are text: markup in a stay title is escaped, never parsed (ADR 0075)", () => {
  const artifact = lagosArtifact();
  const hostile = "<img src=x onerror=alert(1)>";
  const results = artifact.facts.results.map((unit, index) => index === 0 ? { ...unit, title: `Flat ${hostile}` } : unit);
  const { target } = mount(compareMessages({ ...artifact, facts: { ...artifact.facts, results } }).messages);
  assert.equal(target.querySelector("[onerror]"), null);
  assert.equal(target.querySelector(".ui-compare__head")?.textContent, `Flat ${hostile}`);
});

test("the comparison surface is created on shortlet-discovery/v1", () => {
  const created = compareMessages().messages.find((message) => "createSurface" in message);
  assert.ok(created && "createSurface" in created);
  assert.equal(created.createSurface.catalogId, SHORTLET_DISCOVERY_CATALOG_ID);
});

test("AC5: client.ts no longer defines decorateComparison", async () => {
  const client = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /\bdecorateComparison\b/);
});
