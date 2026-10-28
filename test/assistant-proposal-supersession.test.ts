import assert from "node:assert/strict";
import test from "node:test";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT, type GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { PROPOSAL_REPLACED_COPY, PROPOSE_REQUEST, SEARCH_IKOYI, journeyScriptedModel, type RecordedJourneyDefinition } from "./helpers/assistant-recordings.js";
import { firstButtonAction } from "./helpers/guest-date-fixtures.js";
import { assertOk, openChipDriver, phoneGuest, proposalCard, requestSent, stagingGuest } from "./helpers/assistant-chip-session.js";

// ADR 0074 (owner decision, 28 Oct 2026; review follow-up): a stay change removes an open Booking Request proposal however it
// happens: a planner search, a criteria chip edit or undo, or a task switch. A switch or chip edit that changes nothing keeps
// the proposal, and a switch that fails changes nothing.
//
// Scenarios run warm (one application) and cold (a new application before every event, on the 27 Oct 2026 clock). The guest is
// staging-like (no phone, openJourneyEnvironment) unless the scenario confirms a still-valid proposal: that confirm reaches the
// deterministic path, which needs a phone (finding 9), so only those scenarios use a phone-holding guest (phoneGuest), and each
// says so where it starts.

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

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(chip edit, typed yes, ${mode}) A guests chip edit that changes the party size removes the proposal: the typed yes sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      assert.ok(s.pendingId(), "the proposal is open before the chip edit");

      assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
      assert.equal(s.pendingId(), null, "the chip edit that changes the party size removes the proposal");

      const yes = await s.typed("Yes");
      assertOk(yes, "yes");
      if (!yes.ok) throw new Error("unreachable");
      assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
      assert.equal(requestSent(yes), false, "no request is sent");
    } finally { environment.close(); }
  });

  test(`(chip edit, button, ${mode}) After a chip edit, the old card's confirm button returns STALE_SURFACE and sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      const card = proposalCard(await s.typed("Request the first one."));
      assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");

      const pressed = await s.step().app.handleEventAsync(THREAD, firstButtonAction(card));
      assert.equal(pressed.ok, false, "the old card is refused");
      assert.equal(pressed.ok ? "" : pressed.code, "STALE_SURFACE");
      assert.equal(requestSent(pressed as GuestTurnResult), false, "no request is sent");
    } finally { environment.close(); }
  });

  test(`(chip no-op, ${mode}) A chip edit that changes nothing keeps a valid proposal.`, async () => {
    const environment = stagingGuest();
    try {
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      const before = s.pendingId();
      assert.ok(before);
      assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2 }), "guests chip to the same value");
      assert.equal(s.pendingId(), before, "a chip edit that changes nothing keeps the proposal");
    } finally { environment.close(); }
  });

  // Undo runs warm only: the cold variant below pins NOTHING_TO_UNDO (see the issue 03 Comments).
  if (!cold) {
    test("(chip undo, warm) Undo restores the searched stay, but the proposal made before the edit stays removed: the typed yes and the old card send nothing.", async () => {
      const environment = stagingGuest();
      try {
        const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: false, threadId: THREAD });
        await s.typed(SCENARIO.guestTurns[0]!.text);
        const proposal = proposalCard(await s.typed("Request the first one."));
        assert.ok(s.pendingId(), "the proposal is open on the searched stay");

        // The chip edit removes the proposal. Undo steps back to the searched stay (party size 2), and that does not bring the
        // proposal back: the rule removes authority, and only a new proposal can make a new one.
        assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
        assert.equal(s.pendingId(), null, "the edit removes the proposal");
        const undone = await s.chip(CRITERIA_UNDO_EVENT, {});
        assertOk(undone, "undo");
        if (!undone.ok) throw new Error("unreachable");
        assert.equal(undone.criteria?.guests?.count, 2, "undo restores the searched party size");
        assert.equal(s.pendingId(), null, "undo does not restore the removed proposal");

        const yes = await s.typed("Yes");
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
        const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
        await s.typed(SCENARIO.guestTurns[0]!.text);
        proposalCard(await s.typed("Request the first one."));
        assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
        const undone = await s.chip(CRITERIA_UNDO_EVENT, {});
        assert.equal(undone.ok, false);
        assert.equal(undone.ok ? "" : undone.code, "NOTHING_TO_UNDO");
        assert.equal(s.pendingId(), null, "the proposal stays removed");
        const yes = await s.typed("Yes");
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
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD, withShopTask: true });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      const before = s.pendingId();
      const activeTaskId = s.step().runtime.getThread(THREAD).activeTaskId;

      assertOk(await s.taskEvent(TASK_SWITCH_EVENT, { taskId: activeTaskId }), "same-task switch");
      assert.equal(s.pendingId(), before, "switching to the task already open keeps the proposal");

      assertOk(await s.taskEvent(TASK_START_EVENT, { domain: "shortlet" }), "starter for Stays");
      assert.equal(s.pendingId(), before, "the Stays starter while Stays is open keeps the proposal");

      const unknown = await s.taskEvent(TASK_SWITCH_EVENT, { taskId: "task-unknown-0000" });
      assert.equal(unknown.ok, false, "an unknown task is refused");
      assert.equal(s.pendingId(), before, "a failed switch keeps the proposal");

      const unknownDomain = await s.taskEvent(TASK_START_EVENT, { domain: "mars" });
      assert.equal(unknownDomain.ok, false, "an unknown domain is refused");
      assert.equal(s.pendingId(), before, "a failed domain start keeps the proposal");

      const yes = await s.typed("Yes");
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
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD, withShopTask: true });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      const before = s.pendingId();
      assert.ok(before);

      const unknownTask = await s.typed(UNKNOWN_TASK_TEXT);
      assertOk(unknownTask, "a refused switch is a turn, not a failure");
      assert.equal(s.pendingId(), before, "a refused task switch keeps the proposal");

      const unknownDomain = await s.typed(UNKNOWN_DOMAIN_TEXT);
      assertOk(unknownDomain, "a refused domain start is a turn, not a failure");
      assert.equal(s.pendingId(), before, "a refused domain start keeps the proposal");

      const yes = await s.typed("Yes");
      assertOk(yes, "yes after refused switches");
      if (!yes.ok) throw new Error("unreachable");
      assert.notDeepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the proposal is still authorised");
      assert.ok(yes.surfaces.some((surface) => /:request:/.test(surface.surfaceId)), "the confirmed proposal opens its request");
    } finally { environment.close(); }
  });

  test(`(task switch, ${mode}) A real switch to another task removes the proposal: the typed yes sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD, withShopTask: true });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      assertOk(await s.taskEvent(TASK_START_EVENT, { domain: "shop" }), "start the shop task");
      assert.equal(s.pendingId(), null, "the real switch removes the proposal");
      // The proposal belonged to the shortlet task the guest left, so nothing is sent on the shop task either.
      const yes = await s.typed("Yes");
      assertOk(yes, "yes");
      assert.equal(requestSent(yes), false, "no request is sent after the real switch");
    } finally { environment.close(); }
  });

  test(`(notice lifetime, ${mode}) The replaced notice survives an unrelated typed turn: the next yes still gets the replaced reply and sends nothing.`, async () => {
    const environment = stagingGuest();
    try {
      const s = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await s.typed(SCENARIO.guestTurns[0]!.text);
      proposalCard(await s.typed("Request the first one."));
      assertOk(await s.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
      assert.equal(s.pendingId(), null);
      await s.typed("Thanks, that helps");
      const yes = await s.typed("Yes");
      assertOk(yes, "yes after an unrelated turn");
      if (!yes.ok) throw new Error("unreachable");
      assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the notice is consumed only by a confirmation or cancellation attempt");
      assert.equal(requestSent(yes), false);
    } finally { environment.close(); }
  });
}
