import assert from "node:assert/strict";
import test from "node:test";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { openChipDriver, assertOk, stagingGuest } from "./helpers/assistant-chip-session.js";
import { classifiedMessage, isScopeRequest, lastRoleIsTool, latestUserText, OPENROUTER, scopeVerdict, searchToolCall } from "./helpers/guest-date-fixtures.js";
import { clientWith, completion, jsonResponse, type CapturedRequest } from "./helpers/openai-compatible-client.js";

// Issue 63 (ADR 0106 amendments of 8 and 9 Nov 2026, ADR 0092): a terse answer the classifier accepts is kept in the thread.
// Every case runs as a realistic cold journey (staging-like guest, 2026-10-27 Africa/Lagos clock, a NEW application over the same
// store before every event) that first reaches the question the assistant asks, then sends the terse reply. The slot is read from
// the restored thread after another cold restore, with closed values only: no guest or model text.

const THREAD = "g-af63000001";
const LAGOS = { city: "Lagos", neighbourhood: "Lekki Phase 1" } as const;
const CITY = { city: "Lagos" } as const;
const FULL_SEARCH = "Apartment in Lagos for 2 guests for 3 nights from 14 December 2026";
const PARTY_SEARCH = "Apartment in Lekki for 3 nights from 14 December 2026";
const NIGHTS_SEARCH = "Apartment in Lekki for 2 guests from 14 December 2026";
const DATE_SEARCH = "Apartment in Lekki for 2 guests for 3 nights tomorrow";
const VIEW = "Show me the apartment";

interface Turn {
  readonly slots?: Readonly<Record<string, unknown>>;
  readonly intents?: readonly string[];
  readonly search?: Record<string, unknown>;
  readonly tool?: { readonly name: string; readonly args: Record<string, unknown> };
  /** A typed reply plan with no tool call (a stay clarification that asks for the missing fact). */
  readonly reply?: "clarify_stay" | "redirect";
  /** A typed reply plan for the round after the tool result (the runtime rejects untyped prose). */
  readonly replyAfterTool?: { readonly kind: string; readonly references: readonly string[] };
  /** The planner provider fails, so the shell's deterministic path takes the turn. */
  readonly providerDown?: true;
}

function recorder(turns: Readonly<Record<string, Turn>>) {
  return clientWith((request: CapturedRequest) => {
    if (isScopeRequest(request)) {
      const turn = turns[classifiedMessage(request)];
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents ?? ["search"])) });
    }
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    if (turn?.providerDown) return jsonResponse(503, { error: { message: "down" } });
    if (lastRoleIsTool(request)) return completion({ content: JSON.stringify(turn?.replyAfterTool ?? { kind: "show_results", references: [] }) });
    if (turn?.reply) return completion({ content: JSON.stringify({ kind: turn.reply, references: [] }) });
    if (turn?.search) return searchToolCall(`search-${text?.length ?? 0}`, turn.search);
    if (turn?.tool) return completion({ tool_calls: [{ id: `tool-${text?.length ?? 0}`, type: "function", function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }] });
    throw new Error(`Unexpected offline fixture turn: ${text ?? "<none>"}`);
  }, OPENROUTER);
}

/** The restored thread's task state, after a NEW application over the same store has loaded it (a cold restore). */
function restoredState(driver: ReturnType<typeof openChipDriver>) {
  return driver.step().runtime.getThread(THREAD).taskState;
}

function fullSearchTurn(): Turn {
  return { slots: { ...CITY, checkIn: "2026-12-14", nights: 3, guests: 2 }, intents: ["search"], search: { ...CITY, checkIn: "2026-12-14", nights: 3, guests: 2 } };
}

