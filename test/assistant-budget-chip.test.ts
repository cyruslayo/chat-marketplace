import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT } from "../apps/local-guest/src/shortlet-app.js";
import { THREAD_BUSY_CODE } from "../apps/local-guest/src/assistant/assistant-thread-lock.js";
import { SEARCH_IKOYI, journeyScriptedModel, type RecordedJourneyDefinition } from "./helpers/assistant-recordings.js";
import { assertOk, openChipDriver, stagingGuest, type ChipDriver } from "./helpers/assistant-chip-session.js";
import { gatedModel, type Gate } from "./helpers/assistant-thread-lock-fixtures.js";
import { parseGuestProjection } from "../apps/local-guest/src/guest-projection.js";

// Issue 06 (ADR 0106, ADR 0015): the budget chip reaches the assistant's task state, its undo restores the previous budget, and a
// per-night budget keeps its meaning through a cold restore. Every step runs on the 27 Oct 2026 clock as a staging-like guest, with
// the assistant runtime enabled. Each event is a cold restore (a new application over the same store), except the undo, which is a
// warm step: a page load resets the undo history by design (issue 03 Comments), so the undo's result is then read back cold.
//
// The Old Ikoyi unit's All-In Stay Total for 4 nights (14 to 18 Dec 2026, 2 guests) is N49,000,000 kobo (N490,000). A per-night chip
// of N125,000 is N500,000 for 4 nights and includes it; as a per-stay amount the same N125,000 excludes it. That tells the two meanings
// apart on the search, not only on the label.

const THREAD = "g-d1a0000806";
const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
const AGAIN_TEXT = "Search again with the budget I set.";
const HELD_TEXT = "Search again while I wait.";
const CHECK_OUT = "2026-12-18";
const UNIT_TOTAL_KOBO = 49_000_000;
const PER_NIGHT_NAIRA = 125_000;
const PER_NIGHT_TOTAL_KOBO = PER_NIGHT_NAIRA * 100 * SEARCH_IKOYI.nights;
const PRIOR_STAY_NAIRA = 600_000;
const PRIOR_STAY_KOBO = PRIOR_STAY_NAIRA * 100;

const SCENARIO: RecordedJourneyDefinition = {
  name: "budget-chip-scenarios",
  threadId: THREAD,
  description: "Budget-chip scenarios (not recorded).",
  withSecondDomain: false,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: AGAIN_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: HELD_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
  ],
};

interface ArtifactView {
  readonly filters: Readonly<Record<string, unknown>>;
  readonly resultIds: readonly string[];
}

/** The assistant runtime's discovery artifact for the thread: the filters the planner's search ran with, and its results. */
function assistantSearch(driver: ChipDriver): ArtifactView | undefined {
  const artifact: unknown = driver.step().runtime.getThread(THREAD).discoveryArtifact;
  if (typeof artifact !== "object" || artifact === null) return undefined;
  const facts = (artifact as { readonly facts?: { readonly filters?: unknown; readonly results?: unknown } }).facts;
  if (typeof facts?.filters !== "object" || facts.filters === null || !Array.isArray(facts.results)) return undefined;
  return {
    filters: facts.filters as Readonly<Record<string, unknown>>,
    resultIds: (facts.results as readonly { readonly id: string }[]).map((unit) => unit.id),
  };
}

function budgetChip(driver: ChipDriver, naira: number, per: "stay" | "night") {
  return driver.chip(CRITERIA_EDIT_EVENT, { field: "budget", naira, per });
}

function clearBudgetChip(driver: ChipDriver) {
  return driver.chip(CRITERIA_EDIT_EVENT, { field: "budget", clear: true });
}

test("AC1: After a budget chip edit, the next assistant search uses that budget.", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    assertOk(await budgetChip(driver, PER_NIGHT_NAIRA, "night"), "per-night budget chip");

    // The planner omits the budget; the server applies the chip's, converted to the stay's total (ADR 0015).
    assertOk(await driver.typed(AGAIN_TEXT), "the next assistant search");
    const search = assistantSearch(driver);
    assert.ok(search, "the assistant holds the search it ran");
    assert.equal(search.filters.maxPriceKobo, PER_NIGHT_TOTAL_KOBO, "the assistant search filters on the chip's all-in total for 4 nights");

    // The same budget on the deterministic path gives the same results.
    const deterministic = environment.discoveryQuery.search({ location: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-12-14", checkOut: CHECK_OUT, partySize: 2, maxPriceKobo: PER_NIGHT_TOTAL_KOBO });
    assert.deepEqual(search.resultIds, deterministic.facts.results.map((unit) => unit.id), "the assistant search matches the deterministic search for the same budget");
    assert.deepEqual(search.resultIds, ["unit-lagos-ikoyi-001"], "the per-night budget includes the Old Ikoyi unit");
  } finally { environment.close(); }
});

