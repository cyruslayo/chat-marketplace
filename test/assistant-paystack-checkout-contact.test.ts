import assert from "node:assert/strict";
import test from "node:test";
import { DirectPaystackClient } from "../packages/platform-core/src/payments/index.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { getConditionalOfferManager } from "../apps/web/src/conditional-offer-application.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { datedFixture, firstButtonAction, restartedDatedApp, scriptedPlanner, trueRestartedDatedApp, type DatedFixture } from "./helpers/guest-date-fixtures.js";

// Task B: the Paystack card start (#handlePaystackCardCheckout) runs with the Paystack payments module WIRED, as staging does,
// the assistant runtime enabled, and a cold restore (a new app over the same store) before EVERY event on a staging-like guest
// (no phone, no email) on the 27 Oct 2026 clock.

const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const PHONE = "+234 801 234 5678";
const EMAIL = "guest@example.com";
const SCRIPT = {
  [STAY_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: STAY_SEARCH },
};
const PAYSTACK_CONFIG = { secretKey: "sk_test_synthetic_fixture", environment: "test" as const, callbackBaseUrl: "https://demo.example.test" };
const START_MS = Date.parse("2026-10-27T10:00:00Z");

interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

interface Harness {
  readonly f: DatedFixture;
  readonly clock: { now: Date };
  readonly threadId: string;
}

function harness(threadId: string, paystackFetcher = createPaystackHttpFake().fetcher): Harness {
  const clock = { now: new Date(START_MS) };
  const payments = new DirectPaystackClient(PAYSTACK_CONFIG, paystackFetcher);
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: () => clock.now, stagingGuest: true, paystackClient: payments });
  return { f, clock, threadId };
}

/** A new application over the same store, loaded as the browser's page load does, before the event is sent. */
function coldApp(h: Harness) {
  const restored = restartedDatedApp(h.f, scriptedPlanner({}).client);
  restored.app.getState(h.threadId);
  return restored.app;
}

async function tap(h: Harness, surface: Surface, label: string): Promise<GuestTurnSuccess> {
  return successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(surface)), label);
}

/** Drives a fresh thread to the payment-ready card (accepted offer), with no contact saved by the payment step. */
async function reachPaymentReady(h: Harness): Promise<Surface> {
  const search = successOf(await h.f.app.handleTurn(h.threadId, STAY_TEXT), "search");
  const detail = await tap(h, search.surfaces[0]!, "View");
  const draft = await tap(h, detail.surfaces[0]!, "Request to Book");
  const phoneAsk = await tap(h, draft.surfaces[0]!, "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
  const saved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "Save phone number");
  const sent = await tap(h, saved.surfaces[0]!, "Send booking request");
  const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
  h.f.environment.simulateOperatorAcceptance(requestId);
  const offer = coldApp(h).getState(h.threadId);
  assert.ok(offer, "the conversation is readable after acceptance");
  const payment = await tap(h, offer.surfaces[0]!, "Accept offer");
  assert.match(payment.surfaces[0]!.summary ?? "", /payment/i, "accepting the offer opens payment");
  return payment.surfaces[0]!;
}

/** The offer id a payment surface carries (its checkout route or its card artifact id). */
function offerIdOf(surface: Surface): string {
  const json = JSON.stringify(surface);
  const match = /payments\/offers\/([^/"\\]+)/.exec(json) ?? /card-payment:([A-Za-z0-9_-]+)/.exec(json);
  if (!match) throw new Error("the payment surface names no offer");
  return decodeURIComponent(match[1]!);
}

/** Removes the guest's saved email, as a guest with no email (the staging guest before checkout) is in the store. */
function clearEmail(h: Harness): void {
  h.f.environment.database.exec("UPDATE guest_contacts SET contact_email = NULL");
}

function clearPhone(h: Harness): void {
  h.f.environment.database.exec("UPDATE guest_contacts SET phone_number = NULL");
}

test("Start checkout with no email opens the email prompt, not ACTION_NOT_AUTHORIZED", async () => {
  const h = harness("g-d1b0000401");
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    const result = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    assert.match(result.surfaces[0]!.surfaceId, /:contact:email:/, "checkout asks for the contact email");
  } finally { h.f.close(); }
});

test("saving the email resumes to the payment-ready card after a cold restore", async () => {
  const h = harness("g-d1b0000402");
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    const ask = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    const emailAsk = firstButtonAction(ask.surfaces[0]!);
    const saved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "Save email");
    assert.match(saved.surfaces[0]!.surfaceId, /:payment:checkout:/, "the email save resumes to the payment-ready card");
    assert.match(saved.surfaces[0]!.conventionalRoute ?? "", /^\/payments\/offers\/[^/]+$/, "the resumed card links to the offer's payment page");
  } finally { h.f.close(); }
});

