import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";

// A fresh thread's full booking journey on the staging-like clock (27 Oct 2026), with the assistant runtime enabled and a
// cold restore (a new application over the same store) before EVERY event, as each request on the Worker is.
// Units pass the offer check at this clock (the fixture trust dates now come from DEMO_TRUST_EXPIRES_ON).

const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const PHONE = "+234 801 234 5678";
const SCRIPT = {
  [STAY_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: STAY_SEARCH },
};

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

/** A new application over the same store, loaded as the browser's page load does, before the event is sent. */
function coldApp(f: DatedFixture, threadId: string) {
  const restored = restartedDatedApp(f, scriptedPlanner({}).client);
  restored.app.getState(threadId);
  return restored.app;
}

/** The first Button action on a surface, sent after a cold restore. */
async function tap(f: DatedFixture, threadId: string, surface: Surface, label: string): Promise<GuestTurnSuccess> {
  return successOf(await coldApp(f, threadId).handleEventAsync(threadId, firstButtonAction(surface)), label);
}

test("a fresh thread completes the booking journey, cold-restored before every event, on the staging clock", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000301";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");

    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail");

    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "Request to Book opens the draft");

    // Review request: a guest with no phone number is asked for one first.
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    assert.match(phoneAsk.surfaces[0]!.surfaceId, /:contact:phone:/, "Review asks for the phone number");

    // Save the phone number: the review opens with the phone saved.
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = successOf(await coldApp(f, threadId).handleEventAsync(threadId, {
      ...phoneSave,
      context: { ...phoneSave.context, contactValue: PHONE },
    }), "Save phone number");
    assert.match(saved.surfaces[0]!.surfaceId, /:request:review:/, "saving the phone opens the review");

    const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
    assert.deepEqual(sent.receipts, ["Booking Request sent"], "the Booking Request is sent");
    const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
    f.environment.simulateOperatorAcceptance(requestId);

    const offer = coldApp(f, threadId).getState(threadId);
    assert.ok(offer, "the conversation is readable after acceptance");
    assert.match(offer.surfaces[0]!.summary ?? "", /Offer/i, "the accepted request shows its offer");

    const payment = await tap(f, threadId, offer.surfaces[0]!, "Accept offer");
    assert.match(payment.surfaces[0]!.summary ?? "", /payment/i, "accepting the offer opens payment");

    // Starting checkout asks a guest with no email for one (as the staging guest does); saving it resumes the checkout.
    const checkout = await tap(f, threadId, payment.surfaces[0]!, "Start checkout");
    assert.match(checkout.surfaces[0]!.surfaceId, /:contact:email:/, "checkout asks for the contact email");
    const emailAsk = firstButtonAction(checkout.surfaces[0]!);
    const emailSaved = successOf(await coldApp(f, threadId).handleEventAsync(threadId, {
      ...emailAsk,
      context: { ...emailAsk.context, contactValue: "guest@example.com" },
    }), "Save email");
    assert.match(emailSaved.surfaces[0]!.textFallback ?? "", /payment handoff ready|payment has not succeeded/i, "payment is ready to hand off");
  } finally { f.close(); }
});

test("a forged contact surface id fails closed after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000302";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const save = firstButtonAction(phoneAsk.surfaces[0]!);
    const forged = await coldApp(f, threadId).handleEventAsync(threadId, {
      ...save,
      surfaceId: `thread-${threadId}:contact:phone:forged-surface`,
      context: { ...save.context, contactValue: PHONE },
    });
    assert.equal(forged.ok, false);
    assert.equal(forged.ok ? "" : forged.code, "STALE_SURFACE");
  } finally { f.close(); }
});

test("the phone prompt the guest already answered is superseded by the review after a cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000303";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const save = firstButtonAction(phoneAsk.surfaces[0]!);
    successOf(await coldApp(f, threadId).handleEventAsync(threadId, { ...save, context: { ...save.context, contactValue: PHONE } }), "Save phone number");
    const replayed = await coldApp(f, threadId).handleEventAsync(threadId, { ...save, context: { ...save.context, contactValue: PHONE } });
    assert.equal(replayed.ok, false);
    assert.equal(replayed.ok ? "" : replayed.code, "STALE_SURFACE");
  } finally { f.close(); }
});
