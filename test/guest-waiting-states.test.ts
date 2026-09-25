import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { renderNoScriptConversationHtml, type GuestStateSnapshot, type GuestSurfacePayload, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { restartFixture, type RestartStage } from "./helpers/guest-restart.js";

function snapshot(state: GuestStateSnapshot | { ok: false; code: string }): GuestStateSnapshot {
  assert.equal(state.ok, true, JSON.stringify(state));
  return state as GuestStateSnapshot;
}

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function requestIdOf(surface: GuestSurfacePayload): string {
  return surface.surfaceId.split(":").at(-1)!;
}

/** Every button label and event name the surface offers. */
function surfaceActions(surface: GuestSurfacePayload): string[] {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  const components = (update?.updateComponents.components ?? []) as readonly { id: string; component: string; child?: string; text?: string; action?: { event?: { name?: string } } }[];
  return components.filter((component) => component.component === "Button").flatMap((button) => [
    button.action?.event?.name ?? "",
    components.find((component) => component.id === button.child)?.text ?? "",
  ]);
}

test("AC1: The countdown uses the server deadline; changing the client clock doesn't move the displayed deadline time", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    const deadline = fixture.environment.bookingRequestApp.getArtifact(requestIdOf(pending.surfaces[0]!), fixture.environment.guestPrincipal()).facts.operatorResponseDeadlineAt;
    const waiting = pending.surfaces[0]!.waiting;
    assert.ok(waiting, "the pending request carries a waiting state");
    assert.equal(waiting.deadlineAt, deadline, "the deadline is the domain's, not a browser estimate");
    assert.equal(waiting.serverNow, "2026-09-03T10:00:00.000Z", "the countdown starts from the server clock");
    assert.match(waiting.deadlineText, /^Response due by \d{1,2}:\d{2} (am|pm) WAT/);

    // Time passing moves the server's "now", never the deadline.
    fixture.setTime("2026-09-03T10:12:00Z");
    const later = snapshot(await fixture.state()).surfaces[0]!.waiting;
    assert.equal(later?.deadlineAt, deadline);
    assert.equal(later?.deadlineText, waiting.deadlineText);
    assert.equal(later?.serverNow, "2026-09-03T10:12:00.000Z");
  } finally { await fixture.close(); }
});

test("AC2: At zero, the UI refetches state and never marks the request expired on its own", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    const requestId = requestIdOf(pending.surfaces[0]!);
    const deadline = pending.surfaces[0]!.waiting!.deadlineAt;

    // One second before the deadline the server still reports an open wait.
    fixture.setTime(new Date(Date.parse(deadline) - 1_000).toISOString());
    const before = snapshot(await fixture.state());
    assert.equal(before.surfaces[0]!.status, "active");
    assert.ok(before.surfaces[0]!.waiting);

    // Failure path: after the deadline the refetch is what reports expiry, and the countdown is gone.
    fixture.setTime(new Date(Date.parse(deadline) + 1_000).toISOString());
    const after = snapshot(await fixture.state());
    assert.equal(after.surfaces[0]!.waiting, undefined);
    assert.equal(after.surfaces[0]!.summary, "Request outcome");
    assert.equal(fixture.environment.bookingRequestApp.getArtifact(requestId, fixture.environment.guestPrincipal()).facts.status, "expired");
    assert.equal(after.journey?.outcome?.label, "Request expired");
  } finally { await fixture.close(); }
});

