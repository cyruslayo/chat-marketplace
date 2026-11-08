import test from "node:test";
import assert from "node:assert/strict";
import type { GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { criteriaEditEvent } from "./helpers/stay-length-fixtures.js";

// Issue 19, owner decision (8 Nov 2026): the guest's stated stay length is persisted with the assistant context as `statedStay`,
// so it binds every later search and draft after a cold restore (ADR 0106 Projection, amended 8 Nov 2026). The assistant is enabled,
// the clock is the staging-like 27 Oct 2026, the guest has no seeded phone or email, and every event goes through a NEW application
// over the same store (a cold restore) before it runs.
//
// The persisted context needs a location and a check-in, and a clarification turn commits neither (ADR 0106 tool_denial). So each
// thread's first turn carries the party and searches; the length then has a persisted record to bind the next turn.

const CHECK_IN = "2027-01-05";
const IKOYI_TWO_MONTHS_TWO_OF_US = "Ikoyi for 2 months from 5 Jan, 2 of us";
const IKOYI_SIXTY_NIGHTS_TWO_OF_US = "Ikoyi for 60 nights from 5 Jan, 2 of us";
const TWO_OF_US = "2 of us";
const THREE_NIGHTS = "3 nights, 2 of us";
const PLACE = { city: "Lagos", neighbourhood: "Old Ikoyi" } as const;

function searchFor(nights: number) {
  return { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights, guests: 2 };
}

/** The scripted turns: each text the planner sees, with the planner's search for it (`nights` is the planner's own choice). */
function turnsFor(twoOfUsNights: number): Record<string, ScriptedTurn> {
  return {
    [IKOYI_TWO_MONTHS_TWO_OF_US]: { slots: { ...PLACE, checkIn: CHECK_IN, guests: 2 }, search: searchFor(60) },
    [IKOYI_SIXTY_NIGHTS_TWO_OF_US]: { slots: { ...PLACE, checkIn: CHECK_IN, guests: 2 }, search: searchFor(60) },
    [TWO_OF_US]: { slots: { guests: 2 }, search: searchFor(twoOfUsNights) },
    [THREE_NIGHTS]: { slots: { guests: 2 }, search: searchFor(3) },
  };
}

function plannerFor(twoOfUsNights: number) {
  return scriptedPlanner(turnsFor(twoOfUsNights)).client;
}

type Planner = ReturnType<typeof plannerFor>;

function messageOf(result: GuestTurnResult): string {
  return result.ok ? result.messages.join(" ") : `${result.code}: ${result.message}`;
}

function okOf(result: GuestTurnResult): Extract<GuestTurnResult, { readonly ok: true }> {
  assert.equal(result.ok, true, messageOf(result));
  return result as Extract<GuestTurnResult, { readonly ok: true }>;
}

/** The outcome of each search_stays application operation, in order (true: the search ran; false: it was rejected). */
function searchOutcomes(diagnostics: readonly AssistantDiagnosticEvent[]): boolean[] {
  return diagnostics
    .filter((event) => event.stage === "application_operation" && event.toolName === "search_stays")
    .map((event) => event.succeeded);
}

/** The thread's stored assistant context (`thread.assistantContext` in the durable projection). */
function storedContext(environment: LocalGuestEnvironment, threadId: string): Record<string, unknown> {
  const record = environment.interactionStore.findThread(threadId);
  assert.ok(record, "the thread is stored");
  const projection = JSON.parse(record.threadJson) as { readonly assistantContext?: Record<string, unknown> | null };
  assert.ok(projection.assistantContext, "the thread has an assistant context");
  return projection.assistantContext;
}

/** One guest turn through a new application over the same store, loaded as a page load does (a cold restore before the event). */
function coldTurn(environment: LocalGuestEnvironment, model: Planner, threadId: string, text: string, diagnostics: AssistantDiagnosticEvent[]): Promise<GuestTurnResult> {
  const app = wireDatedApp(environment, model, diagnostics).app;
  app.getState(threadId);
  return app.handleTurn(threadId, text);
}

test("A length stated in months binds the next turn after a cold restore: '2 months from 5 Jan' then '2 of us' searches 60 nights, and a planner 61 is a tool_denial", async () => {
  const model60 = plannerFor(60);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model60, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-1f1900000600";
    const first = okOf(await coldTurn(f.environment, model60, threadId, IKOYI_TWO_MONTHS_TWO_OF_US, diagnostics));
    assert.match(first.criteria?.when?.label ?? "", /60 nights \(2 months\)/, "the first search shows the months");
    assert.deepEqual(storedContext(f.environment, threadId).statedStay, { nights: 60, unit: "month", count: 2 });

    // Cold restore, then the party alone: the planner's 60 nights agrees with the stated length and searches.
    const second = okOf(await coldTurn(f.environment, model60, threadId, TWO_OF_US, diagnostics));
    assert.match(second.criteria?.when?.label ?? "", /60 nights/, "the party turn searches 60 nights");
    assert.deepEqual(searchOutcomes(diagnostics), [true, true], "both searches run, for 60 nights");

    // Cold restore again, and the planner asks for 61 nights: a tool_denial, and no 61-night stay is recorded.
    const model61 = plannerFor(61);
    const denied = okOf(await coldTurn(f.environment, model61, threadId, TWO_OF_US, diagnostics));
    assert.equal(messageOf(denied), "Just to check: you’d like 60 nights (2 months). Shall I search for that?", "the reply shows the stated length back");
    assert.deepEqual(searchOutcomes(diagnostics), [true, true, false], "the 61-night search_stays call is a tool_denial, so no search runs");
    assert.equal(storedContext(f.environment, threadId).nights, 60, "the stored stay is still 60 nights");
  } finally { f.close(); }
});

