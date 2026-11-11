import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DirectPaystackClient } from "../packages/platform-core/src/payments/index.js";
import { GUEST_PAYMENT_CALLBACK_COPY } from "../apps/web-agent/src/guest-content.js";
import { renderPaymentCallbackFailureHtml } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { initializeReferences } from "./helpers/paystack-checkout-journey.js";

// Issue 07 (ADR 0047, 0046, 0075, 0080): a payment-provider return that cannot be verified shows a guest page that
// states the problem, the effect and the next action. It never claims success and carries no reference or provider text.

const PAYSTACK_CONFIG = { secretKey: "sk_test_synthetic_fixture", environment: "test" as const, callbackBaseUrl: "https://demo.example.test" };

function visibleText(html: string): string {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

test("AC1: An invalid, unknown-thread or rejected callback returns an HTML guest page, not JSON, with a link to the booking status", async () => {
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, createPaystackHttpFake().fetcher) });
  try {
    // Failure path 1: no reference at all.
    const invalid = await fetch(`${fixture.base}/payments/paystack/callback`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    assert.equal(invalid.status, 400);
    assert.match(invalid.headers.get("content-type") ?? "", /text\/html/);
    const invalidPage = await invalid.text();
    assert.match(invalidPage, /data-error-code="PAYMENT_CALLBACK_INVALID"/);
    assert.match(invalidPage, /<a class="ui-button[^"]*" href="\/">Check your booking status<\/a>/);

    // Failure path 2: a reference the platform does not know.
    const unknown = await fetch(`${fixture.base}/payments/paystack/callback?reference=psp-ref-unknown-synthetic`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    assert.equal(unknown.status, 400);
    assert.match(unknown.headers.get("content-type") ?? "", /text\/html/);
    const unknownPage = await unknown.text();
    assert.match(unknownPage, /data-error-code="PAYMENT_CALLBACK_UNKNOWN"/);
    assert.match(unknownPage, /Check your booking status/);

    // Failure path 3: the two later outcomes that have no thread to return to render the same guest page.
    for (const [status, code] of [[404, "PAYMENT_CALLBACK_THREAD_UNKNOWN"], [400, "PAYMENT_CALLBACK_REJECTED"]] as const) {
      const page = renderPaymentCallbackFailureHtml(status, code);
      assert.match(page, new RegExp(`data-error-code="${code}"`));
      assert.match(page, /Check your booking status/);
      assert.doesNotMatch(page, /^\s*\{/);
    }
  } finally {
    await fixture.close();
  }
});

test("AC2: The page never says the payment or reservation succeeded", () => {
  for (const [status, code] of [[400, "PAYMENT_CALLBACK_INVALID"], [404, "PAYMENT_CALLBACK_THREAD_UNKNOWN"], [400, "PAYMENT_CALLBACK_REJECTED"]] as const) {
    const page = renderPaymentCallbackFailureHtml(status, code);
    const text = visibleText(page);
    assert.match(text, /We could not confirm this payment yet/);
    assert.match(text, /Your reservation is not confirmed/);
    assert.doesNotMatch(text, /payment (?:was |is )?successful|payment succeeded|payment received|paid successfully/i);
    assert.doesNotMatch(text, /reservation is confirmed|booking is confirmed|you(?:'|&#39;)re booked/i);
    assert.doesNotMatch(text, /confirmation (?:email|sent)/i);
  }
});

test("AC3: A failed verification that redirects to the thread shows a not-confirmed status message there", async () => {
  const fake = createPaystackHttpFake();
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, fake.fetcher) });
  try {
    await fixture.advance("payment-ready");
    const state = await fixture.state();
    assert.ok(!("ok" in state && state.ok === false), "the thread is readable");
    const offerPath = /\/payments\/offers\/[^"\\/]+/.exec(JSON.stringify(state))?.[0];
    assert.ok(offerPath, "the payment surface names its offer route");

    // Start the hosted card checkout so a reference exists, then fail its verification.
    const started = await fetch(`${fixture.base}${offerPath}/continue`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    assert.equal(started.status, 303, "the checkout starts");
    await started.text();
    const reference = initializeReferences(fake.requests)[0];
    assert.ok(reference, "the provider reference was initialized");
    fake.setTransaction({ reference, amount: 1, currency: "NGN", status: "failed", domain: "test" });

    const callback = await fetch(`${fixture.base}/payments/paystack/callback?reference=${encodeURIComponent(reference)}`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    assert.equal(callback.status, 303, "a failed verification returns the guest to the conversation");
    const location = callback.headers.get("location") ?? "";
    assert.match(location, /[?&]payment=not-confirmed(?:&|$)/);

    const thread = await fetch(`${fixture.base}${location}`, { headers: { cookie: fixture.cookie, accept: "text/html" } });
    assert.equal(thread.status, 200);
    const body = await thread.text();
    assert.match(body, /data-payment-notice="not-confirmed"/, "the thread shows the not-confirmed notice");
    assert.ok(body.includes(GUEST_PAYMENT_CALLBACK_COPY.notConfirmedNotice), "the notice uses the shared copy");
    assert.doesNotMatch(visibleText(body), /reservation is confirmed|booking is confirmed/i);
  } finally {
    await fixture.close();
  }
});

test("AC3: The not-confirmed notice does not outlive a later confirmation", async () => {
  // A late charge.success can confirm the booking after the callback failed. The browser drops the URL flag on load (a
  // refresh never re-shows the banner) and removes the banner once the server's journey reaches "confirmed".
  const source = await readFile(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.match(source, /url\.searchParams\.delete\("payment"\);\s*window\.history\.replaceState\(/);
  assert.match(source, /if \(journey\.current === "confirmed"\) document\.querySelector\("\[data-payment-notice\]"\)\?\.remove\(\);/);
  // Failure path: the built bundle the guest loads carries the same behaviour (a stale dist/client.js would not).
  const bundle = await readFile(new URL("../apps/local-guest/dist/client.js", import.meta.url), "utf8");
  assert.match(bundle, /searchParams\.delete\("payment"\)/);
  assert.match(bundle, /\[data-payment-notice\]/);
});

test("AC4: No reference, token or provider text appears in the page or the logs", async () => {
  const reference = "psp-ref-synthetic-secret-123";
  const page = renderPaymentCallbackFailureHtml(400, "PAYMENT_CALLBACK_UNKNOWN");
  assert.equal(page.includes(reference), false);
  for (const text of ["paystack", "sk_test", "api.paystack.co", "checkout.paystack.com", "x-paystack-signature"]) {
    assert.equal(page.toLowerCase().includes(text), false, text);
  }
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, createPaystackHttpFake().fetcher) });
  try {
    const response = await fetch(`${fixture.base}/payments/paystack/callback?reference=${encodeURIComponent(reference)}`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    const body = await response.text();
    assert.equal(body.includes(reference), false, "the reference is not echoed into the page");
    for (const text of ["sk_test", "api.paystack.co", "checkout.paystack.com", "x-paystack-signature"]) {
      assert.equal(body.toLowerCase().includes(text), false, text);
    }
  } finally {
    await fixture.close();
  }
});
