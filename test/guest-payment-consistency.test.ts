import assert from "node:assert/strict";
import test from "node:test";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { formatWAT } from "../apps/local-guest/src/guest-kit.js";
import { multipartBody, TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, guestPaymentPage, visibleText } from "./helpers/guest-payment-page.js";

// Guest UI consistency issue 09: one layout for every payment screen.

const manual = { config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } };

test("AC1: the payment choice, transfer, manual transfer, waiting and no-reservation pages share one banner, ticket, details and actions layout", async () => {
  const g = await guestPaymentPage(manual);
  try {
    const choice = await (await g.get(g.paymentPage)).text();
    for (const marker of ['class="request-head payment-head"', 'class="ui-banner ui-banner--warning payment-deadline"', 'class="ui-ticket"', "ui-price-breakdown", 'class="ui-panel payment-steps"', "payment-actions"])
      assert.ok(choice.includes(marker), `choice page has ${marker}`);
    assert.doesNotMatch(choice, /waiting-panel|ui-banner--info/);

    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    const awaitingReceipt = await (await g.get(`${g.paymentPage}/manual-transfer`)).text();
    for (const marker of ['class="request-head payment-head"', "payment-deadline", 'class="ui-ticket"', "ui-price-breakdown", 'class="ui-panel bank-details"', 'class="ui-upload"', "Back to your conversation"])
      assert.ok(awaitingReceipt.includes(marker), `manual page has ${marker}`);

    const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
    assert.equal((await g.postRaw(`${g.paymentPage}/manual-transfer/receipt`, form.body, form.contentType)).status, 303);
    const waiting = await (await g.get(`${g.paymentPage}/manual-transfer`)).text();
    for (const marker of ['class="request-head payment-head"', "ui-banner", 'class="ui-ticket"', 'class="ui-panel transfer-summary"', "ui-status", "Back to your conversation"])
      assert.ok(waiting.includes(marker), `waiting page has ${marker}`);

    g.advance(3 * 3600 * 1000);
    const closed = await (await g.get(`${g.paymentPage}/manual-transfer`)).text();
    for (const marker of ['class="ui-banner ui-banner--danger"', "ui-status--danger", "Back to your conversation", 'href="/stays/search"', "Find other stays"])
      assert.ok(closed.includes(marker), `no-reservation page has ${marker}`);
  } finally { await g.close(); }

  const t = await guestPaymentPage();
  try {
    assert.equal((await t.post(`${t.paymentPage}/transfer`)).status, 303);
    const html = await (await t.get(`${t.paymentPage}/transfer`)).text();
    for (const marker of ['class="request-head payment-head"', 'class="ui-banner ui-banner--warning payment-deadline"', 'class="ui-ticket"', 'class="ui-panel bank-details"', "Waiting for your transfer", "Back to your conversation"])
      assert.ok(html.includes(marker), `transfer page has ${marker}`);
    t.advance(25 * 60 * 1000);
    const expired = await (await t.get(`${t.paymentPage}/transfer`)).text();
    for (const marker of ['class="ui-banner ui-banner--danger"', "ui-status--danger", 'href="/stays/search"'])
      assert.ok(expired.includes(marker), `expired transfer page has ${marker}`);
  } finally { await t.close(); }
});

