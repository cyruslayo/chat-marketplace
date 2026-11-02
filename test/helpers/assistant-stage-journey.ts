import assert from "node:assert/strict";
import type { GuestTurnResult, GuestTurnSuccess } from "../../apps/local-guest/src/shortlet-app.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./guest-date-fixtures.js";

// Guest journeys driven to each stage a sent stay can be in (ADR 0005, 0060, 0106), with a cold restore before EVERY event: a
// new application over the same store, as each request on the Worker is. Used by the change-explanation tests (issue 12).
// The staging-like clock and guest are the datedFixture defaults for these tests (LIVE_LIKE_CLOCK, stagingGuest: true).

export const JOURNEY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
export const JOURNEY_SLOTS = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } as const;
export const JOURNEY_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  [JOURNEY_TEXT]: { slots: JOURNEY_SLOTS, search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 } },
};
export const PHONE = "+234 801 234 5678";
export const EMAIL = "guest@example.com";

export interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[]; readonly summary?: string; readonly textFallback?: string }

export function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** A new application over the same store, with its thread loaded as the page load does (ADR 0106 cold restore). */
export function coldApp(f: DatedFixture, threadId: string, model = scriptedPlanner({}).client) {
  const restored = restartedDatedApp(f, model);
  restored.app.getState(threadId);
  return restored;
}

/** The first Button action on a surface, sent after a cold restore. */
export async function tap(f: DatedFixture, threadId: string, surface: Surface, label: string): Promise<GuestTurnSuccess> {
  return successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, firstButtonAction(surface)), label);
}

/** A typed guest turn after a cold restore, with the given classifier and planner script. */
export async function typedTurn(f: DatedFixture, threadId: string, text: string, script: Readonly<Record<string, ScriptedTurn>>, planner: Parameters<typeof scriptedPlanner>[1] = []): Promise<GuestTurnResult> {
  const restored = coldApp(f, threadId, scriptedPlanner(script, planner).client);
  return restored.app.handleTurn(threadId, text);
}

/** Search, View, Request to Book, then phone and Send booking request. Returns the sent Booking Request's id. */
export async function journeyToRequest(f: DatedFixture, threadId: string): Promise<string> {
  const search = successOf(await typedTurn(f, threadId, JOURNEY_TEXT, JOURNEY_SCRIPT), "search");
  const detail = await tap(f, threadId, search.surfaces[0]!, "View");
  const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
  const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
  const saved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, {
    ...phoneSave,
    context: { ...phoneSave.context, contactValue: PHONE },
  }), "Save phone number");
  const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
  assert.deepEqual(sent.receipts, ["Booking Request sent"], "the Booking Request is sent");
  return sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
}

/** The sent request, accepted by the Operator; returns the offer surface the guest sees. */
export async function journeyToOffer(f: DatedFixture, threadId: string): Promise<Surface> {
  const requestId = await journeyToRequest(f, threadId);
  f.environment.simulateOperatorAcceptance(requestId);
  const offer = coldApp(f, threadId).app.getState(threadId);
  assert.ok(offer, "the conversation is readable after acceptance");
  assert.match(offer.surfaces[0]!.summary ?? "", /Offer/i, "the accepted request shows its offer");
  return offer.surfaces[0]!;
}

/** The offer accepted: the payment surface (stage payment). */
export async function journeyToPayment(f: DatedFixture, threadId: string): Promise<Surface> {
  const offer = await journeyToOffer(f, threadId);
  const payment = await tap(f, threadId, offer, "Accept offer");
  assert.match(payment.surfaces[0]!.summary ?? "", /payment/i, "accepting the offer opens payment");
  return payment.surfaces[0]!;
}

/** The payment verified and the Reservation confirmed (stage booking). Starts checkout with the staging guest's email. */
export async function journeyToReservation(f: DatedFixture, threadId: string): Promise<Surface> {
  const payment = await journeyToPayment(f, threadId);
  const checkout = await tap(f, threadId, payment, "Start checkout");
  assert.match(checkout.surfaces[0]!.surfaceId, /:contact:email:/, "checkout asks for the contact email");
  const emailAsk = firstButtonAction(checkout.surfaces[0]!);
  const emailSaved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, {
    ...emailAsk,
    context: { ...emailAsk.context, contactValue: EMAIL },
  }), "Save email");
  const returned = await tap(f, threadId, emailSaved.surfaces[0]!, "Payment return");
  const verifying = await tap(f, threadId, returned.surfaces[0]!, "Verify payment");
  const confirmed = await tap(f, threadId, verifying.surfaces[0]!, "Confirm payment");
  assert.deepEqual(confirmed.receipts, ["Payment verified"]);
  assert.match(confirmed.surfaces[0]!.summary ?? "", /Reservation confirmed/i);
  return confirmed.surfaces[0]!;
}

/** A fresh staging-like fixture on the staging clock, as every change-explanation journey starts. */
export function stagingJourneyFixture(model = scriptedPlanner(JOURNEY_SCRIPT).client): DatedFixture {
  return datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
}
