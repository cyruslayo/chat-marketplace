import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import {
  coldRun,
  datedFixture,
  LIVE_LIKE_CLOCK,
  runtimeDiscoveryArtifact,
  scriptedPlanner,
  successfulTurn,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";

// Issue 05a (ADR 0106, 0023, 0092, 0055): the guest's own literal checkout gives the nights on the server. Every turn runs on a fresh
// thread, with the assistant runtime enabled, a cold restore before every event, the staging clock (27 Oct 2026) and a guest with no
// phone or email. Checkout phrases ("until next Monday") belong to issue 05b and are not covered here.

const AREA = "Old Ikoyi";
const PAIR_TEXT = "Ikoyi 20 Nov to 23 Nov for 2";
const PAIR_SLOTS = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-20", checkOut: "2026-11-23", guests: 2 } as const;
const BACKWARDS_TEXT = "Ikoyi 23 Nov to 20 Nov for 2";
const BACKWARDS_SLOTS = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-23", checkOut: "2026-11-20", guests: 2 } as const;
const LONG_TEXT = "Ikoyi 1 Dec to 1 Jan 2028 for 2";
const LONG_SLOTS = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-12-01", checkOut: "2028-01-01", guests: 2 } as const;
const SEARCH = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-20", checkOut: "2026-11-23", guests: 2 };
// Issue 05b: "from 2 Nov, leaving in two weeks" (check-in 2 Nov typed; "in two weeks" = Tue 10 Nov, a single day on this clock).
const CHECKOUT_PHRASE_TEXT = "Ikoyi from 2 Nov, leaving in two weeks, for 2";
const CHECKOUT_PHRASE_SEARCH = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", checkOutPhrase: "in two weeks", guests: 2 };
const YES = "Yes";
const HELD_STAY_SEARCH = { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", checkOut: "2026-11-10", guests: 2 };
const CHECKOUT_NOT_WRITTEN_TEXT = "Ikoyi from 2 Nov for 2";
const CHECKOUT_BEFORE_TEXT = "Ikoyi from 10 Nov, leaving next Monday for 2";
const NO_CHECKIN_TEXT = "Ikoyi leaving in two weeks for 2";
const SUPERSEDING_TEXT = "Ikoyi from 2 Nov, leaving next Monday for 2";
// "2 guests" rather than "for 2": the deterministic path reads the party size from "N guests" only (the same words on both paths).
const PARITY_TEXT = "Ikoyi 20 Nov to 23 Nov for 2 guests";

const SCRIPT: Record<string, ScriptedTurn> = {
  [PAIR_TEXT]: { slots: PAIR_SLOTS, intents: ["search"], search: SEARCH },
  // The model's nights (2) contradict the guest's checkout (3 nights).
  "Ikoyi 20 Nov to 23 Nov for 2, two nights": { slots: PAIR_SLOTS, intents: ["search"], search: { ...SEARCH, nights: 2 } },
  [BACKWARDS_TEXT]: { slots: BACKWARDS_SLOTS, intents: ["search"], search: { ...SEARCH, checkIn: "2026-11-23", checkOut: "2026-11-20" } },
  [LONG_TEXT]: { slots: LONG_SLOTS, intents: ["search"], search: { ...SEARCH, checkIn: "2026-12-01", checkOut: "2028-01-01" } },
  [CHECKOUT_PHRASE_TEXT]: { slots: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", guests: 2 }, intents: ["search"], search: CHECKOUT_PHRASE_SEARCH },
  [YES]: { slots: {}, intents: ["search"], search: HELD_STAY_SEARCH },
  [CHECKOUT_NOT_WRITTEN_TEXT]: { slots: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", checkOutPhrase: "in two weeks", guests: 2 } },
  [CHECKOUT_BEFORE_TEXT]: { slots: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-10", guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-10", checkOutPhrase: "next Monday", guests: 2 } },
  [NO_CHECKIN_TEXT]: { slots: { city: "Lagos", neighbourhood: AREA, guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkOutPhrase: "in two weeks", guests: 2 } },
  [SUPERSEDING_TEXT]: { slots: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: AREA, checkIn: "2026-11-02", checkOutPhrase: "next Monday", guests: 2 } },
  [PARITY_TEXT]: { slots: PAIR_SLOTS, intents: ["search"], search: SEARCH },
};

function fixture(): DatedFixture {
  return datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
}

test("AC1: \"Ikoyi 20 Nov to 23 Nov for 2\" searches 2026-11-20 to 2026-11-23 (3 nights) with no nights from the model", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5a0000101";
    const { result, runtime } = await coldRun(f, threadId, PAIR_TEXT, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "pair");
    assert.ok(turn.surfaces.length > 0, "the stay is searched");
    const artifact = runtimeDiscoveryArtifact(runtime, threadId);
    assert.ok(artifact, "the discovery artifact exists");
    const filters = (artifact as unknown as { facts: { filters: Record<string, unknown> } }).facts.filters;
    assert.equal(filters.checkIn, "2026-11-20");
    assert.equal(filters.checkOut, "2026-11-23");
    assert.equal(runtime.getThread(threadId).taskState.stayIntent.nights, 3, "the nights come from the guest's checkout");
  } finally { f.close(); }
});

