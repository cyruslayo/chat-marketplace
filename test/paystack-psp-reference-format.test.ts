import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { mintCardPspReference, PLATFORM_PSP_REFERENCE_PATTERN } from "../domains/shortlet/src/index.js";
import { DirectPaystackClient, PaystackProviderFailure, type PaystackHttpFetcher } from "../packages/platform-core/src/payments/index.js";
import { DEFAULT_PAYER_METADATA_KEY } from "../packages/platform-core/src/payments/paystack.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { firstButtonAction, scriptedPlanner, trueRestartedDatedApp } from "./helpers/guest-date-fixtures.js";
import { PAYSTACK_CONFIG, clearEmail, coldApp, harness, initializeReferences, offerIdOf, reachPaymentReady, successOf, type Harness } from "./helpers/paystack-checkout-journey.js";

// ADR 0049 and 0046: the Paystack transaction reference rule. Paystack accepts only letters, digits, "-", "." and "=".
// A reference with an underscore is refused by the provider, and a rejected initialize reuses the same reference on each
// retry, so the platform mints a conforming reference and never sends a non-conforming one out of the process.

const CONFORMING = /^[A-Za-z0-9-]+$/;
const PROVIDER_ACCEPTED = /^[A-Za-z0-9.=-]+$/;
/** The reference format the platform minted before the fix: underscores and a command id slice. */
const LEGACY_REFERENCE = "psp_ref_6f1c2d3e_1793000000000";

function rejectingFetcher(counter: { calls: number }): PaystackHttpFetcher {
  return async () => {
    counter.calls += 1;
    return { status: 400, json: async () => ({ status: false, message: "synthetic rejection" }) };
  };
}

test("a minted checkout reference matches the Paystack-safe platform format", () => {
  for (const commandId of ["cmd-6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "cmd_under_score_1", "cmd.dot=equals"]) {
    const reference = mintCardPspReference(commandId, new Date("2026-10-27T10:00:00Z"));
    assert.match(reference, /^[A-Za-z0-9-]+$/, `reference for ${commandId} uses only letters, digits and hyphen`);
    assert.match(reference, PLATFORM_PSP_REFERENCE_PATTERN, "the exported pattern accepts the minted reference");
    assert.match(reference, /^psp-ref-/, "the reference keeps the platform prefix");
  }
});

test("minting is deterministic for one command and clock and unique per clock instant", () => {
  const first = mintCardPspReference("cmd-6f1c2d3e-4a5b", new Date("2026-10-27T10:00:00Z"));
  assert.equal(mintCardPspReference("cmd-6f1c2d3e-4a5b", new Date("2026-10-27T10:00:00Z")), first, "the same command and instant mint the same reference");
  assert.notEqual(mintCardPspReference("cmd-6f1c2d3e-4a5b", new Date("2026-10-27T10:00:01Z")), first, "a later attempt mints a different reference");
});

test("a command id with no letters or digits is refused rather than minted into a reference", () => {
  assert.throws(() => mintCardPspReference("___", new Date("2026-10-27T10:00:00Z")), /letters or digits/);
});

test("the Paystack initialize boundary refuses a non-conforming reference with the closed reason and makes no provider call", async () => {
  for (const reference of ["psp_ref_6f1c2d3e_1", "psp ref", "psp/ref", "psp%ref", "psp:ref"]) {
    const counter = { calls: 0 };
    const client = new DirectPaystackClient(PAYSTACK_CONFIG, rejectingFetcher(counter));
    await assert.rejects(
      () => client.initializeTransaction({ email: "guest@example.com", amountKobo: 1000, currency: "NGN", reference, callbackUrl: "https://demo.example.test/payments/paystack/callback" }),
      (error: unknown) => error instanceof PaystackProviderFailure && error.reason === "reference_conflict",
      `reference ${JSON.stringify(reference)} is refused with reference_conflict`,
    );
    assert.equal(counter.calls, 0, `reference ${JSON.stringify(reference)} never reaches the provider`);
  }
});

test("the Paystack initialize boundary accepts every character the provider accepts", async () => {
  const fake = createPaystackHttpFake();
  const client = new DirectPaystackClient(PAYSTACK_CONFIG, fake.fetcher);
  const accepted = await client.initializeTransaction({ email: "guest@example.com", amountKobo: 1000, currency: "NGN", reference: "psp-ref.1=abc", callbackUrl: "https://demo.example.test/payments/paystack/callback" });
  assert.equal(accepted.reference, "psp-ref.1=abc");
  assert.match("psp-ref.1=abc", PROVIDER_ACCEPTED);
  assert.equal(fake.requests.length, 1, "a provider-accepted reference is sent once");
});

test("the chat card start initializes Paystack with a conforming reference only", async () => {
  const fake = createPaystackHttpFake();
  const h = harness("g-d1b0000501", fake.fetcher);
  try {
    const payment = await reachPaymentReady(h);
    h.f.environment.guestContactApp.submitEmail({ contactEmail: "guest@example.com" }, h.f.environment.guestPrincipal());
    const started = successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    assert.match(started.surfaces[0]!.surfaceId, /:payment:checkout:/, "the card is ready");
    const references = initializeReferences(fake.requests);
    assert.equal(references.length, 1, "one Paystack initialization");
    assert.match(references[0]!, CONFORMING, "the reference sent to Paystack is conforming");
  } finally { h.f.close(); }
});

/** A Paystack fake whose initialize can be switched between refusing and accepting, recording every reference attempted. */
function switchableFetcher(fake: ReturnType<typeof createPaystackHttpFake>) {
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
async function startRefusedCheckout(h: Harness, switchable: ReturnType<typeof switchableFetcher>) {
  const payment = await reachPaymentReady(h);
  clearEmail(h);
  h.f.environment.guestContactApp.submitEmail({ contactEmail: "guest@example.com" }, h.f.environment.guestPrincipal());
  const refused = await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment));
  assert.equal(refused.ok, false, "the first start is refused by the provider");
  assert.equal(switchable.attempts.length, 1, "the first start made one Paystack initialization");
  return { payment, offerId: offerIdOf(payment) };
}

