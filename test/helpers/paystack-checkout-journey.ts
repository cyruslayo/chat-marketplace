import assert from "node:assert/strict";
import { DirectPaystackClient } from "../../packages/platform-core/src/payments/index.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../../apps/local-guest/src/shortlet-app.js";
import type { PaystackHttpFetcher } from "../../packages/platform-core/src/payments/index.js";
import { createPaystackHttpFake, type PaystackFakeRequest } from "./paystack-http.js";
import { datedFixture, firstButtonAction, restartedDatedApp, scriptedPlanner, trueRestartedDatedApp, type DatedFixture } from "./guest-date-fixtures.js";

// Shared journey for the Paystack card start on the staging-like guest (ADR 0106): the Paystack payments module WIRED, the
// assistant runtime enabled, a cold restore before every event, no phone and no email, on the 27 Oct 2026 clock.

export const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
export const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
export const PHONE = "+234 801 234 5678";
export const EMAIL = "guest@example.com";
export const SCRIPT = {
  [STAY_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: STAY_SEARCH },
};
export const PAYSTACK_CONFIG = { secretKey: "sk_test_synthetic_fixture", environment: "test" as const, callbackBaseUrl: "https://demo.example.test" };
export const START_MS = Date.parse("2026-10-27T10:00:00Z");

export interface Surface { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }

export function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export interface Harness {
  readonly f: DatedFixture;
  readonly clock: { now: Date };
  readonly threadId: string;
}

export function harness(threadId: string, paystackFetcher = createPaystackHttpFake().fetcher): Harness {
  const clock = { now: new Date(START_MS) };
  const payments = new DirectPaystackClient(PAYSTACK_CONFIG, paystackFetcher);
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: () => clock.now, stagingGuest: true, paystackClient: payments });
  return { f, clock, threadId };
}

/** A new application over the same store, loaded as the browser's page load does, before the event is sent. */
export function coldApp(h: Harness) {
  const restored = restartedDatedApp(h.f, scriptedPlanner({}).client);
  restored.app.getState(h.threadId);
  return restored.app;
}

export async function tap(h: Harness, surface: Surface, label: string): Promise<GuestTurnSuccess> {
  return successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(surface)), label);
}

/** Drives a fresh thread to the payment-ready card (accepted offer), with no contact saved by the payment step. */
export async function reachPaymentReady(h: Harness): Promise<Surface> {
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
export function offerIdOf(surface: Surface): string {
  const json = JSON.stringify(surface);
  const match = /payments\/offers\/([^/"\\]+)/.exec(json) ?? /card-payment:([A-Za-z0-9_-]+)/.exec(json);
  if (!match) throw new Error("the payment surface names no offer");
  return decodeURIComponent(match[1]!);
}

/** Removes the guest's saved email, as a guest with no email (the staging guest before checkout) is in the store. */
export function clearEmail(h: Harness): void {
  h.f.environment.database.exec("UPDATE guest_contacts SET contact_email = NULL");
}

export function clearPhone(h: Harness): void {
  h.f.environment.database.exec("UPDATE guest_contacts SET phone_number = NULL");
}

/** Paystack initialize calls the fake received, with the reference each one sent. */
export function initializeReferences(requests: readonly Pick<PaystackFakeRequest, "url" | "body">[]): string[] {
  return requests
    .filter((request) => request.url.endsWith("/transaction/initialize"))
    .map((request) => (JSON.parse(request.body ?? "{}") as { reference?: string }).reference ?? "");
}

/** The handoff text both paths show (issue 65, one message on both paths). */
export const CHECKOUT_MESSAGE = "Hosted card checkout is ready. Payment has not succeeded; your booking details remain available when you return.";

/** The email-just-saved path (issue 65): Start checkout asks for the email first, and saving it returns the handoff. */
export async function handoffAfterEmailSave(h: Harness) {
  const payment = await reachPaymentReady(h);
  clearEmail(h);
  const ask = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
  assert.match(ask.surfaces[0]!.surfaceId, /:contact:email:/, "Start checkout asks for the email first");
  const emailAsk = firstButtonAction(ask.surfaces[0]!);
  const saved = successOf(await coldApp(h).handleEventAsync(h.threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "Save email");
  assert.match(saved.surfaces[0]!.surfaceId, /:payment:checkout:/, "the email save returns the payment handoff");
  return { offerId: offerIdOf(saved.surfaces[0]!), handoff: saved.surfaces[0]!, result: saved };
}

/** The direct path (issue 65): the guest already has an email on file, so Start checkout returns the handoff in one step. */
export async function handoffWithEmailOnFile(h: Harness) {
  const payment = await reachPaymentReady(h);
  h.f.environment.guestContactApp.submitEmail({ contactEmail: EMAIL }, h.f.environment.guestPrincipal());
  const direct = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout with the email on file");
  assert.match(direct.surfaces[0]!.surfaceId, /:payment:checkout:/, "the direct path returns the payment handoff");
  return { offerId: offerIdOf(direct.surfaces[0]!), handoff: direct.surfaces[0]!, result: direct };
}

/** A Paystack fake whose initialize can be switched between refusing and accepting, recording every reference attempted. */
export function switchableFetcher(fake: ReturnType<typeof createPaystackHttpFake>) {
  const attempts: string[] = [];
  const state = { accepting: false };
  const fetcher: PaystackHttpFetcher = async (url, init) => {
    attempts.push(...initializeReferences([{ url, ...(init.body === undefined ? {} : { body: init.body }) }]));
    if (!state.accepting) return { status: 400, json: async () => ({ status: false, message: "synthetic rejection" }) };
    return fake.fetcher(url, init);
  };
  return { fetcher, attempts, state };
}

/** Sets the staging guest's payment email, then starts the card checkout with the switchable provider refusing. */
export async function startRefusedCheckout(h: Harness, switchable: ReturnType<typeof switchableFetcher>) {
  const payment = await reachPaymentReady(h);
  clearEmail(h);
  h.f.environment.guestContactApp.submitEmail({ contactEmail: EMAIL }, h.f.environment.guestPrincipal());
  const refused = await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment));
  assert.equal(refused.ok, false, "the first start is refused by the provider");
  assert.equal(switchable.attempts.length, 1, "the first start made one Paystack initialization");
  return { payment, offerId: offerIdOf(payment) };
}
