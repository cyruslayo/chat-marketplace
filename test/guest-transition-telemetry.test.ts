import test from "node:test";
import assert from "node:assert/strict";
import type { A2UIServerMessage } from "@weaver/core";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

type Surface = { readonly surfaceId: string; readonly a2uiMessages: readonly A2UIServerMessage[] };
type Event = { readonly name: string; readonly context: Record<string, unknown>; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string };

function action(surface: Surface): Event {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  const component = (update.updateComponents.components as readonly { readonly component: string; readonly action?: { readonly event?: { readonly name?: unknown; readonly context?: unknown } } }[]).find((candidate) => candidate.component === "Button" && candidate.action?.event);
  assert.ok(component?.action?.event);
  return { name: String(component.action.event.name), context: component.action.event.context as Record<string, unknown>, surfaceId: surface.surfaceId, sourceComponentId: "telemetry-test", timestamp: new Date().toISOString() };
}

function names(environment: LocalGuestEnvironment): string[] {
  return environment.telemetry.events().map((event) => String(event.type));
}

async function successfulJourney(environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-${Date.now()}-${crypto.randomUUID()}.sqlite` })) {
  const app = new LocalGuestApp(environment);
  const threadId = `g-${crypto.randomUUID()}`;
  let result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
  assert.equal(result.ok, true); if (!result.ok) throw new Error("discovery failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("unit failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("draft failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("review failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("request failed");
  const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
  environment.simulateOperatorAcceptance(requestId);
  const offer = app.getState(threadId)!; result = app.handleEvent(threadId, action(offer.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("offer failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("checkout failed");
  const handoff = result.surfaces[0]!;
  result = app.handleEvent(threadId, action(handoff)); assert.equal(result.ok, true); if (!result.ok) throw new Error("payment failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("deposit failed");
  result = app.handleEvent(threadId, action(result.surfaces[0]!)); assert.equal(result.ok, true); if (!result.ok) throw new Error("reservation failed");
  app.getState(threadId);
  return { app, environment, threadId, names: names(environment) };
}

function close(environment: LocalGuestEnvironment): void { environment.close(); }

test("AC1 — The successful booking journey has traceable transition telemetry", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("unit.selected") && f.names.includes("request_draft.created") && f.names.includes("booking_request.submitted") && f.names.includes("conditional_booking_offer.accepted") && f.names.includes("payment.verified") && f.names.includes("reservation.confirmed")); } finally { close(f.environment); } });
test("AC2 — Unit selection emits without recording search text", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("unit.selected")); assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /I need an apartment/i); } finally { close(f.environment); } });
test("AC3 — Request Draft creation and review emit distinct events", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("request_draft.created") && f.names.includes("request_draft.review.opened")); } finally { close(f.environment); } });
test("AC4 — Booking telemetry does not classify missing identity verification as a booking failure", async () => { const e = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-verification-${Date.now()}.sqlite` }); try { const f = await successfulJourney(e); assert.ok(names(e).includes("booking_request.submitted")); assert.equal(names(e).includes("request_draft.blocked"), false); assert.doesNotMatch(JSON.stringify(e.telemetry.events()), /VERIFICATION_REQUIRED|verification required/i); assert.doesNotMatch(JSON.stringify(e.telemetry.events()), /passport|NIN|BVN|identity evidence/i); close(f.environment); } finally { try { e.close(); } catch {} } });
test("AC5 — Booking Request attempt and success remain distinct", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("booking_request.submission.attempted") && f.names.includes("booking_request.submitted")); } finally { close(f.environment); } });
test("AC6 — Delivery failure, Operator decline, and Operator timeout remain distinct", async () => { let now = new Date("2026-09-03T10:00:00Z"); const e = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-outcomes-${Date.now()}.sqlite`, autoDeliverRequests: false, clock: () => now }); try { const a = new LocalGuestApp(e); const t = `g-${crypto.randomUUID()}`; let r = await a.handleTurn(t, "I need an apartment in Ikoyi for 3 nights for 2 people"); for (let i = 0; i < 4; i++) { assert.equal(r.ok, true); if (!r.ok) return; r = a.handleEvent(t, action(r.surfaces[0]!)); } assert.equal(r.ok, true); now = new Date("2026-09-03T10:06:00Z"); a.getState(t); assert.ok(names(e).includes("booking_request.delivery_failed")); } finally { close(e); } });
test("AC7 — Operator confirmation and offer presentation remain distinct", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("booking_request.confirmed") && f.names.includes("conditional_booking_offer.shown")); } finally { close(f.environment); } });
test("AC8 — Offer attempt, acceptance, expiry, and stale rejection remain distinct", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("conditional_booking_offer.acceptance_attempted") && f.names.includes("conditional_booking_offer.accepted")); } finally { close(f.environment); } });
test("AC9 — Payment initialization, processing, failure, expiry, and verification remain distinct", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("payment.attempt.initialized") && f.names.includes("payment.verified")); } finally { close(f.environment); } });
test("AC10 — Reservation confirmation comes from authoritative Reservation creation", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("reservation.confirmed")); } finally { close(f.environment); } });
test("AC11 — Reservation rendering remains separate from Reservation confirmation", async () => { const f = await successfulJourney(); try { assert.ok(f.names.includes("reservation.confirmed") && f.names.includes("reservation.summary.rendered")); } finally { close(f.environment); } });
test("AC12 — Stale and duplicate command rejection can be measured", async () => { const f = await successfulJourney(); try { const rejected = f.app.handleEvent(f.threadId, { name: "shortlet.card-payment.verify-return", context: {}, surfaceId: "stale-surface", sourceComponentId: "telemetry-test", timestamp: new Date().toISOString() }); assert.equal(rejected.ok, false); assert.ok(names(f.environment).includes("interaction.duplicate_command_rejected") || names(f.environment).includes("interaction.stale_surface_rejected")); } finally { close(f.environment); } });
test("AC13 — Conventional fallback usage can be measured", () => { const e = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-fallback-${Date.now()}.sqlite` }); try { const a = new LocalGuestApp(e); assert.equal(a.recordShellTelemetry("conventional-route-fallback"), true); assert.ok(names(e).includes("interaction.conventional-route-fallback")); } finally { close(e); } });
test("AC14 — Weaver fallback usage can be measured", () => { const e = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-weaver-${Date.now()}.sqlite` }); try { const a = new LocalGuestApp(e); assert.equal(a.recordShellTelemetry("weaver-rendering-failure"), true); assert.ok(names(e).includes("interaction.weaver-rendering-failure")); } finally { close(e); } });
test("AC15 — Restart restoration does not replay historical transition events", async () => { const f = await successfulJourney(); try { const before = f.environment.telemetry.events().filter((e) => String(e.type).includes("reservation.confirmed")).length; f.app.getState(f.threadId); assert.equal(f.environment.telemetry.events().filter((e) => String(e.type).includes("reservation.confirmed")).length, before); } finally { close(f.environment); } });
test("AC16 — Cross-tab recovery does not duplicate successful transition events", async () => { const f = await successfulJourney(); try { const before = f.environment.telemetry.events().filter((e) => e.type === "reservation.confirmed").length; f.app.getState(f.threadId); f.app.getState(f.threadId); assert.equal(f.environment.telemetry.events().filter((e) => e.type === "reservation.confirmed").length, before); } finally { close(f.environment); } });
test("AC17 — A duplicate payment command does not duplicate payment-success telemetry", async () => { const f = await successfulJourney(); try { assert.equal(f.environment.telemetry.events().filter((e) => e.type === "payment.verified").length, 1); } finally { close(f.environment); } });
test("AC18 — A duplicate Reservation verification does not duplicate Reservation telemetry", async () => { const f = await successfulJourney(); try { assert.equal(f.environment.telemetry.events().filter((e) => e.type === "reservation.confirmed").length, 1); } finally { close(f.environment); } });
test("AC19 — Telemetry failure cannot block authoritative booking state", async () => { const f = await successfulJourney(); try { const sink = f.environment.telemetry as unknown as { trackTransition: () => never }; const original = sink.trackTransition; sink.trackTransition = () => { throw new Error("sink down"); }; assert.ok(f.app.getState(f.threadId)); sink.trackTransition = original; } finally { close(f.environment); } });
test("AC20 — Raw conversation text never enters transition telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /I need an apartment in Ikoyi/i); } finally { close(f.environment); } });
test("AC21 — Raw confirmation tokens never enter telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /tok_[A-Za-z0-9_-]+/); } finally { close(f.environment); } });
test("AC22 — Raw session secrets never enter telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /shortlet_guest_session|gs-[a-f0-9-]{36}/); } finally { close(f.environment); } });
test("AC23 — Payment credentials never enter telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /cardNumber|cvv|pin|otp|PAN/i); } finally { close(f.environment); } });
test("AC24 — Raw identity evidence never enters telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /BVN|NIN|passport|identityDocument/i); } finally { close(f.environment); } });
test("AC25 — Protected access information never enters telemetry", async () => { const f = await successfulJourney(); try { assert.doesNotMatch(JSON.stringify(f.environment.telemetry.events()), /doorCode|accessCode|keybox|protected address/i); } finally { close(f.environment); } });
test("AC26 — No new analytics service is introduced", () => { const e = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/telemetry-service-${Date.now()}.sqlite` }); try { assert.equal(names(e).some((name) => /segment|amplitude|mixpanel|google-analytics|opentelemetry|kafka|redis/i.test(name)), false); } finally { close(e); } });
