import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { A2UIClientActionMessage, A2UIServerMessage } from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { REQUEST_TO_BOOK_EVENT, unitDetailArtifactToA2UI } from "../apps/web-agent/src/unit-detail-a2ui.js";
import { SHORTLET_DISCOVERY_CATALOG_ID } from "../apps/web-agent/src/shortlet-catalogs.js";
import { createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { UNIT_PHOTOS_UNAVAILABLE } from "../apps/local-guest/src/shortlet-renderers.js";
import { quotedUnitDetailArtifact } from "./helpers/unit-detail-fixture.js";

/**
 * Weaver catalogues issue 05 (ADR 0102): the unit detail renders through typed `shortlet-discovery/v1` components.
 * These mount the surface on the guest browser's own runtime in happy-dom.
 */
const TRUSTED_IMAGES = "https://images.example/";

function mountUnitDetail(messages: readonly A2UIServerMessage[], surfaceId: string) {
  const events: A2UIClientActionMessage["action"][] = [];
  const web = createShortletWebRuntime({
    resourcePolicy: ({ kind, url }) => kind === "image" && url.startsWith(TRUSTED_IMAGES) ? url : undefined,
    onServerEvent: (event) => { events.push(event.message.action); },
  });
  for (const message of messages) assert.equal(web.runtime.process(message).ok, true, "the unit detail message is valid");
  const window = new Window();
  const target = window.document.createElement("div");
  window.document.body.append(target);
  assert.equal(web.mount({ surfaceId, target: target as unknown as Element }).ok, true, "the unit detail mounts");
  return { target, events };
}

test("AC3: a unit with no photos renders the fallback gallery group with the no-photos text", () => {
  const surfaceId = "unit-detail-no-photos";
  const { target } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact: quotedUnitDetailArtifact({ photoUrls: [] }), surfaceId }), surfaceId);
  const fallback = target.querySelector('.unit-detail-root > .unit-gallery.unit-gallery--fallback[role="group"][aria-label="Property photos"]');
  assert.ok(fallback, "the fallback gallery group leads the unit detail");
  assert.equal(fallback.querySelector(".unit-photo-missing")?.textContent, UNIT_PHOTOS_UNAVAILABLE);
  assert.equal(target.querySelector("img"), null);
});

test("AC3: a unit with an unsafe photo URL renders no <img> for it", () => {
  const surfaceId = "unit-detail-unsafe-photo";
  const artifact = quotedUnitDetailArtifact({ photoUrls: [`${TRUSTED_IMAGES}living-room.jpg`, "https://tracker.invalid/pixel.jpg"] });
  const { target } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact, surfaceId }), surfaceId);
  const sources = [...target.querySelectorAll("img")].map((image) => image.getAttribute("src"));
  assert.deepEqual(sources, [`${TRUSTED_IMAGES}living-room.jpg`], "only the approved photo is rendered");
  assert.equal(target.querySelector(".listing-gallery")?.getAttribute("data-count"), "1");
  assert.doesNotMatch(target.innerHTML, /tracker\.invalid/, "the refused URL appears nowhere, not even as a link");
});

test("AC3: a unit whose every photo is refused still shows the labelled no-photos group", () => {
  const surfaceId = "unit-detail-all-refused";
  const artifact = quotedUnitDetailArtifact({ photoUrls: ["https://tracker.invalid/one.jpg"] });
  const { target } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact, surfaceId }), surfaceId);
  assert.equal(target.querySelector("img"), null);
  assert.equal(target.querySelector(".unit-gallery--fallback .unit-photo-missing")?.textContent, UNIT_PHOTOS_UNAVAILABLE);
});

test("AC4: a unit missing a tile fact still renders every fact it has, and the surface is never half organized", () => {
  const surfaceId = "unit-detail-missing-bedrooms";
  const artifact = quotedUnitDetailArtifact({ bedrooms: undefined });
  const { target } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact, surfaceId }), surfaceId);
  const root = target.querySelector(".unit-detail-root");
  assert.ok(root);
  assert.deepEqual([...root.children].map((child) => child.className), [
    "listing-gallery",
    "unit-detail-sheet",
    "unit-amenities",
    "unit-supporting-info",
    "ui-action-bar unit-action-bar",
  ], "every section is present, in order");
  const tiles = [...target.querySelectorAll(".unit-detail-sheet .ui-tiles__tile")].map((tile) => tile.textContent);
  assert.deepEqual(tiles, ["Not provided", `${artifact.facts.bathrooms} bathrooms`, `Sleeps ${artifact.facts.capacity}`]);
  assert.ok(target.querySelector(".unit-detail-sheet .ui-price-breakdown .ui-money-total"), "the price still shows");
  assert.equal(target.querySelector(".unit-detail-sheet .unit-detail-description")?.textContent, artifact.facts.description);
  assert.equal(target.querySelector(".unit-detail-sheet .unit-detail-title")?.textContent, artifact.facts.title);
});

test("the action bar keeps Weaver's Request to Book event and shows the server-formatted total", () => {
  const surfaceId = "unit-detail-action";
  const artifact = quotedUnitDetailArtifact();
  const { target, events } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact, surfaceId }), surfaceId);
  const bar = target.querySelector(".unit-action-bar");
  assert.ok(bar);
  assert.match(bar.querySelector(".ui-action-bar__sum strong")?.textContent ?? "", /^₦/);
  const button = bar.querySelector(".unit-actions button") as unknown as { click(): void } | null;
  assert.ok(button, "the Basic Row of buttons sits in the bar with the unit-actions class");
  button.click();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, REQUEST_TO_BOOK_EVENT);
  assert.equal(events[0]?.surfaceId, surfaceId);
});

test("typed props are text: markup in a unit's title or description is escaped, never parsed (ADR 0075)", () => {
  const surfaceId = "unit-detail-escaped";
  const hostile = "<img src=x onerror=alert(1)>";
  // The Unit record already refuses markup; this injects it after that check to prove the renderer escapes on its own.
  const base = quotedUnitDetailArtifact();
  const artifact = { ...base, facts: { ...base.facts, title: `Flat ${hostile}`, description: `Quiet ${hostile}` } };
  const { target } = mountUnitDetail(unitDetailArtifactToA2UI({ artifact, surfaceId }), surfaceId);
  assert.equal(target.querySelector("[onerror]"), null);
  assert.equal(target.querySelector(".unit-detail-title")?.textContent, `Flat ${hostile}`);
  assert.equal(target.querySelector(".unit-detail-description")?.textContent, `Quiet ${hostile}`);
});

test("the unit detail surface is created on shortlet-discovery/v1", () => {
  const messages = unitDetailArtifactToA2UI({ artifact: quotedUnitDetailArtifact(), surfaceId: "unit-detail-catalogue" });
  const created = messages.find((message) => "createSurface" in message);
  assert.ok(created && "createSurface" in created);
  assert.equal(created.createSurface.catalogId, SHORTLET_DISCOVERY_CATALOG_ID);
});

test("AC7: client.ts no longer defines organizeUnitDetail or UNIT_TILE_FACTS", async () => {
  const client = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /\borganizeUnitDetail\b/);
  assert.doesNotMatch(client, /\bUNIT_TILE_FACTS\b/);
});