test("A new typed length replaces the stated length", async () => {
  const model = plannerFor(60);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-1f1900000700";
    okOf(await coldTurn(f.environment, model, threadId, IKOYI_TWO_MONTHS_TWO_OF_US, diagnostics));
    okOf(await coldTurn(f.environment, model, threadId, THREE_NIGHTS, diagnostics));
    assert.deepEqual(storedContext(f.environment, threadId).statedStay, { nights: 3, unit: "night", count: 3 }, "the typed nights replace the months");
    assert.deepEqual(searchOutcomes(diagnostics), [true, true], "the 3-night search runs");

    // The months are gone: a planner 60 on the party turn is a tool_denial against the 3 nights the guest typed.
    const denied = okOf(await coldTurn(f.environment, model, threadId, TWO_OF_US, diagnostics));
    assert.equal(messageOf(denied), "Just to check: you’d like 3 nights. Shall I search for that?", "the reply shows the typed nights back");
    assert.deepEqual(searchOutcomes(diagnostics), [true, true, false], "the 60-night call is refused");
  } finally { f.close(); }
});

test("A nights chip edit replaces the stated length and drops the months show-back", async () => {
  const model = plannerFor(60);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-1f1900000800";
    const searched = okOf(await coldTurn(f.environment, model, threadId, IKOYI_TWO_MONTHS_TWO_OF_US, diagnostics));
    const key = searched.criteria?.key;
    assert.ok(key, "the criteria strip has a key");
    assert.match(searched.criteria?.when?.label ?? "", /60 nights \(2 months\)/);

    // The chip edit is structured guest input, sent through a cold restore as the page does.
    const editing = wireDatedApp(f.environment, model, diagnostics).app;
    editing.getState(threadId);
    const edit = okOf(await editing.handleEventAsync(threadId, criteriaEditEvent(threadId, key, CHECK_IN, 25, LIVE_LIKE_CLOCK())));
    const label = edit.criteria?.when?.label ?? "";
    assert.match(label, /25 nights/, "the strip shows 25 nights");
    assert.doesNotMatch(label, /month/, "the months show-back is dropped");
    assert.deepEqual(storedContext(f.environment, threadId).statedStay, { nights: 25, unit: "night", count: 25 }, "a chip edit sets unit night");

    // The replaced length binds: a planner 60 on the next party turn is refused against the 25 nights the chip holds.
    const denied = okOf(await coldTurn(f.environment, model, threadId, TWO_OF_US, diagnostics));
    assert.equal(messageOf(denied), "Just to check: you’d like 25 nights. Shall I search for that?", "the reply shows the chip's nights back");
  } finally { f.close(); }
});

test("On the assistant path the criteria strip shows 60 nights (2 months) after a months request, and after a cold restore", async () => {
  const model = plannerFor(60);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-1f1900000900";
    const searched = okOf(await coldTurn(f.environment, model, threadId, IKOYI_TWO_MONTHS_TWO_OF_US, diagnostics));
    assert.match(searched.criteria?.when?.label ?? "", /· 60 nights \(2 months\)$/, "the strip after the request shows the months");
    assert.equal(searched.criteria?.when?.nights, 60, "the chip value stays the number of nights");

    // A cold restore: the strip is rebuilt from the persisted context, so the months come back with it.
    const restored = wireDatedApp(f.environment, model, diagnostics).app;
    const state = restored.getState(threadId);
    assert.ok(state, "the restored thread has state");
    assert.match(state.criteria?.when?.label ?? "", /· 60 nights \(2 months\)$/, "the strip after a cold restore shows the months");
  } finally { f.close(); }
});

test("The persisted assistant context gains only the stated length", async () => {
  // The same 60 nights, typed as nights and then as 2 months: the nights and every other field are the same, and only the stated length differs.
  const model = plannerFor(60);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-1f1900001000";
    okOf(await coldTurn(f.environment, model, threadId, IKOYI_SIXTY_NIGHTS_TWO_OF_US, diagnostics));
    const before = storedContext(f.environment, threadId);
    assert.deepEqual(before.statedStay, { nights: 60, unit: "night", count: 60 }, "the typed nights are the stated length");

    okOf(await coldTurn(f.environment, model, threadId, IKOYI_TWO_MONTHS_TWO_OF_US, diagnostics));
    const after = storedContext(f.environment, threadId);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "the same keys before and after: nothing is added");
    assert.deepEqual(after.statedStay, { nights: 60, unit: "month", count: 2 }, "the stated length is the months the guest typed");
    for (const key of Object.keys(before).filter((entry) => entry !== "statedStay")) {
      assert.deepEqual(after[key], before[key], `${key} is unchanged`);
    }
  } finally { f.close(); }
});
