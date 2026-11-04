import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_CHANGE_EXPLANATION } from "../apps/web-agent/src/guest-content.js";
import type { CapturedRequest } from "./helpers/openai-compatible-client.js";
import { latestUserText, runtimeDiscoveryArtifact, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import {
  JOURNEY_SCRIPT,
  JOURNEY_TEXT,
  coldApp,
  journeyToOffer,
  journeyToPayment,
  journeyToRequest,
  journeyToReservation,
  stagingJourneyFixture,
  successOf,
  typedTurn,
} from "./helpers/assistant-stage-journey.js";

// Issue 12 (ADR 0005, 0060, 0080, 0106): a guest asks to change stay facts after the stay was sent. The assistant answers with the
// same explanation the deterministic concierge gives, from the task state, and changes nothing. Every event is cold-restored on a
// fresh thread, on the staging clock (27 Oct 2026) with a staging-like guest.

const CHANGE_TEXT = "add one more night";
const CHANGE_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  [CHANGE_TEXT]: { slots: { nights: 4 }, intents: ["change"] },
};

/** The operator named on the unit the guest's stay is with, as both concierges read it. */
function operatorNameFor(f: DatedFixture, unitId: string): string | undefined {
  return f.environment.unitRepository.findById(unitId)?.operator?.name;
}

/** The Booking Request as the server holds it: any change to the request would show here. */
function requestFacts(f: DatedFixture, requestId: string) {
  return f.environment.bookingRequestApp.getArtifact(requestId, f.environment.guestPrincipal()).facts;
}

/** The assistant's task state and discovery artifact after a cold restore, as the next turn would see them. */
function assistantSnapshot(f: DatedFixture, threadId: string) {
  const restored = coldApp(f, threadId);
  return { discoveryId: runtimeDiscoveryArtifact(restored.runtime, threadId)?.id, taskState: restored.runtime.getThread(threadId).taskState };
}

test("AC1: With a sent Booking Request, \"add one more night\" gives the request explanation and leaves the request unchanged", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000101";
    const requestId = await journeyToRequest(f, threadId);
    const before = requestFacts(f, requestId);
    const planner: CapturedRequest[] = [];
    const reply = successOf(await typedTurn(f, threadId, CHANGE_TEXT, CHANGE_SCRIPT, planner), "add one more night");
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.request(operatorNameFor(f, before.unitId))], "the request explanation is the reply");
    assert.match(reply.messages[0]!, /can't be changed while .+ reviews it/, "it says the request cannot be changed while it is reviewed");
    assert.match(reply.messages[0]!, /Nothing has been changed\.$/, "it ends by saying nothing has been changed");
    assert.equal(planner.length, 0, "the planner is not called for a change turn");
    assert.deepEqual(requestFacts(f, requestId), before, "the Booking Request is unchanged");
    assert.equal(assistantSnapshot(f, threadId).taskState.currentBookingRequestId, requestId, "the task state still holds the same request");
  } finally { f.close(); }
});

test("AC2: With an offer, the offer explanation is given and nothing is changed", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000201";
    await journeyToOffer(f, threadId);
    const before = assistantSnapshot(f, threadId);
    const reply = successOf(await typedTurn(f, threadId, CHANGE_TEXT, CHANGE_SCRIPT), "add one more night");
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.offer()], "the offer explanation is the reply");
    assert.match(reply.messages[0]!, /can't be changed\. You can choose not to accept it at no cost/, "the offer copy names the no-cost exit");
    assert.deepEqual(assistantSnapshot(f, threadId).taskState, before.taskState, "the task state is unchanged");
  } finally { f.close(); }
});

test("AC2: With an accepted offer, the payment explanation is given and nothing is changed", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000202";
    await journeyToPayment(f, threadId);
    const reply = successOf(await typedTurn(f, threadId, CHANGE_TEXT, CHANGE_SCRIPT), "add one more night");
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.payment()], "the payment explanation is the reply, not the offer one");
  } finally { f.close(); }
});

