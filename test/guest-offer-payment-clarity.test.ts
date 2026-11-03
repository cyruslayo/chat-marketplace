import assert from "node:assert/strict";
import test from "node:test";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { guestPaymentPage, TEST_MANUAL_ACCOUNT, visibleText } from "./helpers/guest-payment-page.js";
import { paymentScreenContent } from "../apps/web-agent/src/payment-presentation.js";
import { paymentScreenHtml } from "../apps/local-guest/src/guest-kit.js";

const read = async (fixture: {base: string; cookie: string}, path: string) => (await fetch(fixture.base + path, { headers: { cookie: fixture.cookie } })).text();

test("AC1: offer terms, final amount, separate deposit, and one WAT deadline appear in clear order without raw ISO or policy IDs", async () => {
  await withStagePage({ label: "offer", stage: "offer" }, async ({ fixture, path }) => {
    const html = await read(fixture, path);
    const text = visibleText(html);
    assert.match(html, /<h3>Cancellation<\/h3>/);
    assert.match(html, /<h3>Guest conduct<\/h3>/);
    assert.ok(html.indexOf("ui-ticket") < html.indexOf("ui-price-breakdown"));
    assert.ok(html.indexOf("ui-price-breakdown") < html.indexOf("offer-policies"));
    assert.match(text, /Refundable Security Deposit \(separate\)/);
    assert.equal((text.match(/Pay by .*?WAT/g) ?? []).length, 1);
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T|\b(?:cancel|conduct|deposit)[-_][\w-]*20\d\d/i);
    const state = await fixture.state(); assert.equal(state.ok, true);
    const offerId = path.split("/").at(-1)!;
    const version = fixture.environment.conditionalOfferApp.getArtifact(offerId, fixture.environment.guestPrincipal()).facts.cancellationPolicy.version;
    assert.equal(text.includes(version), false);
  });
});

test("AC2: offer acceptance describes payment choice and never implies a Reservation or completed payment", async () => {
  await withStagePage({ label: "offer", stage: "offer" }, async ({ fixture, path }) => {
    const html = await read(fixture, path);
    assert.match(html, /Accept and choose payment/);
    const surfaceId = /name="surfaceId" value="([^"]+)"/.exec(html)![1]!;
    const response = await fetch(`${fixture.base}${path}/accept`, { method: "POST", headers: { cookie: fixture.cookie, origin: fixture.base }, body: new URLSearchParams({ surfaceId }), redirect: "manual" });
    assert.equal(response.status, 303);
    const next = response.headers.get("location")!;
    assert.match(next, /^\/payments\/offers\/[^/]+$/);
    assert.match(visibleText(await read(fixture, next)), /How would you like to pay/);
    const offerId = next.split("/").at(-1)!;
    assert.equal(fixture.environment.cardPaymentApp.getCheckoutSession(offerId), undefined);
    assert.equal(fixture.environment.interactionStore.findBookingSnapshotByOfferId(offerId), null);
  });
});

