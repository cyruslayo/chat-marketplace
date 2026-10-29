import assert from "node:assert/strict";
import test from "node:test";
import { DirectPaystackClient, PaystackProviderFailure, type PaystackHttpFetcher } from "../packages/platform-core/src/payments/index.js";
import { CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT } from "../apps/web/src/card-payment-actions.js";
import { cardCheckoutFailureReason, type CardCheckoutFailedEvent, type CardCheckoutFailureReason } from "../apps/local-guest/src/shortlet-app.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

// The chat card start (#handlePaystackCardCheckout) keeps one generic guest message. The host sees a closed reason only
// (ADR 0075): no offer id, URL, reference, contact, key or provider text. Each reason below is reached offline with a fake
// Paystack client, or with the domain's fixed message, and the guest-visible result stays the same.

const GUEST_MESSAGE = "The secure card checkout could not be started.";
const PAYSTACK_CONFIG = { secretKey: "sk_test_synthetic_fixture", environment: "test" as const, callbackBaseUrl: "https://demo.example.test" };
const FORBIDDEN = /synthetic|https?:|psp_ref|psp-ref|sk_test|evil|@|\+234|chk_|offer-/;

interface Outcome {
  readonly result: { readonly ok: boolean; readonly code?: string; readonly message?: string };
  readonly events: readonly CardCheckoutFailedEvent[];
}

/** Drives a fresh guest to the payment-ready card and sends its checkout action through the chat path. */
async function startChatCheckout(paystackClient: DirectPaystackClient | undefined, options: { readonly afterReady?: (fixture: Awaited<ReturnType<typeof restartFixture>>) => void } = {}): Promise<Outcome> {
  const events: CardCheckoutFailedEvent[] = [];
  const fixture = await restartFixture(paystackClient === undefined ? {} : { paystackClient }, { onCardCheckoutFailed: (event: CardCheckoutFailedEvent) => events.push(event) });
  try {
    const ready = await fixture.advance("payment-ready");
    options.afterReady?.(fixture);
    const action = guestAction(ready.surfaces[0]!, CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT);
    const result = await fixture.send("/api/event", action);
    return { result: result as Outcome["result"], events };
  } finally {
    await fixture.close();
  }
}

function clientWith(fetcher: PaystackHttpFetcher): DirectPaystackClient {
  return new DirectPaystackClient(PAYSTACK_CONFIG, fetcher);
}

function assertOneClosedReason(outcome: Outcome, reason: CardCheckoutFailureReason): void {
  assert.equal(outcome.result.ok, false, "the guest sees a failure");
  assert.equal(outcome.result.code, "ACTION_NOT_AUTHORIZED", "the guest-visible code is unchanged");
  assert.equal(outcome.result.message, GUEST_MESSAGE, "the guest-visible message is unchanged");
  assert.deepEqual(outcome.events, [{ code: "CARD_CHECKOUT_FAILED", reason }], "one closed reason for the failure");
  assert.doesNotMatch(JSON.stringify(outcome.events), FORBIDDEN, "the reason carries no ids, URLs, references, contacts, keys or provider text");
}

test("a Paystack rejection of the initialize call is reported as provider_rejected", async () => {
  const rejecting: PaystackHttpFetcher = async () => ({ status: 400, json: async () => ({ status: false, message: "synthetic provider rejection" }) });
  assertOneClosedReason(await startChatCheckout(clientWith(rejecting)), "provider_rejected");
});

test("a Paystack request that cannot be sent is reported as provider_unreachable", async () => {
  const unreachable: PaystackHttpFetcher = async () => {
    throw new TypeError("fetch failed");
  };
  assertOneClosedReason(await startChatCheckout(clientWith(unreachable)), "provider_unreachable");
});

test("a Paystack response that is not JSON is reported as provider_response_invalid", async () => {
  const notJson: PaystackHttpFetcher = async () => ({ status: 200, json: async () => { throw new SyntaxError("Unexpected token < in JSON"); } });
  assertOneClosedReason(await startChatCheckout(clientWith(notJson)), "provider_response_invalid");
});

test("a Paystack checkout URL outside the approved host is reported as checkout_url_rejected", async () => {
  const foreignHost: PaystackHttpFetcher = async (_url, init) => ({
    status: 200,
    json: async () => ({ status: true, data: { authorization_url: "https://evil.example.test/pay", reference: (JSON.parse(init.body ?? "{}") as { reference: string }).reference } }),
  });
  assertOneClosedReason(await startChatCheckout(clientWith(foreignHost)), "checkout_url_rejected");
});

test("a Paystack reference that differs from the one sent is reported as reference_conflict", async () => {
  const otherReference: PaystackHttpFetcher = async () => ({
    status: 200,
    json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/synthetic-code", reference: "other-reference" } }),
  });
  assertOneClosedReason(await startChatCheckout(clientWith(otherReference)), "reference_conflict");
});

test("a chat checkout with no Paystack module keeps the local development path and reports nothing", async () => {
  // Without a configured Paystack client the environment uses its deterministic local PSP (development only). That path
  // succeeds, so it is not a failure and must not produce a diagnostic line.
  const outcome = await startChatCheckout(undefined);
  assert.equal(outcome.result.ok, true, "the local development checkout still starts");
  assert.deepEqual(outcome.events, [], "no failure is reported for the local path");
});

test("a checkout whose payment window has closed is reported as action_rejected before any Paystack call", async () => {
  let calls = 0;
  const counting: PaystackHttpFetcher = async () => {
    calls += 1;
    return { status: 200, json: async () => ({ status: true, data: {} }) };
  };
  const outcome = await startChatCheckout(clientWith(counting), { afterReady: (fixture) => fixture.setTime("2026-10-27T10:00:00Z") });
  assert.equal(outcome.result.ok, false, "the guest sees a failure");
  assert.deepEqual(outcome.events, [{ code: "CARD_CHECKOUT_FAILED", reason: "action_rejected" }], "the gate rejection is reported");
  assert.equal(calls, 0, "no Paystack call is made");
});

test("a successful chat checkout reports nothing", async () => {
  const outcome = await startChatCheckout(clientWith(createPaystackHttpFake().fetcher));
  assert.equal(outcome.result.ok, true, "the guest sees the hosted checkout");
  assert.deepEqual(outcome.events, [], "no failure is reported");
});

test("cardCheckoutFailureReason maps each fixed domain message and a provider failure to its closed reason", () => {
  const cases: readonly [unknown, CardCheckoutFailureReason][] = [
    [new Error("Checkout initialization requires an accepted offer (current status: 'revoked')"), "offer_not_payable"],
    [new Error("Payment window has expired; cannot initialize checkout"), "offer_not_payable"],
    [new Error("Unit is no longer eligible through checkout"), "offer_not_payable"],
    [new Error("Only the authoritative payer can initialize checkout"), "payer_not_authorized"],
    [new Error("Cross-tenant offer access denied"), "payer_not_authorized"],
    [new Error("Paystack checkout is not configured"), "provider_not_configured"],
    [new Error("Paystack initialization returned a non-card checkout"), "provider_response_invalid"],
    [new PaystackProviderFailure("provider_unreachable", "Paystack initialization request could not be sent"), "provider_unreachable"],
    [new PaystackProviderFailure("reference_conflict", "Paystack initialization returned a different reference"), "reference_conflict"],
    [new Error("an unrecognised message with synthetic detail"), "unclassified"],
    ["not an error object", "unclassified"],
  ];
  for (const [error, reason] of cases) assert.equal(cardCheckoutFailureReason(error), reason);
});
