import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { GuestSurfacePayload, GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { definitionOf, journeyScriptedModel } from "./helpers/assistant-recordings.js";
import { firstButtonAction, STAGING_GUEST_CONFIG, wireDatedApp } from "./helpers/guest-date-fixtures.js";

// Expired pending actions (state machine issue 14, ADR 0070, 0074, 0075, 0106). A Booking Request proposal lives 15 minutes.
// The clock is advanced past its expiresAt. Every guest event runs on a new application over the same store (a cold restore),
// with the assistant enabled and a staging-like guest (no seeded phone or email) unless a test needs a phone to confirm.

const EXPIRED_COPY = "This action has expired or is no longer authorized.";
const PROPOSAL_LIFETIME_MS = 15 * 60 * 1000;
const THREAD_START = new Date("2026-10-27T10:00:00Z");

/** A clock the test moves forward, so a proposal can be expired without waiting. */
function movingClock() {
  let at = THREAD_START.getTime();
  return {
    clock: () => new Date(at),
    advance(ms: number) { at += ms; },
  };
}

function stagingEnvironment(clock: () => Date): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock, ...STAGING_GUEST_CONFIG });
}

/** A phone-holding guest, so a confirmation of a still-valid proposal reaches the deterministic path (finding 9). */
function phoneEnvironment(clock: () => Date): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock });
}

/** One guest text on a cold-restored application. */
async function guestTurn(environment: LocalGuestEnvironment, threadId: string, text: string): Promise<GuestTurnResult> {
  const model = journeyScriptedModel(definitionOf("confirmation-cancelled"));
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  return fixture.app.handleTurn(threadId, text);
}

/** A button press on a surface, sent after a cold restore. */
async function pressed(environment: LocalGuestEnvironment, threadId: string, surface: GuestSurfacePayload): Promise<GuestTurnResult> {
  const model = journeyScriptedModel(definitionOf("confirmation-cancelled"));
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  const action = firstButtonAction(surface);
  return fixture.app.handleEventAsync(threadId, action);
}

function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** The pending action the runtime holds for a thread after a cold restore. */
function pendingAfterRestore(environment: LocalGuestEnvironment, threadId: string) {
  const model = journeyScriptedModel(definitionOf("confirmation-cancelled"));
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  return fixture.runtime.getThread(threadId).taskState.pendingAction ?? null;
}

function pendingSurface(surfaces: readonly GuestSurfacePayload[]): GuestSurfacePayload {
  const found = surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(found, "a pending-action surface is returned");
  return found;
}

/** Proposes a Booking Request on the journey's own planner answers, then returns the card the proposal filed. */
async function proposeBookingRequest(environment: LocalGuestEnvironment, threadId: string): Promise<GuestSurfacePayload> {
  await guestTurn(environment, threadId, "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026");
  const proposal = successOf(await guestTurn(environment, threadId, "Request the first one."), "propose");
  return pendingSurface(proposal.surfaces);
}

test("AC1: an expired pending action is refused with STALE_SURFACE and cleared, including after a cold restore.", async () => {
  const time = movingClock();
  const environment = stagingEnvironment(time.clock);
  const threadId = "g-d1a0000601";
  try {
    const card = await proposeBookingRequest(environment, threadId);
    assert.ok(pendingAfterRestore(environment, threadId), "the proposal is pending before it expires");

    time.advance(PROPOSAL_LIFETIME_MS + 60_000);
    const refused = await guestTurn(environment, threadId, "Yes");
    assert.equal(refused.ok, false, "a confirmation of an expired action is refused");
    assert.equal(refused.ok ? "" : refused.code, "STALE_SURFACE");
    assert.equal(refused.ok ? "" : refused.message, EXPIRED_COPY);

    assert.equal(pendingAfterRestore(environment, threadId), null, "the expired action is cleared after a cold restore");

    // The card the guest still sees is superseded too: a press on it is refused and cannot revive the action.
    const stalePress = await pressed(environment, threadId, card);
    assert.equal(stalePress.ok, false, "a press on the superseded card is refused");
    assert.equal(stalePress.ok ? "" : stalePress.code, "STALE_SURFACE");
  } finally { environment.close(); }
});

