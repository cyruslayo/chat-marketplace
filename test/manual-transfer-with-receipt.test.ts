import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { formatBookingDeadline } from "../apps/web-agent/src/booking-presentation.js";
import { MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES } from "../domains/shortlet/src/index.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, guestPaymentPage, multipartBody, visibleText, type GuestPaymentPage } from "./helpers/guest-payment-page.js";

// P5 — manual bank transfer with receipt upload (.scratch/guest-payments/issues/05-manual-transfer-with-receipt.md).

const MINUTE = 60_000;
const wat = (iso: string) => formatBookingDeadline(iso).replace(/^Pay by /, "");
const withManual = (start?: string) => guestPaymentPage({ ...(start ? { start } : {}), config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
const manualPage = (g: GuestPaymentPage) => `${g.paymentPage}/manual-transfer`;
const receiptPath = (g: GuestPaymentPage) => `${manualPage(g)}/receipt`;
const receipts = (g: GuestPaymentPage) => { const db = new DatabaseSync(join(g.dir, "guest.sqlite")); try { return (db.prepare("SELECT COUNT(*) AS count FROM manual_transfer_receipts").get() as { count: number }).count; } finally { db.close(); } };
const contracts = (g: GuestPaymentPage) => { const db = new DatabaseSync(join(g.dir, "guest.sqlite")); try { return (db.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count; } finally { db.close(); } };
const upload = (g: GuestPaymentPage, bytes: Buffer, name = "receipt.png", type = "image/png", headers: Record<string, string> = {}) => { const form = multipartBody("receipt", name, type, bytes); return g.postRaw(receiptPath(g), form.body, form.contentType, headers); };

test("AC1 — Choosing manual transfer shows the account, the exact amount, a unique booking reference, and the absolute WAT deadline, and says the booking confirms only after the money is checked", async () => {
  const g = await withManual();
  try {
    const choice = visibleText(await (await g.get(g.paymentPage)).text());
    assert.match(choice, /Pay by manual bank transfer/);
    assert.match(choice, /Your booking confirms only after we check the money has arrived/);
    assert.equal((await g.post(manualPage(g))).status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
    const transferResponse = await g.get(manualPage(g));
    const transferHtml = await transferResponse.text();
    const text = visibleText(transferHtml);
    // The copy button waits, hidden, for /payment.js; without JavaScript the number stays plain text (ADR 0080).
    assert.match(transferHtml, new RegExp(`data-copy-text="${TEST_MANUAL_ACCOUNT.accountNumber}" hidden>Copy account number`));
    assert.match(transferHtml, /<script src="\/payment\.js" defer><\/script>/);
    const script = await g.get("/payment.js");
    assert.equal(script.status, 200);
    assert.match(await script.text(), /data-copy-text/);
    for (const fact of [`Bank ${TEST_MANUAL_ACCOUNT.bankName}`, `Account name ${TEST_MANUAL_ACCOUNT.accountName}`, `Account number ${TEST_MANUAL_ACCOUNT.accountNumber}`, `Exact amount ${formatNgnKobo(transfer.amountKobo)}`, `Booking reference ${transfer.bookingReference}`, `Transfer and upload by ${wat(transfer.paymentDeadlineAt)}`]) {
      assert.ok(text.includes(fact), `shows ${fact}`);
    }
    assert.match(transfer.bookingReference, /^SL-[A-Z2-9]{8}$/);
    assert.match(text, /Your booking confirms only after we see the money in our account and check it; the receipt alone doesn't confirm it\./);
    // It holds the single live attempt: card and provider transfer are refused (ADR 0046, 0090).
    assert.equal((await g.get(`${g.paymentPage}/continue`)).status, 409);
    assert.equal(g.env.livePaymentAttempts.current(g.offerId, g.now())?.method, "manual_transfer");
    // Starting again returns the same reference.
    assert.equal((await g.post(manualPage(g))).status, 303);
    assert.equal(g.env.manualTransfers!.current(g.offerId, g.now())!.bookingReference, transfer.bookingReference);
  } finally { await g.close(); }

  // Unique per booking.
  const [a, b] = [await withManual(), await withManual()];
  try {
    await a.post(manualPage(a)); await b.post(manualPage(b));
    assert.notEqual(a.env.manualTransfers!.current(a.offerId, a.now())!.bookingReference, b.env.manualTransfers!.current(b.offerId, b.now())!.bookingReference);
  } finally { await a.close(); await b.close(); }

  // Offered only when the 20-minute window plus the 60-minute hold fits inside 8:00 AM–8:00 PM WAT (ADR 0090).
  const evening = await withManual("2026-09-03T18:30:00.000Z"); // 7:30 PM WAT: the hold would end at 8:50 PM
  try {
    assert.doesNotMatch(visibleText(await (await evening.get(evening.paymentPage)).text()), /manual bank transfer/i);
    assert.equal((await evening.post(manualPage(evening))).status, 409);
    assert.equal(evening.env.manualTransfers!.current(evening.offerId, evening.now()), null);
  } finally { await evening.close(); }

  // Without a configured business account it is never offered.
  const unconfigured = await guestPaymentPage();
  try {
    assert.equal(unconfigured.env.manualTransfers, null);
    assert.doesNotMatch(visibleText(await (await unconfigured.get(unconfigured.paymentPage)).text()), /manual bank transfer/i);
  } finally { await unconfigured.close(); }
});

test("AC2 — The Guest can upload one receipt (allowed types and size only) before the deadline, and the booking then shows as waiting for payment check with the verification deadline", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    g.advance(5 * MINUTE);
    const response = await upload(g, TEST_RECEIPTS.png);
    assert.equal(response.status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
    assert.equal(transfer.status, "awaiting_verification");
    assert.equal(transfer.receipt?.contentType, "image/png");
    assert.equal(Date.parse(transfer.verificationDeadlineAt) - Date.parse(transfer.paymentDeadlineAt), MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES * MINUTE);
    const text = visibleText(await (await g.get(manualPage(g))).text());
    assert.match(text, /Waiting for payment check/);
    assert.ok(text.includes(`We will check by ${wat(transfer.verificationDeadlineAt)}`), "verification deadline, absolute WAT");
    assert.equal(receipts(g), 1);
    // One receipt only.
    assert.equal((await upload(g, TEST_RECEIPTS.pdf, "again.pdf", "application/pdf")).status, 409);
    assert.equal(receipts(g), 1);
    // The dates stay held through the verification deadline (ADR 0090).
    const offer = g.env.conditionalOfferApp.manager.getOffer(g.offerId);
    g.advance(40 * MINUTE); // past the Payment Window, inside the hold
    assert.equal(g.env.calendar.getAuthoritativeAvailability({ unitId: offer.unitId, checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut, clock: g.now }).isAvailable, false);
  } finally { await g.close(); }

  // A PDF receipt is accepted too.
  const pdf = await withManual();
  try {
    await pdf.post(manualPage(pdf));
    assert.equal((await upload(pdf, TEST_RECEIPTS.pdf, "receipt.pdf", "application/pdf")).status, 303);
    assert.equal(pdf.env.manualTransfers!.current(pdf.offerId, pdf.now())!.receipt?.contentType, "application/pdf");
  } finally { await pdf.close(); }
});

test("AC3 — An upload after the deadline, of a disallowed type or size, or for a booking the Guest doesn't own, is refused and nothing is stored", async () => {
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT, receiptMaxBytes: 1024 } });
  try {
    await g.post(manualPage(g));
    // Disallowed type: judged by the bytes, not the declared type or name.
    const disguised = await upload(g, TEST_RECEIPTS.text, "receipt.png", "image/png");
    assert.equal(disguised.status, 400);
    assert.match(visibleText(await disguised.text()), /Upload a photo \(JPEG or PNG\) or a PDF of your receipt/);
    // Too large.
    const large = await upload(g, Buffer.concat([TEST_RECEIPTS.png, Buffer.alloc(2048, 7)]));
    assert.equal(large.status, 413);
    // Cross-origin.
    assert.equal((await upload(g, TEST_RECEIPTS.png, "receipt.png", "image/png", { origin: "https://attacker.example" })).status, 403);
    assert.equal(receipts(g), 0);
    assert.equal(g.env.manualTransfers!.current(g.offerId, g.now())!.status, "awaiting_receipt");
    // After the Payment Window deadline: refused, and the attempt has expired with the dates released.
    g.advance(20 * MINUTE);
    const late = await upload(g, TEST_RECEIPTS.png);
    assert.ok([303, 409].includes(late.status));
    assert.equal(receipts(g), 0);
    assert.equal(g.env.manualTransfers!.current(g.offerId, g.now())!.status, "expired");
    assert.match(visibleText(await (await g.get(manualPage(g))).text()), /No Reservation was made/);
  } finally { await g.close(); }

  // A booking the Guest doesn't own: another Guest's session cannot see or upload to it.
  const owner = await withManual();
  try {
    await owner.post(manualPage(owner));
    const stranger = await guestPaymentPage({ dir: owner.dir, existing: { offerId: owner.offerId }, config: { manualTransferAccount: TEST_MANUAL_ACCOUNT, guestId: "someone-else" } });
    try {
      assert.equal((await stranger.get(manualPage(stranger))).status, 404);
      assert.equal((await upload(stranger, TEST_RECEIPTS.png)).status, 404);
      assert.equal(receipts(owner), 0);
    } finally { await stranger.close(true); }
  } finally { await owner.close(); }
});

test("AC4 — The receipt never confirms the booking by itself; only the back-office verification (B6) does", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    assert.equal((await upload(g, TEST_RECEIPTS.png)).status, 303);
    assert.equal(contracts(g), 0);
    assert.equal(g.env.interactionStore.findBookingSnapshotByOfferId(g.offerId), null);
    assert.doesNotMatch(visibleText(await (await g.get(manualPage(g))).text()), /Reservation is confirmed/);
    // With no verification by the deadline it expires, still unconfirmed, and the dates are released.
    g.advance(20 * MINUTE + MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES * MINUTE);
    assert.equal(g.env.manualTransfers!.current(g.offerId, g.now())!.status, "expired");
    assert.equal(contracts(g), 0);
    const offer = g.env.conditionalOfferApp.manager.getOffer(g.offerId);
    assert.equal(g.env.calendar.getAuthoritativeAvailability({ unitId: offer.unitId, checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut, clock: g.now }).isAvailable, true);
    // No log or audit carries the receipt, its name or its bytes (ADR 0075).
    const audit = JSON.stringify(g.env.audit.entries());
    assert.ok(!audit.includes("receipt.png") && !audit.includes(TEST_RECEIPTS.png.toString("base64")));
  } finally { await g.close(); }
});

test("AC5 — Upload works without JavaScript and at 320px", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    const html = await (await g.get(manualPage(g))).text();
    // The only script is the optional copy-account-number enhancement; the upload works without it (ADR 0080).
    assert.doesNotMatch(html.replace('<script src="/payment.js" defer></script>', ""), /<script/);
    assert.match(html, /class="ui-ticket" aria-label="Your stay"/);
    assert.match(html, /ui-price-breakdown/);
    assert.match(html, /<form method="post" action="[^"]+\/manual-transfer\/receipt" enctype="multipart\/form-data"/);
    assert.match(html, /<input id="receipt" name="receipt" type="file" accept="image\/jpeg,image\/png,application\/pdf" required>/);
    assert.match(html, /\.transfer-account,\.transfer-reference\{[^}]*overflow-wrap:anywhere/);
  } finally { await g.close(); }
});
