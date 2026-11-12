import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { SEARCH_AREAS, locationConflictQuestion, unsupportedPreferenceNote } from "../apps/local-guest/src/concierge.js";
import { GUEST_CHANGE_EXPLANATION } from "../apps/web-agent/src/guest-content.js";
import type { CapturedRequest } from "./helpers/openai-compatible-client.js";
import { datedFixture, scriptedPlanner, LIVE_LIKE_CLOCK, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { coldApp, journeyToRequest, stagingJourneyFixture, successOf, typedTurn, JOURNEY_SCRIPT } from "./helpers/assistant-stage-journey.js";

// Issue 09 (assistant-concierge-parity; ADR 0005, 0060, 0080, 0099, 0106): a location change while a search is active or a stay is
// sent. The question is asked only for a different city (owner decision, 2 Nov 2026); a same-city change switches at once. Every event runs on the assistant runtime, on a fresh thread, with a cold restore (a new application over the same store)
// before it, on the staging-like clock (27 Oct 2026) and a guest with no seeded phone or email.

const THREAD = "g-d1a0000901";
const IKOYI_TEXT = "Apartment in Old Ikoyi for 2 guests, 3 nights from 14 December 2026";
const IKOYI_SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-12-14", nights: 3, guests: 2 };
const ABUJA_QUESTION = "my friend lives in Abuja, is it far?";
const ABUJA_ANSWER = "Abuja, please";
const LEKKI_SWITCH = "Lekki, please";
const GYM_TEXT = "with a gym";
const UNRELATED_TEXT = "how many bedrooms does a typical place have?";
const ABUJA_TEXT = "Apartment in Abuja for 2 guests, 3 nights from 14 December 2026";

const HELD_LABEL = SEARCH_AREAS.find((area) => area.neighbourhood === "Old Ikoyi")!.label;
const ABUJA_LABEL = SEARCH_AREAS.find((area) => area.city === "Abuja" && area.neighbourhood === undefined)!.label;

const SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...JOURNEY_SCRIPT,
  [IKOYI_TEXT]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: IKOYI_SEARCH },
  [ABUJA_QUESTION]: { slots: { city: "Abuja" }, search: { city: "Abuja" } },
  [ABUJA_ANSWER]: { slots: { city: "Abuja" }, search: { city: "Abuja" } },
  [LEKKI_SWITCH]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1" }, search: { city: "Lagos", neighbourhood: "Lekki Phase 1" } },
  [GYM_TEXT]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, search: { city: "Lagos", neighbourhood: "Old Ikoyi", requiredAmenities: ["gym"] } },
  [UNRELATED_TEXT]: { slots: {}, reply: "clarify_stay" },
};

/** The assistant's task state after a cold restore, as the next event sees it. */
function stayIntentOf(f: DatedFixture, threadId: string) {
  return coldApp(f, threadId).runtime.getThread(threadId).taskState.stayIntent;
}

/** The shortlist's stay ids after a cold restore: the results the guest is looking at. */
function shortlistOf(f: DatedFixture, threadId: string): readonly string[] {
  return coldApp(f, threadId).runtime.getThread(threadId).taskState.shortlist.map((stay) => `${stay.stayRef}:${stay.unitId}`);
}

function hasDiscoverySurface(result: GuestTurnResult): boolean {
  return result.ok && result.surfaces.some((surface) => /:discovery:/.test(surface.surfaceId));
}

/** An Old Ikoyi search is the active search on the thread, with its results shown. */
async function ikoyiSearchActive(f: DatedFixture, threadId: string): Promise<void> {
  successOf(await typedTurn(f, threadId, IKOYI_TEXT, SCRIPT), "Ikoyi search");
  assert.equal(stayIntentOf(f, threadId).neighbourhood, "Old Ikoyi", "the Ikoyi search is the active search");
}

test("AC1: With a Lagos search active, \"my friend lives in Abuja, is it far?\" asks the change question and keeps the Ikoyi results", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    const before = shortlistOf(f, THREAD);
    assert.ok(before.length > 0, "the Ikoyi search has results before the question");

    const planner: CapturedRequest[] = [];
    const asked = successOf(await typedTurn(f, THREAD, ABUJA_QUESTION, SCRIPT, planner), "Abuja question");
    assert.deepEqual(asked.messages, [locationConflictQuestion({ city: "Abuja", label: "Abuja" }, { city: "Lagos", neighbourhood: "Old Ikoyi" })],
      "the reply asks the change question in the deterministic wording");
    // Issue 58: chips are structured `{ label, edit? }`; compare their labels.
    assert.deepEqual(asked.quickReplies?.map((chip) => chip.label), [HELD_LABEL, ABUJA_LABEL], "the question offers the two area chips: the held area, then the new one");
    assert.equal(hasDiscoverySurface(asked), false, "no new results are shown while the question is open");
    assert.deepEqual(shortlistOf(f, THREAD), before, "the Ikoyi results are kept");
    assert.equal(stayIntentOf(f, THREAD).neighbourhood, "Old Ikoyi", "the search still holds Old Ikoyi");
    assert.deepEqual(stayIntentOf(f, THREAD).pendingLocation, { city: "Abuja" }, "the Abuja change is held as the pending change");
  } finally { f.close(); }
});

