import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT } from "../apps/local-guest/src/shortlet-app.js";
import { PROPOSAL_REPLACED_COPY, SEARCH_IKOYI, journeyScriptedModel, type RecordedJourneyDefinition } from "./helpers/assistant-recordings.js";
import { assertOk, openChipDriver, proposalCard, requestSent, stagingGuest, type ChipDriver } from "./helpers/assistant-chip-session.js";

// Review follow-up on 0ea551f..c4d172c (owner decision, 28 Oct 2026): the "where" (area) chip must reach the assistant's task state
// and its persisted context, exactly as the "when" and "guests" chips do. Before the fix the area never reached stayIntent or
// thread.assistantContext, so every cold request rebuilt the discovery from the old area and named the old stay (ADR 0106, 0092,
// 0093, 0074, 0075).
//
// Every scenario runs warm and cold on the 27 Oct 2026 clock. The cold driver restores the thread before every step. The guest is
// staging-like (no phone): no scenario here confirms a proposal, so the phone-only confirm path is not reached.

const THREAD = "g-d1a0000801";
const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
const PROPOSE_TEXT = "Request to book the first one.";
const OLD_AREA = "old-ikoyi";
const NEW_AREA = "lekki-phase-1";
const OLD_LABEL = "Old Ikoyi, Lagos";
const NEW_LABEL = "Lekki Phase 1, Lagos";
const NEW_UNIT_MARKER = /lekki/i;
const OLD_UNIT_MARKER = /ikoyi/i;

const SCENARIO: RecordedJourneyDefinition = {
  name: "where-chip-scenarios",
  threadId: THREAD,
  description: "Where-chip scenarios (not recorded).",
  withSecondDomain: false,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: PROPOSE_TEXT, planner: { tool: "propose_request_to_book", args: { stayRef: "stay-1" } } },
    { text: "Thanks, that helps" },
  ],
};

/** The discovery card the page shows: its route names the area the results are for. */
function shownArea(driver: ChipDriver): { readonly where?: string; readonly routes: string[] } {
  const state = driver.step().app.getState(THREAD);
  assert.ok(state, "the thread is readable");
  return {
    where: state.criteria?.where?.label,
    routes: state.surfaces.map((surface) => surface.conventionalRoute ?? "").filter((route) => route !== ""),
  };
}

