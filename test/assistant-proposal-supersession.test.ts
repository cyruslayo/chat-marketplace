import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import type { GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import {
  PROPOSAL_REPLACED_COPY,
  PROPOSE_REQUEST,
  SEARCH_IKOYI,
  journeyScriptedModel,
  openJourneyEnvironment,
  type RecordedJourneyDefinition,
} from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, firstButtonAction, wireDatedApp, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

// ADR 0074 (owner decision, 28 Oct 2026; review follow-up): a stay change removes an open Booking Request proposal however it
// happens: a planner search, a criteria chip edit or undo, or a task switch. A switch or chip edit that changes nothing keeps
// the proposal, and a switch that fails changes nothing.
//
// Scenarios run warm (one application) and cold (a new application before every event, on the 27 Oct 2026 clock). The guest is
// staging-like (no phone) unless the scenario confirms a still-valid proposal: that confirm reaches the deterministic path,
// which needs a phone (finding 9), so only those scenarios use a phone-holding guest, and each says so where it starts.

const THREAD = "g-d1a0000720";
const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
const UNKNOWN_TASK_TEXT = "Move me over to another kind of task";
const UNKNOWN_DOMAIN_TEXT = "Open a different kind of task";

/** Every typed text the scenarios send, with the planner answer each one gets. Chip and task events are not typed. */
const SCENARIO: RecordedJourneyDefinition = {
  name: "supersession-scenarios",
  threadId: THREAD,
  description: "Supersession scenarios (not recorded).",
  withSecondDomain: true,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: "Request the first one.", planner: PROPOSE_REQUEST },
    { text: "Yes" },
    { text: "Thanks, that helps" },
    { text: UNKNOWN_TASK_TEXT, planner: { tool: "switch_task", args: { taskId: "task-unknown-0000" } } },
    { text: UNKNOWN_DOMAIN_TEXT, planner: { tool: "start_task", args: { domain: "mars" } } },
  ],
};

type Fixture = Omit<DatedFixture, "close">;
type Session = ReturnType<typeof session>;

/**
 * A session drives one thread. A cold session builds a new application for each step, as a Worker request does, and loads the
 * thread first. A warm session keeps one application and does not reload it: a page load resets the assistant undo history
 * (see the issue 03 Comments), so only a warm session can step back with undo.
 */
function session(environment: LocalGuestEnvironment, model: AssistantModelClient, cold: boolean, packs = false) {
  const shop = packs ? [createFakeShopPack()] : undefined;
  let warm: Fixture | undefined;
  return {
    step(): Fixture {
      if (cold) {
        const fixture = wireDatedApp(environment, model, undefined, shop);
        fixture.app.getState(THREAD);
        return fixture;
      }
      warm ??= wireDatedApp(environment, model, undefined, shop);
      return warm;
    },
  };
}

/** The criteria key the strip last showed this session; a chip edit or undo must name it (basedOn), as the page does. */
const keys = new WeakMap<object, string>();

function remember(s: Session, result: GuestTurnResult): GuestTurnResult {
  if (result.ok && result.criteria?.key) keys.set(s, result.criteria.key);
  return result;
}

async function typed(s: Session, text: string): Promise<GuestTurnResult> {
  return remember(s, await s.step().app.handleTurn(THREAD, text));
}

/** A chip edit or undo as the page sends it. The key comes from the last result, never from getState. */
async function chip(s: Session, name: string, context: Record<string, unknown>): Promise<GuestTurnResult> {
  const fixture = s.step();
  const key = keys.get(s);
  assert.ok(key, "the criteria strip has a key");
  return remember(s, await fixture.app.handleEventAsync(THREAD, {
    name,
    surfaceId: criteriaSurfaceId(THREAD),
    sourceComponentId: "criteria-chip",
    timestamp: LIVE_LIKE_CLOCK().toISOString(),
    context: { ...context, basedOn: key },
  }));
}

/** A client-style task event: the shell routes it to the runtime's task handler. */
async function taskEvent(s: Session, name: string, context: Record<string, unknown>): Promise<GuestTurnResult> {
  return s.step().app.handleEventAsync(THREAD, {
    name,
    surfaceId: `thread-${THREAD}:tasks`,
    sourceComponentId: "task-rail",
    timestamp: LIVE_LIKE_CLOCK().toISOString(),
    context,
  });
}