test("AC2: Answering the question with Abuja searches Abuja and keeps the other criteria", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    successOf(await typedTurn(f, THREAD, ABUJA_QUESTION, SCRIPT), "Abuja question");

    const answered = successOf(await typedTurn(f, THREAD, ABUJA_ANSWER, SCRIPT), "Abuja answer");
    assert.equal(hasDiscoverySurface(answered), true, "the Abuja search shows its results");
    const intent = stayIntentOf(f, THREAD);
    assert.equal(intent.location, "Abuja", "the search now holds Abuja");
    assert.equal(intent.neighbourhood, undefined, "no Lagos neighbourhood is carried into Abuja");
    assert.equal(intent.nights, 3, "the nights are kept");
    assert.equal(intent.partySize, 2, "the party size is kept");
    assert.equal(intent.checkIn, "2026-12-14", "the check-in date is kept");
    assert.equal(intent.pendingLocation, undefined, "the answered question is cleared");
  } finally { f.close(); }
});

test("AC3 failure path: an unrelated reply leaves the search unchanged", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    successOf(await typedTurn(f, THREAD, ABUJA_QUESTION, SCRIPT), "Abuja question");
    const before = shortlistOf(f, THREAD);
    const intentBefore = stayIntentOf(f, THREAD);

    const unrelated = successOf(await typedTurn(f, THREAD, UNRELATED_TEXT, SCRIPT), "unrelated reply");
    assert.equal(hasDiscoverySurface(unrelated), false, "no search runs for an unrelated reply");
    assert.deepEqual(shortlistOf(f, THREAD), before, "the results are unchanged");
    const intent = stayIntentOf(f, THREAD);
    assert.equal(intent.neighbourhood, intentBefore.neighbourhood, "the area is unchanged");
    assert.equal(intent.nights, intentBefore.nights, "the nights are unchanged");
    assert.equal(intent.partySize, intentBefore.partySize, "the party size is unchanged");
    assert.deepEqual(intent.pendingLocation, intentBefore.pendingLocation, "the open question is not cleared by an unrelated reply");
  } finally { f.close(); }
});

test("AC4: \"with a gym\" adds the same note as the deterministic path, and the search runs without a gym filter", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    const note = unsupportedPreferenceNote(["gym"]);
    assert.equal(note, "I can't filter by “gym” yet, so it isn't applied to the search.", "the deterministic note for a gym");

    const reply = successOf(await typedTurn(f, THREAD, GYM_TEXT, SCRIPT), "with a gym");
    assert.ok(reply.messages.length > 0, "the search replies");
    assert.equal(reply.messages.at(-1)?.endsWith(note!), true, "the reply carries the same note as the deterministic path");
    assert.equal(hasDiscoverySurface(reply), true, "the search ran");
    assert.deepEqual(stayIntentOf(f, THREAD).requiredAmenities ?? [], [], "the search carried no amenity filter");
  } finally { f.close(); }
});

test("AC5: the pending question survives a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    successOf(await typedTurn(f, THREAD, ABUJA_QUESTION, SCRIPT), "Abuja question");

    // The persisted thread holds the pending change in the existing assistant context (ADR 0093 minimal projection).
    const stored = f.environment.interactionStore.findThread(THREAD);
    assert.ok(stored, "the thread is stored");
    const durable = JSON.parse(stored!.threadJson) as { readonly assistantContext?: { readonly pendingLocation?: unknown } };
    assert.deepEqual(durable.assistantContext?.pendingLocation, { city: "Abuja" }, "the pending change is persisted in the assistant context");

    // The next event is a cold restore: the guest's answer is accepted against the restored pending change.
    const answered = successOf(await typedTurn(f, THREAD, ABUJA_ANSWER, SCRIPT), "answer after restore");
    assert.equal(hasDiscoverySurface(answered), true, "the answer after the restore runs the Abuja search");
    assert.equal(stayIntentOf(f, THREAD).location, "Abuja", "the restored question is answered");
  } finally { f.close(); }
});

test("AC6: a same-city neighbourhood change (Old Ikoyi to Lekki Phase 1) searches at once and asks nothing", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await ikoyiSearchActive(f, THREAD);
    const switched = successOf(await typedTurn(f, THREAD, LEKKI_SWITCH, SCRIPT), "Lekki switch");
    assert.equal(switched.messages.some((message) => /Do you want|should I keep searching/.test(message)), false, "no change question is asked within the same city");
    assert.equal(hasDiscoverySurface(switched), true, "the Lekki search runs at once");
    const intent = stayIntentOf(f, THREAD);
    assert.equal(intent.location, "Lagos", "the city is unchanged");
    assert.equal(intent.neighbourhood, "Lekki Phase 1", "the search now holds Lekki Phase 1, as the deterministic path does");
    assert.equal(intent.nights, 3, "the nights are kept");
    assert.equal(intent.partySize, 2, "the party size is kept");
    assert.equal(intent.pendingLocation, undefined, "no change is pending");
  } finally { f.close(); }
});

test("AC7: In a sent stay a location change gets the change explanation and no search runs", async () => {
  const f: DatedFixture = stagingJourneyFixture(scriptedPlanner(SCRIPT).client);
  try {
    const requestId = await journeyToRequest(f, THREAD);
    const unitId = f.environment.bookingRequestApp.getArtifact(requestId, f.environment.guestPrincipal()).facts.unitId;
    const planner: CapturedRequest[] = [];
    const reply = successOf(await typedTurn(f, THREAD, LEKKI_SWITCH, SCRIPT, planner), "location change in a sent stay");
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.request(f.environment.unitRepository.findById(unitId)?.operator?.name)],
      "the request explanation is the reply");
    assert.equal(planner.length, 0, "the planner is not called, so no search runs");
    assert.equal(hasDiscoverySurface(reply), false, "no results are shown");
    assert.equal(coldApp(f, THREAD).runtime.getThread(THREAD).taskState.currentBookingRequestId, requestId, "the sent request is still the stay");
  } finally { f.close(); }
});
