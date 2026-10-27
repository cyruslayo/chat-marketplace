import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { datedFixture, restartedDatedApp, runtimeDiscoveryArtifact, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { VIEW_UNIT_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";

const OWNER_TEXT = "Lekki Phase 1, check in 20 November 2026, check out 23 November 2026, 2 guests";
const OWNER_LATER = "Lekki Phase 1, check in 27 November 2026, check out 30 November 2026, 2 guests";
const DATED_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-20", nights: 3, guests: 2 };

/** The result of a turn that must succeed; a rejection fails the test with its code. */
function successOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `expected success, saw ${result.code}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function viewEvent(surfaceId: string, unitId: string, artifactId: string) {
  return { name: VIEW_UNIT_EVENT, surfaceId, sourceComponentId: "card-view", timestamp: new Date().toISOString(), context: { artifactId, unitId } };
}

/** Runs one dated planner search and returns the card's surface and the unit and artifact it shows. */
async function searchOnce(f: DatedFixture, threadId: string, text: string) {
  const search = successOf(await f.app.handleTurn(threadId, text));
  const surface = search.surfaces[0];
  assert.ok(surface, "the planner returned a discovery surface");
  const artifact = runtimeDiscoveryArtifact(f.runtime, threadId);
  assert.ok(artifact, "the planner search leaves a discovery artifact");
  const unit = artifact.facts.results[0];
  assert.ok(unit, "the search has at least one result");
  return { surfaceId: surface.surfaceId, artifactId: artifact.id, unitId: unit.id };
}

test("View apartment opens a unit from a planner-produced result", async () => {
  const f = datedFixture(scriptedPlanner({ [OWNER_TEXT]: { slots: DATED_SEARCH, search: DATED_SEARCH } }).client);
  try {
    const threadId = "g-d1a0000001";
    const card = await searchOnce(f, threadId, OWNER_TEXT);
    const opened = successOf(f.app.handleEvent(threadId, viewEvent(card.surfaceId, card.unitId, card.artifactId)));
    assert.ok(opened.surfaces.length > 0, "the unit detail opens");
  } finally { f.close(); }
});

test("A planner surface id that is neither the shell's nor the runtime's current discovery surface stays stale", async () => {
  const f = datedFixture(scriptedPlanner({ [OWNER_TEXT]: { slots: DATED_SEARCH, search: DATED_SEARCH } }).client);
  try {
    const threadId = "g-d1a0000002";
    const card = await searchOnce(f, threadId, OWNER_TEXT);
    const forged = f.app.handleEvent(threadId, viewEvent(`thread-${threadId}:discovery:forged-artifact`, card.unitId, card.artifactId));
    assert.equal(forged.ok, false);
    assert.equal(forged.ok ? "" : forged.code, "STALE_SURFACE");
  } finally { f.close(); }
});

test("A superseded planner surface id stays stale after a newer planner search", async () => {
  const f = datedFixture(scriptedPlanner({
    [OWNER_TEXT]: { slots: DATED_SEARCH, search: DATED_SEARCH },
    [OWNER_LATER]: { slots: { ...DATED_SEARCH, checkIn: "2026-11-27" }, search: { ...DATED_SEARCH, checkIn: "2026-11-27" } },
  }).client);
  try {
    const threadId = "g-d1a0000003";
    const older = await searchOnce(f, threadId, OWNER_TEXT);
    const newer = await searchOnce(f, threadId, OWNER_LATER);
    assert.notEqual(newer.artifactId, older.artifactId);
    const stale = f.app.handleEvent(threadId, viewEvent(older.surfaceId, older.unitId, older.artifactId));
    assert.equal(stale.ok, false);
    assert.equal(stale.ok ? "" : stale.code, "STALE_SURFACE");
    successOf(f.app.handleEvent(threadId, viewEvent(newer.surfaceId, newer.unitId, newer.artifactId)));
  } finally { f.close(); }
});

test("Opening a unit without dates asks for dates instead of failing", async () => {
  // A thread persisted without any stay dates (for example from an earlier build) rebuilds a dateless discovery.
  const f = datedFixture(scriptedPlanner({ [OWNER_TEXT]: { slots: DATED_SEARCH, search: DATED_SEARCH } }).client);
  try {
    const threadId = "g-d1a0000004";
    const card = await searchOnce(f, threadId, OWNER_TEXT);
    const record = f.environment.interactionStore.findThread(threadId);
    assert.ok(record, "the search persisted the conversation");
    const projection = JSON.parse(record.threadJson) as { assistantContext: Record<string, unknown> | null; discoveryContext: unknown };
    projection.assistantContext = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
    projection.discoveryContext = null;
    f.environment.interactionStore.saveThread({ ...record, threadJson: JSON.stringify(projection) });
    const restarted = restartedDatedApp(f, scriptedPlanner({}).client);
    const state = restarted.app.getState(threadId);
    const surfaceId = state?.surfaces[0]?.surfaceId ?? card.surfaceId;
    // The restored discovery is rebuilt from the persisted projection, so its artifact id is the one the restored card carries.
    const restoredArtifactId = /"artifactId":"([^"]+)"/.exec(JSON.stringify(state?.surfaces[0]?.a2uiMessages ?? []))?.[1];
    assert.ok(restoredArtifactId, "the restored card names its artifact");
    const answered = successOf(restarted.app.handleEvent(threadId, viewEvent(surfaceId, card.unitId, restoredArtifactId)));
    assert.deepEqual(answered.surfaces, []);
    assert.deepEqual(answered.messages, [GUEST_ASSISTANT_COPY.unitDatesClarification]);
  } finally { f.close(); }
});