test("AC2 failure path: a model nights that contradicts the guest's checkout is a tool_denial and runs no search", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5a0000102";
    const { result, runtime } = await coldRun(f, threadId, "Ikoyi 20 Nov to 23 Nov for 2, two nights", scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "contradicting nights");
    assert.equal(turn.messages[0], GUEST_ASSISTANT_COPY.datesClarification, "the dates clarification answers the refusal");
    assert.deepEqual(turn.surfaces, [], "no search surface");
    assert.equal(runtime.getThread(threadId).taskState.shortlist.length, 0, "no search ran");
  } finally { f.close(); }
});

test("AC3 failure path: a checkout before the check-in is a tool_denial with the dates clarification", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5a0000103";
    const { result, runtime } = await coldRun(f, threadId, BACKWARDS_TEXT, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "backwards");
    assert.equal(turn.messages[0], GUEST_ASSISTANT_COPY.datesClarification);
    assert.deepEqual(turn.surfaces, []);
    assert.equal(runtime.getThread(threadId).taskState.shortlist.length, 0, "no search ran");
  } finally { f.close(); }
});

test("AC3 failure path: a stay beyond the stay limits is a tool_denial and runs no search", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5a0000104";
    const { result, runtime } = await coldRun(f, threadId, LONG_TEXT, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "beyond limits");
    assert.ok(
      turn.messages[0] === GUEST_ASSISTANT_COPY.stayClarification || turn.messages[0] === GUEST_ASSISTANT_COPY.datesClarification,
      "the existing stay or dates clarification answers the refusal",
    );
    assert.deepEqual(turn.surfaces, []);
    assert.equal(runtime.getThread(threadId).taskState.shortlist.length, 0, "no search ran");
  } finally { f.close(); }
});

test("AC5: the checkout journey runs with the assistant enabled and a cold restore before every event, on the staging clock", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5a0000105";
    const searched = successfulTurn((await coldRun(f, threadId, PAIR_TEXT, scriptedPlanner(SCRIPT).client)).result, "search");
    assert.ok(searched.surfaces.length > 0, "the stay is searched after a cold restore");
    const refused = successfulTurn((await coldRun(f, `g-d5a0000106`, "Ikoyi 20 Nov to 23 Nov for 2, two nights", scriptedPlanner(SCRIPT).client)).result, "refused");
    assert.deepEqual(refused.surfaces, [], "the refusal also survives a cold restore on its own thread");
  } finally { f.close(); }
});

// Issue 05b (ADR 0106 2 Nov 2026): a relative checkout phrase is shown back with both dates and the nights, and only a yes searches.

test("05b AC1: \"from 2 Nov, leaving in two weeks, for 2\" shows back both dates and the nights, and runs no search", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000101";
    const { result, runtime } = await coldRun(f, threadId, CHECKOUT_PHRASE_TEXT, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(result, "checkout phrase");
    assert.equal(turn.messages[0], "Just to check: arriving Mon 2 Nov 2026 and leaving Tue 10 Nov 2026 (8 nights), 2 guests in Old Ikoyi. Shall I search these dates? Reply \"yes\", or tell me different dates.", "both dates and the nights are shown back");
    assert.deepEqual(turn.surfaces, [], "no search surface");
    assert.equal(runtime.getThread(threadId).taskState.shortlist.length, 0, "no search ran");
    assert.equal(runtime.getThread(threadId).taskState.stayIntent.checkOut, undefined, "the checkout is not authorized until the guest says yes");
  } finally { f.close(); }
});

