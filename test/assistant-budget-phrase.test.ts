import assert from "node:assert/strict";
import test from "node:test";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { CRITERIA_EDIT_EVENT, LocalGuestApp, type GuestTurnResult, type GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { assertOk, openChipDriver } from "./helpers/assistant-chip-session.js";
import { openJourneyEnvironment } from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, coldTurn, datedFixture, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// Issue 07 (ADR 0106, ADR 0015, ADR 0080): the planner passes the guest's own budget words (`budgetPhrase`), and the server reads the
// amount with the deterministic parser and converts it to the stay's All-In Stay Total. Every assistant event is a cold restore (a new
// application over the same store) on a fresh thread, with the assistant runtime enabled, the 27 Oct 2026 clock and a staging-like guest.
//
// Unit totals for Lagos, 14 to 17 Dec 2026, 2 guests (the discovery query): Old Ikoyi N370,000 and Lekki Phase 1 N200,000.

const CHECK_IN = "2026-12-14";
const STAY_DETAILS = "Apartment in Lagos from 14 December 2026 for 3 nights for 2 guests";
const STAY_SLOTS = { city: "Lagos", checkIn: CHECK_IN, nights: 3, guests: 2 } as const;
const BOTH_UNITS = ["unit-lagos-ikoyi-001", "unit-lagos-lekki-002"];

/** A planner script entry: the classifier's slots for the text, and the planner's search, with or without `budgetPhrase`. */
function turn(text: string, budgetPhrase?: string | null): Record<string, ScriptedTurn> {
  return {
    [text]: {
      slots: STAY_SLOTS,
      search: { city: "Lagos", checkIn: CHECK_IN, nights: 3, guests: 2, ...(budgetPhrase === undefined ? {} : { budgetPhrase }) },
    },
  };
}

/** Records every authoritative discovery search with the filters it ran with (the same environment across cold restores). */
function recordSearches(environment: LocalGuestEnvironment): Record<string, unknown>[] {
  const searches: Record<string, unknown>[] = [];
  const authoritative = environment.discoveryQuery.search.bind(environment.discoveryQuery);
  environment.discoveryQuery.search = (filters) => {
    searches.push({ ...filters });
    return authoritative(filters);
  };
  return searches;
}

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function unitIdsOf(result: GuestTurnSuccess): string[] {
  return [...new Set([...JSON.stringify(result.surfaces[0]?.a2uiMessages ?? []).matchAll(/"unitId":"([^"]+)"/g)].map((match) => match[1]!))].sort();
}

function assistantFixture(script: Readonly<Record<string, ScriptedTurn>>): DatedFixture {
  return datedFixture(scriptedPlanner(script).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
}

test("AC1: \"under ₦150k a night\" for 3 nights limits the search to an all-in ₦450,000.", async () => {
  const text = `${STAY_DETAILS}, under ₦150k a night`;
  const f = assistantFixture(turn(text, "under ₦150k a night"));
  try {
    const searches = recordSearches(f.environment);
    const result = successOf(await coldTurn(f, "g-d1a0000701", text, scriptedPlanner(turn(text, "under ₦150k a night")).client), "per-night budget");
    assert.equal(searches.length, 1, "one authoritative search runs");
    assert.equal(searches[0]!.maxPriceKobo, 45_000_000, "the all-in limit is ₦150,000 x 3 nights = ₦450,000");
    assert.deepEqual(unitIdsOf(result), BOTH_UNITS, "both stays are within ₦450,000 all-in");
    assert.equal(result.criteria?.budget?.label, "₦450,000 total for 3 nights, all fees included", "the criteria strip shows the all-in total");
  } finally { f.close(); }
});

test("AC2: \"budget 500k total\" limits it to ₦500,000.", async () => {
  const text = `${STAY_DETAILS}, budget 500k total`;
  const f = assistantFixture(turn(text, "budget 500k total"));
  try {
    const searches = recordSearches(f.environment);
    successOf(await coldTurn(f, "g-d1a0000702", text, scriptedPlanner(turn(text, "budget 500k total")).client), "stay budget");
    assert.equal(searches.length, 1);
    assert.equal(searches[0]!.maxPriceKobo, 50_000_000, "a stay budget of ₦500,000 is the all-in limit");
  } finally { f.close(); }
});

test("AC3: \"max 4 guests\" and \"under 3 nights\" set no budget.", async () => {
  const f = assistantFixture({});
  try {
    const searches = recordSearches(f.environment);
    // The planner gives no budget phrase for guest counts or night counts: the search has no budget filter.
    const counted = `${STAY_DETAILS}, max 4 guests, under 3 nights`;
    const plain = scriptedPlanner(turn(counted)).client;
    successOf(await coldTurn(f, "g-d1a0000703", counted, plain), "counts without a budget");
    assert.equal(searches.length, 1);
    assert.equal(searches[0]!.maxPriceKobo, undefined, "no budget filter is set from a guest count");

    // Failure path: a planner that passes a count as the budget phrase is refused as a tool_denial, and no budget is searched.
    const refused = await coldTurn(f, "g-d1a0000704", counted, scriptedPlanner(turn(counted, "max 4 guests")).client);
    assert.equal(refused.ok, true);
    if (!refused.ok) throw new Error("unreachable");
    assert.equal(refused.assistantControlOutcome, "tool_denial", "a count read as money is a rejected tool call");
    assert.deepEqual(refused.messages, [GUEST_ASSISTANT_COPY.budgetClarification], "the guest is asked for an amount");
    assert.equal(searches.every((filters) => filters.maxPriceKobo === undefined), true, "no search on the refused call carries a budget");
  } finally { f.close(); }
});

test("AC4: a budget phrase not in guest text is a tool_denial.", async () => {
  const f = assistantFixture(turn(STAY_DETAILS, "budget 500k total"));
  try {
    const searches = recordSearches(f.environment);
    // The guest never typed "budget 500k total"; the planner invented it, so the call is refused before any search.
    const result = await coldTurn(f, "g-d1a0000705", STAY_DETAILS, scriptedPlanner(turn(STAY_DETAILS, "budget 500k total")).client);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.assistantControlOutcome, "tool_denial", "an unauthored budget phrase is a rejected tool call");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.budgetClarification]);
    assert.equal(searches.length, 0, "no search runs on an unauthored budget");
  } finally { f.close(); }
});

test("AC5: Same input gives the same budget filter on both paths (parity test).", async () => {
  const text = `${STAY_DETAILS}, under ₦150k a night`;
  const f = assistantFixture(turn(text, "under ₦150k a night"));
  try {
    const searches = recordSearches(f.environment);
    // The deterministic concierge (assistant disabled) reads the same words.
    const deterministic = await new LocalGuestApp(f.environment).handleTurn("g-d1a0000706", text);
    successOf(deterministic, "deterministic path");
    const deterministicFilter = searches.at(-1);
    const assisted = successOf(await coldTurn(f, "g-d1a0000707", text, scriptedPlanner(turn(text, "under ₦150k a night")).client), "assistant path");
    const assistedFilter = searches.at(-1);
    assert.ok(deterministicFilter && assistedFilter, "both paths search");
    assert.equal(assistedFilter.maxPriceKobo, deterministicFilter.maxPriceKobo, "the same all-in limit on both paths");
    assert.equal(assistedFilter.maxPriceKobo, 45_000_000);
    assert.deepEqual(unitIdsOf(assisted), BOTH_UNITS, "the assistant's stays match the deterministic stays");
  } finally { f.close(); }
});

test("AC6: A newer typed budget replaces the chip budget.", async () => {
  // The chip sets ₦150,000 a night (₦450,000 for 3 nights). The guest then types a stay budget of ₦300,000, which is newer and wins.
  const first = `${STAY_DETAILS}`;
  const typed = "Budget 300k total for the same stay";
  const script = { ...turn(first), ...turn(typed, "budget 300k total") };
  const environment = openJourneyEnvironment();
  try {
    const searches = recordSearches(environment);
    const driver = openChipDriver(environment, scriptedPlanner(script).client, { cold: true, threadId: "g-d1a0000708" });
    assertOk(await driver.typed(first), "the stay search");
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "budget", naira: 150_000, per: "night" }), "the chip budget");
    assert.equal(driver.stay().maxBudgetPer, "night", "the chip budget is in the assistant's state");

    assertOk(await driver.typed(typed), "the newer typed budget");
    assert.equal(driver.stay().maxBudgetKobo, 30_000_000, "the typed budget replaces the chip's amount");
    assert.equal(driver.stay().maxBudgetPer, "stay", "the typed budget keeps its own meaning (a stay total)");
    assert.equal(searches.at(-1)!.maxPriceKobo, 30_000_000, "the next search filters on the newer typed budget");
  } finally { environment.close(); }
});

