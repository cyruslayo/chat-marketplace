import assert from "node:assert/strict";
import test from "node:test";
import { AssistantReplayDivergenceError, ReplayModelClient } from "../apps/local-guest/src/assistant/assistant-recording.js";
import {
  CANCEL_COPY,
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
  "cancel-after-task-switch",
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

  // Cancellation after a task switch: the open Booking Request is cancelled, not sent.
  const afterSwitch = byName("cancel-after-task-switch");
  assert.match(afterSwitch[1]!.surfaces[0]!.surfaceId, /:pending-action:/);
  assert.deepEqual(afterSwitch[3]!.messages, [CANCEL_COPY]);
  assert.equal(afterSwitch[3]!.surfaces.length, 0, "no request or pending surface remains after the cancel");
});