test("AC2: the payment choice is a radio group with one submit that reaches today's route and command, and an unknown or missing method starts nothing", async () => {
  const g = await guestPaymentPage(manual);
  try {
    const html = await (await g.get(g.paymentPage)).text();
    assert.match(html, /<fieldset class="ui-segmented"/);
    assert.match(html, /<input type="radio" name="method" value="card"[^>]*checked/);
    assert.match(html, /<input type="radio" name="method" value="bank_transfer"/);
    assert.equal((html.match(/<form method="post" action="[^"]*\/payments\/offers\/[^"/]+"/g) ?? []).length, 1, "one method form");
    // ADR 0090: the manual option stays its own action.
    assert.match(html, new RegExp(`<form method="post" action="${g.paymentPage}/manual-transfer"[^>]*>`));
    assert.match(visibleText(html), /you can't switch to card until the transfer account expires/);

    // Failure paths: nothing starts.
    const bodies: Record<string, string>[] = [{}, { method: "" }, { method: "cheque" }, { method: "card,bank_transfer" }];
    for (const body of bodies) {
      const refused = await g.post(g.paymentPage, body);
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
    assert.equal((await g.post(g.paymentPage, { method: "card" }, { origin: "https://attacker.example" })).status, 403);
    assert.equal(g.env.bankTransferApp!.manager.getSession(g.offerId), undefined);
    assert.equal(g.env.cardPaymentApp.manager.getCheckoutSession(g.offerId), undefined);
    assert.equal(g.env.livePaymentAttempts.current(g.offerId, g.env.clock()), undefined);

    // Card reaches the existing card continuation.
    const card = await g.post(g.paymentPage, { method: "card" });
    assert.equal(card.status, 303);
    assert.equal(card.headers.get("location"), `${g.paymentPage}/continue`);
    // Bank transfer reaches the existing transfer route with the method preserved.
    const bank = await g.post(g.paymentPage, { method: "bank_transfer" });
    assert.equal(bank.status, 307);
    assert.equal(bank.headers.get("location"), `${g.paymentPage}/transfer`);
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    assert.equal(g.env.bankTransferApp!.manager.getSession(g.offerId)?.status, "initiated");
  } finally { await g.close(); }
});

test("AC3: every payment deadline is a warning banner with an absolute WAT time and the minutes left, and no payment page renders a waiting panel", async () => {
  const g = await guestPaymentPage(manual);
  try {
    const wat = (iso: string) => formatWAT(iso);
    const choice = await (await g.get(g.paymentPage)).text();
    const window = g.env.cardPaymentApp.getArtifact(g.offerId, g.env.guestPrincipal()).facts.paymentWindowExpiresAt;
    assert.ok(visibleText(choice).includes(`Pay by ${wat(window)} · 20 minutes left`));
    assert.match(choice, /class="ui-banner ui-banner--warning payment-deadline"/);

    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    const manualHtml = await (await g.get(`${g.paymentPage}/manual-transfer`)).text();
    assert.match(manualHtml, /class="ui-banner ui-banner--warning payment-deadline"/);
    assert.match(visibleText(manualHtml), /Transfer and upload by .+ WAT, .+ · 20 minutes left/);
    for (const html of [choice, manualHtml]) assert.doesNotMatch(html, /waiting-panel|ui-banner--info/);
  } finally { await g.close(); }
});

test("AC5: the waiting screen shows the projected verification deadline and receipt time, and the no-reservation screen shows the actual expiry time", async () => {
  const g = await guestPaymentPage(manual);
  try {
    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    g.advance(5 * 60 * 1000);
    const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
    assert.equal((await g.postRaw(`${g.paymentPage}/manual-transfer/receipt`, form.body, form.contentType)).status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.env.clock())!;
    const waiting = visibleText(await (await g.get(`${g.paymentPage}/manual-transfer`)).text());
    assert.ok(waiting.includes(`We will check by ${formatWAT(transfer.verificationDeadlineAt)}`), "verification deadline");
    assert.ok(waiting.includes(`Uploaded ${formatWAT(transfer.receipt!.uploadedAt)}`), "receipt time");
    assert.ok(waiting.includes(transfer.bookingReference), "booking reference");
    assert.ok(waiting.includes(formatNgnKobo(transfer.amountKobo)), "amount");
    assert.doesNotMatch(waiting, /\[verification deadline\]|\[upload time\]/);

    g.advance(4 * 3600 * 1000);
    const closedTransfer = g.env.manualTransfers!.current(g.offerId, g.env.clock())!;
    assert.equal(closedTransfer.status, "expired");
    const closed = visibleText(await (await g.get(`${g.paymentPage}/manual-transfer`)).text());
    assert.ok(closed.includes(formatWAT(closedTransfer.paymentDeadlineAt)), "actual expiry time");
    assert.match(closed, /No Reservation was made/);
    assert.match(closed, /refunded in full/);
  } finally { await g.close(); }

  const t = await guestPaymentPage();
  try {
    assert.equal((await t.post(`${t.paymentPage}/transfer`)).status, 303);
    const session = t.env.bankTransferApp!.manager.getSession(t.offerId)!;
    t.advance(25 * 60 * 1000);
    const text = visibleText(await (await t.get(`${t.paymentPage}/transfer`)).text());
    assert.ok(text.includes(formatWAT(session.expiresAt)), "the account's real expiry");
    assert.match(text, /Money sent after the deadline is refunded in full\./);
  } finally { await t.close(); }
});

test("AC6: the amounts on each payment screen equal the projection values used today", async () => {
  const g = await guestPaymentPage(manual);
  try {
    const facts = g.env.cardPaymentApp.getArtifact(g.offerId, g.env.guestPrincipal()).facts;
    const choice = visibleText(await (await g.get(g.paymentPage)).text());
    assert.ok(choice.includes(formatNgnKobo(facts.allInStayTotalKobo!)), "All-In Stay Total");
    assert.ok(choice.includes(`Amount due now: ${formatNgnKobo(facts.amountDueNowKobo)}`), "amount due now");
    assert.ok(choice.includes(`Next payment: stay payment · ${formatNgnKobo(facts.currentComponentAmountKobo ?? facts.allInStayTotalKobo!)}`), "next payment row");

    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.env.clock())!;
    const manualText = visibleText(await (await g.get(`${g.paymentPage}/manual-transfer`)).text());
    assert.ok(manualText.includes(`Exact amount ${formatNgnKobo(transfer.amountKobo)}`));
    assert.ok(manualText.includes(`Amount due now: ${formatNgnKobo(transfer.amountKobo)}`));
  } finally { await g.close(); }
});