// ADR 0106 amendment (9 Nov 2026): the open-question code tells the classifier and the planner that a numeral answers the question.
// Issue 63: the answer must then land in the thread's task state and survive the next cold restore.
test("a terse party-size numeral the classifier accepts is kept in the thread after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
      "2": { slots: { guests: 2 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(PARTY_SEARCH), "the search that asks for a party size");
    assert.equal(restoredState(driver).openQuestion, "party_size", "the assistant asked for the party size");
    assertOk(await driver.typed("2"), "the terse party size");
    assert.equal(restoredState(driver).stayIntent.partySize, 2, "the party size is kept after a cold restore");
    assert.equal(restoredState(driver).openQuestion, undefined, "the answered question is cleared");
  } finally { environment.close(); }
});

test("a terse nights numeral the classifier accepts is kept in the thread after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [NIGHTS_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", guests: 2 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", guests: 2 } },
      "3": { slots: { nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(NIGHTS_SEARCH), "the search that asks for nights");
    assert.equal(restoredState(driver).openQuestion, "nights", "the assistant asked for the nights");
    assertOk(await driver.typed("3"), "the terse nights");
    assert.equal(restoredState(driver).stayIntent.nights, 3, "the nights are kept after a cold restore");
    assert.equal(restoredState(driver).stayIntent.checkOut, "2026-12-17", "the checkout follows the kept nights");
  } finally { environment.close(); }
});

test("a terse pick the classifier accepts opens the named result and is kept in the thread after a cold restore", async () => {
  const cases: readonly [text: string, stayRef: string][] = [["the first one", "stay-1"], ["the second", "stay-2"], ["the last one", "stay-2"]];
  for (const [text, stayRef] of cases) {
    const environment = stagingGuest();
    try {
      const harness = recorder({
        [FULL_SEARCH]: fullSearchTurn(),
        // The planner provider fails on the vague view, so the shell asks which result (the deterministic "which one" path).
        [VIEW]: { slots: {}, intents: ["details"], providerDown: true },
        [text]: text === "the last one"
          // "the last one" is the pack's server-chosen view (issue 16 AC2): no planner call is needed.
          ? { slots: {}, intents: ["details"] }
          : { slots: {}, intents: ["details"], tool: { name: "get_unit_details", args: { stayRef } } },
      });
      const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
      assertOk(await driver.typed(FULL_SEARCH), "the search that shows results");
      assertOk(await driver.typed(VIEW), "the question that asks which result");
      assert.equal(restoredState(driver).openQuestion, "pick_result", `${text}: the assistant asked which result`);
      assert.ok(restoredState(driver).shortlist.length > 1, `${text}: more than one result is shown`);
      assertOk(await driver.typed(text), text);
      assert.equal(restoredState(driver).selectedStayRef, stayRef, `${text}: the named result is kept after a cold restore`);
    } finally { environment.close(); }
  }
});

test("a terse yes confirms only a date the server showed back, and that check-in is kept after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [DATE_SEARCH]: { slots: { ...LAGOS, nights: 3, guests: 2 }, intents: ["search"], search: { ...LAGOS, checkInPhrase: "tomorrow", nights: 3, guests: 2 } },
      yes: { slots: {}, intents: ["search"], search: { ...LAGOS, nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(DATE_SEARCH), "the date show-back");
    assert.equal(restoredState(driver).openQuestion, "date_confirm", "the assistant asked to confirm the shown date");
    assert.equal(restoredState(driver).stayIntent.pendingDate?.candidates[0], "2026-10-28", "the server showed one date back");
    assertOk(await driver.typed("yes"), "the confirmation");
    assert.equal(restoredState(driver).stayIntent.checkIn, "2026-10-28", "the shown-back date is kept after a cold restore");
    assert.equal(restoredState(driver).stayIntent.isDemoDate, false, "the confirmed date is guest-authored, not a demo date");
    assert.equal(restoredState(driver).stayIntent.checkOut, "2026-10-31", "the checkout follows the kept nights");
  } finally { environment.close(); }
});