test("a stuck initiated attempt with a legacy underscore reference gets a conforming reference on retry after a true cold restore", async () => {
  const fake = createPaystackHttpFake();
  const switchable = switchableFetcher(fake);
  const h = harness("g-d1b0000502", switchable.fetcher);
  try {
    const { payment, offerId } = await startRefusedCheckout(h, switchable);
    const stuck = h.f.environment.cardPaymentApp.getCheckoutSession(offerId);
    assert.equal(stuck?.status, "initiated", "the refused attempt stays initiated");
    assert.equal(stuck?.providerEnvironment, undefined, "no provider environment is recorded for it");
    // The row a previous build persisted: the legacy underscore reference, still initiated, never bound to Paystack.
    h.f.environment.database.exec(`UPDATE guest_checkout_sessions SET psp_reference = '${LEGACY_REFERENCE}' WHERE offer_id = '${offerId}'`);

    switchable.state.accepting = true;
    const restarted = trueRestartedDatedApp(h.f, scriptedPlanner({}).client);
    try {
      // The guest's resume of the payment link (ADR 0106 cold restore) starts the same attempt again on the fresh process.
      const environment = restarted.environment;
      const resumed = await environment.cardPaymentApp.initializePaystackCheckout(offerId, environment.guestPrincipal(), environment.payments);
      assert.match(resumed.checkoutUrl, /^https:\/\/checkout\.paystack\.com\//, "the retry reaches the approved hosted checkout");

      const session = restarted.environment.cardPaymentApp.getCheckoutSession(offerId);
      assert.equal(session?.status, "initiated", "the attempt stays the same live attempt");
      assert.equal(session?.checkoutId, stuck?.checkoutId, "the checkout id is kept, not re-minted");
      assert.equal(session?.expiresAt, stuck?.expiresAt, "the payment window is not reset");
      assert.notEqual(session?.pspReference, LEGACY_REFERENCE, "the legacy reference is replaced");
      assert.match(session?.pspReference ?? "", CONFORMING, "the replacement reference is conforming");
      assert.equal(switchable.attempts.at(-1), session?.pspReference, "the retry initialized Paystack with the replacement reference");
      assert.ok(!switchable.attempts.includes(LEGACY_REFERENCE), "the legacy reference is never sent to Paystack");
      assert.equal(fake.requests.filter((request) => request.url.endsWith("/transaction/initialize")).length, 1, "the accepted retry is one Paystack initialization");
    } finally {
      restarted.close();
    }
  } finally { h.f.close(); }
});

/** Marks the offer's session paid through the webhook path, as the provider's charge.success would (ADR 0087). */
async function confirmThroughWebhook(environment: ReturnType<typeof trueRestartedDatedApp>["environment"], reference: string, amountKobo: number, fake: ReturnType<typeof createPaystackHttpFake>) {
  const payerId = environment.guestPrincipal().id;
  fake.setTransaction({ reference, amount: amountKobo, currency: "NGN", status: "success", domain: "test", metadata: { [DEFAULT_PAYER_METADATA_KEY]: payerId } });
  const body = JSON.stringify({ event: "charge.success", data: { reference } });
  const signature = createHmac("sha512", PAYSTACK_CONFIG.secretKey).update(body).digest("hex");
  const payments = environment.payments!;
  const webhook = await payments.handleWebhook({ rawBody: body, signature });
  assert.equal(webhook.kind, "charge", "a signed charge.success is accepted as a charge prompt");
  assert.equal(webhook.kind === "charge" ? webhook.reference : undefined, reference, "the webhook names the reference it carries, exactly");
  const session = environment.cardPaymentApp.getCheckoutSessionByReference(reference);
  assert.ok(session, "the webhook reference reconciles to a checkout session");
  return environment.cardPaymentApp.verifyAndConfirmPaystack(reference, environment.systemPrincipal(), payments);
}

for (const [label, reference] of [["a legacy-format", LEGACY_REFERENCE], ["a new-format", undefined]] as const) {
  test(`a charge.success for ${label} reference reconciles through the Paystack webhook after a true cold restore`, async () => {
    const fake = createPaystackHttpFake();
    const switchable = switchableFetcher(fake);
    switchable.state.accepting = true;
    const h = harness(`g-d1b0000503${label.length}`, switchable.fetcher);
    try {
      const payment = await reachPaymentReady(h);
      h.f.environment.guestContactApp.submitEmail({ contactEmail: "guest@example.com" }, h.f.environment.guestPrincipal());
      successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
      const offerId = offerIdOf(payment);
      if (reference !== undefined) h.f.environment.database.exec(`UPDATE guest_checkout_sessions SET psp_reference = '${reference}' WHERE offer_id = '${offerId}'`);
      const restarted = trueRestartedDatedApp(h.f, scriptedPlanner({}).client);
      try {
        const session = restarted.environment.cardPaymentApp.getCheckoutSession(offerId);
        assert.ok(session, "the session is restored from the store");
        if (reference !== undefined) assert.equal(session.pspReference, reference, "the legacy reference survives the restart");
        const outcome = await confirmThroughWebhook(restarted.environment, session.pspReference, session.amountKobo, fake);
        assert.ok(["confirmed", "deposit_required"].includes(outcome.outcome), `the ${label} reference settles the stay payment`);
        assert.notEqual(restarted.environment.cardPaymentApp.getCheckoutSessionByReference(session.pspReference)?.status, "initiated", "the attempt is no longer initiated");
      } finally {
        restarted.close();
      }
    } finally { h.f.close(); }
  });
}

test("a paid attempt is never re-minted, even when its stored reference is legacy-format", async () => {
  const fake = createPaystackHttpFake();
  const switchable = switchableFetcher(fake);
  switchable.state.accepting = true;
  const h = harness("g-d1b0000504", switchable.fetcher);
  try {
    const payment = await reachPaymentReady(h);
    h.f.environment.guestContactApp.submitEmail({ contactEmail: "guest@example.com" }, h.f.environment.guestPrincipal());
    successOf(await coldApp(h).handleEventAsync(h.threadId, firstButtonAction(payment)), "Start checkout");
    const offerId = offerIdOf(payment);
    const paid = h.f.environment.cardPaymentApp.getCheckoutSession(offerId)!;
    const outcome = await confirmThroughWebhook(h.f.environment, paid.pspReference, paid.amountKobo, fake);
    assert.ok(["confirmed", "deposit_required"].includes(outcome.outcome), "the stay payment settles");

    h.f.environment.database.exec(`UPDATE guest_checkout_sessions SET psp_reference = '${LEGACY_REFERENCE}' WHERE offer_id = '${offerId}'`);
    const paidBefore = h.f.environment.cardPaymentApp.getCheckoutSessionByReference(LEGACY_REFERENCE);
    assert.equal(paidBefore?.status, "completed", "the paid attempt is completed before the restart");
    const restarted = trueRestartedDatedApp(h.f, scriptedPlanner({}).client);
    try {
      const attemptsBefore = switchable.attempts.length;
      // A later payment for the same offer (a deposit, if one is due) may open a new attempt. The paid stay attempt must not move.
      await restarted.environment.cardPaymentApp.initializePaystackCheckout(offerId, restarted.environment.guestPrincipal(), restarted.environment.payments).catch(() => undefined);
      for (const reference of switchable.attempts.slice(attemptsBefore)) {
        assert.match(reference, CONFORMING, "any new attempt uses a conforming reference");
        assert.notEqual(reference, LEGACY_REFERENCE, "the paid attempt reference is never re-sent");
      }
      const after = restarted.environment.cardPaymentApp.getCheckoutSessionByReference(LEGACY_REFERENCE);
      assert.ok(after, "the paid attempt still resolves by its own reference");
      assert.equal(after.checkoutId, paid.checkoutId, "the paid attempt keeps its checkout id");
      assert.equal(after.status, paidBefore?.status, "the paid attempt keeps its status");
      assert.notEqual(after.status, "initiated", "the paid attempt is not live again");
      assert.equal(after.pspReference, LEGACY_REFERENCE, "the paid attempt keeps its reference");
    } finally {
      restarted.close();
    }
  } finally { h.f.close(); }
});