test("AC7: A repeated phrase from an earlier guest turn is accepted, one never typed is rejected.", async () => {
  const earlier = `${STAY_DETAILS}, budget 500k total`;
  const again = "Search again for the same stay";
  // The guest never typed this text or its phrase (the planner invented "under 9 million a night").
  const invented = "Check the same stay once more";
  const script = {
    ...turn(earlier, "budget 500k total"),
    ...turn(again, "budget 500k total"),
    ...turn(invented, "under 9 million a night"),
  };
  const f = assistantFixture(script);
  try {
    const searches = recordSearches(f.environment);
    successOf(await coldTurn(f, "g-d1a0000709", earlier, scriptedPlanner(script).client), "the first search");
    assert.equal(searches.at(-1)!.maxPriceKobo, 50_000_000, "the typed phrase sets the ₦500,000 stay budget");

    // Accepted: the same words the guest typed in an earlier turn.
    const repeated = successOf(await coldTurn(f, "g-d1a0000709", again, scriptedPlanner(script).client), "the repeated phrase");
    assert.notEqual(repeated.assistantControlOutcome, "tool_denial", "a phrase typed earlier is accepted");
    assert.equal(searches.at(-1)!.maxPriceKobo, 50_000_000, "the repeated phrase gives the same all-in limit");

    // Rejected: a phrase the guest never typed, in a valid amount form, that differs from the budget the task holds.
    const rejected = await coldTurn(f, "g-d1a0000709", invented, scriptedPlanner(script).client);
    assert.equal(rejected.ok, true);
    if (!rejected.ok) throw new Error("unreachable");
    assert.equal(rejected.assistantControlOutcome, "tool_denial", "a phrase never typed is a rejected tool call");
    assert.equal(searches.some((filters) => filters.maxPriceKobo === 2_700_000_000), false, "the invented ₦9m a night is never searched");
    assert.equal(searches.at(-1)!.maxPriceKobo, 50_000_000, "the held ₦500,000 stay budget still applies");
  } finally { f.close(); }
});
