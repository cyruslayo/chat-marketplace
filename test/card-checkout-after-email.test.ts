import assert from "node:assert/strict";
import test from "node:test";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { firstButtonAction, trueRestartedDatedApp, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { guestPaymentPage, visibleText } from "./helpers/guest-payment-page.js";
import { EMAIL, CHECKOUT_MESSAGE, coldApp, handoffAfterEmailSave, handoffWithEmailOnFile, harness, initializeReferences } from "./helpers/paystack-checkout-journey.js";

// Issue 65: after the guest saves an email for card checkout, the chat hands off exactly as the direct path does (one click to
// /payments/offers/<offerId>/continue, the same label and message). The journey is the staging-like guest of the Paystack
// checkout tests (test/helpers/paystack-checkout-journey.ts): the Paystack module wired, the assistant runtime enabled, a cold
// restore before every event, no phone and no email, on the 27 Oct 2026 clock.

test("After the guest saves an email for card checkout, the handoff surface's continue control is /payments/offers/<offerId>/continue, the same as for a guest with an email on file", async () => {
  const emailPathHarness = harness("g-d1c6500501", createPaystackHttpFake().fetcher);
  const directHarness = harness("g-d1c6500502", createPaystackHttpFake().fetcher);
  try {
    const afterEmail = await handoffAfterEmailSave(emailPathHarness);
    const onFile = await handoffWithEmailOnFile(directHarness);
    assert.equal(afterEmail.handoff.conventionalRoute, `/payments/offers/${encodeURIComponent(afterEmail.offerId)}/continue`, "the email path's continue control goes to /continue");
    assert.equal(onFile.handoff.conventionalRoute, `/payments/offers/${encodeURIComponent(onFile.offerId)}/continue`, "the direct path's continue control goes to /continue");
    assert.match(afterEmail.handoff.conventionalRoute ?? "", /^\/payments\/offers\/[^/]+\/continue$/, "the same route shape as the direct path");
  } finally { emailPathHarness.f.close(); directHarness.f.close(); }
});

test("The handoff message and label are the same on both paths", async () => {
  const emailPathHarness = harness("g-d1c6500503", createPaystackHttpFake().fetcher);
  const directHarness = harness("g-d1c6500504", createPaystackHttpFake().fetcher);
  try {
    const afterEmail = await handoffAfterEmailSave(emailPathHarness);
    const onFile = await handoffWithEmailOnFile(directHarness);
    assert.deepEqual(afterEmail.result.messages, [CHECKOUT_MESSAGE], "the email path says the direct path's message");
    assert.deepEqual(onFile.result.messages, [CHECKOUT_MESSAGE], "the direct path says the same message");
    assert.equal(afterEmail.handoff.conventionalRouteLabel, onFile.handoff.conventionalRouteLabel, "the continue label is the same on both paths");
    assert.match(afterEmail.handoff.conventionalRouteLabel ?? "", /^Continue to stay payment · ₦/, "the label names the stay payment and its amount");
    assert.equal(afterEmail.handoff.textFallback, onFile.handoff.textFallback, "the text fallback is the same on both paths");
    assert.match(afterEmail.handoff.textFallback ?? "", /^You will leave Xenia temporarily for hosted card checkout\./, "the text fallback is the direct path's wording");
  } finally { emailPathHarness.f.close(); directHarness.f.close(); }
});

test("Following that control after the email save, and then following the direct path's control, reuses one Live Payment Attempt (no second checkout session)", async () => {
  const fake = createPaystackHttpFake();
  const h = harness("g-d1c6500505", fake.fetcher);
  try {
    const { offerId } = await handoffAfterEmailSave(h);
    assert.deepEqual(initializeReferences(fake.requests), [], "saving the email starts no Paystack transaction; only the continue control does");
    const session = h.f.environment.cardPaymentApp.getCheckoutSession(offerId);
    assert.ok(session, "the checkout session exists before the continue control is followed");

    // The email path's continue control: the server's /continue route runs initializePaystackCheckout (ADR 0087).
    const first = await h.f.environment.cardPaymentApp.initializePaystackCheckout(offerId, h.f.environment.guestPrincipal(), h.f.environment.payments);
    assert.equal(first.pspReference, session.pspReference, "the continue control starts the Live Payment Attempt the session already holds");
    assert.equal(first.checkoutId, session.checkoutId, "the continue control keeps the same checkout session");

    // The direct path's control, after a cold restore (the next request is a new process over the same store): the same route reuses the attempt.
    const restarted = trueRestartedDatedApp(h.f, scriptedPlanner({}).client);
    try {
      const environment = restarted.environment;
      const again = await environment.cardPaymentApp.initializePaystackCheckout(offerId, environment.guestPrincipal(), environment.payments);
      assert.equal(again.pspReference, first.pspReference, "the restored continue control reuses the same Live Payment Attempt");
      assert.equal(again.checkoutId, first.checkoutId, "no second checkout session is created");
      // Issue 66 (AC7, deliberate change): the durable checkout session keeps the approved Paystack address, so the restored
      // continue reuses it and initializes nothing. Before issue 66 this pinned [ref, ref] (the known gap in issue 65, deviation 5).
      assert.deepEqual(initializeReferences(fake.requests), [first.pspReference], "the restored continue reuses the stored address: one initialization in total");
    } finally {
      restarted.close();
    }
  } finally { h.f.close(); }
});

test("The response carries no Paystack URL; the redirect comes only from /continue on the server", async () => {
  const fake = createPaystackHttpFake({ authorizationUrl: "https://checkout.paystack.com/fake-token-65" });
  const h = harness("g-d1c6500506", fake.fetcher);
  try {
    const { result, handoff } = await handoffAfterEmailSave(h);
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /checkout\.paystack\.com|fake-token-65|authorization_url/, "the save response names no Paystack URL");
    assert.doesNotMatch(handoff.conventionalRoute ?? "", /^https?:|paystack/, "the continue control is a relative server route");
    assert.deepEqual(initializeReferences(fake.requests), [], "the save response is returned before any provider call");
  } finally { h.f.close(); }
});