test("AC2: Clearing the budget chip removes it from the assistant search.", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    assertOk(await budgetChip(driver, PER_NIGHT_NAIRA, "night"), "per-night budget chip");
    assertOk(await clearBudgetChip(driver), "clear the budget chip");
    assert.equal(driver.stay().maxBudgetKobo, undefined, "the assistant's stay has no budget after the clear");

    assertOk(await driver.typed(AGAIN_TEXT), "the next assistant search");
    const search = assistantSearch(driver);
    assert.ok(search);
    assert.equal(search.filters.maxPriceKobo, undefined, "the assistant search has no budget filter after the clear");
    assert.deepEqual(search.resultIds, ["unit-lagos-ikoyi-001"], "the unfiltered search still finds the unit");
  } finally { environment.close(); }
});

test("AC3: Undo after a budget edit restores the previous budget in the assistant state.", async () => {
  const environment = stagingGuest();
  try {
    // Undo keeps its history in the page's application, so the edits and the undo run warm (issue 03 Comments); the result is read
    // back on a cold restore below.
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: false, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    assertOk(await budgetChip(driver, PRIOR_STAY_NAIRA, "stay"), "the previous budget, per stay");
    assertOk(await budgetChip(driver, PER_NIGHT_NAIRA, "night"), "the budget being undone, per night");
    assert.equal(driver.stay().maxBudgetPer, "night", "the per-night budget is in the assistant's state before the undo");

    assertOk(await driver.chip(CRITERIA_UNDO_EVENT, {}), "undo the budget edit");
    assert.equal(driver.stay().maxBudgetKobo, PRIOR_STAY_KOBO, "the previous budget is back in the assistant's state");
    assert.equal(driver.stay().maxBudgetPer, "stay", "the previous budget keeps its per-stay meaning");

    const cold = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
    assert.equal(cold.stay().maxBudgetKobo, PRIOR_STAY_KOBO, "after a cold restore the previous budget is still in the state");
    assert.equal(cold.stay().maxBudgetPer, "stay");
  } finally { environment.close(); }
});

test("AC4: A per-night chip budget survives a cold restore as per night.", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    assertOk(await budgetChip(driver, PER_NIGHT_NAIRA, "night"), "per-night budget chip");

    // A cold restore rebuilds the strip from the persisted context: it must still be a per-night budget for 4 nights.
    const strip = driver.step().app.getState(THREAD)?.criteria?.budget;
    assert.equal(strip?.per, "night", "the strip reloads the budget as per night");
    assert.equal(strip?.naira, PER_NIGHT_NAIRA);
    assert.equal(strip?.label, "₦500,000 total for 4 nights, all fees included", "the strip converts the nightly budget with the current nights");
    assert.equal(driver.stay().maxBudgetPer, "night", "the assistant's state keeps the per-night meaning");
    assert.equal(assistantSearch(driver)?.filters.maxPriceKobo, PER_NIGHT_TOTAL_KOBO, "the rebuilt search uses the per-night total, not the nightly amount as a stay total");
  } finally { environment.close(); }
});

