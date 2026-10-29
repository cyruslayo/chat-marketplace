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
    assert.deepEqual(events, [{ code: "PAYMENT_CONTINUATION_REJECTED", reason: "provider_start_failed", statusClass: "invalid_request" }], "one closed reason and its closed status class for the rejection");
    const observed = JSON.stringify(events);
    assert.doesNotMatch(observed, /offer-|synthetic|https?:|psp_ref|psp-ref|sk_test/, "the reason carries no ids, URLs, references or provider text");
  } finally {
    await fixture.close();
  }
});

// ADR 0075: a provider rejection on the continuation adds only the closed HTTP-status class to the closed reason.
const CONTINUATION_STATUS_CASES = [
  [429, "rate_limited"],
  [200, "unsuccessful_body"],
] as const;

for (const [status, statusClass] of CONTINUATION_STATUS_CASES) {
  test(`A continuation rejected with HTTP ${status} reports provider_start_failed with the closed class ${statusClass} and no provider text`, async () => {
    const events: PaymentContinuationRejectedEvent[] = [];
    const providerText = async () => ({ status: status, json: async () => ({ status: false, message: "synthetic provider text https://api.paystack.co psp-ref-synthetic guest@example.test" }) });
    const fixture = await restartFixture({}, {
      paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, providerText),
      onPaymentContinuationRejected: (event) => events.push(event),
    });
    try {
      await fixture.advance("payment-ready");
      const offerPath = /\/payments\/offers\/[^"\\/]+/.exec(JSON.stringify(await fixture.state()))?.[0];
      assert.ok(offerPath, "the payment surface names its offer route");
      const response = await fetch(`${fixture.base}${offerPath}/continue`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
      await response.text();

      assert.equal(response.status, 400, "the guest sees the generic continuation failure");
      assert.deepEqual(events, [{ code: "PAYMENT_CONTINUATION_REJECTED", reason: "provider_start_failed", statusClass }], "one closed reason and one closed status class");
      assert.doesNotMatch(JSON.stringify(events), /offer-|synthetic|https?:|psp-ref|guest@|sk_test|api\.paystack/i, "the event carries no provider text");
    } finally {
      await fixture.close();
    }
  });
}