test("AC3: available methods form one accessible choice group with adjacent restrictions; unavailable choices cannot start payment", async () => {
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
  try {
    const html = await (await g.get(g.paymentPage)).text();
    const group = /<fieldset[^>]*>[\s\S]*?<\/fieldset>/.exec(html)![0];
    assert.ok(html.indexOf("payment-choice") < html.indexOf("payment-steps"), "the current payment choice comes before future outcomes");
    assert.match(group, /<legend[^>]*>Payment method/);
    for (const method of ["card", "bank_transfer", "manual_transfer"]) assert.match(group, new RegExp(`name="method" value="${method}"`));
    assert.match(group, /Hosted card checkout/);
    assert.match(visibleText(group), /can't switch to card until the transfer account expires/);
    assert.match(group, /receipt/);
    assert.equal((html.match(/<form /g) ?? []).length, 1);
    const selected = await g.post(g.paymentPage, { method: "manual_transfer" });
    assert.equal(selected.status, 307); assert.equal(selected.headers.get("location"), `${g.paymentPage}/manual-transfer`);
  } finally { await g.close(); }
  const closed = await guestPaymentPage({ start: "2026-09-03T18:02:00Z", config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
  try {
    assert.doesNotMatch(await (await closed.get(closed.paymentPage)).text(), /value="manual_transfer"/);
    assert.equal((await closed.post(closed.paymentPage, { method: "manual_transfer" })).status, 409);
    assert.equal(closed.env.manualTransfers?.current(closed.offerId, closed.now()), null);
  } finally { await closed.close(); }
  const cardOnly = await guestPaymentPage({ config: { deterministicPsp: false } });
  try {
    const html = await (await cardOnly.get(cardOnly.paymentPage)).text();
    assert.equal((html.match(/type="radio" name="method"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /value="bank_transfer"|value="manual_transfer"/);
    assert.equal((await cardOnly.post(cardOnly.paymentPage, { method: "bank_transfer" })).status, 409);
    assert.equal(cardOnly.env.bankTransferApp, null);
  } finally { await cardOnly.close(); }
});

test("AC4: handoff, pending, failed, expired, and reconciliation states show only authorized actions without a conflicting method switch", async () => {
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
  try {
    assert.equal((await g.get(`${g.paymentPage}/continue`)).status, 303);
    const artifact = g.env.cardPaymentApp.getArtifact(g.offerId, g.env.guestPrincipal());
    for (const status of ["checkout_initiated", "failed", "expired", "reconciliation_required"] as const) {
      const current = { ...artifact, facts: { ...artifact.facts, status }, actions: status === "checkout_initiated" ? artifact.actions : [] };
      const content = paymentScreenContent(current, g.now(), g.paymentPage);
      assert.equal("choosePath" in content, false, status);
      assert.doesNotMatch(paymentScreenHtml(content, "", "", {}), /Choose another way to pay|name="method"/, status);
    }
    assert.equal((await g.post(g.paymentPage, { method: "manual_transfer" })).status, 409);
    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 409);
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 409);
  } finally { await g.close(); }
  for (const status of ["failed", "pending", "late"] as const) {
    const payment = await guestPaymentPage({ config: status === "late" ? {} : { verifyPayment: (pspReference, amountKobo) => ({ verified: false, status, amountKobo, currency: "NGN", pspReference }) } });
    try {
      assert.equal((await payment.get(`${payment.paymentPage}/continue`)).status, 303);
      const checkout = payment.env.cardPaymentApp.getCheckoutSession(payment.offerId)!;
      if (status === "late") payment.advance(31 * 60_000);
      assert.throws(() => payment.env.cardPaymentApp.verifyAndConfirm(checkout.pspReference, payment.env.systemPrincipal()));
      const artifact = payment.env.cardPaymentApp.getArtifact(payment.offerId, payment.env.guestPrincipal());
      assert.equal(artifact.facts.status, status === "late" ? "reconciliation_required" : "checkout_initiated");
      const stateHtml = await (await payment.get(payment.paymentPage)).text();
      assert.doesNotMatch(stateHtml, /name="method"|Choose another way/);
      if (status === "pending") assert.doesNotMatch(stateHtml, /href="[^" ]+\/continue"/, "processing cannot reopen checkout through a status link");
      assert.equal((await payment.post(payment.paymentPage, { method: "card" })).status, 409);
      assert.equal(payment.env.interactionStore.findBookingSnapshotByOfferId(payment.offerId), null);
    } finally { await payment.close(); }
  }
});

test("AC5: late-payment wording matches reconciliation authority without promising an automatic refund or booking revival", async () => {
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
  try {
    const choice = visibleText(await (await g.get(g.paymentPage)).text());
    assert.doesNotMatch(choice, /after the deadline is refunded/);
    assert.match(choice, /payment needs review/);
    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    g.advance(25 * 60_000);
    const closed = visibleText(await (await g.get(`${g.paymentPage}/manual-transfer`)).text());
    assert.doesNotMatch(closed, /is refunded in full|refund.*completed|automatically refunded/i);
    assert.match(closed, /contact Shortlet/i);
    assert.equal(g.env.interactionStore.findBookingSnapshotByOfferId(g.offerId), null);
  } finally { await g.close(); }
});
