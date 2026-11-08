import test from "node:test";
import assert from "node:assert/strict";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { coldTurn, datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { storedAssistantContext, withLiveApp } from "./helpers/stay-length-fixtures.js";

// Issue 20 (coordinator follow-up): a date range or "N of us" the guest typed in a clarification turn is kept, on both paths. Every
// assistant event is a NEW application over the same store (a cold restore), on the staging-like clock (27 Oct 2026) and guest.

const PLACE = { city: "Lagos", neighbourhood: "Old Ikoyi" } as const;
const JAN_5 = "2027-01-05";
const JAN_8 = "2027-01-08";
const JAN_6 = "2027-01-06";

function searchOutcomes(diagnostics: readonly AssistantDiagnosticEvent[]): boolean[] {
  return diagnostics
    .filter((event) => event.stage === "application_operation" && event.toolName === "search_stays")
    .map((event) => event.succeeded);
}

function okOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return result as GuestTurnSuccess;
}

function journey(turns: Readonly<Record<string, ScriptedTurn>>): { readonly model: ReturnType<typeof scriptedPlanner>["client"]; readonly diagnostics: AssistantDiagnosticEvent[]; readonly f: DatedFixture } {
  const model = scriptedPlanner(turns).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  return { model, diagnostics, f };
}

test("A date range in a clarification turn is kept after a cold restore", async () => {
  const cases: readonly { readonly text: string; readonly threadId: string }[] = [
    { text: "Ikoyi, 5 Jan to 8 Jan", threadId: "g-1f2000001001" },
    { text: "Ikoyi from 5 Jan until 8 Jan", threadId: "g-1f2000001002" },
    { text: "Ikoyi, 5–8 Jan", threadId: "g-1f2000001003" },
  ];
  for (const { text, threadId } of cases) {
    const turns: Record<string, ScriptedTurn> = {
      [text]: { slots: { ...PLACE, checkIn: JAN_5, checkOut: JAN_8 }, reply: "clarify_stay" },
      "2 of us": { slots: { guests: 2 }, search: { ...PLACE, checkIn: JAN_5, nights: 3, guests: 2 } },
    };
    const { model, diagnostics, f } = journey(turns);
    try {
      okOf(await coldTurn(f, threadId, text, model, diagnostics));
      const saved = storedAssistantContext(f.environment, threadId);
      assert.equal(saved.checkIn, JAN_5, `"${text}": the check-in is saved`);
      assert.equal(saved.checkOut, JAN_8, `"${text}": the checkout is saved`);
      assert.equal(saved.nights, 3, `"${text}": the nights are saved`);
      assert.deepEqual(saved.statedStay, { nights: 3, unit: "night", count: 3 }, `"${text}": the stated length is three nights`);

      const second = okOf(await coldTurn(f, threadId, "2 of us", model, diagnostics));
      assert.deepEqual(searchOutcomes(diagnostics), [true], `"${text}": the party turn searches the saved range`);
      assert.match(second.criteria?.when?.label ?? "", /^5–8 Jan 2027 · 3 nights$/, `"${text}": the strip shows the range`);
    } finally { f.close(); }
  }
});

test("An ambiguous date range saves no dates", async () => {
  const cases: readonly { readonly text: string; readonly threadId: string }[] = [
    { text: "Ikoyi, 8 Jan to 5 Jan, 2 of us", threadId: "g-1f2000002001" },
    { text: "Ikoyi, 5 Jan or 6 Jan, 2 of us", threadId: "g-1f2000002002" },
    { text: "Ikoyi, next Friday to 8 Jan, 2 of us", threadId: "g-1f2000002003" },
  ];
  for (const { text, threadId } of cases) {
    const turns: Record<string, ScriptedTurn> = { [text]: { slots: { ...PLACE, checkIn: JAN_5, checkOut: JAN_8 }, reply: "clarify_stay" } };
    const { model, diagnostics, f } = journey(turns);
    try {
      okOf(await coldTurn(f, threadId, text, model, diagnostics));
      assert.deepEqual(searchOutcomes(diagnostics), [], `"${text}": no search runs`);
      const saved = storedAssistantContext(f.environment, threadId);
      assert.equal(saved.checkIn, undefined, `"${text}": no check-in is saved`);
      assert.equal(saved.checkOut, undefined, `"${text}": no checkout is saved`);
      assert.equal(saved.nights, undefined, `"${text}": no nights are saved`);
      assert.notEqual(saved.checkIn, JAN_6, `"${text}": the second candidate is not saved either`);
    } finally { f.close(); }
  }
});

test("'4 of us' is read as a party of 4 on both paths", async () => {
  // Deterministic path: the shared reader gives the party, and the strip shows it.
  await withLiveApp(async (app) => {
    const turn = okOf(await app.handleTurn("g-1f2000003001", "Ikoyi from 5 Jan for 3 nights, 4 of us"));
    assert.equal(turn.criteria?.guests?.count, 4, "the deterministic path reads 4 of us as 4 guests");
  });
  // Assistant path, cold restore before the event: the clarification turn saves the party.
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi from 5 Jan for 3 nights, 4 of us": { slots: { ...PLACE, checkIn: JAN_5, nights: 3, guests: 4 }, reply: "clarify_stay" },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    okOf(await coldTurn(f, "g-1f2000003002", "Ikoyi from 5 Jan for 3 nights, 4 of us", model, diagnostics));
    assert.equal(storedAssistantContext(f.environment, "g-1f2000003002").partySize, 4, "the assistant path saves 4 guests");
  } finally { f.close(); }
});

test("'a few of us' gives no party size", async () => {
  await withLiveApp(async (app) => {
    const turn = okOf(await app.handleTurn("g-1f2000004001", "Ikoyi from 5 Jan for 3 nights, a few of us"));
    assert.equal(turn.criteria?.guests, undefined, "the deterministic path reads no party from 'a few of us'");
  });
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi from 5 Jan for 3 nights, a few of us": { slots: { ...PLACE, checkIn: JAN_5, nights: 3 }, reply: "clarify_stay" },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    okOf(await coldTurn(f, "g-1f2000004002", "Ikoyi from 5 Jan for 3 nights, a few of us", model, diagnostics));
    assert.equal(storedAssistantContext(f.environment, "g-1f2000004002").partySize, undefined, "the assistant path saves no party");
  } finally { f.close(); }
});
