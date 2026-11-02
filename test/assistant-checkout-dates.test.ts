import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
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

const SCRIPT: Record<string, ScriptedTurn> = {
  [PAIR_TEXT]: { slots: PAIR_SLOTS, intents: ["search"], search: SEARCH },
  // The model's nights (2) contradict the guest's checkout (3 nights).
  "Ikoyi 20 Nov to 23 Nov for 2, two nights": { slots: PAIR_SLOTS, intents: ["search"], search: { ...SEARCH, nights: 2 } },
  [BACKWARDS_TEXT]: { slots: BACKWARDS_SLOTS, intents: ["search"], search: { ...SEARCH, checkIn: "2026-11-23", checkOut: "2026-11-20" } },
  [LONG_TEXT]: { slots: LONG_SLOTS, intents: ["search"], search: { ...SEARCH, checkIn: "2026-12-01", checkOut: "2028-01-01" } },
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
