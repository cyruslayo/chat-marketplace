import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import {
  COMPARE_ATTRIBUTES,
  COMPARE_BACK_EVENT,
  COMPARE_UNIT_EVENT,
  compareArtifactToA2UI,
  formatNgnKobo,
  guestAmenityLabel,
  type DiscoveryUnitProjection,
} from "../apps/web-agent/src/index.js";
import type { GuestSurfacePayload, GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

const LAGOS = "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people";

interface Component { readonly id: string; readonly component: string; readonly text?: string; readonly children?: readonly string[]; readonly action?: { readonly event?: { readonly name?: string; readonly context?: Record<string, unknown> } } }

function components(surface: GuestSurfacePayload): readonly Component[] {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  return update.updateComponents.components as readonly Component[];
}

function success(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as GuestTurnSuccess;
}

/** The Compare button event for one result on a results surface. */
function compareEvent(surface: GuestSurfacePayload, unitId: string) {
  const button = components(surface).find((component) => component.component === "Button" && component.action?.event?.name === COMPARE_UNIT_EVENT && component.action.event.context?.unitId === unitId);
  assert.ok(button, `a Compare button for ${unitId}`);
  return { name: COMPARE_UNIT_EVENT, context: button.action!.event!.context!, surfaceId: surface.surfaceId, sourceComponentId: "compare-test", timestamp: new Date().toISOString() };
}

function unitIds(surface: GuestSurfacePayload): string[] {
  return components(surface).filter((component) => component.action?.event?.name === COMPARE_UNIT_EVENT).map((component) => String(component.action!.event!.context!.unitId));
}

async function lagosResults() {
  const fixture = await restartFixture();
  const results = success(await fixture.send("/api/turn", { text: LAGOS }));
  const surface = results.surfaces[0]!;
  const ids = unitIds(surface);
  assert.ok(ids.length >= 2, "the Lagos search has at least two results");
  return { fixture, surface, ids };
}

test("AC2: Choosing Compare on two results shows price, capacity and amenities aligned", async () => {
  const { fixture, surface, ids } = await lagosResults();
  try {
    const [first, second] = ids as [string, string];
    const picked = success(await fixture.send("/api/event", compareEvent(surface, first)));
    assert.match(picked.messages[0]!, /^Choose one more stay to compare with .+\.$/);
    const marked = picked.surfaces[0]!;
    assert.equal(marked.surfaceId, surface.surfaceId, "the same results, re-presented");
    assert.ok(components(marked).some((component) => component.text === "Remove from compare"));

    const compared = success(await fixture.send("/api/event", compareEvent(marked, second)));
    const view = compared.surfaces[0]!;
    assert.match(view.surfaceId, /:compare:/);
    assert.equal(view.mode, "focused-surface");
    const byId = new Map(components(view).map((component) => [component.id, component]));
    const results = (fixture.environment.discoveryQuery.search({ location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 }).facts.results) as readonly DiscoveryUnitProjection[];
    const units = [first, second].map((id) => results.find((unit) => unit.id === id)!);

    // Price, capacity and amenities appear in that order, one row each.
    const order = byId.get("root")!.children!.filter((id) => id.endsWith("-row"));
    assert.deepEqual(order, COMPARE_ATTRIBUTES.map((attribute) => `compare-${attribute.key}-row`));
    assert.deepEqual(COMPARE_ATTRIBUTES.map((attribute) => attribute.key), ["price", "deposit", "capacity", "amenities"]);
    for (const attribute of COMPARE_ATTRIBUTES) {
      const row = byId.get(`compare-${attribute.key}-row`)!;
      assert.equal(row.component, "Row");
      assert.deepEqual(row.children, [`compare-${attribute.key}-0`, `compare-${attribute.key}-1`], `${attribute.key} has one cell per stay`);
      units.forEach((unit, index) => {
        assert.equal(byId.get(`compare-${attribute.key}-${index}-unit`)!.text, unit.title, "each cell names its stay");
        assert.equal(byId.get(`compare-${attribute.key}-${index}-value`)!.text, attribute.value(unit));
      });
    }
    units.forEach((unit, index) => {
      // ADR-0015: the price is the All-In Stay Total for these dates and guests.
      assert.equal(byId.get(`compare-price-${index}-value`)!.text, formatNgnKobo(unit.price.allInStayTotalKobo!));
      assert.match(byId.get(`compare-capacity-${index}-value`)!.text!, new RegExp(`^Sleeps ${unit.capacity}`));
      assert.equal(byId.get(`compare-amenities-${index}-value`)!.text, unit.amenities.map(guestAmenityLabel).join(" · "));
    });
    assert.equal(byId.get("compare-price-label")!.text, "All-In Stay Total");
    assert.ok(view.textFallback?.includes(units[0]!.title) && view.textFallback.includes(units[1]!.title));

    // The discovery surface is superseded; Back to results re-presents the same search.
    const stale = await fixture.send("/api/event", compareEvent(marked, first));
    assert.equal(stale.ok, false);
    assert.equal((stale as { code: string }).code, "STALE_SURFACE");
    const back = success(await fixture.send("/api/event", guestAction(view, COMPARE_BACK_EVENT)));
    assert.match(back.surfaces[0]!.surfaceId, /:discovery:results:/);
    assert.deepEqual(unitIds(back.surfaces[0]!), ids);
    assert.ok(!components(back.surfaces[0]!).some((component) => component.text === "Remove from compare"), "the pick is cleared");
  } finally { await fixture.close(); }
});

test("AC2 failure path: the same result twice un-picks it and opens no comparison", async () => {
  const { fixture, surface, ids } = await lagosResults();
  try {
    const picked = success(await fixture.send("/api/event", compareEvent(surface, ids[0]!)));
    const unpicked = success(await fixture.send("/api/event", compareEvent(picked.surfaces[0]!, ids[0]!)));
    assert.match(unpicked.messages[0]!, /is no longer selected to compare\.$/);
    assert.doesNotMatch(unpicked.surfaces[0]!.surfaceId, /:compare:/);
    assert.ok(!components(unpicked.surfaces[0]!).some((component) => component.text === "Remove from compare"));
  } finally { await fixture.close(); }
});

test("AC2 failure path: a tampered artifact, an unknown stay or extra context fails closed", async () => {
  const { fixture, surface, ids } = await lagosResults();
  try {
    const event = compareEvent(surface, ids[0]!);
    for (const context of [
      { ...event.context, artifactId: "discovery-forged" },
      { ...event.context, unitId: "unit-not-in-results" },
      { ...event.context, extra: true },
      { artifactId: event.context.artifactId },
    ]) {
      const result = await fixture.send("/api/event", { ...event, context });
      assert.equal(result.ok, false, JSON.stringify(context));
      assert.equal((result as { code: string }).code, "INVALID_CONTEXT");
    }
    // A stale results surface is rejected before any context check.
    const staleSurface = await fixture.send("/api/event", { ...event, surfaceId: `${surface.surfaceId}:old` });
    assert.equal((staleSurface as { code: string }).code, "STALE_SURFACE");
  } finally { await fixture.close(); }
});

test("AC2 failure path: a new search clears a pending pick", async () => {
  const { fixture, surface, ids } = await lagosResults();
  try {
    success(await fixture.send("/api/event", compareEvent(surface, ids[0]!)));
    const again = success(await fixture.send("/api/turn", { text: "Make it 3 guests" }));
    assert.ok(!components(again.surfaces[0]!).some((component) => component.text === "Remove from compare"));
  } finally { await fixture.close(); }
});

test("AC2 failure path: a single result offers no Compare control", async () => {
  const fixture = await restartFixture();
  try {
    const results = success(await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" }));
    assert.deepEqual(unitIds(results.surfaces[0]!), []);
  } finally { await fixture.close(); }
});

test("compareArtifactToA2UI refuses a stay that is not in the artifact", async () => {
  const { fixture, ids } = await lagosResults();
  try {
    const artifact = fixture.environment.discoveryQuery.search({ location: "Lagos", checkIn: "2026-09-10", checkOut: "2026-09-13", partySize: 2 });
    assert.throws(() => compareArtifactToA2UI({ artifact, unitIds: [ids[0]!, "unit-missing"], surfaceId: "s" }), /not in these results/);
  } finally { await fixture.close(); }
});
