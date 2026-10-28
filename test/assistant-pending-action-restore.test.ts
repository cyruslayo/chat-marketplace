import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { ASSISTANT_CANCEL_ACTION_EVENT, ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import type { GuestSurfacePayload, GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { definitionOf, journeyScriptedModel, openJourneyEnvironment } from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, firstButtonAction, wireDatedApp } from "./helpers/guest-date-fixtures.js";

// Cold-restore pending actions (issue 03 follow-up). A Booking Request proposal is a pending action held by the
// assistant runtime. Every guest event below runs on a new application and runtime over the same store (a cold
// restore), on the 27 Oct 2026 clock, with the assistant enabled and a staging-like guest.

const SCOPE = "concierge_scope";

/** Counts the classifier calls the runtime makes; every call still goes through the scripted provider contract. */
function countingModel(inner: AssistantModelClient, counter: { scope: number }): AssistantModelClient {
  return {
    supportsProviderAttemptReservation: true,
    generate: (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      if (request.structuredOutput?.name === SCOPE) counter.scope++;
      return inner.generate(request);
    },
  };
}

function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** One guest text on a cold-restored application. */
async function guestTurn(environment: LocalGuestEnvironment, model: AssistantModelClient, threadId: string, text: string): Promise<GuestTurnResult> {
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  return fixture.app.handleTurn(threadId, text);
}

/** The Booking Request proposal the first two guest turns create, on the journey's own planner answers. */
async function proposeBookingRequest(environment: LocalGuestEnvironment, model: AssistantModelClient, threadId: string) {
  await guestTurn(environment, model, threadId, "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026");
  return successOf(await guestTurn(environment, model, threadId, "Request the first one."), "propose");
}

/** The pending action the runtime holds for a thread after a cold restore (read through a fresh runtime). */
function pendingAfterRestore(environment: LocalGuestEnvironment, model: AssistantModelClient, threadId: string) {
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  return fixture.runtime.getThread(threadId).taskState.pendingAction ?? null;
}

function pendingSurface(surfaces: readonly GuestSurfacePayload[]): GuestSurfacePayload {
  const found = surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(found, "a pending-action surface is returned");
  return found;
}

test("A typed cancel after a cold restore reports Action cancelled, makes no classifier call, clears the pending action and sends no request.", async () => {
  const environment = openJourneyEnvironment();
  const counter = { scope: 0 };
  const model = countingModel(journeyScriptedModel(definitionOf("confirmation-cancelled")), counter);
  const threadId = "g-d1a0000501";
  try {
    const proposal = await proposeBookingRequest(environment, model, threadId);
    assert.ok(pendingSurface(proposal.surfaces));
    assert.ok(pendingAfterRestore(environment, model, threadId), "the proposed action survives a cold restore");

    const scopeCallsBefore = counter.scope;
    const cancelled = successOf(await guestTurn(environment, model, threadId, "No, cancel that."), "cancel");
    assert.deepEqual(cancelled.messages, ["Action cancelled. Let me know how else I can help."]);
    assert.equal(cancelled.surfaces.some((surface) => /:pending-action:/.test(surface.surfaceId)), false, "no pending surface remains");
    assert.equal(cancelled.surfaces.some((surface) => /:request:/.test(surface.surfaceId)), false, "no request surface is opened");
    assert.equal(counter.scope, scopeCallsBefore, "the deterministic cancel makes no classifier call");
    assert.equal(pendingAfterRestore(environment, model, threadId), null, "the pending action is cleared");
  } finally { environment.close(); }
});

test("A typed yes after a cold restore runs the deterministic confirmation with no classifier call.", async () => {
  // A Booking Request is sent to the guest's phone-holding account, so this guest has a phone (ADR 0011).
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
  const counter = { scope: 0 };
  const model = countingModel(journeyScriptedModel(definitionOf("confirmation-cancelled")), counter);
  const threadId = "g-d1a0000502";
  try {
    await proposeBookingRequest(environment, model, threadId);
    const scopeCallsBefore = counter.scope;
    const confirmed = await guestTurn(environment, model, threadId, "Yes");
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : `yes: ${confirmed.code}`);
    if (!confirmed.ok) throw new Error("unreachable");
    assert.doesNotMatch(confirmed.messages.join(" "), /I can help you find and compare/, "the reply is the confirmation, not the scope redirect");
    assert.equal(counter.scope, scopeCallsBefore, "the deterministic confirmation makes no classifier call");
    assert.equal(pendingAfterRestore(environment, model, threadId), null, "the confirmed action is no longer pending");
  } finally { environment.close(); }
});

test("A forged, superseded or unknown pending action id fails closed after a cold restore.", async () => {
  // A phone-holding guest: a forged Confirm must be refused by the id guard, not by the missing-phone defect (issue 03 review item 9).
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK });
  const counter = { scope: 0 };
  const model = countingModel(journeyScriptedModel(definitionOf("confirmation-cancelled")), counter);
  const threadId = "g-d1a0000503";
  try {
    const proposal = await proposeBookingRequest(environment, model, threadId);
    const live = firstButtonAction(pendingSurface(proposal.surfaces));

    // Unknown id on the live surface: the restored runtime must refuse it.
    const forgedId = { ...live, name: ASSISTANT_CANCEL_ACTION_EVENT, context: { ...live.context, actionId: "pa-forged-0000" } };
    const forged = await (async () => {
      const fixture = wireDatedApp(environment, model);
      fixture.app.getState(threadId);
      return fixture.app.handleEventAsync(threadId, forgedId);
    })();
    assert.equal(forged.ok, false, "an unknown action id is refused");
    assert.ok(!forged.ok && ["STALE_SURFACE", "ARTIFACT_MISMATCH"].includes(forged.code), `unknown id code: ${!forged.ok ? forged.code : ""}`);

    // Forged surface id: not the surface the thread holds.
    const forgedSurface = { ...live, surfaceId: `thread-${threadId}:pending-action:pa-forged-surface`, name: ASSISTANT_CONFIRM_ACTION_EVENT };
    const wrongSurface = await (async () => {
      const fixture = wireDatedApp(environment, model);
      fixture.app.getState(threadId);
      return fixture.app.handleEventAsync(threadId, forgedSurface);
    })();
    assert.equal(wrongSurface.ok, false, "a forged surface id is refused");
    assert.ok(!wrongSurface.ok && ["STALE_SURFACE", "ARTIFACT_MISMATCH"].includes(wrongSurface.code), `forged surface code: ${!wrongSurface.ok ? wrongSurface.code : ""}`);

    // The pending action is still held: the refused events changed nothing.
    assert.ok(pendingAfterRestore(environment, model, threadId), "refused events leave the pending action in place");

    // Superseded: after a typed cancel, the old live id no longer authorises anything.
    await guestTurn(environment, model, threadId, "No, cancel that.");
    const superseded = await (async () => {
      const fixture = wireDatedApp(environment, model);
      fixture.app.getState(threadId);
      return fixture.app.handleEventAsync(threadId, { ...live, name: ASSISTANT_CANCEL_ACTION_EVENT });
    })();
    assert.equal(superseded.ok, false, "a superseded action id is refused");
    assert.ok(!superseded.ok && ["STALE_SURFACE", "ARTIFACT_MISMATCH"].includes(superseded.code), `superseded code: ${!superseded.ok ? superseded.code : ""}`);
  } finally { environment.close(); }
});
