import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import { datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// ADR 0015 / ADR 0106: the Request to Book summary shows only known stay details. A proposal without known nights or party size is
// a rejected tool call (tool_denial) answered with the stay clarification. Each event runs on a cold restore (a new application over
// the same store) on a fresh thread, the staging clock (27 Oct 2026) and a staging-like guest with no phone or email.

const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const BROWSE_TEXT = "Show me apartments in Lekki";
const BROWSE_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
const STAY_SLOTS = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const BROWSE_SLOTS = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
const REQUEST_TEXT = "Request to book the first one.";
const PROPOSE: ScriptedTurn = { slots: {}, intents: ["request"], tool: { name: "propose_request_to_book", args: { stayRef: "stay-1" } } };
const CHECK_IN = "2026-12-14";

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

// The thread is created by the guest's first message on the original application; every later event is cold-restored.

/** A new application over the same guest store (with the same scripted model), loaded as a page load does, before the event is sent. */
function coldFixture(f: DatedFixture, model: AssistantModelClient, threadId: string) {
  const restored = restartedDatedApp(f, model);
  restored.app.getState(threadId);
  return restored;
}

/** A criteria chip edit on the thread, sent after a cold restore. */
async function chip(f: DatedFixture, model: AssistantModelClient, threadId: string, basedOn: string | undefined, context: Record<string, unknown>): Promise<GuestTurnSuccess> {
  return successOf(await coldFixture(f, model, threadId).app.handleEventAsync(threadId, {
    name: CRITERIA_EDIT_EVENT,
    surfaceId: criteriaSurfaceId(threadId),
    sourceComponentId: "criteria-chip",
    timestamp: LIVE_LIKE_CLOCK().toISOString(),
    context: { ...context, basedOn },
  }), "criteria chip");
}

test("AC1: With nights and party known, the summary shows them", async () => {
  const model = scriptedPlanner({ [STAY_TEXT]: { slots: STAY_SLOTS, search: STAY_SEARCH }, [REQUEST_TEXT]: PROPOSE }).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d15a000001";
    successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const proposal = successOf(await coldFixture(f, model, threadId).app.handleTurn(threadId, REQUEST_TEXT), "propose");
    const summary = coldFixture(f, model, threadId).runtime.getThread(threadId).taskState.pendingAction?.summary ?? "";
    assert.match(summary, /for 2026-12-14 to 2026-12-17 \(3 nights, 2 guests\)/);
    assert.doesNotMatch(summary, /undefined|null/);
  } finally { f.close(); }
});

test("AC2 failure path: with nights unknown, no proposal is created and the stay clarification is returned", async () => {
  const model = scriptedPlanner({ [BROWSE_TEXT]: { slots: BROWSE_SLOTS, search: BROWSE_SEARCH }, [REQUEST_TEXT]: PROPOSE }).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d15a000002";
    const browse = successOf(await f.app.handleTurn(threadId, BROWSE_TEXT), "browse");
    // The guest gives a party size through the guests chip. A check-in chip needs its nights, so no dates or nights are known.
    await chip(f, model, threadId, browse.criteria?.key, { field: "guests", partySize: 2 });
    assert.equal(coldFixture(f, model, threadId).runtime.getThread(threadId).taskState.stayIntent.nights, undefined, "nights stay unknown");
    const result = successOf(await coldFixture(f, model, threadId).app.handleTurn(threadId, REQUEST_TEXT), "propose without nights");
    const restored = coldFixture(f, model, threadId);
    assert.equal(result.assistantControlOutcome, "tool_denial");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.stayClarification]);
    assert.equal(result.surfaces.length, 0);
    assert.equal(restored.runtime.getThread(threadId).taskState.pendingAction ?? null, null, "no pending request is created");
  } finally { f.close(); }
});

test("AC3 failure path: with party size unknown, no proposal is created and the stay clarification is returned", async () => {
  const model = scriptedPlanner({ [BROWSE_TEXT]: { slots: BROWSE_SLOTS, search: BROWSE_SEARCH }, [REQUEST_TEXT]: PROPOSE }).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d15a000003";
    const browse = successOf(await f.app.handleTurn(threadId, BROWSE_TEXT), "browse");
    // The guest gives a check-in and nights through the chips, but no party size.
    await chip(f, model, threadId, browse.criteria?.key, { field: "when", checkIn: CHECK_IN, nights: 3 });
    assert.equal(coldFixture(f, model, threadId).runtime.getThread(threadId).taskState.stayIntent.partySize, undefined, "party size stays unknown");
    const result = successOf(await coldFixture(f, model, threadId).app.handleTurn(threadId, REQUEST_TEXT), "propose without party size");
    const restored = coldFixture(f, model, threadId);
    assert.equal(result.assistantControlOutcome, "tool_denial");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.stayClarification]);
    assert.equal(result.surfaces.length, 0);
    assert.equal(restored.runtime.getThread(threadId).taskState.pendingAction ?? null, null, "no pending request is created");
  } finally { f.close(); }
});
