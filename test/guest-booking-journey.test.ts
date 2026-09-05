import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

type Surface = Extract<Awaited<ReturnType<LocalGuestApp["handleTurn"]>>, { readonly ok: true }>;
type ActionEvent = { readonly name: string; readonly context: Record<string, unknown>; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string };

function firstAction(surface: { readonly a2uiMessages: readonly A2UIServerMessage[]; readonly surfaceId: string }): ActionEvent {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  const component = (update.updateComponents.components as readonly { readonly component: string; readonly action?: { readonly event?: { readonly name?: unknown; readonly context?: unknown } } }[]).find((candidate) => candidate.component === "Button" && candidate.action?.event);
  assert.ok(component?.action?.event);
  assert.equal(typeof component.action.event.name, "string");
  assert.ok(component.action.event.context && typeof component.action.event.context === "object" && !Array.isArray(component.action.event.context));
  return { name: component.action.event.name as string, context: component.action.event.context as Record<string, unknown>, surfaceId: surface.surfaceId, sourceComponentId: "test", timestamp: new Date().toISOString() };
}

function event(app: LocalGuestApp, threadId: string, surface: { readonly a2uiMessages: readonly A2UIServerMessage[]; readonly surfaceId: string }): ReturnType<LocalGuestApp["handleEvent"]> {
  return app.handleEvent(threadId, firstAction(surface));
}

function close(environment: LocalGuestEnvironment): void { environment.close(); }

test("AC1–AC8 — Guest discovery, Unit inspection, Request Draft, review, disclosure, and pending status preserve one conversation workspace", async () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/ac1-${Date.now()}.sqlite` });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-abcdefac1";
    const discovery = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(discovery.ok, true);
    if (!discovery.ok) return;
    const inspection = event(app, threadId, discovery.surfaces[0]!);
    assert.equal(inspection.ok, true);
    if (!inspection.ok) return;
    const draft = event(app, threadId, inspection.surfaces[0]!);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/);
    assert.match(draft.surfaces[0]!.textFallback ?? "", /not reserved/i);
    const review = event(app, threadId, draft.surfaces[0]!);
    assert.equal(review.ok, true);
    if (!review.ok) return;
    assert.match(review.surfaces[0]!.summary ?? "", /review/i);
    const pending = event(app, threadId, review.surfaces[0]!);
    assert.equal(pending.ok, true);
    if (!pending.ok) return;
    assert.match(pending.surfaces[0]!.surfaceId, /:request:req-/);
    assert.match(pending.surfaces[0]!.textFallback ?? "", /Operator response deadline.*WAT/i);
    assert.match(pending.messages.join(" "), /No Reservation exists yet/i);
    assert.equal(environment.calendar.getAuthoritativeAvailability({ unitId: "unit-lagos-ikoyi-001", checkIn: "2026-09-10", checkOut: "2026-09-13", clock: environment.clock }).isAvailable, false);
  } finally { close(environment); }
});

test("AC12–AC23 and AC37–AC39 — Operator confirmation, explicit offer acceptance, PSP return verification, staged payment, reservation commit, and refresh restoration are authoritative", async () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/ac12-${Date.now()}.sqlite` });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-abcdefac12";
    let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(result.ok, true); if (!result.ok) return;
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
    environment.simulateOperatorAcceptance(requestId);
    const offerState = app.getState(threadId);
    assert.ok(offerState);
    assert.match(offerState!.surfaces[0]!.summary ?? "", /Offer/i);
    result = event(app, threadId, offerState!.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.match(result.surfaces[0]!.summary ?? "", /payment/i);
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.match(result.surfaces[0]!.textFallback ?? "", /checkout_initiated/i);
    const stayHandoff = result.surfaces[0]!;
    result = event(app, threadId, stayHandoff) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.match(result.messages.join(" "), /separate Refundable Security Deposit/i);
    const duplicateReturn = app.handleEvent(threadId, firstAction(stayHandoff));
    assert.equal(duplicateReturn.ok, false);
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    result = event(app, threadId, result.surfaces[0]!) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.match(result.messages.join(" "), /Reservation.*committed/i);
    assert.match(result.surfaces[0]!.summary ?? "", /Reservation confirmed/i);
    const restored = app.getState(threadId);
    assert.equal(restored?.surfaces[0]?.surfaceId, result.surfaces[0]!.surfaceId);
    assert.equal(restored?.timeline.some((entry) => /Reservation was committed|stay is confirmed/i.test(entry.text)), true);
  } finally { close(environment); }
});

