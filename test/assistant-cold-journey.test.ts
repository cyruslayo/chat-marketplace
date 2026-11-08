import assert from "node:assert/strict";
import test from "node:test";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { coldApp, PHONE, SCRIPT, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";

// A fresh thread's full booking journey on the staging-like clock (27 Oct 2026), with the assistant runtime enabled and a
// cold restore (a new application over the same store) before EVERY event, as each request on the Worker is.
// Units pass the offer check at this clock (the fixture trust dates now come from DEMO_TRUST_EXPIRES_ON).
// The script, the phone and the cold-restore driver live in test/helpers/assistant-cold-journey-harness.ts.

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

test("AC1: direct request edits retain contact and invalidate the old draft after an assistant cold restore", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000320";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phone = await tap(f, threadId, draft.surfaces[0]!, "Review");
    const action = firstButtonAction(phone.surfaces[0]!);
    const invalid = successOf(await coldApp(f, threadId).handleEventAsync(threadId, { ...action, context: { ...action.context, contactValue: "08012" } }), "invalid phone");
    assert.match(JSON.stringify(invalid.surfaces), /08012/);
    assert.match(JSON.stringify(invalid.surfaces), /Enter a Nigerian mobile number, such as 0801 234 5678/);
    const retry = firstButtonAction(invalid.surfaces[0]!);
    const review = successOf(await coldApp(f, threadId).handleEventAsync(threadId, { ...retry, context: { ...retry.context, contactValue: PHONE } }), "phone correction");
    const old = review.surfaces[0]!;
    const id = old.surfaceId.split(":").at(-1)!;
    const updated = successOf(await coldApp(f, threadId).conventionalDraftEdit(id, old.surfaceId, { checkIn: "2026-12-14", checkOut: "2026-12-18", partySize: 2 }, f.environment.guestPrincipal()), "direct edit");
    const restored = restartedDatedApp(f, scriptedPlanner({}).client);
    const state = restored.app.getState(threadId);
    assert.equal(restored.runtime.getThread(threadId).taskState.stayIntent.nights, 4);
    assert.equal(state?.surfaces[0]?.surfaceId, updated.surfaces[0]?.surfaceId);
    assert.match(JSON.stringify(state?.surfaces), /2026-12-18/);
    assert.equal(f.environment.guestContactApp.get(f.environment.guestPrincipal())?.phoneNumber, "+2348012345678");
    const stale = await coldApp(f, threadId).conventionalRequestAction(id, "submit", old.surfaceId, f.environment.guestPrincipal());
    assert.equal(stale.ok, false);
    assert.equal(f.environment.interactionStore.listBookingRequestIds().length, 0);
  } finally { f.close(); }
});
