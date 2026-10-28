import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
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
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";

// ADR 0074 (owner decision, 28 Oct 2026; review follow-up): a stay change removes an open Booking Request proposal however it
// happens. The stay changes through a planner search (already covered), a criteria chip edit or undo, or a task switch. A
// task switch or chip edit that changes nothing keeps the proposal, and a failed switch changes nothing.
//
// Every scenario runs warm (one application) and cold (a new application before every event, on the 27 Oct 2026 clock). The
// guest is staging-like (no phone). Only the scenarios whose confirm path needs a phone number use a phone-holding guest, and
// they say so where they start.

const THREAD = "g-d1a0000720";

/** Every typed text the scenarios send, with the planner answer each one gets. The chip and task events are not typed. */
const SCENARIO: RecordedJourneyDefinition = {
  name: "supersession-scenarios",
  threadId: THREAD,
  description: "Supersession scenarios (not recorded).",
  withSecondDomain: true,
  guestTurns: [
    { text: "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026", planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: "Request the first one.", planner: PROPOSE_REQUEST },
    { text: "Yes" },
    { text: "Thanks, that helps" },
  ],
};

type Fixture = Omit<DatedFixture, "close">;

/** A session drives one thread. Cold sessions build a new application for each step; warm sessions keep one. */
function session(environment: LocalGuestEnvironment, model: AssistantModelClient, cold: boolean, packs = false) {
  const shop = packs ? [createFakeShopPack()] : undefined;
  let warm: Fixture | undefined;
  const next = (): Fixture => {
    if (cold) return wireDatedFixture(environment, model, shop);
    warm ??= wireDatedFixture(environment, model, shop);
    return warm;
  };
  return {
    /** The fixture for one step, with the thread loaded as a page load does. */
    step(): Fixture {
      const fixture = next();
      fixture.app.getState(THREAD);
      return fixture;
    },
  };
}

function wireDatedFixture(environment: LocalGuestEnvironment, model: AssistantModelClient, shop: ReturnType<typeof createFakeShopPack>[] | undefined): Fixture {
  return wireDatedApp(environment, model, undefined, shop);
}

/** The criteria key the strip last showed this session; a chip edit must name it (basedOn), as the page does. */
const keys = new WeakMap<object, string>();

function remember(s: ReturnType<typeof session>, result: GuestTurnResult): GuestTurnResult {
  if (result.ok && result.criteria?.key) keys.set(s, result.criteria.key);
  return result;
}

async function typed(s: ReturnType<typeof session>, text: string): Promise<GuestTurnResult> {
  return remember(s, await s.step().app.handleTurn(THREAD, text));
}

/**
 * A chip edit or undo as the page sends it. The key comes from the last result, not from getState: a page load resets the
 * assistant undo history (see the issue 03 Comments), so a warm session never reloads between the steps of one scenario.
 */
async function chip(s: ReturnType<typeof session>, name: string, context: Record<string, unknown>): Promise<GuestTurnResult> {
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

function assertOk(result: GuestTurnResult, label: string): void {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: ${result.code} ${result.message}`);
}

/** The live proposal card's confirm button, as the guest would press it (the first button on the card). */
function proposalCard(result: GuestTurnResult) {
  assertOk(result, "propose");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "a proposal card is returned");
  return card;
}

function pendingId(s: ReturnType<typeof session>): string | null {
  return s.step().runtime.getThread(THREAD).taskState.pendingAction?.id ?? null;
}

function requestSent(result: GuestTurnResult): boolean {
  return result.ok && result.surfaces.some((surface) => /:request:/.test(surface.surfaceId));
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(chip edit, typed yes, ${mode}) A guests chip edit that changes the party size removes the proposal: the typed yes sends nothing.`, async () => {
    // A phone-holding guest: a confirm that wrongly got through would send the request, which the assertion below catches.
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      const proposal = await typed(s, "Request the first one.");
      proposalCard(proposal);
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
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      const card = proposalCard(await typed(s, "Request the first one."));
      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");

      const pressed = await s.step().app.handleEventAsync(THREAD, firstButtonAction(card));
      assert.equal(pressed.ok, false, "the old card is refused");
      assert.equal(pressed.ok ? "" : pressed.code, "STALE_SURFACE");
      assert.equal(requestSent(pressed as GuestTurnResult), false, "no request is sent");
    } finally { environment.close(); }
  });

  // Chip undo is not exercised here: in an assistant thread the undo history is reset by every typed turn and by every page
  // load (assistant context search sets it to the current search), so no proposal can exist on an undoable history. See the
  // issue 03 Comments (pre-existing, reported to the owner).
  test(`(chip no-op, ${mode}) A chip edit that changes nothing keeps a valid proposal.`, async () => {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      const before = pendingId(s);
      assert.ok(before);
      assertOk(await chip(s, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2 }), "guests chip to the same value");
      assert.equal(pendingId(s), before, "a chip edit that changes nothing keeps the proposal");
    } finally { environment.close(); }
  });

  test(`(task events, ${mode}) A same-task switch click and a starter click while already in Stays keep the proposal; a failed switch keeps it and a later typed yes still confirms.`, async () => {
    // A phone-holding guest: the later typed yes must reach the deterministic confirm path, which needs a phone (finding 9).
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold, true);
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

  test(`(task switch, ${mode}) A real switch to another task removes the proposal: the typed yes says it was replaced and sends nothing.`, async () => {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold, true);
      await typed(s, SCENARIO.guestTurns[0]!.text);
      proposalCard(await typed(s, "Request the first one."));
      assertOk(await taskEvent(s, TASK_START_EVENT, { domain: "shop" }), "start the shop task");
      assert.equal(pendingId(s), null, "the real switch removes the proposal");
      // The proposal belonged to the shortlet task the guest left, so nothing is sent on the shop task either.
      const yes = await typed(s, "Yes");
      assertOk(yes, "yes");
      assert.equal(requestSent(yes as GuestTurnResult), false, "no request is sent after the real switch");
    } finally { environment.close(); }
  });

  test(`(notice lifetime, ${mode}) The replaced notice survives an unrelated typed turn: the next yes still gets the replaced reply and sends nothing.`, async () => {
    const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
    try {
      const model = journeyScriptedModel(SCENARIO);
      const s = session(environment, model, cold);
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

/** A client-style task event: the shell routes it to the runtime's task handler. */
async function taskEvent(s: ReturnType<typeof session>, name: string, context: Record<string, unknown>): Promise<GuestTurnResult> {
  return s.step().app.handleEventAsync(THREAD, {
    name,
    surfaceId: "thread-" + THREAD + ":tasks",
    sourceComponentId: "task-rail",
    timestamp: LIVE_LIKE_CLOCK().toISOString(),
    context,
  });
}
