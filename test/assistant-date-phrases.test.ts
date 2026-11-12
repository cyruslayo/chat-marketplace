import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import type { GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
import {
  coldRun,
  datedFixture,
  firstButtonAction,
  LIVE_LIKE_CLOCK,
  restartedDatedApp,
  scriptedPlanner,
  successfulTurn,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";

// Issue 04 (ADR 0106, 2 Nov 2026 amendment): a relative date phrase is resolved on the server and shown back before any search.
// Every turn runs on a fresh thread, with the assistant runtime enabled, the staging-like clock (27 Oct 2026, a Tuesday) and a
// guest with no phone or email. Every event is a cold restore (a new application over the same store).

const AREA = "Old Ikoyi";
const STAY = { city: "Lagos", neighbourhood: AREA, guests: 2, nights: 3 } as const;

/** Ambiguous on this clock: 30 Oct 2026 or 6 Nov 2026 (ADR 0106, 2 Nov: a tap chooses; nothing authorized until then). */
const NEXT_FRIDAY_TEXT = "Flat in Old Ikoyi next Friday for 3 nights, 2 guests";
/** A single relative day on this clock: Tue 10 Nov 2026 (arriving), Fri 13 Nov 2026 (leaving). */
const IN_TWO_WEEKS_TEXT = "Flat in Old Ikoyi in two weeks for 3 nights, 2 guests";
const IN_TWO_WEEKS_CHECK_IN = "2026-11-10";
const SHOW_BACK_PATTERN = /Just to check: arriving Tue 10 Nov 2026 and leaving Fri 13 Nov 2026 \(3 nights\), 2 guests in Old Ikoyi/;
const UNRELATED_TEXT = "What is the wifi like there?";
const YES = "Yes";

const SCRIPT: Record<string, ScriptedTurn> = {
  [IN_TWO_WEEKS_TEXT]: { slots: STAY, intents: ["search"], search: { ...STAY, checkInPhrase: "in two weeks" } },
  [NEXT_FRIDAY_TEXT]: { slots: STAY, intents: ["search"], search: { ...STAY, checkInPhrase: "next Friday" } },
  [YES]: { slots: {}, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkIn: IN_TWO_WEEKS_CHECK_IN, nights: 3, guests: 2 } },
  [UNRELATED_TEXT]: { slots: {}, intents: ["clarify"], reply: "clarify_stay" },
  "Fri 6 Nov 2026": { slots: { checkIn: "2026-11-06" }, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-06", nights: 3, guests: 2 } },
  "Flat in Old Ikoyi next week for 3 nights, 2 guests": { slots: STAY, intents: ["search"], search: { ...STAY, checkInPhrase: "next week" } },
  "Flat in Old Ikoyi next month for 3 nights, 2 guests": { slots: STAY, intents: ["search"], search: { ...STAY, checkInPhrase: "next month" } },
  "Flat in Old Ikoyi for 3 nights, 2 guests": { slots: STAY, intents: ["search"], search: { ...STAY, checkInPhrase: "next Friday" } },
};

function fixture(): DatedFixture {
  return datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
}

/** The committed assistant state of a thread after the turn (read from the runtime that handled it). */
function stayIntentOf(runtime: AssistantRuntime, threadId: string): AssistantTaskState {
  return runtime.getThread(threadId).taskState;
}

function quickReplies(result: GuestTurnSuccess): readonly string[] {
  return (result.quickReplies ?? []).map((chip) => chip.label);
}

test("AC1: \"Flat in Ikoyi next Friday for 3 nights, 2 guests\" gives two date chips and runs no search", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000101";
    const { result, runtime } = await coldRun(f, threadId, NEXT_FRIDAY_TEXT, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "next Friday");
    assert.deepEqual(quickReplies(turn), ["Fri 30 Oct 2026", "Fri 6 Nov 2026"], "one chip per candidate date");
    assert.deepEqual(turn.surfaces, [], "no results surface is shown before the guest picks a day");
    assert.equal(stayIntentOf(runtime, threadId).shortlist.length, 0, "no search ran");
    assert.equal(stayIntentOf(runtime, threadId).stayIntent.checkIn, undefined, "neither candidate is authorized yet");
  } finally { f.close(); }
});

