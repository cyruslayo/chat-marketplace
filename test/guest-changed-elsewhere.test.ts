import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { VIEW_UNIT_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";
import { GUEST_CHANGED_ELSEWHERE } from "../apps/web-agent/src/guest-content.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { changedElsewhereRecovery } from "../apps/local-guest/src/stale-surface-response.js";
import { datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { coldApp, tap } from "./helpers/assistant-cold-journey-harness.js";

// Issue 11 (ADR 0072, 0074, 0106; guideline §6 stale action, §9 HTTP conflict): a refused action after the view changed.

const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const SCRIPT = { [STAY_TEXT]: { slots: STAY_SEARCH, search: STAY_SEARCH } };

interface ViewContext { readonly artifactId: string; readonly unitId: string }

function viewContextsOf(value: unknown): ViewContext[] {
  const found: ViewContext[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
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

function viewEvent(surfaceId: string, context: ViewContext) {
  return { name: VIEW_UNIT_EVENT, surfaceId, sourceComponentId: "card-view", timestamp: new Date().toISOString(), context: { artifactId: context.artifactId, unitId: context.unitId } };
}

function successOfTurn(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: ${result.code}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("AC1: An ARTIFACT_MISMATCH rejection marks the surface out of date and refreshes the current state", () => {
  const recovery = changedElsewhereRecovery("ARTIFACT_MISMATCH");
  assert.deepEqual(recovery, { kind: "stale", message: GUEST_CHANGED_ELSEWHERE.message });
  assert.equal(changedElsewhereRecovery("STALE_SURFACE")?.kind, "stale");
  assert.equal(changedElsewhereRecovery("STALE_ACTION")?.kind, "stale");
  assert.equal(changedElsewhereRecovery("EXPIRED_SURFACE")?.kind, "expired");
  // Failure path: an unrelated code is not treated as a stale view.
  assert.equal(changedElsewhereRecovery("QUOTA_REFUSAL"), undefined);
  const source = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(source, /const recovery = changedElsewhereRecovery\(response\.code\)/);
  assert.match(source, /markActiveSurfaceStatus\(shellState, recovery\.kind\)/);
  assert.match(source, /void refreshServerState\(\)/);
});

test("AC2: The guest sees the changed-elsewhere message, never a raw code", () => {
  const recovery = changedElsewhereRecovery("ARTIFACT_MISMATCH");
  assert.equal(recovery?.message, "This request changed while you were viewing it. Check the latest status.");
  assert.doesNotMatch(recovery?.message ?? "", /ARTIFACT_MISMATCH|STALE_|MISMATCH/);
  // Failure path: the server's internal sentence is not used for this code.
  assert.notEqual(recovery?.message, "The action does not match the authoritative artifact.");
});

test("AC3: A forged artifact id is still rejected after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000501";
    const search = successOfTurn(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const [view] = viewContextsOf(search.surfaces[0]!.a2uiMessages);
    assert.ok(view, "the discovery card carries a View action");
    const restored = restartedDatedApp(f, scriptedPlanner({}).client);
    restored.app.getState(threadId);
    const forged = await restored.app.handleEventAsync(threadId, viewEvent(search.surfaces[0]!.surfaceId, { artifactId: "search-guest-demo-999", unitId: view.unitId }));
    assert.equal(forged.ok, false);
    assert.equal(forged.ok ? "" : forged.code, "ARTIFACT_MISMATCH");
  } finally {
    f.close();
  }
});

test("AC4: The draft entered before the rejection is not lost", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000502";
    const search = successOfTurn(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const [view] = viewContextsOf(search.surfaces[0]!.a2uiMessages);
    assert.ok(view, "the discovery card carries a View action");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "the draft is open");

    // Replaying the superseded discovery action is refused, and the authored draft stays authoritative.
    const rejected = await coldApp(f, threadId).handleEventAsync(threadId, viewEvent(search.surfaces[0]!.surfaceId, view));
    assert.equal(rejected.ok, false);
    const state = coldApp(f, threadId).getState(threadId);
    assert.ok(state);
    assert.match(state.surfaces[0]?.surfaceId ?? "", /:request:draft:/, "the draft is still the current surface");
    assert.match(JSON.stringify(state.surfaces[0]), /Request Draft|Request to Book|Check-in/i, "the draft facts are intact");
  } finally {
    f.close();
  }
});