// Issue 63: the acceptance rule may not rest on one wording. A different affirmative that the closed confirmation set already accepts
// settles the same server show-back, so the eval's held-out confirmation case has an answer that can land (ADR 0092: the show-back is
// the only authority; nothing here reads the guest's words for a date).
test("a held-out acceptance wording confirms the shown-back date and is kept after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [DATE_SEARCH]: { slots: { ...LAGOS, nights: 3, guests: 2 }, intents: ["search"], search: { ...LAGOS, checkInPhrase: "tomorrow", nights: 3, guests: 2 } },
      "go ahead": { slots: {}, intents: ["search"], search: { ...LAGOS, nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(DATE_SEARCH), "the date show-back");
    assert.equal(restoredState(driver).stayIntent.pendingDate?.candidates[0], "2026-10-28", "the server showed one date back");
    assertOk(await driver.typed("go ahead"), "the held-out acceptance");
    assert.equal(restoredState(driver).stayIntent.checkIn, "2026-10-28", "the shown-back date is kept after a cold restore");
    assert.equal(restoredState(driver).stayIntent.isDemoDate, false, "the confirmed date is guest-authored, not a demo date");
  } finally { environment.close(); }
});

// ADR 0106 (9 Nov 2026 amendment) and the projection rule of its 8 Nov 2026 amendment: the closed code rides on a partial context
// (no area yet), so a `where` question survives the cold restore and its terse answer is read against it.
test("a terse where answer the classifier accepts is kept in the thread after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      "I need a place for 2 guests for 3 nights from 14 December 2026": { slots: { guests: 2, nights: 3, checkIn: "2026-12-14" }, intents: ["search"], reply: "clarify_stay" },
      "Wuse 2": { slots: { city: "Abuja", neighbourhood: "Wuse 2" }, intents: ["search"], search: { city: "Abuja", neighbourhood: "Wuse 2", checkIn: "2026-12-14", nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed("I need a place for 2 guests for 3 nights from 14 December 2026"), "the clarification that asks where");
    assert.equal(restoredState(driver).openQuestion, "where", "the question survives the cold restore with no area held");
    assertOk(await driver.typed("Wuse 2"), "the terse area");
    assert.equal(restoredState(driver).stayIntent.location, "Abuja", "the area is kept after a cold restore");
    // The neighbourhood is only projected when the closed area list (the units' own neighbourhoods) holds it; the area is the slot.
  } finally { environment.close(); }
});

// ADR 0106 (guards fail closed) and ADR 0075: a pick that names no result in the current shortlist, or whose result has gone,
// selects nothing; the results surface the guest holds stays usable, and the turn's closed control outcome is reported (never blank).
test("a stale or forged pick is refused and selects no unit", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [FULL_SEARCH]: fullSearchTurn(),
      [VIEW]: { slots: {}, intents: ["details"], providerDown: true },
      // A reference no result carries. The pack refuses it before execution and the next round asks again.
      "the first one": { slots: {}, intents: ["details"], tool: { name: "get_unit_details", args: { stayRef: "stay-99" } }, replyAfterTool: { kind: "clarify_stay", references: [] } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(FULL_SEARCH), "the search that shows results");
    assertOk(await driver.typed(VIEW), "the question that asks which result");
    assert.ok(driver.step().app.getState(THREAD)?.surfaces.some((surface) => /:discovery:/.test(surface.surfaceId)), "the discovery surface is shown");
    const refused = await driver.typed("the first one");
    assert.equal(refused.ok, true, "the turn still answers");
    assert.equal(restoredState(driver).selectedStayRef, undefined, "no result is selected");
    assert.ok(driver.step().app.getState(THREAD)?.surfaces.some((surface) => /:discovery:/.test(surface.surfaceId)), "the results surface stays usable");
    assert.equal(refused.ok ? refused.assistantControlOutcome : undefined, "tool_denial", "the closed denial is reported");
  } finally { environment.close(); }
});