function proposalUnit(driver: ChipDriver): string | undefined {
  return driver.step().runtime.getThread(THREAD).taskState.pendingAction?.authoritativeReferences.unitId;
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(a, ${mode}) A where chip shows the new area's discovery on reload, not the old area's.`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await driver.typed(SEARCH_TEXT);
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "where chip");

      const shown = shownArea(driver);
      assert.equal(shown.where, NEW_LABEL, "the strip shows the new area after a reload");
      assert.ok(shown.routes.some((route) => /neighbourhood=Lekki/.test(route)), "the discovery card is for the new area");
      assert.ok(!shown.routes.some((route) => /neighbourhood=Old\+Ikoyi|neighbourhood=Old%20Ikoyi/.test(route)), "the old area's discovery is not rebuilt");
      assert.equal(driver.stay().neighbourhood, "Lekki Phase 1", "the assistant's stay intent holds the new area");
    } finally { environment.close(); }
  });

  test(`(b, ${mode}) After a where chip, a typed request to book names the new area's stay, not the old one.`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await driver.typed(SEARCH_TEXT);
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "where chip");
      const proposal = proposalCard(await driver.typed(PROPOSE_TEXT));
      assert.ok(proposal);
      const unit = proposalUnit(driver);
      assert.ok(unit, "a proposal is open");
      assert.match(unit, NEW_UNIT_MARKER, "the proposal names a Lekki stay");
      assert.doesNotMatch(unit, OLD_UNIT_MARKER, "the proposal does not name the old Ikoyi stay");
    } finally { environment.close(); }
  });

  test(`(c, ${mode}) A guests chip after a where chip keeps the new area on every reload.`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await driver.typed(SEARCH_TEXT);
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "where chip");
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip after the where chip");

      const shown = shownArea(driver);
      assert.equal(shown.where, NEW_LABEL, "the guests chip does not rebuild from the old area");
      assert.ok(shown.routes.some((route) => /neighbourhood=Lekki/.test(route)));
      assert.equal(driver.stay().neighbourhood, "Lekki Phase 1");
      assert.equal(driver.stay().partySize, 1, "the party size chip is recorded beside the area");
    } finally { environment.close(); }
  });

  if (!cold) {
    test("(d, warm) Undo of a where chip restores the previous area, consistently on the strip and in the assistant's stay.", async () => {
      const environment = stagingGuest();
      try {
        const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: false, threadId: THREAD });
        await driver.typed(SEARCH_TEXT);
        assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "where chip");
        assertOk(await driver.chip(CRITERIA_UNDO_EVENT, {}), "undo the where chip");

        const shown = shownArea(driver);
        assert.equal(shown.where, OLD_LABEL, "the strip shows the previous area after undo");
        assert.ok(shown.routes.some((route) => /neighbourhood=Old\+Ikoyi/.test(route)), "the previous area's discovery is back");
        assert.equal(driver.stay().neighbourhood, "Old Ikoyi", "the assistant's stay intent is back on the previous area");
      } finally { environment.close(); }
    });
  } else {
    test("(d, cold) A cold undo of a where chip reports NOTHING_TO_UNDO: a page load resets the undo history (issue 03 Comments), so the area stays on the new one and the strip agrees with it.", async () => {
      const environment = stagingGuest();
      try {
        const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
        await driver.typed(SEARCH_TEXT);
        assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "where chip");
        const undone = await driver.chip(CRITERIA_UNDO_EVENT, {});
        assert.equal(undone.ok, false);
        assert.equal(undone.ok ? "" : undone.code, "NOTHING_TO_UNDO");
        assert.equal(shownArea(driver).where, NEW_LABEL, "the strip still shows the new area");
        assert.equal(driver.stay().neighbourhood, "Lekki Phase 1", "the assistant's stay still agrees with the strip");
      } finally { environment.close(); }
    });
  }

  test(`(e, ${mode}) A where chip that names the same area keeps a valid proposal; one that changes the area removes it.`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await driver.typed(SEARCH_TEXT);
      proposalCard(await driver.typed(PROPOSE_TEXT));
      const before = driver.pendingId();
      assert.ok(before, "the proposal is open");

      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: OLD_AREA }), "the same area");
      assert.equal(driver.pendingId(), before, "a where chip that names the same area keeps the proposal");

      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: NEW_AREA }), "a new area");
      assert.equal(driver.pendingId(), null, "a where chip that changes the area removes the proposal");
      const yes = await driver.typed("Yes");
      assertOk(yes, "yes");
      if (!yes.ok) throw new Error("unreachable");
      assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
      assert.equal(requestSent(yes), false, "no request is sent");
    } finally { environment.close(); }
  });

  test(`(f, ${mode}) A where chip with an unknown area fails closed: it is rejected and the state is unchanged.`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold, threadId: THREAD });
      await driver.typed(SEARCH_TEXT);
      const proposal = proposalCard(await driver.typed(PROPOSE_TEXT));
      assert.ok(proposal);
      const before = driver.pendingId();
      const forged = await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: "mars-central" });
      assert.equal(forged.ok, false, "an unknown area is refused");
      assert.equal(forged.ok ? "" : forged.code, "INVALID_CRITERIA");
      assert.equal(shownArea(driver).where, OLD_LABEL, "the strip keeps the area it had");
      assert.equal(driver.stay().neighbourhood, "Old Ikoyi", "the assistant's stay is unchanged");
      assert.equal(driver.pendingId(), before, "the proposal is unchanged");
    } finally { environment.close(); }
  });
}
