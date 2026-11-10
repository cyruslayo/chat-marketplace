import test from "node:test";
import assert from "node:assert/strict";
import type { GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// Issue 19 (ADR 0106 date and stay authority, 27 Oct and 2 Nov 2026; ADR 0092: a month is 30 nights). The assistant is enabled, the
// clock is the staging-like 27 Oct 2026, the guest has no seeded phone or email, and every event is sent through a NEW application
// over the same store (a cold restore) before it runs.

const TEXT_TWO_MONTHS = "Ikoyi for 2 months from 5 Jan, 2 of us";
const TEXT_A_FEW_MONTHS = "Ikoyi for a few months from 5 Jan, 2 of us";
const TEXT_SEVEN_MONTHS = "Ikoyi for 7 months from 5 Jan, 2 of us";
const CHECK_IN = "2027-01-05";
/** Classifier slots never carry nights, so the planner's own search call is the one under test. */
const SLOTS = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, guests: 2 };

function scriptFor(text: string, nights: number): Record<string, ScriptedTurn> {
  return { [text]: { slots: SLOTS, search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights, guests: 2 } } };
}

type Planner = ReturnType<typeof scriptedPlanner>["client"];

/** A new application over the same store, before the event (ADR 0106 cold restore). */
function coldTurn(environment: LocalGuestEnvironment, model: Planner, threadId: string, text: string, diagnostics: AssistantDiagnosticEvent[]): Promise<GuestTurnResult> {
  return wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, text);
}

/** The outcome of each search_stays application operation, in order (true: the search ran; false: it was rejected). */
function searchOutcomes(diagnostics: readonly AssistantDiagnosticEvent[]): boolean[] {
  return diagnostics
    .filter((event) => event.stage === "application_operation" && event.toolName === "search_stays")
    .map((event) => event.succeeded);
}

/** The stay the assistant persisted for the thread (the same nights and checkout a cold restore rebuilds from). */
function persistedStay(environment: LocalGuestEnvironment, threadId: string): { readonly nights?: unknown; readonly checkOut?: unknown } | undefined {
  const record = environment.interactionStore.findThread(threadId);
  if (!record) return undefined;
  const projection = JSON.parse(record.threadJson) as { readonly assistantContext?: { readonly nights?: unknown; readonly checkOut?: unknown } | null };
  return projection.assistantContext ?? undefined;
}

function messageOf(result: GuestTurnResult): string {
  return result.ok ? result.messages.join(" ") : `${result.code}: ${result.message}`;
}

test("AC3 'Ikoyi for 2 months from 5 Jan, 2 of us' yields a 60-night search, cold-restored before every event", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_TWO_MONTHS, 60)).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = await coldTurn(f.environment, model, "g-1f1900000060", TEXT_TWO_MONTHS, diagnostics);
    assert.equal(result.ok, true, messageOf(result));
    assert.deepEqual(searchOutcomes(diagnostics), [true], "one search runs");
    assert.equal(persistedStay(f.environment, "g-1f1900000060")?.nights, 60);
    assert.equal(persistedStay(f.environment, "g-1f1900000060")?.checkOut, "2027-03-06", "60 nights from 5 January 2027");
  } finally { f.close(); }
});

test("AC3 a planner call with 61 nights is a tool_denial and no 61-night search runs", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_TWO_MONTHS, 61)).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = await coldTurn(f.environment, model, "g-1f1900000061", TEXT_TWO_MONTHS, diagnostics);
    assert.equal(result.ok, true, `a rejected tool call is not a failed turn: ${messageOf(result)}`);
    assert.equal(messageOf(result), "Just to check: you’d like 60 nights (2 months). Shall I search for that?", "the reply shows the guest's length back");
    assert.deepEqual(searchOutcomes(diagnostics), [false], "the 61-night search_stays call is rejected");
    assert.equal(persistedStay(f.environment, "g-1f1900000061")?.nights, undefined, "no 61-night stay is recorded");
  } finally { f.close(); }
});

test("AC4 A vague length ('a few months') gets the nights question on the assistant path, never a guessed length", async () => {
  // The planner tries to guess 60 nights from the vague words. The server does not accept the guess.
  const model = scriptedPlanner(scriptFor(TEXT_A_FEW_MONTHS, 60)).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = await coldTurn(f.environment, model, "g-1f1900000004", TEXT_A_FEW_MONTHS, diagnostics);
    assert.equal(result.ok, true, messageOf(result));
    assert.match(messageOf(result), /How many nights/, "the guest is asked for the nights");
    assert.deepEqual(searchOutcomes(diagnostics), [false], "the guessed 60-night search is rejected, so no search runs");
    assert.equal(persistedStay(f.environment, "g-1f1900000004")?.nights, undefined);
  } finally { f.close(); }
});

test("AC5 '7 months' is refused with the existing 180-night message on the assistant path", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_SEVEN_MONTHS, 210)).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = await coldTurn(f.environment, model, "g-1f1900000005", TEXT_SEVEN_MONTHS, diagnostics);
    assert.equal(result.ok, true, messageOf(result));
    assert.match(messageOf(result), /Stays can be at most 180 nights\. Please choose 180 nights or fewer\./);
    // The schema (nights at most the policy maximum) rejects 210 before any application operation, so no search_stays runs at all.
    assert.deepEqual(searchOutcomes(diagnostics), [], "no search runs for 210 nights");
  } finally { f.close(); }
});