test("a pick whose result has gone is refused and reports its closed control outcome", async () => {
  // The live eval's empty-thread shape, kept as the regression for the blank outcome row: a shortlist reference whose Unit is not
  // in the repository makes the tool throw, and the generic failure return must still carry the outcome the turn was counted under.
  const environment = stagingGuest();
  try {
    const model = recorder({ "the first one": { slots: {}, intents: ["details"], tool: { name: "get_unit_details", args: { stayRef: "stay-1" } } } });
    const runtime = new AssistantRuntime(environment, model.client, { packs: [createShortletAssistantPack(environment)] });
    runtime.getThread(THREAD);
    runtime.applyDiscoveryShortlist(THREAD, [{
      stayRef: "stay-1", unitId: "unit-missing", title: "Result 1", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: 2, amenities: [],
      nightlyKobo: 1, allInStayTotalKobo: null, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0, amountDueNowKobo: null,
      inspectionStatus: "verified", managementAuthorityStatus: "verified",
    }]);
    runtime.recordOpenQuestion(THREAD, "pick_result");
    const output = await runtime.handleTurn(THREAD, "the first one");
    assert.equal(output.ok, false, "the turn fails closed");
    assert.equal(output.controlOutcome, "model_handling_failure", "the closed outcome is reported, never blank");
    assert.equal(runtime.getThread(THREAD).taskState.selectedStayRef, undefined, "no result is selected");
  } finally { environment.close(); }
});

// ADR 0092 (date authority is fail closed): "yes" authorizes a date only on a show-back the server itself presented.
test("a yes with no shown-back date commits no check-in", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      "Apartment in Lekki for 2 guests for 3 nights": { slots: { ...LAGOS, nights: 3, guests: 2 }, intents: ["search"], search: { ...LAGOS, nights: 3, guests: 2 } },
      yes: { slots: {}, intents: ["search"], search: { ...LAGOS, nights: 3, guests: 2 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed("Apartment in Lekki for 2 guests for 3 nights"), "a search with no date");
    assert.equal(restoredState(driver).stayIntent.pendingDate, undefined, "no date was shown back");
    assert.ok(restoredState(driver).stayIntent.checkIn === undefined || restoredState(driver).stayIntent.isDemoDate !== false, "no guest-authored check-in");
    assertOk(await driver.typed("yes"), "a bare yes");
    const state = restoredState(driver);
    assert.equal(state.stayIntent.pendingDate, undefined, "no date is pending");
    assert.ok(state.stayIntent.checkIn === undefined || state.stayIntent.isDemoDate !== false, "a bare yes commits no guest-authored check-in");
  } finally { environment.close(); }
});

// Issue 63, fix A (ADR 0106 amendment of 16 Nov 2026): the 16 Nov three-run live eval showed the planner asking again after a bare "2"
// in every run. When the server asked for the party size or the nights, a reply that is only a positive whole number is the guest's own
// answer to that question, read by the same readers as a typed party size or length. The model still runs the turn.
test("a bare number that answers the server's party-size question is kept even when the planner asks again", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
      "2": { slots: { guests: 2 }, intents: ["search"], reply: "clarify_stay" },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(PARTY_SEARCH), "the search that asks for a party size");
    assert.equal(restoredState(driver).openQuestion, "party_size");
    assertOk(await driver.typed("2"), "the bare party size");
    assert.equal(restoredState(driver).stayIntent.partySize, 2, "the party size is kept after a cold restore");
    assert.notEqual(restoredState(driver).openQuestion, "party_size", "the party-size question is not asked again");
  } finally { environment.close(); }
});

test("a bare number that answers the server's nights question is kept even when the planner asks again", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [NIGHTS_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", guests: 2 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", guests: 2 } },
      "3": { slots: { nights: 3 }, intents: ["search"], reply: "clarify_stay" },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(NIGHTS_SEARCH), "the search that asks for nights");
    assert.equal(restoredState(driver).openQuestion, "nights");
    assertOk(await driver.typed("3"), "the bare nights");
    assert.equal(restoredState(driver).stayIntent.statedStay?.nights, 3, "the stated length is kept after a cold restore");
  } finally { environment.close(); }
});

