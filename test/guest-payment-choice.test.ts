import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { LOCAL_TRANSFER_BANK_NAME } from "../apps/local-guest/src/local-bank-transfer-provider.js";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { formatBookingDeadline } from "../apps/web-agent/src/booking-presentation.js";
import type { Unit } from "../domains/shortlet/src/index.js";

// P3 — the Guest chooses card or transfer (.scratch/guest-payments/issues/03-guest-payment-choice.md).

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

/** A Guest with an accepted, zero-deposit offer (ADR 0089), served by the local pilot server with the local providers. */
async function guestWithOffer(dir = mkdtempSync(join(tmpdir(), "p3-choice-")), existing?: { readonly offerId: string }) {
  const env = new LocalGuestEnvironment({ databasePath: join(dir, "guest.sqlite"), initialGuestPhoneNumber: "+2348012345678", initialGuestContactEmail: "guest@example.test", clock: () => new Date("2026-09-03T10:02:00.000Z") });
  let offerId = existing?.offerId ?? "";
  if (!existing) {
    const unit = env.unitRepository.findById("unit-lagos-ikoyi-001") as Unit;
    env.unitRepository.save({ ...unit, price: { ...unit.price, refundableSecurityDepositKobo: 0 } });
    const draft = env.bookingRequestApp.createDraft({ unitId: unit.id, primaryGuest: { id: env.config.guestId, name: env.config.guestName }, occupants: env.demoOccupants(2), selfBookingAttestation: env.selfBookingAttestation(), checkIn: "2026-09-10", checkOut: "2026-09-13" }, env.guestPrincipal());
    const request = env.bookingRequestApp.disclose(draft.draftId, env.guestPrincipal());
    offerId = env.simulateOperatorAcceptance(request.requestId).offerId;
    const offer = env.conditionalOfferApp.manager.getOffer(offerId);
    env.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: env.guestPrincipal() });
  }
  const server = startLocalGuestServer({ port: 0, environment: env, localPayment: true, conciergeMode: "deterministic" });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const cookie = (await fetch(`${base}/`)).headers.get("set-cookie")?.split(";")[0] ?? "";
  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie, accept: "text/html" }, redirect: "manual" });
  const post = (path: string, body: Record<string, string> = {}, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: "POST", headers: { cookie, accept: "text/html", "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body), redirect: "manual" });
  const paymentPage = `/payments/offers/${encodeURIComponent(offerId)}`;
  return { env, dir, offerId, get, post, paymentPage, transferPage: `${paymentPage}/transfer`, close: async (keep = false) => { await server.close(); if (!keep) rmSync(dir, { recursive: true, force: true }); } };
}

test("AC1 — After accepting the offer the Guest can choose bank transfer or card, and each leads to its payment path", async () => {
  const g = await guestWithOffer();
  try {
    const html = await (await g.get(g.paymentPage)).text();
    const text = visibleText(html);
    assert.match(text, /How would you like to pay\?/);
    assert.match(html, new RegExp(`<form method="post" action="${g.paymentPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/transfer"><button[^>]*type="submit">Pay by bank transfer</button></form>`));
    assert.match(html, new RegExp(`<a[^>]*href="${g.paymentPage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/continue"[^>]*>Pay by card`));

    // Card leads to the card path.
    const card = await g.get(`${g.paymentPage}/continue`);
    assert.equal(card.status, 303);
    assert.match(card.headers.get("location") ?? "", /^\/payments\/local\/checkout\?reference=/);
  } finally { await g.close(); }

  // Bank transfer leads to the transfer path.
  const t = await guestWithOffer();
  try {
    const chosen = await t.post(`${t.paymentPage}/transfer`);
    assert.equal(chosen.status, 303);
    assert.equal(chosen.headers.get("location"), t.transferPage);
    assert.equal(t.env.bankTransferApp!.manager.getSession(t.offerId)?.status, "initiated");
    // The payment page now sends the Guest to their transfer, never back to the choice.
    assert.equal((await t.get(t.paymentPage)).headers.get("location"), t.transferPage);
    // A cross-origin POST starts nothing.
    const other = await guestWithOffer();
    try {
      assert.equal((await other.post(`${other.paymentPage}/transfer`, {}, { origin: "https://attacker.example" })).status, 403);
      assert.equal(other.env.bankTransferApp!.manager.getSession(other.offerId), undefined);
    } finally { await other.close(); }
  } finally { await t.close(); }
});

test("AC2 — The transfer screen shows the bank, account number, exact amount, and the absolute WAT deadline with time left, and says the booking confirms when the transfer arrives", async () => {
  const g = await guestWithOffer();
  let keep = false;
  try {
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    const session = g.env.bankTransferApp!.manager.getSession(g.offerId)!;
    const text = visibleText(await (await g.get(g.transferPage)).text());
    assert.ok(text.includes(`Bank ${LOCAL_TRANSFER_BANK_NAME}`), "bank");
    assert.ok(text.includes(`Account number ${session.accountNumber}`), "account number");
    assert.ok(text.includes(`Exact amount ${formatNgnKobo(session.amountKobo)}`), "exact amount");
    assert.ok(text.includes(`Transfer by ${formatBookingDeadline(session.expiresAt).replace(/^Pay by /, "")}`), "absolute WAT deadline");
    assert.match(text, /20 minutes left/);
    assert.match(text, /Your booking confirms automatically once the transfer arrives\./);
    assert.doesNotMatch(text, /Reservation is confirmed/);

    // Durable (P1 follow-up): a restarted server over the same database shows the same account.
    await g.close(true); keep = true;
    const restarted = await guestWithOffer(g.dir, { offerId: g.offerId });
    try {
      const again = visibleText(await (await restarted.get(restarted.transferPage)).text());
      assert.ok(again.includes(`Account number ${session.accountNumber}`), "survives restart");
      // The local demo transfer arrives: the Reservation is confirmed, once.
      const completed = await restarted.post("/payments/local/transfer/complete", { reference: session.transferReference });
      assert.equal(completed.status, 303);
      const done = visibleText(await (await restarted.get(restarted.transferPage)).text());
      assert.match(done, /Payment received/);
      assert.match(done, /your Reservation is confirmed/);
      // The same booking snapshot as a card payment, so booking pages and the back office (B4) see the Reservation.
      assert.ok(restarted.env.interactionStore.findBookingSnapshotByOfferId(restarted.offerId), "booking snapshot recorded");
      assert.equal((await restarted.post("/payments/local/transfer/complete", { reference: session.transferReference })).status, 303);
      const db = new DatabaseSync(join(g.dir, "guest.sqlite"));
      try { assert.equal((db.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count, 1, "confirmed once"); } finally { db.close(); }
    } finally { await restarted.close(); }
  } finally { if (!keep) await g.close(); else rmSync(g.dir, { recursive: true, force: true }); }
});

test("AC3 — The page states before the choice that a transfer can't be switched to card while its account is payable, and a switch attempt is refused while it is payable", async () => {
  const g = await guestWithOffer();
  try {
    const before = visibleText(await (await g.get(g.paymentPage)).text());
    assert.match(before, /If you choose bank transfer, you can't switch to card until the transfer account expires\./);
    assert.ok(before.indexOf("can't switch to card") < before.indexOf("Pay by bank transfer"), "stated before the choice");

    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    const refused = await g.get(`${g.paymentPage}/continue`);
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /Your bank transfer is still open/);
    assert.equal(g.env.cardPaymentApp.manager.getCheckoutSession(g.offerId), undefined, "no card checkout started");
    assert.equal(g.env.livePaymentAttempts.current(g.offerId, g.env.clock())?.method, "bank_transfer");
    // Starting the transfer again returns the same account (ADR 0046).
    const first = g.env.bankTransferApp!.manager.getSession(g.offerId)!.accountNumber;
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    assert.equal(g.env.bankTransferApp!.manager.getSession(g.offerId)!.accountNumber, first);
  } finally { await g.close(); }
});

test("AC4 — The transfer and card paths both work at 320px and without JavaScript", async () => {
  const g = await guestWithOffer();
  try {
    // Plain HTML forms and links, no script: the choice, the transfer and the card continuation all work without JavaScript.
    const choice = await (await g.get(g.paymentPage)).text();
    assert.doesNotMatch(choice, /<script/);
    assert.match(choice, /<meta name="viewport" content="width=device-width,\s*initial-scale=1/);
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    const transfer = await (await g.get(g.transferPage)).text();
    assert.doesNotMatch(transfer, /<script/);
    // Long account numbers wrap rather than widen the page at 320px.
    assert.match(transfer, /\.transfer-account\{[^}]*overflow-wrap:anywhere/);
  } finally { await g.close(); }
});