test("AC2: Yes after the show-back searches those dates, and the criteria strip shows them", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000102";
    const shown = successfulTurn((await coldRun(f, threadId, IN_TWO_WEEKS_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    assert.match(shown.messages[0] ?? "", SHOW_BACK_PATTERN, "the show-back names the concrete dates, nights and party");
    assert.deepEqual(quickReplies(shown), [GUEST_ASSISTANT_COPY.dateConfirmChip, GUEST_ASSISTANT_COPY.dateChangeChip], "Yes and Change dates chips");

    const confirmed = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(confirmed.result, "Yes");
    assert.ok(turn.surfaces.length > 0, "the confirmed dates are searched");
    const state = stayIntentOf(confirmed.runtime, threadId);
    assert.equal(state.stayIntent.checkIn, IN_TWO_WEEKS_CHECK_IN, "the confirmed check-in is the server-owned date");
    assert.equal(state.stayIntent.checkOut, "2026-11-13", "the checkout is the confirmed nights after the check-in");
    assert.equal(state.stayIntent.nights, 3);
  } finally { f.close(); }
});

test("AC3 failure path: an unrelated reply after the show-back does not confirm and runs no search", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000103";
    successfulTurn((await coldRun(f, threadId, IN_TWO_WEEKS_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    const unrelated = await coldRun(f, threadId, UNRELATED_TEXT, scriptedPlanner(SCRIPT).client);
    successfulTurn(unrelated.result, "unrelated reply");
    assert.equal(stayIntentOf(unrelated.runtime, threadId).stayIntent.checkIn, undefined, "the unrelated reply does not authorize the date");
    assert.equal(stayIntentOf(unrelated.runtime, threadId).shortlist.length, 0, "no search ran");
    // A later Yes has nothing to confirm: the show-back was closed by the unrelated reply.
    const yes = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    const answer = successfulTurn(yes.result, "later yes");
    assert.equal(stayIntentOf(yes.runtime, threadId).stayIntent.checkIn, undefined, "a later yes does not confirm a closed show-back");
    assert.deepEqual(answer.surfaces, [], "a later yes shows no results");
    assert.equal(answer.messages[0], GUEST_ASSISTANT_COPY.datesClarification, "a later yes asks for the dates in plain words");
  } finally { f.close(); }
});

test("AC4: an ambiguous phrase offers one chip per candidate, and choosing one searches that date", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000104";
    const offered = successfulTurn((await coldRun(f, threadId, NEXT_FRIDAY_TEXT, scriptedPlanner(SCRIPT).client)).result, "ambiguous");
    assert.equal(quickReplies(offered).length, 2, "one chip per candidate");
    const chosen = await coldRun(f, threadId, "Fri 6 Nov 2026", scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(chosen.result, "chosen candidate");
    assert.ok(turn.surfaces.length > 0, "the chosen date is searched");
    assert.equal(stayIntentOf(chosen.runtime, threadId).stayIntent.checkIn, "2026-11-06", "the chosen date is the check-in");
  } finally { f.close(); }
});

test("AC5: \"next week\" or \"next month\" never searches before the guest picks a day", async () => {
  const f = fixture();
  try {
    for (const [index, text] of ["Flat in Old Ikoyi next week for 3 nights, 2 guests", "Flat in Old Ikoyi next month for 3 nights, 2 guests"].entries()) {
      const threadId = `g-d4a00001a${index}`;
      const refused = successfulTurn((await coldRun(f, threadId, text, scriptedPlanner(SCRIPT).client)).result, text);
      assert.equal(refused.messages[0], GUEST_ASSISTANT_COPY.datesClarification, `${text}: the dates clarification`);
      assert.deepEqual(refused.surfaces, [], `${text}: no search surface`);
    }
  } finally { f.close(); }
});

test("AC6 failure path: a phrase not present in guest text is a tool_denial", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000106";
    const refused = successfulTurn((await coldRun(f, threadId, "Flat in Old Ikoyi for 3 nights, 2 guests", scriptedPlanner(SCRIPT).client)).result, "not authored");
    assert.equal(refused.messages[0], GUEST_ASSISTANT_COPY.datesClarification, "a phrase the guest did not write is refused with the dates clarification");
    assert.deepEqual(refused.surfaces, [], "no search runs");
  } finally { f.close(); }
});

test("AC7 failure path: a cold restore keeps the pending show-back, so a Yes after the restore confirms it", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000107";
    successfulTurn((await coldRun(f, threadId, IN_TWO_WEEKS_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    // A new application (a cold restore) before the Yes: the pending show-back is still there.
    const yes = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    assert.equal(stayIntentOf(yes.runtime, threadId).stayIntent.checkIn, IN_TWO_WEEKS_CHECK_IN, "the restored show-back confirms the same date");
  } finally { f.close(); }
});

test("AC7 failure path: a show-back superseded by a later phrase does not confirm the earlier date", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000108";
    successfulTurn((await coldRun(f, threadId, IN_TWO_WEEKS_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    // The guest asks for another day: the earlier show-back is superseded (ADR 0074), so a yes confirms nothing.
    successfulTurn((await coldRun(f, threadId, NEXT_FRIDAY_TEXT, scriptedPlanner(SCRIPT).client)).result, "superseding phrase");
    const yes = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    assert.equal(stayIntentOf(yes.runtime, threadId).stayIntent.checkIn, undefined, "the superseded date is not confirmed");
  } finally { f.close(); }
});

test("AC8: the journey runs with the assistant enabled and a cold restore before every event, on the staging clock", async () => {
  const f = fixture();
  try {
    const threadId = "g-d4a0000109";
    const shown = successfulTurn((await coldRun(f, threadId, IN_TWO_WEEKS_TEXT, scriptedPlanner(SCRIPT).client)).result, "search");
    const confirmed = successfulTurn((await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client)).result, "confirm");
    assert.ok(shown.messages.length > 0 && confirmed.surfaces.length > 0, "the dates are searched after the cold-restored confirmation");
    const search = confirmed.surfaces[0]!;
    const restored = restartedDatedApp(f, scriptedPlanner({}).client);
    restored.app.getState(threadId);
    const detail = successfulTurn(await restored.app.handleEventAsync(threadId, firstButtonAction(search)), "View");
    assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail after the restore");
  } finally { f.close(); }
});
