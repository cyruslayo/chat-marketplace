import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId, type GuestTurnResult, type GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { CapturedRequest } from "./helpers/openai-compatible-client.js";
import { datedFixture, restartedDatedApp, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";

const LEKKI_FIRST = "Find apartments in Lekki Phase 1, Lagos, for 4 nights and 2 guests.";
const CHIP_FOLLOW_UP = "2 guests";
const CHIP_CHECK_IN = "2026-11-20";
const CHIP_CHECK_OUT = "2026-11-24";
const OWNER_DATED = "Lekki Phase 1, check in 20 November 2026 for 3 nights, 2 guests";
const MODEL_ONLY = "Two guests, please";
const LEKKI = { city: "Lagos", neighbourhood: "Lekki Phase 1" };

function successOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `expected success, saw ${result.code}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** Chooses a check-in and four nights on the date chip, as the guest does in the criteria strip. */
function chooseChipDates(f: DatedFixture, threadId: string, checkIn: string, nights: number) {
  const basedOn = f.app.getState(threadId)?.criteria?.key;
  assert.ok(basedOn, "the thread exposes its criteria key");
  return f.app.handleEvent(threadId, {
    name: CRITERIA_EDIT_EVENT,
    surfaceId: criteriaSurfaceId(threadId),
    sourceComponentId: "date-chip",
    timestamp: new Date().toISOString(),
    context: { field: "when", checkIn, nights, basedOn },
  });
}

/** The planner request (a non-classifier request) whose conversation ends with the given guest message. */
function plannerRequestFor(requests: readonly CapturedRequest[], text: string): CapturedRequest {
  const found = requests.filter((request) => JSON.stringify(request.body.messages).includes(text)).at(-1);
  assert.ok(found, `the planner saw "${text}"`);
  return found;
}

/** The text the planner was shown: its message contents, with the state summary JSON unescaped. */
function plannerText(request: CapturedRequest): string {
  const messages = request.body.messages as readonly { readonly content?: unknown }[];
  return messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
}

const SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  [LEKKI_FIRST]: { slots: { ...LEKKI, nights: 4, guests: 2 }, search: { ...LEKKI, nights: 4, guests: 2 } },
  [CHIP_FOLLOW_UP]: { slots: { guests: 2 }, search: { ...LEKKI, checkIn: CHIP_CHECK_IN, nights: 4, guests: 2 } },
  [OWNER_DATED]: { slots: { ...LEKKI, checkIn: "2026-11-20", nights: 3, guests: 2 }, search: { ...LEKKI, checkIn: "2026-11-20", nights: 3, guests: 2 } },
  [MODEL_ONLY]: { slots: { guests: 2 }, search: { ...LEKKI, checkIn: "2026-11-25", nights: 4, guests: 2 } },
};

test("A chip date survives getState and the next planner turn", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client);
  try {
    const threadId = "g-c1a0000001";
    successOf(await f.app.handleTurn(threadId, LEKKI_FIRST));
    successOf(chooseChipDates(f, threadId, CHIP_CHECK_IN, 4));
    assert.equal(f.app.getState(threadId)?.criteria?.when?.checkIn, CHIP_CHECK_IN, "getState keeps the chip date");
    const followUp = successOf(await f.app.handleTurn(threadId, CHIP_FOLLOW_UP));
    assert.equal(followUp.surfaces.length, 1);
    assert.equal(f.app.getState(threadId)?.criteria?.when?.checkIn, CHIP_CHECK_IN, "the chip date survives the planner turn");
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.checkIn, CHIP_CHECK_IN);
  } finally { f.close(); }
});

test("Chip nights reach the planner canonical facts", async () => {
  const requests: CapturedRequest[] = [];
  const f = datedFixture(scriptedPlanner(SCRIPT, requests).client);
  try {
    const threadId = "g-c1a0000002";
    successOf(await f.app.handleTurn(threadId, LEKKI_FIRST));
    successOf(chooseChipDates(f, threadId, CHIP_CHECK_IN, 4));
    const stay = f.runtime.getThread(threadId).taskState.stayIntent;
    assert.equal(stay.nights, 4, "the chip nights are in the task state");
    assert.equal(stay.checkOut, CHIP_CHECK_OUT, "the checkout is the check-in plus the chip nights");
    assert.equal(stay.isDemoDate, false, "a chip date is guest-authored, not the demo date");
    const reply = successOf(await f.app.handleTurn(threadId, CHIP_FOLLOW_UP));
    assert.ok(!reply.messages.includes(GUEST_ASSISTANT_COPY.stayClarification), "the planner is not asked for the nights again");
    const planner = plannerRequestFor(requests, CHIP_FOLLOW_UP);
    const shown = plannerText(planner);
    assert.ok(shown.includes(`"checkOut":"${CHIP_CHECK_OUT}"`), "the planner's facts carry the chip checkout");
    assert.ok(shown.includes('"nights":4'), "the planner's facts carry the chip nights");
  } finally { f.close(); }
});

test("getState criteria reflect a model-driven dated search", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client);
  try {
    const threadId = "g-c1a0000003";
    successOf(await f.app.handleTurn(threadId, OWNER_DATED));
    const criteria = f.app.getState(threadId)?.criteria;
    assert.equal(criteria?.when?.checkIn, "2026-11-20", "the strip shows the model's dated search");
    assert.equal(criteria?.when?.nights, 3);
    assert.equal(criteria?.guests?.count, 2);
  } finally { f.close(); }
});

test("A model-proposed date with no guest text and no chip input is still rejected", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client);
  try {
    const threadId = "g-c1a0000004";
    successOf(await f.app.handleTurn(threadId, LEKKI_FIRST));
    const proposed = await f.app.handleTurn(threadId, MODEL_ONLY);
    const answered = successOf(proposed);
    assert.deepEqual(answered.surfaces, []);
    assert.deepEqual(answered.messages, [GUEST_ASSISTANT_COPY.datesClarification]);
    assert.notEqual(f.runtime.getThread(threadId).taskState.stayIntent.checkIn, "2026-11-25");
  } finally { f.close(); }
});

test("Cold restore keeps chip dates", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client);
  try {
    const threadId = "g-c1a0000005";
    successOf(await f.app.handleTurn(threadId, LEKKI_FIRST));
    successOf(chooseChipDates(f, threadId, CHIP_CHECK_IN, 4));
    const restarted = restartedDatedApp(f, scriptedPlanner(SCRIPT).client);
    assert.equal(restarted.app.getState(threadId)?.criteria?.when?.checkIn, CHIP_CHECK_IN, "a restarted app restores the chip date");
  } finally { f.close(); }
});
