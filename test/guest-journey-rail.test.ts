import test from "node:test";
import assert from "node:assert/strict";
import { BACK_TO_RESULTS_EVENT, REQUEST_TO_BOOK_EVENT } from "../apps/web-agent/src/index.js";
import { JOURNEY_STEPS, projectJourney, type JourneyStep } from "../apps/local-guest/src/journey-rail.js";
import { renderNoScriptConversationHtml, type GuestStateSnapshot, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { guestAction, restartFixture, stages, type RestartStage } from "./helpers/guest-restart.js";

const EXPECTED_STEP: Readonly<Record<RestartStage, JourneyStep>> = {
  discovery: "search", inspection: "stay", draft: "request", review: "request", pending: "request", offer: "offer",
  "payment-ready": "pay", handoff: "pay", "deposit-ready": "pay", "deposit-handoff": "pay", confirmed: "confirmed",
};

function snapshot(state: GuestStateSnapshot | { ok: false; code: string }): GuestStateSnapshot {
  assert.equal(state.ok, true, JSON.stringify(state));
  return state as GuestStateSnapshot;
}

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** A failed step is shown as itself; nothing after it is done or current. */
function assertOutcome(state: GuestStateSnapshot, step: JourneyStep, label: RegExp): void {
  const journey = state.journey;
  assert.ok(journey, "the rail is present");
  assert.equal(journey.current, step);
  assert.match(journey.outcome?.label ?? "", label);
  const index = JOURNEY_STEPS.indexOf(step);
  assert.equal(journey.steps[index]!.state, "failed");
  assert.match(journey.steps[index]!.label, label);
  assert.ok(journey.steps.slice(0, index).every((entry) => entry.state === "done"));
  assert.ok(journey.steps.slice(index + 1).every((entry) => entry.state === "upcoming"));
  assert.ok(!journey.steps.some((entry) => entry.state === "current"), "an outcome is never shown as progress");
}

test("projectJourney: steps before the current one are done, and an outcome is failed rather than progress", () => {
  const live = projectJourney("offer");
  assert.deepEqual(live.steps.map((step) => step.state), ["done", "done", "done", "current", "upcoming", "upcoming"]);
  assert.deepEqual(live.steps.map((step) => step.label), ["Search", "Stay", "Request", "Offer", "Pay", "Confirmed"]);
  const declined = projectJourney("request", { kind: "declined", label: "Request declined" });
  assert.deepEqual(declined.steps.map((step) => step.state), ["done", "done", "failed", "upcoming", "upcoming", "upcoming"]);
  assert.equal(declined.steps[2]!.label, "Request declined");
  assert.equal(projectJourney("confirmed").steps.at(-1)!.state, "current");
});

test("AC1: The rail's current stage matches the server projection after every event and after reload", async () => {
  const fixture = await restartFixture();
  const seen: [RestartStage, JourneyStep | undefined][] = [];
  try {
    await fixture.advance("confirmed", async (stage, result) => {
      const state = snapshot(await fixture.state());
      // Offer arrives by refresh, so its turn result is the state itself.
      if (stage !== "offer") assert.deepEqual(result.journey, state.journey, `turn result and state disagree at ${stage}`);
      seen.push([stage, state.journey?.current]);
    });
    assert.deepEqual(seen, stages.map((stage) => [stage, EXPECTED_STEP[stage]]));

    // After reload (a new process), the projection is re-derived identically.
    const before = snapshot(await fixture.state()).journey;
    await fixture.restart();
    assert.deepEqual(snapshot(await fixture.state()).journey, before);
  } finally { await fixture.close(); }

  // Reload mid-journey restores the same stage, not a restarted one.
  const midway = await restartFixture();
  try {
    await midway.advance("inspection");
    await midway.restart();
    assert.equal(snapshot(await midway.state()).journey?.current, "stay");
  } finally { await midway.close(); }

  // Failure path: a conversation with no search yet has no rail.
  const empty = await restartFixture();
  try {
    const turn = success(await empty.send("/api/turn", { text: "hello" }));
    assert.equal(turn.journey, undefined);
  } finally { await empty.close(); }
});

test("AC2: Expired and declined states show on the rail as themselves, not as progress", async () => {
  const declined = await restartFixture();
  try {
    const pending = await declined.advance("pending");
    declined.environment.simulateOperatorDecline(pending.surfaces[0]!.surfaceId.split(":").at(-1)!);
    assertOutcome(snapshot(await declined.state()), "request", /^Request declined$/);
    // A later turn keeps the outcome rather than advancing past it.
    const turn = success(await declined.send("/api/turn", { text: "what now?" }));
    assert.equal(turn.journey?.steps[2]!.state, "failed");
  } finally { await declined.close(); }

  const requestExpired = await restartFixture();
  try {
    await requestExpired.advance("pending");
    requestExpired.setTime("2026-09-03T10:31:00Z");
    assertOutcome(snapshot(await requestExpired.state()), "request", /^Request expired$/);
  } finally { await requestExpired.close(); }

  const offerExpired = await restartFixture();
  try {
    await offerExpired.advance("offer");
    offerExpired.setTime("2026-09-03T10:31:00Z");
    assertOutcome(snapshot(await offerExpired.state()), "offer", /^Offer expired$/);
  } finally { await offerExpired.close(); }

  const paymentExpired = await restartFixture();
  try {
    await paymentExpired.advance("payment-ready");
    paymentExpired.setTime("2026-09-03T11:00:00Z");
    const state = snapshot(await paymentExpired.state());
    assertOutcome(state, "pay", /^Payment window expired$/);
    // Failure path: an expired payment never reaches "Confirmed".
    assert.notEqual(state.journey?.current, "confirmed");
  } finally { await paymentExpired.close(); }
});

test("AC3: \"Back to results\" from stay detail restores the previous results with the same criteria", async () => {
  const fixture = await restartFixture();
  try {
    const search = await fixture.advance("discovery");
    const results = search.surfaces[0]!;
    const detail = success(await fixture.send("/api/event", guestAction(results)));
    assert.equal(detail.journey?.current, "stay");
    const unitSurface = detail.surfaces[0]!;
    const back = guestAction(unitSurface, BACK_TO_RESULTS_EVENT);

    const restored = success(await fixture.send("/api/event", back));
    const surface = restored.surfaces[0]!;
    assert.notEqual(surface.surfaceId, results.surfaceId, "a new surface lifecycle (ADR-0074)");
    assert.match(surface.surfaceId, /:discovery:results:2$/);
    assert.equal(surface.mode, "inline-surface");
    assert.equal(surface.summary, results.summary);
    assert.equal(surface.conventionalRoute, results.conventionalRoute, "same criteria");
    assert.equal(surface.textFallback, results.textFallback);
    const unitsIn = (payload: typeof surface) => [...JSON.stringify(payload.a2uiMessages).matchAll(/"unitId":"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(unitsIn(surface), unitsIn(results), "the same results");
    assert.equal(restored.journey?.current, "search");
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 0);

    // Failure path: the superseded unit surface's actions are stale.
    const staleBack = await fixture.send("/api/event", back);
    assert.equal(staleBack.ok, false);
    assert.equal(!staleBack.ok && staleBack.code, "STALE_SURFACE");
    assert.equal((await fixture.send("/api/event", guestAction(unitSurface, REQUEST_TO_BOOK_EVENT))).ok, false);

    // The restored results are live: another apartment can be opened, and back works again.
    const views = [...JSON.stringify(surface.a2uiMessages).matchAll(/"unitId":"([^"]+)"/g)];
    assert.ok(views.length > 0);
    const second = success(await fixture.send("/api/event", guestAction(surface)));
    assert.equal(second.journey?.current, "stay");
    assert.notEqual(second.surfaces[0]!.surfaceId, unitSurface.surfaceId);

    // Failure path: a tampered discovery reference is rejected and the stay stays open.
    const tampered = { ...guestAction(second.surfaces[0]!, BACK_TO_RESULTS_EVENT), context: { artifactId: "discovery-forged" } };
    const rejected = await fixture.send("/api/event", tampered);
    assert.equal(!rejected.ok && rejected.code, "INVALID_CONTEXT");
    assert.equal(snapshot(await fixture.state()).journey?.current, "stay");

    // After going back and reloading, the results are what is restored.
    success(await fixture.send("/api/event", guestAction(second.surfaces[0]!, BACK_TO_RESULTS_EVENT)));
    await fixture.restart();
    const reloaded = snapshot(await fixture.state());
    assert.match(reloaded.surfaces[0]!.surfaceId, /:discovery:results:3$/);
    assert.equal(reloaded.surfaces[0]!.conventionalRoute, results.conventionalRoute);
    assert.equal(reloaded.journey?.current, "search");
  } finally { await fixture.close(); }
});

test("AC4: Going back never cancels a submitted Booking Request", async () => {
  const fixture = await restartFixture();
  try {
    let back: ReturnType<typeof guestAction> | undefined;
    const pending = await fixture.advance("pending", (stage, result) => {
      if (stage === "inspection") back = guestAction(result.surfaces[0]!, BACK_TO_RESULTS_EVENT);
    });
    assert.ok(back);
    const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
    const statusOf = () => fixture.environment.bookingRequestApp.getArtifact(requestId, fixture.environment.guestPrincipal()).facts.status;
    assert.equal(statusOf(), "disclosed");

    // Failure path: replaying "Back to results" from the stay is rejected.
    const replay = await fixture.send("/api/event", back);
    assert.equal(!replay.ok && replay.code, "STALE_SURFACE");
    // Asking in words does not withdraw it either.
    success(await fixture.send("/api/turn", { text: "go back to the results" }));

    assert.equal(statusOf(), "disclosed");
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1);
    const state = snapshot(await fixture.state());
    assert.equal(state.journey?.current, "request");
    assert.equal(state.journey?.outcome, undefined);
  } finally { await fixture.close(); }
});

test("The no-JS conversation page shows the same journey rail (ADR-0080)", () => {
  const html = renderNoScriptConversationHtml({ threadId: "g-abcdef12", timeline: [], surfaces: [], journey: projectJourney("request", { kind: "declined", label: "Request declined" }) });
  assert.match(html, /<nav class="no-js-journey" aria-label="Booking progress">/);
  assert.match(html, /<li data-state="failed">Request declined<span class="journey-state"> \(not completed\)<\/span><\/li>/);
  assert.doesNotMatch(html, /aria-current/);
  assert.doesNotMatch(renderNoScriptConversationHtml({ threadId: "g-abcdef12", timeline: [], surfaces: [] }), /<nav class="no-js-journey"/);
});