test("a bare number is read exactly as the typed reader reads it, and not at all when it is zero or the open question is not party size or nights", async () => {
  // Zero is no party size. A long length is read as the typed reader reads it, so no rule changes.
  for (const text of ["0", "400"]) {
    const environment = stagingGuest();
    try {
      const harness = recorder({
        [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
        [NIGHTS_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", guests: 2 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", guests: 2 } },
        [text]: { slots: {}, intents: ["search"], reply: "clarify_stay" },
      });
      const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
      const setup = text === "0" ? PARTY_SEARCH : NIGHTS_SEARCH;
      assertOk(await driver.typed(setup), `${text}: the question`);
      assertOk(await driver.typed(text), text);
      if (text === "0") assert.equal(restoredState(driver).stayIntent.partySize, undefined, "zero is not a party size");
      // The same reader as a typed "400 nights": it records the stated length exactly as typed text would, and the stay rules refuse
      // it where they refuse a typed length (at search). No bound is added or relaxed here.
      else assert.deepEqual(restoredState(driver).stayIntent.statedStay, { unit: "night", count: 400, nights: 400 }, "read exactly as a typed length");
    } finally { environment.close(); }
  }
  // A bare number to a `where` question is neither a party size nor a length.
  const environment = stagingGuest();
  try {
    const harness = recorder({
      "I need a place for 3 nights from 14 December 2026": { slots: { nights: 3, checkIn: "2026-12-14" }, intents: ["search"], reply: "clarify_stay" },
      "2": { slots: {}, intents: ["search"], reply: "clarify_stay" },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed("I need a place for 3 nights from 14 December 2026"), "the clarification that asks where");
    assert.equal(restoredState(driver).openQuestion, "where");
    assertOk(await driver.typed("2"), "a bare number to a where question");
    assert.equal(restoredState(driver).stayIntent.partySize, undefined, "no party size is read from it");
  } finally { environment.close(); }
});

/** A planner whose first reply on `text` is a typed plan with no tool call, then (if `then` is given) the tool on the retry. */
function claimingPlanner(turns: Readonly<Record<string, Turn>>, text: string, claimed: "show_results" | "show_details", then?: Turn["tool"]) {
  let plannerCalls = 0;
  const harness = clientWith((request: CapturedRequest) => {
    if (isScopeRequest(request)) {
      const message = classifiedMessage(request);
      const turn = message === text ? { slots: {}, intents: [claimed === "show_details" ? "details" : "search"] } : turns[message];
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents ?? ["search"])) });
    }
    const latest = latestUserText(request);
    if (latest === text) {
      if (lastRoleIsTool(request)) return completion({ content: JSON.stringify({ kind: claimed, references: [] }) });
      plannerCalls++;
      if (plannerCalls === 1 || then === undefined) return completion({ content: JSON.stringify({ kind: claimed, references: [] }) });
      return completion({ tool_calls: [{ id: "retry-tool", type: "function", function: { name: then.name, arguments: JSON.stringify(then.args) } }] });
    }
    const turn = latest === undefined ? undefined : turns[latest];
    if (turn?.providerDown) return jsonResponse(503, { error: { message: "down" } });
    if (lastRoleIsTool(request)) return completion({ content: JSON.stringify({ kind: "show_results", references: [] }) });
    if (turn?.search) return searchToolCall(`search-${latest?.length ?? 0}`, turn.search);
    throw new Error(`Unexpected offline fixture turn: ${latest ?? "<none>"}`);
  }, OPENROUTER);
  return { ...harness, plannerCalls: () => plannerCalls };
}

