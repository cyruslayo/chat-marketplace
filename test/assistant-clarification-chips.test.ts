import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import { quickRepliesFor } from "../apps/local-guest/src/concierge.js";
import { clarificationChipsFor } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { createInitialTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
import { isQuickReplyList } from "../apps/local-guest/src/quick-replies.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import {
  classifiedMessage,
  coldTurn,
  datedFixture,
  firstButtonAction,
  isScopeRequest,
  lastRoleIsTool,
  latestUserText,
  LIVE_LIKE_CLOCK,
  OPENROUTER,
  scopeVerdict,
  scriptedPlanner,
  searchToolCall,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";
import { clientWith, completion } from "./helpers/openai-compatible-client.js";

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
    assert.ok(result.quickReplies?.some((chip) => chip.label === AREA_CHIP), "a Lagos neighbourhood is one of the chips");
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
  assert.ok(asked.quickReplies?.some((chip) => chip.label === AREA_CHIP), "the area chip is offered");
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

// Issue 58 (ADR 0106, ADR 0107 "Settled"): a quick-reply chip is structured guest input. A chip with an `edit` is a
// `shortlet.criteria.edit` event (never typed text), so it never reaches the scope classifier. A malformed chip is dropped.

/** A scripted model that also records every message the scope classifier was asked to judge. */
function recorder(turns: Readonly<Record<string, ScriptedTurn>>) {
  const scopeMessages: string[] = [];
  const { client } = clientWith((request) => {
    if (isScopeRequest(request)) {
      const message = classifiedMessage(request);
      scopeMessages.push(message);
      const turn = turns[message];
      if (turn?.scope === "unclear") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "unclear", reasonCode: "unclear" }) });
      if (turn?.scope === "out_of_scope") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "out_of_scope", reasonCode: "outside" }) });
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents)) });
    }
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    if (lastRoleIsTool(request)) return completion({ content: turn?.replyAfterTool ? JSON.stringify(turn.replyAfterTool) : "Search complete." });
    if (turn?.reply) return completion({ content: JSON.stringify({ kind: turn.reply, references: [] }) });
    if (turn?.search) return searchToolCall(`search-${text?.length ?? 0}`, turn.search);
    if (turn?.tool) return completion({ tool_calls: [{ id: `tool-${text?.length ?? 0}`, type: "function", function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }] });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  return { client, scopeMessages };
}

function discoveryCardOf(result: GuestTurnResult) {
  assertOk(result, "search");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:discovery:/.test(surface.surfaceId));
  assert.ok(card, "the search shows a discovery card");
  return card;
}

const STAGING_AREA = "Somewhere in Old Ikoyi, Lagos";
const STAGING_JOURNEY: Record<string, ScriptedTurn> = {
  [STAGING_AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
};

test("Issue 58 AC1: the When chip's \"Just me\" chip is a structured event, so the classifier is never called for it, and View opens the quoted results", async () => {
  const environment = stagingGuest();
  try {
    const rec = recorder(STAGING_JOURNEY);
    const driver = openChipDriver(environment, rec.client, { cold: true, threadId: THREAD });
    discoveryCardOf(await driver.typed(STAGING_AREA));
    const when = await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 });
    assertOk(when, "when chip");
    assert.ok(when.ok);
    const justMe = when.quickReplies?.find((chip) => chip.label === "Just me");
    assert.deepEqual(justMe, { label: "Just me", edit: { field: "guests", partySize: 1 } }, "the who chip carries a structured edit");
    const beforeChip = rec.scopeMessages.length;
    const tapped = await driver.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 });
    assertOk(tapped, "Just me chip");
    assert.equal(rec.scopeMessages.length, beforeChip, "the chip never reaches the scope classifier");
    assert.equal(driver.stay().partySize, 1, "the chip's party size is recorded");
    const card = discoveryCardOf(tapped);
    const opened = await driver.step().app.handleEventAsync(THREAD, firstButtonAction(card));
    assert.equal(opened.ok, true, opened.ok ? "" : `View after the Just me chip: ${opened.code} ${opened.message}`);
  } finally { environment.close(); }
});

test("Issue 58 AC2: who chips carry a guests edit, where chips carry area ids, and the date-confirm chips carry no edit", () => {
  const who = quickRepliesFor("who");
  assert.deepEqual(who[0], { label: "Just me", edit: { field: "guests", partySize: 1 } });
  assert.ok(who.every((chip) => chip.edit?.field === "guests" && chip.edit.partySize >= 1), "every who chip carries a party size");
  const where = quickRepliesFor("where");
  assert.ok(where.length > 0 && where.every((chip) => chip.edit?.field === "where" && typeof chip.edit.area === "string" && chip.edit.area.length > 0), "every where chip carries an area id");
  const pending = createInitialTaskState();
  pending.stayIntent = { location: "Lagos", pendingDate: { candidates: ["2026-11-20"] } };
  const dateChips = clarificationChipsFor(pending, "date");
  assert.ok(dateChips && dateChips.length > 0 && dateChips.every((chip) => chip.edit === undefined), "the date-confirm chips stay text-only");
});

