import test from "node:test";
import assert from "node:assert/strict";
import type { GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// Facts given across two turns: turn 1 gives the place, the date and the length but no party, so the planner asks for it;
// turn 2 gives the party and the planner searches with the facts from both turns. Clock 27 Oct 2026, staging-like guest.
// Cold runs: a NEW application over the same store before every event. Warm runs: one application for both turns.

const CHECK_IN = "2027-01-05";
const PLACE = { city: "Lagos", neighbourhood: "Old Ikoyi" } as const;
const A_TURN_1 = "Ikoyi from 5 Jan for 3 nights";
const A_TURN_2 = "2 of us";
const B_TURN_1 = "Ikoyi, 2 months from 5 Jan";
const B_TURN_2 = "2 of us";

/** One script per case: both cases' second turn is "2 of us", so they cannot share one planner script. */
function scriptFor(first: string, second: string, nights: number): Record<string, ScriptedTurn> {
  return {
    [first]: { slots: { ...PLACE, checkIn: CHECK_IN }, reply: "clarify_stay" },
    [second]: { slots: { guests: 2 }, search: { ...PLACE, checkIn: CHECK_IN, nights, guests: 2 } },
  };
}

type Planner = ReturnType<typeof scriptedPlanner>["client"];

function okOf(result: GuestTurnResult): Extract<GuestTurnResult, { readonly ok: true }> {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return result as Extract<GuestTurnResult, { readonly ok: true }>;
}

function messageOf(result: GuestTurnResult): string {
  return result.ok ? result.messages.join(" ") : `${result.code}: ${result.message}`;
}

function searchOutcomes(diagnostics: readonly AssistantDiagnosticEvent[]): boolean[] {
  return diagnostics
    .filter((event) => event.stage === "application_operation" && event.toolName === "search_stays")
    .map((event) => event.succeeded);
}

/** The thread's stored assistant context, or undefined when nothing was persisted. */
function storedContext(environment: LocalGuestEnvironment, threadId: string): Record<string, unknown> | undefined {
  const record = environment.interactionStore.findThread(threadId);
  if (!record) return undefined;
  const projection = JSON.parse(record.threadJson) as { readonly assistantContext?: Record<string, unknown> | null };
  return projection.assistantContext ?? undefined;
}

function coldTurn(environment: LocalGuestEnvironment, model: Planner, threadId: string, text: string, diagnostics: AssistantDiagnosticEvent[]): Promise<GuestTurnResult> {
  const app = wireDatedApp(environment, model, diagnostics).app;
  app.getState(threadId);
  return app.handleTurn(threadId, text);
}

/** Runs both turns and asserts the second turn's search, with the facts from both turns. */
async function runTwoTurns(first: string, second: string, nights: number, cold: boolean): Promise<void> {
  const model = scriptedPlanner(scriptFor(first, second, nights)).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const threadId = cold ? "g-1f1900002000" : "g-1f1900002001";
  try {
    let reply = "";
    if (cold) {
      okOf(await coldTurn(f.environment, model, threadId, first, diagnostics));
      reply = messageOf(await coldTurn(f.environment, model, threadId, second, diagnostics));
    } else {
      const app = wireDatedApp(f.environment, model, diagnostics).app;
      app.getState(threadId);
      okOf(await app.handleTurn(threadId, first));
      reply = messageOf(await app.handleTurn(threadId, second));
    }
    assert.deepEqual(searchOutcomes(diagnostics).at(-1), true, `the second turn runs a search; the guest saw: "${reply}"`);
    const context = storedContext(f.environment, threadId);
    assert.ok(context, "the thread holds an assistant context after the search");
    assert.equal(context.city, "Lagos");
    assert.equal(context.checkIn, CHECK_IN);
    assert.equal(context.nights, nights, `the search is for ${nights} nights`);
    assert.equal(context.partySize, 2, "the search is for 2 guests");
  } finally { f.close(); }
}

test("(a) cold: 'Ikoyi from 5 Jan for 3 nights' then '2 of us' searches 3 nights in Ikoyi from 5 Jan for 2 guests", { todo: "todo: pre-existing, outside issue 19: a clarification turn leaves no city or check-in in the runtime state, so nothing is persisted (shortlet-app.ts:3118-3119 returns null without a city; shortlet-app.ts:3494 syncs only then), and restoreShortletState clears the conversation history that the planner's check-in needed (assistant-runtime.ts:779)" }, async () => {
  await runTwoTurns(A_TURN_1, A_TURN_2, 3, true);
});

test("(a) warm: the same two turns in one running application searches 3 nights for 2 guests", async () => {
  await runTwoTurns(A_TURN_1, A_TURN_2, 3, false);
});

test("(b) cold: 'Ikoyi, 2 months from 5 Jan' then '2 of us' searches 60 nights", { todo: "todo: pre-existing, outside issue 19: a clarification turn leaves no city or check-in in the runtime state, so nothing is persisted (shortlet-app.ts:3118-3119 returns null without a city; shortlet-app.ts:3494 syncs only then), and restoreShortletState clears the conversation history that the planner's check-in needed (assistant-runtime.ts:779); the stated length also stays only in the runtime state (stayIntent.statedStay), which is not persisted without the same city" }, async () => {
  await runTwoTurns(B_TURN_1, B_TURN_2, 60, true);
});

test("(b) warm: the same two turns in one running application searches 60 nights", async () => {
  await runTwoTurns(B_TURN_1, B_TURN_2, 60, false);
});
