import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { clientWith, completion } from "./helpers/openai-compatible-client.js";
import { classifiedMessage, datedFixture, isScopeRequest, lastRoleIsTool, latestUserText, OPENROUTER, scopeVerdict, scriptedPlanner, searchToolCall } from "./helpers/guest-date-fixtures.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";

const OWNER_TEXT = "Lekki Phase 1, check in 20 November 2026, check out 23 November 2026, 2 guests";
const OWNER_VARIANT = "3 nights from 20 November 2026 for 2 guests";
const CHIP_FOLLOW_UP = "2 guests";
const LEKKI_FIRST = "Find apartments in Lekki Phase 1, Lagos, for 4 nights and 2 guests.";

/** Classifier slots for the owner's natural-language dates; the model normalises them to ISO slots. */
function ownerSlots(text: string) {
  if (text === OWNER_TEXT) return { city: "Lagos", neighbourhood: "Lekki Phase 1", guests: 2, checkIn: "2026-11-20", checkOut: "2026-11-23" };
  if (text === OWNER_VARIANT) return { city: "Lagos", guests: 2, nights: 3, checkIn: "2026-11-20" };
  return {};
}

test("Date literal AC1: a natural-language check-in and checkout in the guest's own message authorize the planner's matching ISO dates", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) return completion({ content: JSON.stringify(scopeVerdict(ownerSlots(classifiedMessage(request)))) });
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    if (latestUserText(request) === OWNER_TEXT) return searchToolCall("owner-dates", { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-20", nights: 3, guests: 2 });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client, diagnostics);
  try {
    const result = await f.app.handleTurn("g-deadbeef21", OWNER_TEXT);
    assert.equal(result.ok, true, `expected an in-scope reply, saw errorClass ${JSON.stringify(diagnostics.map((event) => event.errorClass))}`);
    assert.equal(result.surfaces.length, 1, JSON.stringify({ messages: result.messages, diag: diagnostics.map((event) => [event.stage, event.errorClass, event.failureClass, event.succeeded]) }));
    assert.ok(!diagnostics.some((event) => event.errorClass === "AssistantDateProvenanceError"));
  } finally { f.close(); }
});

test("Date literal AC2: '3 nights from 20 November 2026 for 2 guests' authorizes the matching check-in", async () => {
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) return completion({ content: JSON.stringify(scopeVerdict(ownerSlots(classifiedMessage(request)))) });
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    if (latestUserText(request) === OWNER_VARIANT) return searchToolCall("variant-dates", { city: "Lagos", checkIn: "2026-11-20", nights: 3, guests: 2 });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client);
  try {
    const result = await f.app.handleTurn("g-deadbeef22", OWNER_VARIANT);
    assert.equal(result.ok, true);
    assert.equal(result.surfaces.length, 1);
  } finally { f.close(); }
});

test("Date authority AC3: a planner date that matches no guest literal fails closed with a dated clarification that keeps the guest's message", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) return completion({ content: JSON.stringify(scopeVerdict(ownerSlots(classifiedMessage(request)))) });
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    if (latestUserText(request) === OWNER_TEXT) return searchToolCall("unauthored", { city: "Lagos", checkIn: "2026-11-21", nights: 3, guests: 2 });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client, diagnostics);
  try {
    const result = await f.app.handleTurn("g-deadbeef23", OWNER_TEXT);
    assert.equal(result.ok, true, "a date authority violation must not surface as CONCIERGE_UNAVAILABLE");
    assert.deepEqual(result.surfaces, []);
    assert.equal(result.messages?.[0], GUEST_ASSISTANT_COPY.datesClarification);
    const history = f.runtime.getThread("g-deadbeef23").conversationHistory;
    assert.ok(history.some((step) => step.role === "user" && step.text === OWNER_TEXT), "the guest's message is preserved");
    assert.ok(!diagnostics.some((event) => event.stage === "application_operation" && event.succeeded), "no search ran");
  } finally { f.close(); }
});

test("Date chip AC4: a date set through the structured chip authorizes the planner's matching ISO date on a later text turn", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) {
      const text = classifiedMessage(request);
      const slots = text === CHIP_FOLLOW_UP ? { guests: 2 } : text === LEKKI_FIRST ? { city: "Lagos", neighbourhood: "Lekki Phase 1", nights: 4, guests: 2 } : {};
      return completion({ content: JSON.stringify(scopeVerdict(slots)) });
    }
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    const text = latestUserText(request);
    if (text === LEKKI_FIRST) return searchToolCall("first-search", { city: "Lagos", neighbourhood: "Lekki Phase 1", nights: 4, guests: 2 });
    if (text === CHIP_FOLLOW_UP) return searchToolCall("chip-follow-up", { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-20", nights: 4, guests: 2 });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client, diagnostics);
  try {
    const threadId = "g-deadbeef24";
    const first = await f.app.handleTurn(threadId, LEKKI_FIRST);
    assert.equal(first.ok, true);
    const basedOn = f.app.getState(threadId)?.criteria?.key;
    assert.ok(basedOn, "the first search exposes its criteria key");
    const chip = f.app.handleEvent(threadId, { name: CRITERIA_EDIT_EVENT, surfaceId: criteriaSurfaceId(threadId), sourceComponentId: "t",
      timestamp: new Date().toISOString(), context: { field: "when", checkIn: "2026-11-20", nights: 4, basedOn } });
    assert.equal(chip.ok, true);
    const followUp = await f.app.handleTurn(threadId, CHIP_FOLLOW_UP);
    assert.equal(followUp.ok, true, `a chip-set date is guest-authored structured input; errorClass ${JSON.stringify(diagnostics.map((event) => [event.errorClass, event.failureClass]))}`);
    assert.equal(followUp.surfaces.length, 1);
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.checkIn, "2026-11-20");
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.isDemoDate, false);
  } finally { f.close(); }
});

