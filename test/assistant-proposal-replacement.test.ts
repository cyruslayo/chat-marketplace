import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import {
  PROPOSAL_REPLACED_COPY,
  PROPOSE_REQUEST,
  RECORDED_JOURNEYS,
  SEARCH_IKOYI,
  SEARCH_LEKKI,
  intendedOutcomeViolations,
  journeyScriptedModel,
  openJourneyEnvironment,
  runJourney,
  type JourneyTurnOutput,
  type RecordedJourneyDefinition,
} from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, wireDatedApp } from "./helpers/guest-date-fixtures.js";

// ADR 0074 (owner decision, 28 Oct 2026): a new search that changes the proposed stay, or a task switch, after a Booking
// Request proposal removes the proposal's authority. Typed confirmations and the old card's button then send nothing.
// Every scenario runs warm (one application) and cold (a new application before every event, on the 27 Oct 2026 clock).
// The guest is staging-like (no phone, see openJourneyEnvironment): none of these scenarios reaches the phone-only confirm
// path, because the proposal is removed before any confirm. A confirmation that wrongly got through would throw the missing-
// phone error (finding 9) and fail the test. Scenario steps use a planner answer per text, as the recorded journeys do.

const THREAD = "g-d1a0000601";
const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";

const CHANGED_SEARCH: RecordedJourneyDefinition = {
  name: "proposal-replaced-by-search-change",
  threadId: THREAD,
  description: "A Booking Request is proposed, then the search changes to another stay, then the guest confirms.",
  withSecondDomain: false,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: "Request the first one.", planner: PROPOSE_REQUEST },
    { text: "Actually Lekki, same dates", planner: { tool: "search_stays", args: SEARCH_LEKKI } },
    { text: "Yes", replaced: true },
    { text: "Confirm the Booking Request from the earlier card", button: { ofTurn: 1, expect: "STALE_SURFACE" } },
  ],
};

const SWITCHED_TASK: RecordedJourneyDefinition = {
  name: "proposal-replaced-by-task-switch",
  threadId: "g-d1a0000602",
  description: "A Booking Request is proposed, the guest switches task, then confirms.",
  withSecondDomain: true,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: "Request the first one.", planner: PROPOSE_REQUEST },
    { text: "Start a new task in shop", planner: { tool: "start_task", args: { domain: "shop" } } },
    { text: "Yes", replaced: true },
    { text: "Confirm the Booking Request from the earlier card", button: { ofTurn: 1, expect: "STALE_SURFACE" } },
  ],
};