test("AC5: A budget edit while a turn is running is refused like the other chips (threadBusy).", async () => {
  const environment = stagingGuest();
  try {
    const gated = gatedModel(journeyScriptedModel(SCENARIO), HELD_TEXT);
    const driver = openChipDriver(environment, gated.model, { cold: true, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    const gate: Gate = gated.gate;

    const inFlight = driver.typed(HELD_TEXT);
    await gate.reached;
    const refused = await budgetChip(driver, PER_NIGHT_NAIRA, "night");
    assert.equal(refused.ok, false, "the budget edit is refused while the turn runs");
    assert.equal(refused.ok ? "" : refused.code, THREAD_BUSY_CODE, "the refusal is THREAD_BUSY");
    assert.equal(driver.stay().maxBudgetKobo, undefined, "the refused edit records no budget in the assistant's state");

    gate.release();
    assertOk(await inFlight, "the in-flight turn completes");
    assert.equal(driver.stay().maxBudgetKobo, undefined, "the completed turn does not add the refused budget");
  } finally { environment.close(); }
});

test("AC6: Runs with the assistant enabled and a cold restore before every event.", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: true, threadId: THREAD });
    assertOk(await driver.typed(SEARCH_TEXT), "search on a fresh thread");
    assert.equal(driver.step().runtime.hasThread(THREAD), true, "the assistant runtime holds the thread after a cold restore");

    assertOk(await budgetChip(driver, PER_NIGHT_NAIRA, "night"), "budget chip on a cold restore");
    assert.equal(driver.step().runtime.hasThread(THREAD), true, "the assistant runtime holds the thread after the chip");
    assert.equal(driver.stay().maxBudgetPer, "night", "the chip reached the assistant on this cold restore");

    assertOk(await driver.typed(AGAIN_TEXT), "assistant search on a cold restore");
    assert.equal(assistantSearch(driver)?.filters.maxPriceKobo, PER_NIGHT_TOTAL_KOBO, "the assistant search used the budget");
  } finally { environment.close(); }
});

function persistedProjection() {
  return {
    version: 1,
    timeline: [],
    discoverySurfaceId: "surface",
    discoveryRevision: 0,
    discoveryArtifact: null,
    unitDetail: null,
    draftId: null,
    draftQuote: null,
    requestId: null,
    offerId: null,
    activeStage: null,
    activeSurfaceId: null,
    assistantContext: { city: "Lagos", checkIn: "2026-12-14", nights: 4, partySize: 2 },
  };
}

// Fail-closed guards beyond the acceptance criteria (ADR 0106: closed checks; ADR 0015: a budget has one meaning).
test("Legacy: a persisted budget with no meaning restores as a stay total; the rest of the context is kept.", () => {
  const projection = persistedProjection();
  const legacy = parseGuestProjection({ ...projection, assistantContext: { ...projection.assistantContext, maxBudgetKobo: 50_000_000 } })?.assistantContext;
  assert.ok(legacy, "the context parses");
  assert.equal(legacy.maxBudgetKobo, 50_000_000, "the legacy amount is kept");
  assert.equal(legacy.maxBudgetPer, "stay", "a legacy budget means a stay total (the planner was its only writer)");
  assert.equal(legacy.nights, 4, "the stay's nights are kept");
});

test("Fail closed: a persisted budget whose meaning is present but unknown or invalid is dropped; the rest of the context is kept.", () => {
  const projection = persistedProjection();
  const parsed = (assistantContext: Record<string, unknown>) => parseGuestProjection({ ...projection, assistantContext })?.assistantContext;
  assert.equal(parsed({ ...projection.assistantContext, maxBudgetKobo: 50_000_000, maxBudgetPer: "night" })?.maxBudgetPer, "night", "a known meaning is kept");
  for (const invalid of [{ maxBudgetPer: "week" }, { maxBudgetPer: 1 }, { maxBudgetPer: null }]) {
    const context = parsed({ ...projection.assistantContext, maxBudgetKobo: 50_000_000, ...invalid });
    assert.ok(context, "the rest of the context still parses");
    assert.equal(context.maxBudgetKobo, undefined, `a budget with ${JSON.stringify(invalid)} is dropped, not guessed`);
    assert.equal(context.maxBudgetPer, undefined);
    assert.equal(context.nights, 4, "the stay's nights are kept");
  }
});

test("Fail closed: a budget with a zero amount or an unknown meaning is refused by the runtime and changes nothing.", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, journeyScriptedModel(SCENARIO), { cold: false, threadId: THREAD });
    await driver.typed(SEARCH_TEXT);
    const runtime = driver.step().runtime;
    const before = driver.stay();
    assert.equal(runtime.recordGuestStay(THREAD, { budget: { kobo: 0, per: "stay" } }), false, "a zero budget is refused");
    assert.equal(runtime.recordGuestStay(THREAD, { budget: { kobo: 50_000_000, per: "week" as "stay" } }), false, "an unknown meaning is refused");
    assert.deepEqual(driver.stay(), before, "a refused budget changes nothing");
  } finally { environment.close(); }
});
