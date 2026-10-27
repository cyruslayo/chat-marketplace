import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp, runtimeDiscoveryArtifact, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { VIEW_UNIT_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";

// ADR 0106 (planner discovery is the shell's discovery surface) and ADR 0077/0080 (cold start rebuilds current facts).
// A fresh thread's first successful planner search must stay openable after the browser's next request, which in
// production arrives at a restored application (a cold restore) rather than the process that ran the planner.

const LEKKI_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const LEKKI_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const LEKKI_LATER_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 21 December 2026";
const LEKKI_LATER_SEARCH = { ...LEKKI_SEARCH, checkIn: "2026-12-21" };
const SCRIPT = {
  [LEKKI_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: LEKKI_SEARCH },
  [LEKKI_LATER_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-21", nights: 3, guests: 2 }, search: LEKKI_LATER_SEARCH },
};

interface ViewContext { readonly artifactId: string; readonly unitId: string }

/** Every View-unit context a discovery card carries, read from its A2UI messages exactly as the browser receives them. */
function viewContextsOf(value: unknown): ViewContext[] {
  const found: ViewContext[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const context = record.context;
    if (record.name === VIEW_UNIT_EVENT && context !== null && typeof context === "object") {
      const candidate = context as Record<string, unknown>;
      if (typeof candidate.artifactId === "string" && typeof candidate.unitId === "string") found.push({ artifactId: candidate.artifactId, unitId: candidate.unitId });
    }
    Object.values(record).forEach(walk);
  };
  walk(value);
  return found;
}

/** The result of a turn that must succeed; a rejection fails the test with its code. */
function successOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `expected success, saw ${result.code}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function viewEvent(surfaceId: string, context: ViewContext) {
  return { name: VIEW_UNIT_EVENT, surfaceId, sourceComponentId: "card-view", timestamp: new Date().toISOString(), context: { artifactId: context.artifactId, unitId: context.unitId } };
}

/** One planner search as the guest receives it: the discovery card's surface and the View action on its first unit. */
async function plannerCard(f: DatedFixture, threadId: string, text: string) {
  const turn = successOf(await f.app.handleTurn(threadId, text));
  const surface = turn.surfaces[0];
  assert.ok(surface, "the planner returned a discovery surface");
  const runtimeArtifact = runtimeDiscoveryArtifact(f.runtime, threadId);
  assert.ok(runtimeArtifact, "the planner search leaves a discovery artifact");
  const [view] = viewContextsOf(surface.a2uiMessages);
  assert.ok(view, "the discovery card carries a View action");
  assert.equal(view.artifactId, runtimeArtifact.id, "the card names the planner's artifact");
  return { surfaceId: surface.surfaceId, artifactId: view.artifactId, unitId: view.unitId };
}

/** A new application over the same guest store, then the browser's page load, as after a restart or on another instance. */
async function coldRestore(f: DatedFixture, threadId: string): Promise<DatedFixture> {
  const restored = restartedDatedApp(f, scriptedPlanner({}).client);
  restored.app.getState(threadId);
  return { ...restored, close: f.close };
}

test("a fresh thread's first planner card opens its unit after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000101";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    const restored = await coldRestore(f, threadId);
    const opened = successOf(await restored.app.handleEventAsync(threadId, viewEvent(card.surfaceId, card)));
    assert.equal(opened.surfaces.length, 1, "the unit detail opens");
    assert.match(opened.surfaces[0]?.surfaceId ?? "", /:unit:detail:/);
  } finally { f.close(); }
});

test("a fresh thread's first planner card opens its unit in the same process", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000102";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    successOf(f.app.handleEvent(threadId, viewEvent(card.surfaceId, card)));
  } finally { f.close(); }
});

test("the card keeps its artifact id across repeated cold restores of the same thread", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000103";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    const once = await coldRestore(f, threadId);
    const twice = await coldRestore(once, threadId);
    successOf(await twice.app.handleEventAsync(threadId, viewEvent(card.surfaceId, card)));
  } finally { f.close(); }
});

test("after a second planner search, the newer card opens and the superseded card stays stale after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000104";
    const older = await plannerCard(f, threadId, LEKKI_TEXT);
    const newer = await plannerCard(f, threadId, LEKKI_LATER_TEXT);
    assert.notEqual(newer.artifactId, older.artifactId);
    const restored = await coldRestore(f, threadId);
    successOf(await restored.app.handleEventAsync(threadId, viewEvent(newer.surfaceId, newer)));
    const stale = await restored.app.handleEventAsync(threadId, viewEvent(older.surfaceId, older));
    assert.equal(stale.ok, false);
    assert.equal(stale.ok ? "" : stale.code, "STALE_SURFACE");
  } finally { f.close(); }
});

test("a superseded artifact id on the newer, still-active card fails closed after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000109";
    const older = await plannerCard(f, threadId, LEKKI_TEXT);
    const newer = await plannerCard(f, threadId, LEKKI_LATER_TEXT);
    const restored = await coldRestore(f, threadId);
    const mismatched = await restored.app.handleEventAsync(threadId, viewEvent(newer.surfaceId, { artifactId: older.artifactId, unitId: newer.unitId }));
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.ok ? "" : mismatched.code, "ARTIFACT_MISMATCH");
  } finally { f.close(); }
});

test("after a second planner search and a cold restore, the newer card opens", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000105";
    await plannerCard(f, threadId, LEKKI_TEXT);
    const newer = await plannerCard(f, threadId, LEKKI_LATER_TEXT);
    const restored = await coldRestore(f, threadId);
    successOf(await restored.app.handleEventAsync(threadId, viewEvent(newer.surfaceId, newer)));
  } finally { f.close(); }
});

test("a forged artifact id on the current card fails closed after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000106";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    const restored = await coldRestore(f, threadId);
    const forged = await restored.app.handleEventAsync(threadId, viewEvent(card.surfaceId, { artifactId: "search-guest-demo-999", unitId: card.unitId }));
    assert.equal(forged.ok, false);
    assert.equal(forged.ok ? "" : forged.code, "ARTIFACT_MISMATCH");
  } finally { f.close(); }
});

test("a unit that is not in the card's results fails closed after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000107";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    const restored = await coldRestore(f, threadId);
    const wrong = await restored.app.handleEventAsync(threadId, viewEvent(card.surfaceId, { artifactId: card.artifactId, unitId: "demo-unit-not-in-results" }));
    assert.equal(wrong.ok, false);
    assert.equal(wrong.ok ? "" : wrong.code, "ACTION_NOT_AUTHORIZED");
  } finally { f.close(); }
});

test("an unknown surface id fails closed after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000108";
    const card = await plannerCard(f, threadId, LEKKI_TEXT);
    const restored = await coldRestore(f, threadId);
    const unknown = await restored.app.handleEventAsync(threadId, viewEvent(`thread-${threadId}:discovery:unknown-surface`, card));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.ok ? "" : unknown.code, "STALE_SURFACE");
  } finally { f.close(); }
});