function assertOk(result: GuestTurnResult, label: string): void {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: ${result.code} ${result.message}`);
}

/** The live proposal card the proposal's turn returned. */
function proposalCard(result: GuestTurnResult) {
  assertOk(result, "propose");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "a proposal card is returned");
  return card;
}

function pendingId(s: Session): string | null {
  return s.step().runtime.getThread(THREAD).taskState.pendingAction?.id ?? null;
}

function requestSent(result: GuestTurnResult): boolean {
  return result.ok && result.surfaces.some((surface) => /:request:/.test(surface.surfaceId));
}

/** A staging-like guest: no phone, as the staging Durable Object starts it. */
function stagingGuest(): LocalGuestEnvironment {
  return openJourneyEnvironment();
}

/**
 * A phone-holding guest. Used only where a confirm of a still-valid proposal reaches the deterministic path, which needs a phone
 * (finding 9); a confirm that wrongly got through would then send the request and fail the test.
 */
function phoneGuest(): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(chip edit, typed yes, ${mode}) A guests chip edit that changes the party size removes the proposal: the typed yes sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      assert.ok(pendingId(s), "the proposal is open before the chip edit");

      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
      assert.equal(pendingId(s), null, "the chip edit that changes the party size removes the proposal");

      const yes = await typed(s, "Yes");
      assertOk(yes, "yes");
      if (!yes.ok) throw new Error("unreachable");
      assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
      assert.equal(requestSent(yes), false, "no request is sent");
    } finally { environment.close(); }
  });

  test(`(chip edit, button, ${mode}) After a chip edit, the old card's confirm button returns STALE_SURFACE and sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      const card = proposalCard(await typed(s, "Request the first one."));
      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");

      const pressed = await s.step().app.handleEventAsync(THREAD, firstButtonAction(card));
      assert.equal(pressed.ok, false, "the old card is refused");
      assert.equal(pressed.ok ? "" : pressed.code, "STALE_SURFACE");
      assert.equal(requestSent(pressed as GuestTurnResult), false, "no request is sent");
    } finally { environment.close(); }
  });

  test(`(chip no-op, ${mode}) A chip edit that changes nothing keeps a valid proposal.`, async () => {
    const environment = stagingGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      const before = pendingId(s);
      assert.ok(before);
      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2 }), "guests chip to the same value");
      assert.equal(pendingId(s), before, "a chip edit that changes nothing keeps the proposal");
    } finally { environment.close(); }
  });

  // Undo runs warm only: the cold variant below pins NOTHING_TO_UNDO (see the issue 03 Comments).
  if (!cold) {
    test("(chip undo, warm) Undo restores the searched stay, but the proposal made before the edit stays removed: the typed yes and the old card send nothing.", async () => {
      const environment = stagingGuest();
      try {
        const s = session(environment, journeyScriptedModel(SCENARIO), false);
        await typed(s, SCENARIO.guestTurns[0]!.text);
        const proposal = proposalCard(await typed(s, "Request the first one."));
        assert.ok(pendingId(s), "the proposal is open on the searched stay");

        // The chip edit removes the proposal. Undo steps back to the searched stay (party size 2), and that does not bring the
        // proposal back: the rule removes authority, and only a new proposal can make a new one.
        assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
        assert.equal(pendingId(s), null, "the edit removes the proposal");
        const undone = await chip(s, CRITERIA_UNDO_EVENT, {});
        assertOk(undone, "undo");
        if (!undone.ok) throw new Error("unreachable");
        assert.equal(undone.criteria?.guests?.count, 2, "undo restores the searched party size");
        assert.equal(pendingId(s), null, "undo does not restore the removed proposal");

        const yes = await typed(s, "Yes");
        assertOk(yes, "yes after undo");
        if (!yes.ok) throw new Error("unreachable");
        assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
        assert.equal(requestSent(yes), false, "no request is sent");
        const pressed = await s.step().app.handleEventAsync(THREAD, firstButtonAction(proposal));
        assert.equal(pressed.ok ? "" : pressed.code, "STALE_SURFACE");
      } finally { environment.close(); }
    });
  } else {
    test("(chip undo, cold) A cold undo reports NOTHING_TO_UNDO, because a page load resets the assistant undo history; the proposal stays removed and nothing is sent.", async () => {
      // Pinned pre-existing behaviour (issue 03 Comments): #rebuildAssistantDiscovery sets the undo history to the current search on
      // every load, so no cold request can step back. This test changes only when the owner decides the history must survive.
      const environment = stagingGuest();
      try {
        const s = session(environment, journeyScriptedModel(SCENARIO), true);
        await typed(s, SCENARIO.guestTurns[0]!.text);
        proposalCard(await typed(s, "Request the first one."));
        assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
        const undone = await chip(s, CRITERIA_UNDO_EVENT, {});
        assert.equal(undone.ok, false);
        assert.equal(undone.ok ? "" : undone.code, "NOTHING_TO_UNDO");
        assert.equal(pendingId(s), null, "the proposal stays removed");
        const yes = await typed(s, "Yes");
        assertOk(yes, "yes");
        if (!yes.ok) throw new Error("unreachable");
        assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
      } finally { environment.close(); }
    });
  }

  test(`(task events, ${mode}) A same-task switch click and a starter click while Stays is open keep the proposal; a failed switch keeps it and a later typed yes still confirms.`, async () => {
    // A phone-holding guest: the later typed yes confirms a still-valid proposal, which needs a phone (finding 9).
    // Discrimination note: the actual-change guard on this event path is not observable through the live state. The switch restores
    // a clone taken before the removal, and #syncActiveTask rewrites the stored copy from the committed state, so removing the guard
    // leaves every assertion here unchanged. The planner-path test below is the one that kills the unconditional-removal mutant.
    const environment = phoneGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold, true);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      const before = pendingId(s);
      const activeTaskId = s.step().runtime.getThread(THREAD).activeTaskId;

      assertOk(await taskEvent(s, TASK_SWITCH_EVENT, { taskId: activeTaskId }), "same-task switch");
      assert.equal(pendingId(s), before, "switching to the task already open keeps the proposal");

      assertOk(await taskEvent(s, TASK_START_EVENT, { domain: "shortlet" }), "starter for Stays");
      assert.equal(pendingId(s), before, "the Stays starter while Stays is open keeps the proposal");

      const unknown = await taskEvent(s, TASK_SWITCH_EVENT, { taskId: "task-unknown-0000" });
      assert.equal(unknown.ok, false, "an unknown task is refused");
      assert.equal(pendingId(s), before, "a failed switch keeps the proposal");

      const unknownDomain = await taskEvent(s, TASK_START_EVENT, { domain: "mars" });
      assert.equal(unknownDomain.ok, false, "an unknown domain is refused");
      assert.equal(pendingId(s), before, "a failed domain start keeps the proposal");

      const yes = await typed(s, "Yes");
      assertOk(yes, "yes after failed switches");
      if (!yes.ok) throw new Error("unreachable");
      assert.notDeepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the proposal is still authorised, so the yes is not the replaced reply");
    } finally { environment.close(); }
  });

  test(`(model-invoked switches, ${mode}) A planner switch to an unknown task or domain fails and keeps a valid proposal; a later typed yes still confirms.`, async () => {
    // A phone-holding guest: the later typed yes confirms a still-valid proposal, which needs a phone (finding 9).
    // The refused switch returns its closed error from the tool path. An unconditional removal on that path would clear the live
    // proposal, because the refused call returns the same state object; this test is what catches that mutant.
    const environment = phoneGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold, true);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      const before = pendingId(s);
      assert.ok(before);

      const unknownTask = await typed(s, UNKNOWN_TASK_TEXT);
      assertOk(unknownTask, "a refused switch is a turn, not a failure");
      assert.equal(pendingId(s), before, "a refused task switch keeps the proposal");

      const unknownDomain = await typed(s, UNKNOWN_DOMAIN_TEXT);
      assertOk(unknownDomain, "a refused domain start is a turn, not a failure");
      assert.equal(pendingId(s), before, "a refused domain start keeps the proposal");

      const yes = await typed(s, "Yes");
      assertOk(yes, "yes after refused switches");
      if (!yes.ok) throw new Error("unreachable");
      assert.notDeepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the proposal is still authorised");
      assert.ok(yes.surfaces.some((surface) => /:request:/.test(surface.surfaceId)), "the confirmed proposal opens its request");
    } finally { environment.close(); }
  });

  test(`(task switch, ${mode}) A real switch to another task removes the proposal: the typed yes sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold, true);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      assertOk(await taskEvent(s, TASK_START_EVENT, { domain: "shop" }), "start the shop task");
      assert.equal(pendingId(s), null, "the real switch removes the proposal");
      // The proposal belonged to the shortlet task the guest left, so nothing is sent on the shop task either.
      const yes = await typed(s, "Yes");
      assertOk(yes, "yes");
      assert.equal(requestSent(yes), false, "no request is sent after the real switch");
    } finally { environment.close(); }
  });

  test(`(notice lifetime, ${mode}) The replaced notice survives an unrelated typed turn: the next yes still gets the replaced reply and sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = session(environment, journeyScriptedModel(SCENARIO), cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
      assert.equal(pendingId(s), null);
      await typed(s, "Thanks, that helps");
      const yes = await typed(s, "Yes");
      assertOk(yes, "yes after an unrelated turn");
      if (!yes.ok) throw new Error("unreachable");
      assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the notice is consumed only by a confirmation or cancellation attempt");
      assert.equal(requestSent(yes), false);
    } finally { environment.close(); }
  });
}