test("AC2: after the expired refusal, the next request produces a fresh pending action with a new id that can be confirmed.", async () => {
  const time = movingClock();
  const environment = phoneEnvironment(time.clock);
  const threadId = "g-d1a0000602";
  try {
    await proposeBookingRequest(environment, threadId);
    const expiredId = pendingAfterRestore(environment, threadId)?.id;
    assert.ok(expiredId, "the first proposal has an id");

    time.advance(PROPOSAL_LIFETIME_MS + 60_000);
    const refused = await guestTurn(environment, threadId, "Yes");
    assert.equal(refused.ok ? "" : refused.code, "STALE_SURFACE");

    const fresh = successOf(await guestTurn(environment, threadId, "Request the first one."), "ask again");
    const freshAction = pendingAfterRestore(environment, threadId);
    assert.ok(freshAction, "asking again opens a fresh pending action");
    assert.notEqual(freshAction.id, expiredId, "the fresh action has a new id");
    assert.ok(pendingSurface(fresh.surfaces), "the fresh proposal shows its card");

    const confirmed = await guestTurn(environment, threadId, "Yes");
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : `confirm fresh: ${confirmed.code}: ${confirmed.message}`);
    assert.equal(pendingAfterRestore(environment, threadId), null, "the confirmed fresh action is no longer pending");
  } finally { environment.close(); }
});

test("AC3: a pending action presented with a different thread, guest or tenant is still refused with STALE_SURFACE, and the stored pending action is unchanged.", async () => {
  const time = movingClock();
  const environment = stagingEnvironment(time.clock);
  const threadId = "g-d1a0000603";
  try {
    await proposeBookingRequest(environment, threadId);
    const stored = environment.interactionStore.findThread(threadId);
    assert.ok(stored, "the thread is stored");
    const projection = JSON.parse(stored.threadJson) as { pendingAction: Record<string, unknown> };
    const original = projection.pendingAction;

    // The proposal is also expired, so only the identity check can refuse it: an identity mismatch must not clear it.
    time.advance(PROPOSAL_LIFETIME_MS + 60_000);
    const foreign: Array<[string, Record<string, unknown>]> = [
      ["thread", { threadId: "g-d1a0000999" }],
      ["guest", { guestActorId: "guest-someone-else" }],
      ["tenant", { tenantId: "tenant-someone-else" }],
    ];
    for (const [field, change] of foreign) {
      const current = environment.interactionStore.findThread(threadId);
      assert.ok(current, "the thread is stored");
      const next = JSON.parse(current.threadJson) as { pendingAction: Record<string, unknown> };
      next.pendingAction = { ...original, ...change };
      environment.interactionStore.saveThread({ ...current, threadJson: JSON.stringify(next) });
      const before = environment.interactionStore.findThread(threadId)?.threadJson;

      const refused = await guestTurn(environment, threadId, "Yes");
      assert.equal(refused.ok, false, `a ${field} mismatch is refused`);
      assert.equal(refused.ok ? "" : refused.code, "STALE_SURFACE", `a ${field} mismatch returns STALE_SURFACE`);
      assert.equal(environment.interactionStore.findThread(threadId)?.threadJson, before, `a ${field} mismatch leaves the stored pending action unchanged`);
    }
  } finally { environment.close(); }
});

test("AC4: a non-expired pending action still executes exactly as before.", async () => {
  const time = movingClock();
  const environment = phoneEnvironment(time.clock);
  const threadId = "g-d1a0000604";
  try {
    const card = await proposeBookingRequest(environment, threadId);
    time.advance(PROPOSAL_LIFETIME_MS - 60_000);
    const confirmed = successOf(await pressed(environment, threadId, card), "confirm before expiry");
    assert.ok(confirmed.messages.length > 0, "the confirmation returns its reply");
    assert.equal(pendingAfterRestore(environment, threadId), null, "the executed action is no longer pending");
  } finally { environment.close(); }
});
