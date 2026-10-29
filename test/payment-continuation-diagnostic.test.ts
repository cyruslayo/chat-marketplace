import assert from "node:assert/strict";
import test from "node:test";
import { DirectPaystackClient } from "../packages/platform-core/src/payments/index.js";
import { restartFixture } from "./helpers/guest-restart.js";
import type { PaymentContinuationRejectedEvent } from "../apps/local-guest/src/guest-server.js";

// The payment continuation (/payments/offers/:id/continue) keeps one generic guest page, and the host sees a closed
// reason only (ADR 0075): no offer id, URL, reference, contact or provider text.

const PAYSTACK_CONFIG = { secretKey: "sk_test_synthetic_fixture", environment: "test" as const, callbackBaseUrl: "https://demo.example.test" };

test("A rejected payment continuation reports a closed reason and no identifiers or provider text", async () => {
  const events: PaymentContinuationRejectedEvent[] = [];
  const rejecting = async () => ({ status: 400, json: async () => ({ status: false, message: "synthetic provider rejection" }) });
  const fixture = await restartFixture({}, {
    paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, rejecting),
    onPaymentContinuationRejected: (event) => events.push(event),
  });
  try {
    await fixture.advance("payment-ready");
    const state = await fixture.state();
    assert.ok(!("ok" in state && state.ok === false), "the thread is readable");
    const offerPath = /\/payments\/offers\/[^"\\/]+/.exec(JSON.stringify(state))?.[0];
    assert.ok(offerPath, "the payment surface names its offer route");

    const response = await fetch(`${fixture.base}${offerPath}/continue`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    const body = await response.text();

    assert.equal(response.status, 400, "the guest sees the generic continuation failure");
    assert.match(body, /Payment can(?:&#39;|')t continue right now/, "the generic page is unchanged");
    assert.deepEqual(events, [{ code: "PAYMENT_CONTINUATION_REJECTED", reason: "provider_start_failed" }], "one closed reason for the rejection");
    const observed = JSON.stringify(events);
    assert.doesNotMatch(observed, /offer-|synthetic|https?:|psp_ref|sk_test/, "the reason carries no ids, URLs, references or provider text");
  } finally {
    await fixture.close();
  }
});
