import test from "node:test";
import assert from "node:assert/strict";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { coldTurn, datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { criteriaEditEvent, storedAssistantContext } from "./helpers/stay-length-fixtures.js";

// Issue 20 (owner decision, 8 Nov 2026; ADR 0106 amended 8 Nov 2026): a clarification turn runs no search and keeps nothing the
// planner proposed, but saves the facts the guest's own words gave into the persisted assistant context, so the next turn can use
// them after a cold restore. The assistant is enabled, the clock is the staging-like 27 Oct 2026, the guest has no seeded phone or
// email, and every event goes through a NEW application over the same store before it runs.

const PLACE = { city: "Lagos", neighbourhood: "Old Ikoyi" } as const;
const JAN_5 = "2027-01-05";
const JAN_12 = "2027-01-12";
const JAN_20 = "2027-01-20";
/** The keys the persisted context may hold after issue 19 (ADR 0106 Projection, amended 8 Nov 2026): nothing else is added by issue 20. */
const ISSUE_19_CONTEXT_KEYS = ["city", "neighbourhood", "checkIn", "isDemoDate", "checkOut", "nights", "partySize", "bedrooms", "maxBudgetKobo", "maxBudgetPer", "requiredAmenities", "selectedUnitId", "pendingLocation", "pendingDate", "statedStay",
  // Issue 57 (ADR 0106 amendment of 9 Nov 2026): the closed open-question code, server-set, no text. Added when the chat-hardening batch merged.
  "openQuestion"];

type Planner = ReturnType<typeof scriptedPlanner>["client"];

function okOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${result.code}: ${result.message}`);
  return result as GuestTurnSuccess;
}

function messageOf(result: GuestTurnResult): string {
  return result.ok ? result.messages.join(" ") : `${result.code}: ${result.message}`;
}

/** The outcome of each search_stays application operation, in order (true: the search ran; false: it was rejected). */
function searchOutcomes(diagnostics: readonly AssistantDiagnosticEvent[]): boolean[] {
  return diagnostics
    .filter((event) => event.stage === "application_operation" && event.toolName === "search_stays")
    .map((event) => event.succeeded);
}

function searchFor(checkIn: string, nights: number, guests: number) {
  return { ...PLACE, checkIn, nights, guests };
}

/** One fixture, one planner, one scripted script; every turn after this is a cold restore. */
function journey(turns: Readonly<Record<string, ScriptedTurn>>): { readonly model: Planner; readonly diagnostics: AssistantDiagnosticEvent[]; readonly f: DatedFixture } {
  const model = scriptedPlanner(turns).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  return { model, diagnostics, f };
}

test("AC1 Cold restore before every event: 'Ikoyi from 5 Jan for 3 nights' then '2 of us' searches Ikoyi, 5 to 8 Jan, 2 guests", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi from 5 Jan for 3 nights": { slots: { ...PLACE, checkIn: JAN_5, nights: 3 }, reply: "clarify_stay" },
    "2 of us": { slots: { guests: 2 }, search: searchFor(JAN_5, 3, 2) },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    const threadId = "g-1f2000000100";
    okOf(await coldTurn(f, threadId, "Ikoyi from 5 Jan for 3 nights", model, diagnostics));
    const second = okOf(await coldTurn(f, threadId, "2 of us", model, diagnostics));
    assert.deepEqual(searchOutcomes(diagnostics), [true], `the second turn searches; the guest saw: "${messageOf(second)}"`);
    assert.match(second.criteria?.when?.label ?? "", /^5–8 Jan 2027 · 3 nights$/, "the search is 5 to 8 Jan, three nights");
    const context = storedAssistantContext(f.environment, threadId);
    assert.equal(context.neighbourhood, "Old Ikoyi", "the search is in Ikoyi");
    assert.equal(context.partySize, 2, "the search is for 2 guests");
  } finally { f.close(); }
});

test("AC2 Cold restore before every event: 'Ikoyi, 2 months from 5 Jan' then '2 of us' searches 60 nights, and the strip shows '60 nights (2 months)'", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi, 2 months from 5 Jan": { slots: { ...PLACE, checkIn: JAN_5, nights: 60 }, reply: "clarify_stay" },
    "2 of us": { slots: { guests: 2 }, search: searchFor(JAN_5, 60, 2) },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    const threadId = "g-1f2000000200";
    okOf(await coldTurn(f, threadId, "Ikoyi, 2 months from 5 Jan", model, diagnostics));
    const second = okOf(await coldTurn(f, threadId, "2 of us", model, diagnostics));
    assert.deepEqual(searchOutcomes(diagnostics), [true], "the second turn searches");
    assert.match(second.criteria?.when?.label ?? "", /6 Mar/, "60 nights from 5 Jan end on 6 Mar 2027");
    assert.match(second.criteria?.when?.label ?? "", /60 nights \(2 months\)/, "the strip shows the months after the nights");
    assert.equal(second.criteria?.when?.nights, 60, "the chip value stays the number of nights");
  } finally { f.close(); }
});

test("AC3 A clarification turn saves nothing the planner proposed: a planner check-in the guest never typed leaves no check-in in the saved context", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi, 2 months, 2 of us": { slots: { ...PLACE, nights: 60, guests: 2 }, search: searchFor(JAN_5, 60, 2) },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    const threadId = "g-1f2000000300";
    const denied = okOf(await coldTurn(f, threadId, "Ikoyi, 2 months, 2 of us", model, diagnostics));
    assert.match(denied.messages.join(" "), /before I can search/, "the invented check-in is a rejected tool call with a dated clarification");
    assert.deepEqual(searchOutcomes(diagnostics), [false], "no search runs");
    const context = storedAssistantContext(f.environment, threadId);
    assert.equal(context.checkIn, undefined, "the planner's 5 Jan is not saved");
    assert.equal(context.checkOut, undefined, "no checkout is saved either");
    assert.equal(context.nights, undefined, "no nights from the planner are saved");
    assert.deepEqual(context.statedStay, { nights: 60, unit: "month", count: 2 }, "the guest's own length is saved");
    // Coordinator rule (8 Nov 2026): a refused planner date is not a missing-fact clarification, so the area it came with is not saved.
    assert.equal(context.city, undefined, "a refused planner date saves no area");
  } finally { f.close(); }
});

test("AC4 A check-in the date rules refuse is not saved: 'next month' and a date beyond the booking horizon", async () => {
  const cases = [
    "Ikoyi for 3 nights next month, 2 of us",
    "Ikoyi from 2028-01-05 for 3 nights, 2 of us",
  ];
  for (const text of cases) {
    const turns: Record<string, ScriptedTurn> = { [text]: { slots: { ...PLACE, nights: 3 }, reply: "clarify_stay" } };
    const { model, diagnostics, f } = journey(turns);
    try {
      const threadId = `g-1f20000004${cases.indexOf(text)}0`;
      okOf(await coldTurn(f, threadId, text, model, diagnostics));
      assert.deepEqual(searchOutcomes(diagnostics), [], `"${text}": no search runs`);
      const context = storedAssistantContext(f.environment, threadId);
      assert.equal(context.checkIn, undefined, `"${text}": no check-in is saved`);
      assert.equal(context.checkOut, undefined, `"${text}": no checkout is saved`);
      assert.equal(context.isDemoDate, undefined, `"${text}": no provenance is saved either`);
    } finally { f.close(); }
  }
});

test("AC5 A new guest fact in turn 2 replaces the saved check-in, and a chip edit replaces it too", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi from 5 Jan for 3 nights": { slots: { ...PLACE, checkIn: JAN_5, nights: 3 }, reply: "clarify_stay" },
    "Ikoyi from 12 Jan, 2 of us": { slots: { ...PLACE, checkIn: JAN_12, guests: 2 }, reply: "clarify_stay" },
    "2 of us": { slots: { guests: 2 }, search: searchFor(JAN_12, 3, 2) },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    const threadId = "g-1f2000000500";
    okOf(await coldTurn(f, threadId, "Ikoyi from 5 Jan for 3 nights", model, diagnostics));
    okOf(await coldTurn(f, threadId, "Ikoyi from 12 Jan, 2 of us", model, diagnostics));
    const replaced = storedAssistantContext(f.environment, threadId);
    assert.equal(replaced.checkIn, JAN_12, "the new check-in replaces 5 Jan");
    assert.equal(replaced.checkOut, "2027-01-15", "the held three nights still apply to the new arrival");

    const searched = okOf(await coldTurn(f, threadId, "2 of us", model, diagnostics));
    assert.match(searched.criteria?.when?.label ?? "", /^12–15 Jan 2027 · 3 nights$/, "the search uses the replaced arrival");
    const key = searched.criteria?.key;
    assert.ok(key, "the strip has a key to edit against");

    const editing = wireDatedApp(f.environment, model, diagnostics).app;
    editing.getState(threadId);
    okOf(await editing.handleEventAsync(threadId, criteriaEditEvent(threadId, key, JAN_20, 3, LIVE_LIKE_CLOCK())));
    assert.equal(storedAssistantContext(f.environment, threadId).checkIn, JAN_20, "the chip edit replaces the check-in");
  } finally { f.close(); }
});

test("AC7 The persisted assistant context gains no field beyond issue 19's statedStay (its keys are asserted)", async () => {
  const turns: Record<string, ScriptedTurn> = {
    "Ikoyi, 2 months from 5 Jan, 2 of us": { slots: { ...PLACE, checkIn: JAN_5, nights: 60, guests: 2 }, reply: "clarify_stay" },
    "2 of us": { slots: { guests: 2 }, search: searchFor(JAN_5, 60, 2) },
  };
  const { model, diagnostics, f } = journey(turns);
  try {
    const threadId = "g-1f2000000700";
    okOf(await coldTurn(f, threadId, "Ikoyi, 2 months from 5 Jan, 2 of us", model, diagnostics));
    const partial = storedAssistantContext(f.environment, threadId);
    assert.deepEqual(Object.keys(partial).filter((key) => !ISSUE_19_CONTEXT_KEYS.includes(key)), [], "the partial context keeps only issue 19's fields");
    okOf(await coldTurn(f, threadId, "2 of us", model, diagnostics));
    const searched = storedAssistantContext(f.environment, threadId);
    assert.deepEqual(Object.keys(searched).filter((key) => !ISSUE_19_CONTEXT_KEYS.includes(key)), [], "the searched context keeps only issue 19's fields");
  } finally { f.close(); }
});
