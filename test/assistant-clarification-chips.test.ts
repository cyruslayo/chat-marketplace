import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { CRITERIA_EDIT_EVENT } from "../apps/local-guest/src/shortlet-app.js";
import { quickRepliesFor } from "../apps/local-guest/src/concierge.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import {
  coldTurn,
  datedFixture,
  LIVE_LIKE_CLOCK,
  scriptedPlanner,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";

// Issue 10 (assistant-concierge-parity): quick-reply chips on the assistant's clarifications. Every turn runs with the assistant
// runtime enabled and a cold restore before the event, on the staging-like clock (27 Oct 2026) and a guest with no seeded phone
// or email (ADR 0106, the assistant cold-restore rule). The browser check of the chips' 44px targets (AC5) is in
// assistant-clarification-chips-chromium.test.ts.

const THREAD = "g-d1a0001001";
const AREA_CHIP = "Lekki Phase 1, Lagos";
const AREA_CHIP_SEARCH: ScriptedTurn = {
  slots: { city: "Lagos", neighbourhood: "Lekki Phase 1" },
  search: { city: "Lagos", neighbourhood: "Lekki Phase 1" },
};
const APARTMENT_FOR_TWO: ScriptedTurn = { slots: { guests: 2 }, reply: "clarify_stay" };

function plannerWith(turns: Readonly<Record<string, ScriptedTurn>>, planner: Parameters<typeof scriptedPlanner>[1] = []): AssistantModelClient {
  return scriptedPlanner(turns, planner).client;
}

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("AC1: \"Apartment for 2\" with no area offers the area chips", async () => {
  const f: DatedFixture = datedFixture(plannerWith({ "Apartment for 2": APARTMENT_FOR_TWO }), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = successOf(await coldTurn(f, THREAD, "Apartment for 2", plannerWith({ "Apartment for 2": APARTMENT_FOR_TWO })), "apartment for two");
    assert.deepEqual(result.quickReplies, quickRepliesFor("where"), "the chips are the area chips, from the closed area list");
    assert.ok(result.quickReplies?.includes(AREA_CHIP), "a Lagos neighbourhood is one of the chips");
  } finally { f.close(); }
});

test("AC2: with area and guests known, the reply asks for dates and offers no relative-date chips", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Lekki, please": AREA_CHIP_SEARCH,
    "Which dates are free?": { slots: {}, reply: "clarify_stay" },
  };
  const driver = openChipDriver(stagingGuest(), plannerWith(turns), { cold: true, threadId: THREAD });
  assertOk(await driver.typed("Lekki, please"), "area search");
  // The guests chip is structured guest input: it records the party size beside the area (ADR 0106 chip facts).
  const guests = await driver.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2 });
  assertOk(guests, "guests chip");
  assert.equal(driver.stay().partySize, 2, "the guests chip is held in the assistant's task state");
  assert.equal(driver.stay().checkIn, undefined, "no date is known yet");
  assert.equal(successOf(guests, "guests chip").quickReplies, undefined, "the strip's own reply carries no relative-date chips on the assistant path");

  const asked = successOf(await driver.typed("Which dates are free?"), "dates question");
  assert.deepEqual(asked.messages, [GUEST_ASSISTANT_COPY.datesClarification], "the reply asks for the dates in the plain-word form the server reads");
  assert.equal(asked.quickReplies, undefined, "no 'when' chips: relative dates wait for issue 04 and no date is invented (ADR 0106)");
});

test("AC3: tapping a chip fills that criterion in the assistant task state", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Apartment for 2": APARTMENT_FOR_TWO,
    [AREA_CHIP]: AREA_CHIP_SEARCH,
  };
  const planner: Parameters<typeof scriptedPlanner>[1] = [];
  const driver = openChipDriver(stagingGuest(), plannerWith(turns, planner), { cold: true, threadId: THREAD });
  const asked = successOf(await driver.typed("Apartment for 2"), "apartment for two");
  assert.ok(asked.quickReplies?.includes(AREA_CHIP), "the area chip is offered");
  assert.equal(driver.stay().location, undefined, "nothing is filled before the chip is tapped");

  // A tap sends the chip's text as an ordinary guest turn: the planner sees that text and the area is recorded from it.
  assertOk(await driver.typed(AREA_CHIP), "tap the area chip");
  assert.equal(driver.stay().location, "Lagos");
  assert.equal(driver.stay().neighbourhood, "Lekki Phase 1", "the tapped area fills the neighbourhood criterion");
  assert.ok(planner.some((request) => JSON.stringify(request.body.messages).includes(AREA_CHIP)), "the planner was shown the tapped text");
});

test("AC4: an out-of-scope reply and a support reply carry no chips", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "What is the weather in Lagos today?": { slots: {}, intents: [], scope: "out_of_scope" },
    "I am locked out of my apartment": { slots: {}, intents: ["support"], reply: "support_guidance" },
  };
  const outOfScope = successOf(await coldTurn(datedFixture(plannerWith(turns), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true }), THREAD, "What is the weather in Lagos today?", plannerWith(turns)), "out of scope");
  assert.equal(outOfScope.assistantControlOutcome, "scope_redirect");
  assert.equal(outOfScope.quickReplies, undefined, "a scope redirect offers no chips");

  const support = successOf(await coldTurn(datedFixture(plannerWith(turns), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true }), THREAD, "I am locked out of my apartment", plannerWith(turns)), "support");
  assert.equal(support.assistantControlOutcome, "support_guidance");
  assert.equal(support.quickReplies, undefined, "support guidance offers no chips");
});