// Issue 63, fix B (ADR 0106 amendment of 16 Nov 2026): the live planner sometimes answered an open question with a results or details
// reply without running the tool that applies the answer. On a turn that answers the server's open question, such a plan is not
// accepted: the same planner request is repeated once (no new history or prompt), and a second such plan is rejected, never counted
// as a success.
test("a planner reply that claims results without applying the open-question answer is retried once, and the answer lands", async () => {
  const environment = stagingGuest();
  try {
    const harness = claimingPlanner({
      [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
    }, "me and my wife", "show_results", { name: "search_stays", args: { ...LAGOS, checkIn: "2026-12-14", nights: 3, guests: 2 } });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(PARTY_SEARCH), "the search that asks for a party size");
    const turn = await driver.typed("me and my wife");
    assertOk(turn, "the worded party size");
    assert.equal(harness.plannerCalls(), 2, "the planner request is repeated once");
    assert.equal(turn.ok ? turn.assistantControlOutcome : undefined, "successful_model_handling");
    assert.equal(restoredState(driver).stayIntent.partySize, 2, "the answer lands through the retried search");
  } finally { environment.close(); }
});

test("an in-scope solo answer survives a rejected results claim after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = claimingPlanner({
      [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
    }, "just me", "show_results");
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(PARTY_SEARCH), "the search that asks for party size");
    assert.equal(restoredState(driver).openQuestion, "party_size");
    const turn = await driver.typed("just me");
    assert.equal(harness.plannerCalls(), 2, "the unapplied claim is retried once");
    assert.equal(turn.ok ? turn.assistantControlOutcome : undefined, "rejected_plan_fallback");
    assert.equal(restoredState(driver).stayIntent.partySize, 1, "the guest's answer survives the cold restore");
    assert.equal(restoredState(driver).shortlist.length, 0, "no results were fabricated");
  } finally { environment.close(); }
});

test("an in-scope couple answer survives a planner redirect after a cold restore", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({
      [PARTY_SEARCH]: { slots: { ...LAGOS, checkIn: "2026-12-14", nights: 3 }, intents: ["search"], search: { ...LAGOS, checkIn: "2026-12-14", nights: 3 } },
      "a couple": { slots: { guests: 2 }, intents: ["search"], reply: "redirect" },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(PARTY_SEARCH), "the search that asks for party size");
    assert.equal(restoredState(driver).openQuestion, "party_size");
    assertOk(await driver.typed("a couple"), "the in-scope answer");
    assert.equal(restoredState(driver).stayIntent.partySize, 2, "the guest's answer survives the cold restore");
    assert.equal(restoredState(driver).shortlist.length, 0, "a redirect does not fabricate results");
  } finally { environment.close(); }
});

test("a pick the planner claims to show without opening it is retried once, then rejected and never counted as a success", async () => {
  const environment = stagingGuest();
  try {
    const harness = claimingPlanner({
      [FULL_SEARCH]: fullSearchTurn(),
      [VIEW]: { slots: {}, intents: ["details"], providerDown: true },
    }, "the second", "show_details");
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(FULL_SEARCH), "the search that shows results");
    assertOk(await driver.typed(VIEW), "the question that asks which result");
    assert.equal(restoredState(driver).openQuestion, "pick_result");
    const turn = await driver.typed("the second");
    assert.equal(harness.plannerCalls(), 2, "one retry, no more");
    assert.equal(turn.ok ? turn.assistantControlOutcome : undefined, "rejected_plan_fallback", "a claim without an applied answer is not a success");
    assert.equal(restoredState(driver).selectedStayRef, undefined, "no result is selected");
  } finally { environment.close(); }
});

test("a results reply with no open question is accepted as before, with no retry", async () => {
  const environment = stagingGuest();
  try {
    const harness = claimingPlanner({ [FULL_SEARCH]: fullSearchTurn() }, "Show me those again", "show_results");
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    assertOk(await driver.typed(FULL_SEARCH), "the search that shows results");
    assert.equal(restoredState(driver).openQuestion, undefined, "no question is open after a search");
    const turn = await driver.typed("Show me those again");
    assertOk(turn, "the follow-up");
    assert.equal(harness.plannerCalls(), 1, "no retry without an open question");
    assert.equal(turn.ok ? turn.assistantControlOutcome : undefined, "successful_model_handling");
  } finally { environment.close(); }
});