test("Issue 58 AC3: a nights chip carries an edit only when the check-in is confirmed", () => {
  const confirmed = createInitialTaskState();
  confirmed.stayIntent = { location: "Lagos", partySize: 2, checkIn: "2026-11-12", isDemoDate: false };
  const confirmedChips = clarificationChipsFor(confirmed, "plan");
  assert.ok(confirmedChips && confirmedChips.length > 0 && confirmedChips.every((chip) => chip.edit?.field === "when"), "a confirmed check-in gives structured night chips");
  const unconfirmed = createInitialTaskState();
  unconfirmed.stayIntent = { location: "Lagos", partySize: 2, checkIn: "2026-11-12", isDemoDate: true };
  const textChips = clarificationChipsFor(unconfirmed, "plan");
  assert.ok(textChips && textChips.length > 0 && textChips.every((chip) => chip.edit === undefined), "without a confirmed check-in the night chips stay text-only");
});

test("Issue 58 AC4: a forged chip edit fails closed (INVALID_CRITERIA), and a stale basedOn is STALE_SURFACE", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, scriptedPlanner(STAGING_JOURNEY).client, { cold: true, threadId: THREAD });
    discoveryCardOf(await driver.typed(STAGING_AREA));
    const zero = await driver.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 0 });
    assert.equal(zero.ok, false);
    assert.equal(zero.ok ? "" : zero.code, "INVALID_CRITERIA");
    const unknownArea = await driver.chip(CRITERIA_EDIT_EVENT, { field: "where", area: "nowhere" });
    assert.equal(unknownArea.ok, false);
    assert.equal(unknownArea.ok ? "" : unknownArea.code, "INVALID_CRITERIA");
    const stale = await driver.step().app.handleEventAsync(THREAD, {
      name: CRITERIA_EDIT_EVENT,
      surfaceId: criteriaSurfaceId(THREAD),
      sourceComponentId: "criteria-chip",
      timestamp: LIVE_LIKE_CLOCK().toISOString(),
      context: { field: "guests", partySize: 1, basedOn: "stale-key-000" },
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.ok ? "" : stale.code, "STALE_SURFACE");
  } finally { environment.close(); }
});

test("Issue 58 AC5: the chip's party size reaches the persisted context and survives a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, scriptedPlanner(STAGING_JOURNEY).client, { cold: true, threadId: THREAD });
    discoveryCardOf(await driver.typed(STAGING_AREA));
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1 }), "guests chip");
    const stored = driver.step().environment.interactionStore.findThread(THREAD);
    assert.ok(stored, "the thread is saved");
    const projection = JSON.parse(stored.threadJson) as { assistantContext?: { partySize?: number } };
    assert.equal(projection.assistantContext?.partySize, 1, "the chip's party size is in the persisted context");
    // A fresh application over the same store (a Worker cold restore) still holds it.
    assert.equal(driver.step().runtime.getThread(THREAD).taskState.stayIntent.partySize, 1);
  } finally { environment.close(); }
});

test("Issue 58 AC6: isQuickReplyList drops a malformed chip and keeps the valid ones", () => {
  const valid = { label: "Just me", edit: { field: "guests" as const, partySize: 1 } };
  const validWhen = { label: "3 nights", edit: { field: "when" as const, checkIn: "2026-11-12", nights: 3 } };
  const chips = isQuickReplyList([
    valid,
    { label: "ok" },
    { label: "zero guests", edit: { field: "guests", partySize: 0 } },
    { label: "no area", edit: { field: "where", area: "" } },
    { label: "unknown field", edit: { field: "budget", naira: 5 } },
    // An edit with an extra key must fail closed (its keys are spread into the event), dropping only that chip.
    { label: "extra key", edit: { field: "guests", partySize: 1, area: "lekki" } },
    { label: "extra key when", edit: { field: "when", checkIn: "2026-11-12", nights: 3, partySize: 2 } },
    { edit: { field: "guests", partySize: 1 } },
    validWhen,
  ]);
  assert.deepEqual(chips, [valid, { label: "ok" }, validWhen]);
  assert.equal(isQuickReplyList("not a list"), undefined);
});
