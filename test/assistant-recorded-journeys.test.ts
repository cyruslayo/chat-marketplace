import assert from "node:assert/strict";
import test from "node:test";
import { AssistantReplayDivergenceError, ReplayModelClient } from "../apps/local-guest/src/assistant/assistant-recording.js";
import {
  CANCEL_COPY,
  PROPOSAL_REPLACED_COPY,
  definitionOf,
  intendedOutcomeViolations,
  loadRecording,
  openJourneyEnvironment,
  RECORDED_JOURNEYS,
  replayJourney,
  runJourney,
  type JourneyTurnOutput,
} from "./helpers/assistant-recordings.js";

// Recorded assistant conversations replayed as regression evals (issue 03). Each recording is a cold-restored journey on the
// staging-like clock (27 Oct 2026), with the assistant runtime enabled and a new runtime before every guest step.

const NAMED_JOURNEYS = [
  "search-refinement-request-draft",
  "missing-information-clarification",
  "confirmation-cancelled",
  "confirm-after-task-switch",
  "confirm-after-search-change",
] as const;

test("Replaying a recording through a fresh runtime reproduces the recorded messages, surface ids, component types and task rail for every turn.", async () => {
  for (const journey of NAMED_JOURNEYS) {
    const recording = loadRecording(journey);
    const { turns, replay } = await replayJourney(recording);
    replay.assertFaithful();
    assert.equal(turns.length, recording.turns.length, `${journey}: turn count`);
    turns.forEach((turn, index) => {
      assert.deepEqual(turn, recording.turns[index], `${journey}: turn ${index + 1} (${turn.guestText}) reproduces the recording`);
    });
  }
});

test("Replay fails with an error naming the step when the runtime's request diverges from the recording (through the runtime).", async () => {
  const recording = loadRecording("search-refinement-request-draft");
  // Change what the second model call offers. The runtime's own request then differs from the recording at that step.
  const exchanges = recording.exchanges.map((exchange, index) => index === 1
    ? { ...exchange, request: { ...exchange.request, toolNames: ["get_booking_status"] } }
    : exchange);
  const environment = openJourneyEnvironment();
  try {
    const replay = new ReplayModelClient(exchanges);
    await runJourney(definitionOf(recording.journey), environment, replay);
    assert.throws(() => replay.assertFaithful(), (error: unknown) => {
      assert.ok(error instanceof AssistantReplayDivergenceError);
      assert.equal(error.step, 1);
      assert.match(error.message, /step 2/);
      return true;
    });
  } finally {
    environment.close();
  }
});

test("The four named journeys are committed as recordings and pass.", async () => {
  assert.deepEqual(RECORDED_JOURNEYS.map((journey) => journey.name), [...NAMED_JOURNEYS]);
  for (const journey of NAMED_JOURNEYS) {
    const recording = loadRecording(journey);
    assert.ok(recording.exchanges.length > 0, `${journey} holds model exchanges`);
    assert.deepEqual(intendedOutcomeViolations(definitionOf(journey), recording.turns as JourneyTurnOutput[]), [], `${journey} shows its intended outcomes`);
  }

  const byName = (journey: string): JourneyTurnOutput[] => loadRecording(journey).turns as JourneyTurnOutput[];

  // Refinement through to a request draft: the second search supersedes the first, and the draft is a non-submitting surface.
  const refinement = byName("search-refinement-request-draft");
  assert.match(refinement[0]!.messages[0]!, /Old Ikoyi/);
  assert.match(refinement[1]!.messages[0]!, /Lekki Phase 1/);
  assert.notEqual(refinement[1]!.surfaces[0]!.surfaceId, refinement[0]!.surfaces[0]!.surfaceId, "the refined search has its own surface");
  assert.match(refinement[3]!.surfaces[0]!.surfaceId, /:request:draft:/, "the draft opens on the request-draft surface");
  assert.match(refinement[3]!.messages[0]!, /has not been submitted/);

  // Missing information: the planner asks for nights and guests, and the guest's answer completes the search.
  const clarification = byName("missing-information-clarification");
  assert.match(clarification[0]!.messages[0]!, /How many nights/);
  assert.match(clarification[1]!.messages[0]!, /Old Ikoyi/);

  // Cancelled confirmation: a Booking Request is proposed, and the typed cancel clears the pending surface with the cancel copy.
  const cancelled = byName("confirmation-cancelled");
  assert.match(cancelled[1]!.surfaces[0]!.surfaceId, /:pending-action:/, "the proposal opens a pending confirmation");
  assert.deepEqual(cancelled[2]!.messages, [CANCEL_COPY]);
  assert.equal(cancelled[2]!.surfaces.length, 0, "no pending surface or request survives the cancel");

  // ADR 0074 (owner decision): a task switch removes the open proposal, so the typed yes gets the replaced reply and the old
  // card's button is refused as stale. Nothing is sent.
  const afterSwitch = byName("confirm-after-task-switch");
  assert.match(afterSwitch[1]!.surfaces[0]!.surfaceId, /:pending-action:/);
  assert.deepEqual(afterSwitch[3]!.messages, [PROPOSAL_REPLACED_COPY]);
  assert.equal(afterSwitch[4]!.code, "STALE_SURFACE");
  // A search change removes the proposal the same way.
  const afterSearch = byName("confirm-after-search-change");
  assert.match(afterSearch[1]!.surfaces[0]!.surfaceId, /:pending-action:/);
  assert.deepEqual(afterSearch[3]!.messages, [PROPOSAL_REPLACED_COPY]);
  assert.equal(afterSearch[3]!.surfaces.length, 0, "no request or pending surface remains");
});