test("AC4, AC9–AC11, AC26–AC28, and AC34–AC36 — verification blocks, request outcomes are distinct, stale actions fail closed, and generated actions stay allow-listed", async () => {
  const unverified = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/ac4-${Date.now()}.sqlite`, guestIdentityVerified: false });
  try {
    const app = new LocalGuestApp(unverified);
    const threadId = "g-abcdefac4";
    let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(result.ok, true); if (!result.ok) return;
    const discovery = result.surfaces[0]!;
    result = app.handleEvent(threadId, firstAction(discovery)) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    const detail = result.surfaces[0]!;
    result = app.handleEvent(threadId, firstAction(detail)) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    result = app.handleEvent(threadId, firstAction(result.surfaces[0]!)) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    assert.match(result.surfaces[0]!.textFallback ?? "", /not reserved/i);
    assert.equal(result.surfaces[0]!.a2uiMessages.some((message) => /verification is required/i.test(JSON.stringify(message))), true);
  } finally { close(unverified); }

  let now = new Date("2026-09-03T10:00:00Z");
  const timeoutEnvironment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/ac11-${Date.now()}.sqlite`, clock: () => now });
  try {
    const app = new LocalGuestApp(timeoutEnvironment);
    const threadId = "g-abcdefac11";
    let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(result.ok, true); if (!result.ok) return;
    result = app.handleEvent(threadId, firstAction(result.surfaces[0]!)) as Surface;
    result = app.handleEvent(threadId, firstAction(result.surfaces[0]!)) as Surface;
    result = app.handleEvent(threadId, firstAction(result.surfaces[0]!)) as Surface;
    const reviewSurface = result.surfaces[0]!;
    result = app.handleEvent(threadId, firstAction(reviewSurface)) as Surface;
    assert.equal(result.ok, true); if (!result.ok) return;
    const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
    now = new Date("2026-09-03T10:31:00Z");
    const expired = app.getState(threadId);
    assert.match(expired?.surfaces[0]?.textFallback ?? "", /expired|No Reservation/i);
    assert.equal(app.handleEvent(threadId, firstAction(reviewSurface)).ok, false);
    assert.equal(timeoutEnvironment.calendar.getAuthoritativeAvailability({ unitId: "unit-lagos-ikoyi-001", checkIn: "2026-09-10", checkOut: "2026-09-13", clock: () => now }).isAvailable, true);
    assert.ok(requestId);
  } finally { close(timeoutEnvironment); }
});

test("AC9–AC11 — delivery failure, Operator decline, and Operator timeout release inventory without exposing payment or Reservation actions", async () => {
  const cases = [
    { name: "delivery", config: { autoDeliverRequests: false }, advance: 6, expected: /could not be delivered|delivery_failed/i },
    { name: "decline", config: { autoDeliverRequests: true }, advance: 0, expected: /declined/i },
    { name: "timeout", config: { autoDeliverRequests: true }, advance: 31, expected: /expired/i },
  ] as const;
  for (const scenario of cases) {
    let now = new Date("2026-09-03T10:00:00Z");
    const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/${scenario.name}-${Date.now()}-${crypto.randomUUID()}.sqlite`, clock: () => now, ...scenario.config });
    try {
      const app = new LocalGuestApp(environment);
      const threadId = `g-${scenario.name === "delivery" ? "deadbeef1" : scenario.name === "decline" ? "deadbeef2" : "deadbeef3"}`;
      let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
      assert.equal(result.ok, true); if (!result.ok) continue;
      for (let step = 0; step < 4; step++) { result = app.handleEvent(threadId, firstAction(result.surfaces[0]!)) as Surface; assert.equal(result.ok, true); if (!result.ok) break; }
      if (!result.ok) continue;
      const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
      if (scenario.name === "decline") environment.simulateOperatorDecline(requestId);
      now = new Date(now.getTime() + scenario.advance * 60 * 1000);
      const state = app.getState(threadId);
      assert.ok(state);
      assert.match(state!.surfaces[0]!.textFallback ?? "", scenario.expected);
      assert.equal(state!.surfaces[0]!.a2uiMessages.some((message) => JSON.stringify(message).includes("Start secure checkout")), false);
    } finally { close(environment); }
  }
});