test("Date chip AC5: a planner date that neither the guest text nor a chip date authored still fails closed", async () => {
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) {
      const slots = classifiedMessage(request) === CHIP_FOLLOW_UP ? { guests: 2 } : { city: "Lagos", neighbourhood: "Lekki Phase 1", nights: 4, guests: 2 };
      return completion({ content: JSON.stringify(scopeVerdict(slots)) });
    }
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    const text = latestUserText(request);
    if (text === LEKKI_FIRST) return searchToolCall("first-search", { city: "Lagos", neighbourhood: "Lekki Phase 1", nights: 4, guests: 2 });
    if (text === CHIP_FOLLOW_UP) return searchToolCall("model-only-date", { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-25", nights: 4, guests: 2 });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client);
  try {
    const threadId = "g-deadbeef25";
    await f.app.handleTurn(threadId, LEKKI_FIRST);
    const followUp = await f.app.handleTurn(threadId, CHIP_FOLLOW_UP);
    assert.equal(followUp.ok, true);
    assert.deepEqual(followUp.surfaces, []);
    assert.equal(followUp.messages?.[0], GUEST_ASSISTANT_COPY.datesClarification);
  } finally { f.close(); }
});

// Stay details without a party size (or without nights) are a rejected planner call, not an application fault (ADR 0106).
const PARTY_ISO = "Apartment in Lekki, 3 nights from 2026-09-20";
const PARTY_FOLLOW_UP = "2 guests";
const NIGHTS_MISSING = "Apartment in Lekki from 2026-09-20 for 2 guests";
const SEPT_LEKKI = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
const PARTY_SCRIPT = {
  [PARTY_ISO]: { slots: { ...SEPT_LEKKI, checkIn: "2026-09-20", nights: 3 }, search: { ...SEPT_LEKKI, checkIn: "2026-09-20", nights: 3 } },
  [PARTY_FOLLOW_UP]: { slots: { guests: 2 }, search: { ...SEPT_LEKKI, checkIn: "2026-09-20", nights: 3, guests: 2 } },
  [NIGHTS_MISSING]: { slots: { ...SEPT_LEKKI, checkIn: "2026-09-20", guests: 2 }, search: { ...SEPT_LEKKI, checkIn: "2026-09-20", guests: 2 } },
};

test("Stay details AC1: an ISO check-in with nights and no party size gets the fixed stay clarification, not CONCIERGE_UNAVAILABLE", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(scriptedPlanner(PARTY_SCRIPT).client, diagnostics);
  try {
    const result = await f.app.handleTurn("g-deadbeef31", PARTY_ISO);
    assert.equal(result.ok, true, `expected a clarification, saw ${JSON.stringify(diagnostics.map((event) => [event.toolName, event.errorClass]))}`);
    if (!result.ok) return;
    assert.equal(result.assistantControlOutcome, "tool_denial");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.stayClarification]);
    assert.deepEqual(result.surfaces, []);
    assert.ok(!diagnostics.some((event) => event.errorClass === "RangeError"), "the missing party size is not an application fault");
  } finally { f.close(); }
});

test("Stay details AC2: a follow-up that gives the party size completes the search with the earlier check-in", async () => {
  const f = datedFixture(scriptedPlanner(PARTY_SCRIPT).client);
  try {
    const threadId = "g-deadbeef32";
    const asked = await f.app.handleTurn(threadId, PARTY_ISO);
    assert.equal(asked.ok, true);
    const completed = await f.app.handleTurn(threadId, PARTY_FOLLOW_UP);
    assert.equal(completed.ok, true, JSON.stringify(completed));
    if (!completed.ok) return;
    assert.equal(completed.surfaces.length, 1, "the search produced its results surface");
    const artifact = f.runtime.getThread(threadId).discoveryArtifact as { readonly facts?: { readonly filters?: Record<string, unknown> } } | undefined;
    assert.deepEqual([artifact?.facts?.filters?.checkIn, artifact?.facts?.filters?.checkOut, artifact?.facts?.filters?.partySize], ["2026-09-20", "2026-09-23", 2]);
  } finally { f.close(); }
});

test("Stay details AC3: a check-in and party size without nights gets the same fixed clarification", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(scriptedPlanner(PARTY_SCRIPT).client, diagnostics);
  try {
    const result = await f.app.handleTurn("g-deadbeef33", NIGHTS_MISSING);
    assert.equal(result.ok, true, `expected a clarification, saw ${JSON.stringify(diagnostics.map((event) => [event.toolName, event.errorClass]))}`);
    if (!result.ok) return;
    assert.equal(result.assistantControlOutcome, "tool_denial");
    assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.stayClarification]);
  } finally { f.close(); }
});