test("The recorder refuses a recording whose cancel turn still leaves a pending surface or a fallback outcome.", () => {
  const definition = definitionOf("confirmation-cancelled");
  const committed = loadRecording("confirmation-cancelled").turns as JourneyTurnOutput[];
  assert.deepEqual(intendedOutcomeViolations(definition, committed), [], "the committed recording passes");

  const withPending = committed.map((turn, index) => index === 2
    ? { ...turn, surfaces: [{ surfaceId: "thread-g-d1a0000403:pending-action:pa-generated-id-1", componentTypes: [] }] }
    : turn);
  assert.ok(intendedOutcomeViolations(definition, withPending).some((message) => /leaves a pending surface/.test(message)));

  const withFallback = committed.map((turn, index) => index === 2
    ? { ...turn, messages: ["I can help you find and compare stays, explain pricing, or check a booking status. What would you like to do?"], controlOutcome: "rejected_plan_fallback" }
    : turn);
  const fallbackViolations = intendedOutcomeViolations(definition, withFallback);
  assert.ok(fallbackViolations.some((message) => /is not the cancel copy/.test(message)));
  assert.ok(fallbackViolations.some((message) => /fallback outcome rejected_plan_fallback/.test(message)));
});

test("A stale confirm button must be refused with its expected code, or the recording is refused.", () => {
  const base = definitionOf("confirm-after-task-switch");
  const definition = { ...base, guestTurns: [{ text: "Request the first one." }, { text: "Confirm the Booking Request from the earlier card", button: { ofTurn: 0, expect: "STALE_SURFACE" } }] };
  const row = (guestText: string, extra: Partial<JourneyTurnOutput>): JourneyTurnOutput => ({ guestText, ok: true, messages: [], surfaces: [], tasks: [], ...extra });
  const first = row("Request the first one.", { surfaces: [{ surfaceId: "thread-g-d1a0000404:pending-action:pa-generated-id-1", componentTypes: [] }] });
  const refused = row("Confirm the Booking Request from the earlier card", { ok: false, code: "STALE_SURFACE", messages: [], surfaces: [] });
  assert.deepEqual(intendedOutcomeViolations(definition, [first, refused]), [], "a stale press refused as STALE_SURFACE passes");
  assert.ok(intendedOutcomeViolations(definition, [first, { ...refused, code: "INVALID_THREAD" }]).some((message) => /was not refused as STALE_SURFACE/.test(message)));
  assert.ok(intendedOutcomeViolations(definition, [first, row("Confirm the Booking Request from the earlier card", { surfaces: [{ surfaceId: "thread-g-d1a0000404:request:req-1", componentTypes: [] }] })]).some((message) => /was not refused/.test(message)), "a press that sends a request is not a pass");
});