test("05b AC2: Yes after the checkout show-back searches the held stay, cold-restored before the Yes", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000102";
    successfulTurn((await coldRun(f, threadId, CHECKOUT_PHRASE_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    const confirmed = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    const turn = successfulTurn(confirmed.result, "Yes");
    assert.ok(turn.surfaces.length > 0, "the confirmed stay is searched");
    const state = confirmed.runtime.getThread(threadId).taskState.stayIntent;
    assert.equal(state.checkIn, "2026-11-02");
    assert.equal(state.checkOut, "2026-11-10");
    assert.equal(state.nights, 8);
  } finally { f.close(); }
});

test("05b AC3 failure path: a checkout phrase the guest did not write is a tool_denial", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000103";
    const refused = successfulTurn((await coldRun(f, threadId, CHECKOUT_NOT_WRITTEN_TEXT, scriptedPlanner(SCRIPT).client)).result, "not written");
    assert.equal(refused.messages[0], GUEST_ASSISTANT_COPY.datesClarification);
    assert.deepEqual(refused.surfaces, []);
  } finally { f.close(); }
});

test("05b AC3 failure path: a checkout phrase before the check-in is refused with the dates clarification", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000104";
    const refused = successfulTurn((await coldRun(f, threadId, CHECKOUT_BEFORE_TEXT, scriptedPlanner(SCRIPT).client)).result, "before check-in");
    assert.equal(refused.messages[0], GUEST_ASSISTANT_COPY.datesClarification);
    assert.deepEqual(refused.surfaces, []);
  } finally { f.close(); }
});

test("05b AC3 failure path: a checkout phrase with no guest-authored check-in is refused and never uses the demo date", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000105";
    const refused = successfulTurn((await coldRun(f, threadId, NO_CHECKIN_TEXT, scriptedPlanner(SCRIPT).client)).result, "no check-in");
    assert.equal(refused.messages[0], GUEST_ASSISTANT_COPY.datesClarification);
    assert.deepEqual(refused.surfaces, [], "no search runs on the demo check-in");
  } finally { f.close(); }
});

test("05b AC4 failure path: a checkout show-back superseded by a later phrase does not confirm the earlier checkout", async () => {
  const f = fixture();
  try {
    const threadId = "g-d5b0000106";
    successfulTurn((await coldRun(f, threadId, CHECKOUT_PHRASE_TEXT, scriptedPlanner(SCRIPT).client)).result, "show-back");
    successfulTurn((await coldRun(f, threadId, SUPERSEDING_TEXT, scriptedPlanner(SCRIPT).client)).result, "superseding");
    const yes = await coldRun(f, threadId, YES, scriptedPlanner(SCRIPT).client);
    const state = yes.runtime.getThread(threadId).taskState.stayIntent;
    assert.equal(state.checkOut === "2026-11-10", false, "the earlier checkout is not confirmed");
  } finally { f.close(); }
});

// Issue 05 AC4 (ADR 0080): the deterministic path and the assistant path search the same filters for the same stay.

test("AC4 parity: the deterministic path and the assistant path search the same filters for \"Ikoyi 20 Nov to 23 Nov for 2\"", async () => {
  const f = fixture();
  try {
    const recorded: { path: string; filters: unknown }[] = [];
    const query = f.environment.discoveryQuery as unknown as { search(filters: unknown): unknown };
    const original = query.search.bind(query);
    let path = "";
    query.search = (filters: unknown) => { recorded.push({ path, filters }); return original(filters); };

    path = "deterministic";
    const deterministic = await new LocalGuestApp(f.environment).handleTurn("g-d5c0000101", PARITY_TEXT);
    successfulTurn(deterministic, "deterministic");

    path = "assistant";
    successfulTurn((await coldRun(f, "g-d5c0000102", PARITY_TEXT, scriptedPlanner(SCRIPT).client)).result, "assistant");

    const forPath = (name: string) => recorded.filter((entry) => entry.path === name).map((entry) => entry.filters);
    assert.ok(forPath("deterministic").length > 0, "the deterministic path searched");
    assert.deepEqual(forPath("assistant").at(-1), forPath("deterministic").at(-1), "the same filters on both paths");
  } finally { f.close(); }
});