test("AC3: Each waiting state lists the outcomes the guest will see next", async () => {
  const fixture = await restartFixture();
  const seen = new Map<RestartStage, GuestSurfacePayload["waiting"]>();
  try {
    await fixture.advance("confirmed", async (stage) => {
      seen.set(stage, snapshot(await fixture.state()).surfaces[0]!.waiting);
    });
  } finally { await fixture.close(); }

  const pending = seen.get("pending");
  assert.equal(pending?.kind, "operator-response");
  assert.equal(pending?.outcomes.length, 3);
  assert.match(pending!.outcomes[0]!, /^If .+ confirms, you'll get a Conditional Booking Offer/);
  assert.match(pending!.outcomes[1]!, /^If .+ declines, no payment is due/);
  assert.match(pending!.outcomes[2]!, /^If there's no response by the deadline, the request expires and the dates are released\.$/);

  const offer = seen.get("offer");
  assert.equal(offer?.kind, "offer-payment-window");
  assert.match(offer!.deadlineText, /^Pay by /);
  for (const stage of ["offer", "payment-ready", "handoff"] as const) {
    const outcomes = seen.get(stage)?.outcomes.join(" ") ?? "";
    assert.match(outcomes, /If payment is verified before the deadline/, stage);
    assert.match(outcomes, /If the deadline passes, the Payment Window expires and the dates are released\./, stage);
    assert.match(outcomes, /completes after the deadline is refunded/, stage);
  }

  // Failure path: states that wait on nothing show no countdown.
  for (const stage of ["discovery", "inspection", "draft", "review", "confirmed"] as const) assert.equal(seen.get(stage), undefined, stage);
});

test("AC4: The guest can keep chatting during the wait", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    assert.match(pending.surfaces[0]!.waiting!.meanwhile.join(" "), /You can keep chatting here while you wait\./);
    const turn = success(await fixture.send("/api/turn", { text: "is there parking?" }));
    assert.match(turn.messages.join(" "), /Secure parking/);
    // The wait and its request are untouched by the conversation.
    const state = snapshot(await fixture.state());
    assert.equal(state.surfaces[0]!.surfaceId, pending.surfaces[0]!.surfaceId);
    assert.equal(state.surfaces[0]!.waiting?.deadlineAt, pending.surfaces[0]!.waiting!.deadlineAt);
    assert.equal(fixture.environment.bookingRequestApp.getArtifact(requestIdOf(pending.surfaces[0]!), fixture.environment.guestPrincipal()).facts.status, "disclosed");
  } finally { await fixture.close(); }
});

test("AC5: No awaiting-Operator surface offers a withdraw or cancel action for the Booking Request", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    const surface = pending.surfaces[0]!;
    assert.deepEqual(surfaceActions(surface), [], "the awaiting-Operator surface has no actions at all");
    const waitingText = [surface.waiting!.heading, ...surface.waiting!.outcomes, ...surface.waiting!.meanwhile].join(" ");
    assert.doesNotMatch(waitingText, /\b(withdraw|cancel)/i);

    // Failure path: a forged withdraw or cancel event is not an available action.
    for (const name of ["shortlet.booking-request.withdraw", "shortlet.booking-request.cancel"]) {
      const forged = await fixture.send("/api/event", { name, surfaceId: surface.surfaceId, sourceComponentId: "forged", timestamp: new Date().toISOString(), context: { requestId: requestIdOf(surface) } });
      assert.equal(!forged.ok && forged.code, "UNSUPPORTED_EVENT", name);
    }
    assert.equal(fixture.environment.bookingRequestApp.getArtifact(requestIdOf(surface), fixture.environment.guestPrincipal()).facts.status, "disclosed");
  } finally { await fixture.close(); }
});

test("AC6: The awaiting-Operator surface states that nothing is charged until the guest accepts an offer and pays", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    const waiting = pending.surfaces[0]!.waiting!;
    assert.ok(waiting.meanwhile.includes("Nothing is charged until you accept an offer and pay."));
    assert.ok(waiting.meanwhile.includes("If you change your mind, you can leave the offer unaccepted. When it expires, the dates are released."));
    // ADR-0080: the no-JS page carries the same statement and the absolute deadline.
    const html = renderNoScriptConversationHtml({ threadId: fixture.threadId, timeline: [], surfaces: pending.surfaces });
    assert.match(html, /data-waiting="operator-response"/);
    assert.match(html, /Nothing is charged until you accept an offer and pay\./);
    assert.match(html, /Response due by /);
    // Failure path: once the request is declined there is no wait and no claim about a pending offer.
    fixture.environment.simulateOperatorDecline(requestIdOf(pending.surfaces[0]!));
    assert.equal(snapshot(await fixture.state()).surfaces[0]!.waiting, undefined);
  } finally { await fixture.close(); }
});