test("The standalone payment page still shows Continue to hosted card checkout (no-JS path unchanged)", async () => {
  const page = await guestPaymentPage({ localPayment: false });
  try {
    // Ready offer, no attempt yet: the page offers the method form, and its card choice redirects through /continue (no JS).
    const ready = await page.get(page.paymentPage);
    assert.equal(ready.status, 200);
    const readyHtml = await ready.text();
    assert.match(visibleText(readyHtml), /Hosted card checkout\./, "the ready page offers the hosted card method");
    assert.match(readyHtml, new RegExp(`<form method="post" action="${page.paymentPage}"`), "the ready page's form posts to the offer's payment page");
    const posted = await page.post(page.paymentPage, { method: "card" });
    assert.equal(posted.status, 303, "the no-JS card choice redirects");
    assert.equal(posted.headers.get("location"), `${page.paymentPage}/continue`, "the no-JS redirect goes through /continue");

    // A checkout attempt exists (the state after the chat hands off): the page's single link is Continue to hosted card checkout.
    page.env.cardPaymentApp.initializeCheckout(page.offerId, page.env.guestPrincipal());
    const started = await page.get(page.paymentPage);
    assert.equal(started.status, 200);
    const startedHtml = await started.text();
    assert.match(visibleText(startedHtml), /Continue to hosted card checkout/, "the standalone page shows Continue to hosted card checkout");
    assert.match(startedHtml, new RegExp(`<a class="ui-button ui-button--primary ui-button--block" href="${page.paymentPage}/continue">Continue to hosted card checkout</a>`), "that link goes through /continue");
  } finally { await page.close(); }
});

test("The saved email does not appear in the timeline or the handoff text", async () => {
  const h = harness("g-d1c6500507", createPaystackHttpFake().fetcher);
  try {
    const { result } = await handoffAfterEmailSave(h);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(EMAIL.replace(/[.]/g, "\\.")), "the handoff does not repeat the email");
    const state = coldApp(h).getState(h.threadId);
    assert.doesNotMatch(JSON.stringify(state), new RegExp(EMAIL.replace(/[.]/g, "\\.")), "the timeline does not show the email");
  } finally { h.f.close(); }
});