test("Start checkout with no phone opens the phone prompt, and saving it resumes to the payment-ready card", async () => {
  const h = harness("g-d1b0000403");
  try {
    const payment = await reachPaymentReady(h);
    clearPhone(h);
    const ask = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    assert.match(ask.surfaces[0]!.surfaceId, /:contact:phone:/, "checkout asks for the phone number first");
    const phoneAsk = firstButtonAction(ask.surfaces[0]!);
    const saved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...phoneAsk, context: { ...phoneAsk.context, contactValue: PHONE } }), "Save phone number");
    // The staging guest has no email either, so the phone save resumes the payment into the email prompt (not the booking draft).
    assert.match(saved.surfaces[0]!.surfaceId, /:contact:email:/, "the phone save resumes the payment, which then asks for the email");
    const emailAsk = firstButtonAction(saved.surfaces[0]!);
    const emailSaved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "Save email");
    assert.match(emailSaved.surfaces[0]!.surfaceId, /:payment:checkout:/, "the email save resumes to the payment-ready card");
  } finally { h.f.close(); }
});

test("a forged payment surface id fails closed after a cold restore", async () => {
  const h = harness("g-d1b0000404");
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    const action = firstButtonAction(payment);
    const forged = await coldApp(h).handleEventAsync(h.threadId, { ...action, surfaceId: `thread-${h.threadId}:payment:checkout:forged` });
    assert.equal(forged.ok, false);
    assert.equal(forged.ok ? "" : forged.code, "STALE_SURFACE");
  } finally { h.f.close(); }
});

test("an offer that is no longer accepted gets no contact prompt and fails closed", async () => {
  const h = harness("g-d1b0000405");
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    const offerId = offerIdOf(payment);
    getConditionalOfferManager(h.f.environment.conditionalOfferApp).getOffer(offerId).status = "revoked";
    const result = await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "" : result.code, "ACTION_NOT_AUTHORIZED");
    assert.doesNotMatch(JSON.stringify(result), /:contact:/, "no contact prompt for an offer that is not accepted");
  } finally { h.f.close(); }
});

test("an expired payment window gets no contact prompt and fails closed", async () => {
  const h = harness("g-d1b0000406");
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    h.clock.now = new Date(START_MS + 24 * 60 * 60 * 1000);
    const result = await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment));
    assert.equal(result.ok, false);
    assert.ok(["ACTION_NOT_AUTHORIZED", "STALE_SURFACE"].includes(result.ok ? "" : result.code), "a closed rejection");
    assert.doesNotMatch(JSON.stringify(result), /:contact:/, "no contact prompt for an expired window");
  } finally { h.f.close(); }
});

test("a Paystack start failure is a closed, safe failure and the attempt state stays consistent", async () => {
  const rejecting = async () => ({ status: 400, json: async () => ({ status: false, message: "synthetic rejection" }) });
  const h = harness("g-d1b0000407", rejecting);
  try {
    const payment = await reachPaymentReady(h);
    h.f.environment.guestContactApp.submitEmail({ contactEmail: EMAIL }, h.f.environment.guestPrincipal());
    const result = await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "" : result.code, "ACTION_NOT_AUTHORIZED");
    assert.equal(result.ok ? "" : result.message, "The secure card checkout could not be started.");
    assert.equal(result.ok ? "" : /synthetic rejection|sk_test/.test(JSON.stringify(result)), false, "no provider text reaches the guest");
  } finally { h.f.close(); }
});
/** Paystack initialize calls the fake received, with the reference each one sent. */
function initializeReferences(requests: readonly { url: string; body?: string }[]): string[] {
  return requests
    .filter((request) => request.url.endsWith("/transaction/initialize"))
    .map((request) => (JSON.parse(request.body ?? "{}") as { reference?: string }).reference ?? "");
}

test("resuming the payment link after a true cold restore returns the approved hosted checkout with one Paystack initialization", async () => {
  const fake = createPaystackHttpFake();
  const h = harness("g-d1b0000408", fake.fetcher);
  try {
    const payment = await reachPaymentReady(h);
    clearEmail(h);
    const ask = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    const emailAsk = firstButtonAction(ask.surfaces[0]!);
    const saved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "Save email");
    assert.match(saved.surfaces[0]!.surfaceId, /:payment:checkout:/, "the chat reports the checkout ready");
    const offerId = offerIdOf(saved.surfaces[0]!);
    const before = initializeReferences(fake.requests).length;

    // The guest's click on the payment link lands on a fresh process (ADR 0106 cold restore): a new environment over the same file.
    const restarted = trueRestartedDatedApp(h.f, scriptedPlanner({}).client);
    try {
      const environment = restarted.environment;
      const resumed = await environment.cardPaymentApp.initializePaystackCheckout(offerId, environment.guestPrincipal(), environment.payments);
      assert.match(resumed.checkoutUrl, /^https:\/\/checkout\.paystack\.com\//, "the resumed checkout is the approved hosted page");
      const references = initializeReferences(fake.requests).slice(before);
      assert.deepEqual(references, [resumed.pspReference], "the resume initializes exactly one Paystack transaction, for the session's own reference");
    } finally {
      restarted.close();
    }
  } finally { h.f.close(); }
});