const REPEATED_SEARCH: RecordedJourneyDefinition = {
  name: "proposal-kept-by-unchanged-search",
  threadId: "g-d1a0000603",
  description: "A Booking Request is proposed and the same search is repeated unchanged: the stay and its authority are the same, so the proposal stays.",
  withSecondDomain: false,
  guestTurns: [
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
    { text: "Request the first one.", planner: PROPOSE_REQUEST },
    { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
  ],
};

/** The journey's scripted model, with the scenario's own texts answered by the planner map above. */
function model(definition: RecordedJourneyDefinition): AssistantModelClient {
  return journeyScriptedModel(definition);
}

/** Runs a scenario warm or cold, and returns its turn outputs and the pending proposal left at the end. */
async function play(definition: RecordedJourneyDefinition, warm: boolean) {
  // The staging-like guest (no phone): these scenarios end in the replaced reply or a stale refusal, so the phone-only confirm
  // path is never reached.
  const environment = openJourneyEnvironment();
  try {
    let pendingAfter: string | null | undefined;
    const outputs = await runJourney(definition, environment, model(definition), {
      warm,
      observe: (fixture) => {
        pendingAfter = fixture.runtime.getThread(definition.threadId).taskState.pendingAction?.id ?? null;
      },
    });
    return { outputs, pendingAfter };
  } finally {
    environment.close();
  }
}

function surfacesOf(turn: JourneyTurnOutput): string[] {
  return turn.surfaces.map((surface) => surface.surfaceId);
}

for (const warm of [false, true]) {
  const mode = warm ? "warm" : "cold";

  test(`(a, ${mode}) A new search that changes the proposed stay replaces the Booking Request: the typed yes sends nothing and says the proposal was replaced.`, async () => {
    const { outputs, pendingAfter } = await play(CHANGED_SEARCH, warm);
    const yes = outputs[3]!;
    assert.equal(yes.ok, true);
    assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY], "the guest is told the proposal was replaced");
    assert.equal(surfacesOf(yes).some((id) => /:request:|:pending-action:/.test(id)), false, "no request or pending card is opened");
    assert.equal(pendingAfter, null, "the old pending action is cleared");
    assert.deepEqual(intendedOutcomeViolations(CHANGED_SEARCH, outputs), []);
  });

  test(`(b, ${mode}) After a search change, the old card's confirm button returns STALE_SURFACE and sends nothing.`, async () => {
    const { outputs } = await play(CHANGED_SEARCH, warm);
    const button = outputs[4]!;
    assert.equal(button.ok, false);
    assert.equal(button.code, "STALE_SURFACE");
    assert.equal(surfacesOf(button).some((id) => /:request:/.test(id)), false, "no request is opened");
  });

  test(`(c, ${mode}) A task switch after a proposal replaces it: the typed yes and the old card's button send nothing.`, async () => {
    const { outputs, pendingAfter } = await play(SWITCHED_TASK, warm);
    const yes = outputs[3]!;
    assert.deepEqual(yes.messages, [PROPOSAL_REPLACED_COPY]);
    assert.equal(pendingAfter, null, "the switch leaves no pending action on the shortlet task");
    const button = outputs[4]!;
    assert.equal(button.ok, false);
    assert.equal(button.code, "STALE_SURFACE");
    assert.equal(surfacesOf(yes).some((id) => /:request:/.test(id)), false);
  });

  test(`(d, ${mode}) The same search repeated unchanged keeps a still-valid proposal.`, async () => {
    const { pendingAfter } = await play(REPEATED_SEARCH, warm);
    assert.ok(pendingAfter, "the proposal is kept: its stay, unit, dates and party are unchanged");
  });

  test(`(f, ${mode}) Guards stay fail closed after a replacement: a forged id is refused as STALE_SURFACE.`, async () => {
    const forged: RecordedJourneyDefinition = {
      ...CHANGED_SEARCH,
      guestTurns: [...CHANGED_SEARCH.guestTurns.slice(0, 3), { text: "Forged confirm", button: { ofTurn: 1, expect: "STALE_SURFACE" } }],
    };
    const { outputs } = await play(forged, warm);
    assert.equal(outputs[3]!.ok, false);
    assert.equal(outputs[3]!.code, "STALE_SURFACE");
  });
}

test("(e) Warm and cold runs of a replacement give the same turn outputs.", async () => {
  // Discovery artifact ids come from a process-wide counter, so two environments differ only by that number.
  const counterFree = (outputs: readonly JourneyTurnOutput[]) => JSON.parse(JSON.stringify(outputs).replace(/search-guest-demo-\d+/g, "search-guest-demo-N")) as JourneyTurnOutput[];
  const warm = await play(CHANGED_SEARCH, true);
  const cold = await play(CHANGED_SEARCH, false);
  assert.deepEqual(counterFree(warm.outputs), counterFree(cold.outputs), "warm and cold parity");
  const warmSwitch = await play(SWITCHED_TASK, true);
  const coldSwitch = await play(SWITCHED_TASK, false);
  assert.deepEqual(counterFree(warmSwitch.outputs), counterFree(coldSwitch.outputs), "warm and cold parity after a task switch");
});

test("The recorded journeys show the replaced-proposal outcome for a task switch and for a search change.", () => {
  const names = RECORDED_JOURNEYS.map((journey) => journey.name);
  assert.ok(!names.includes("cancel-after-task-switch"), "the cancel journey no longer matches the rule");
  assert.ok(names.includes("confirm-after-task-switch"));
  assert.ok(names.includes("confirm-after-search-change"));
});