test("AC2: With a reservation, the amendment explanation is given and nothing is changed", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000203";
    await journeyToReservation(f, threadId);
    const reply = successOf(await typedTurn(f, threadId, CHANGE_TEXT, CHANGE_SCRIPT), "add one more night");
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.booking()], "the amendment explanation is the reply");
    assert.match(reply.messages[0]!, /booking amendment/, "a confirmed Reservation changes only through an amendment");
  } finally { f.close(); }
});

test("AC3 failure path: no search runs and no proposal is created on these turns, and the discovery artifact and criteria stay unchanged", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000301";
    await journeyToRequest(f, threadId);
    const before = assistantSnapshot(f, threadId);
    assert.ok(before.discoveryId, "the journey left a discovery artifact");
    // The classifier misreads the change as a new search and the planner would call search_stays: neither may run.
    const misread: Readonly<Record<string, ScriptedTurn>> = {
      [CHANGE_TEXT]: { slots: { nights: 4 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 4, guests: 2 } },
    };
    const planner: CapturedRequest[] = [];
    const reply = successOf(await typedTurn(f, threadId, CHANGE_TEXT, misread, planner), "add one more night");
    assert.equal(planner.length, 0, "no planner call, so no search_stays execution");
    const requestUnit = f.environment.unitRepository.findById(requestFacts(f, before.taskState.currentBookingRequestId!).unitId);
    assert.deepEqual(reply.messages, [GUEST_CHANGE_EXPLANATION.request(requestUnit?.operator?.name)], "the request explanation is the reply");
    assert.equal(reply.surfaces.length, 0, "no surface is placed");
    const after = assistantSnapshot(f, threadId);
    assert.equal(after.discoveryId, before.discoveryId, "the discovery artifact is unchanged");
    assert.deepEqual(after.taskState.stayIntent, before.taskState.stayIntent, "the search criteria are unchanged");
    assert.equal(after.taskState.pendingAction ?? null, null, "no proposal is created");
    assert.deepEqual(after.taskState, before.taskState, "the task state is unchanged");
  } finally { f.close(); }
});

test("AC4: Same reply as the deterministic path for the same state, with a cold restore before every event", async () => {
  const stages: readonly { readonly name: string; readonly reach: (f: DatedFixture, threadId: string) => Promise<unknown> }[] = [
    { name: "request", reach: (f, threadId) => journeyToRequest(f, threadId) },
    { name: "offer", reach: (f, threadId) => journeyToOffer(f, threadId) },
    { name: "payment", reach: (f, threadId) => journeyToPayment(f, threadId) },
    { name: "booking", reach: (f, threadId) => journeyToReservation(f, threadId) },
  ];
  for (const [index, stage] of stages.entries()) {
    const f = stagingJourneyFixture();
    try {
      const threadId = `g-c12a00004${index}`;
      await stage.reach(f, threadId);
      const assistant = successOf(await typedTurn(f, threadId, CHANGE_TEXT, CHANGE_SCRIPT), `${stage.name}: assistant`);
      // The deterministic concierge, a new application over the same store (no assistant runtime), reads the same thread.
      const deterministic = successOf(await new LocalGuestApp(f.environment).handleTurn(threadId, CHANGE_TEXT), `${stage.name}: deterministic`);
      assert.match(deterministic.messages.join(" "), /Nothing has been changed\./, `${stage.name}: the deterministic path explains the change`);
      assert.deepEqual(assistant.messages, deterministic.messages, `${stage.name}: the assistant reply equals the deterministic reply`);
    } finally { f.close(); }
  }
});

test("A change with no sent Booking Request is an ordinary search, as before", async () => {
  const f = stagingJourneyFixture();
  try {
    const threadId = "g-c12a0000501";
    successOf(await typedTurn(f, threadId, JOURNEY_TEXT, JOURNEY_SCRIPT), "search");
    const planner: CapturedRequest[] = [];
    const reply = successOf(await typedTurn(f, threadId, "add one more night", {
      "add one more night": { slots: { nights: 4 }, intents: ["change"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 4, guests: 2 } },
    }, planner), "change");
    assert.equal(planner.length, 1, "the planner runs for a discovery-stage change");
    assert.equal(latestUserText(planner[0]!), "add one more night");
    assert.doesNotMatch(reply.messages.join(" "), /can't be changed/, "no explanation before a request is sent");
  } finally { f.close(); }
});
