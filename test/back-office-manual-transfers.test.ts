import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { FOREIGN_ORIGIN, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { guestManualTransfers, type GuestManualTransfers } from "./helpers/guest-manual-transfer.js";
import { TEST_RECEIPTS, visibleText } from "./helpers/guest-payment-page.js";
import { formatWat } from "../apps/local-owner/src/back-office-view.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";
import { renderManualTransferPageHtml } from "../apps/local-guest/src/guest-server.js";
import { MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES, RECEIPT_RETENTION_DAYS } from "../domains/shortlet/src/index.js";

// B6 — verify manual transfers (scratch/operator-dashboard/issues/06-verify-manual-transfers.md).

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";

let guests = 0;
/** A confirmed Booking Request whose Guest has started a manual transfer (11:00 WAT: inside 8 AM–8 PM, ADR 0090). */
async function manualTransfer(f: SignedInOperator, guest: GuestManualTransfers, checkIn: string, checkOut: string, options: { readonly upload?: boolean } = {}) {
  guests += 1;
  const requestId = f.server.environment.createDemoIncomingBookingRequest({ guestId: `manual-guest-${guests}`, guestName: `Manual Guest ${guests}`, checkIn, checkOut }).facts.requestId;
  assert.equal((await decideRequest(f.session, requestId, "confirm")).status, 303);
  let transfer = guest.start(requestId);
  if (options.upload !== false) transfer = guest.upload(requestId);
  return { requestId, transfer };
}

async function queue(f: SignedInOperator): Promise<string> {
  const response = await operatorGet(f.session, "/operator/transfers");
  assert.equal(response.status, 200);
  return response.text();
}

function card(html: string, transferId: string): { readonly text: string; readonly html: string; readonly status: string } {
  const match = new RegExp(`<li class="bo-transfer" id="transfer-${transferId}" data-transfer-id="${transferId}" data-status="([^"]+)">([\\s\\S]*?)</li>`).exec(html);
  assert.ok(match, `transfer ${transferId} is listed`);
  return { status: match[1]!, html: match[2]!, text: visibleText(match[2]!) };
}

const order = (html: string) => [...html.matchAll(/data-transfer-id="([^"]+)"/g)].map((match) => match[1]!);
const version = (html: string, transferId: string) => card(html, transferId).html.match(/name="expectedVersion" value="(\d+)"/)?.[1] ?? "0";
const contracts = (f: SignedInOperator) => { const db = new DatabaseSync(f.server.environment.config.databasePath); try { return (db.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count; } finally { db.close(); } };
const datesFree = (f: SignedInOperator, requestId: string) => { const request = f.server.environment.bookingRequestApp.manager.getRequest(requestId) as { unitId: string; checkIn: string; checkOut: string }; return f.server.environment.calendar.getAuthoritativeAvailability({ unitId: request.unitId, checkIn: request.checkIn, checkOut: request.checkOut, clock: f.server.environment.clock }).isAvailable; };

async function act(f: SignedInOperator, transferId: string, action: "confirm" | "reject" | "late-credit", fields: Record<string, string>, options: { cookie?: string; origin?: string; expectedVersion?: string } = {}) {
  const expectedVersion = options.expectedVersion ?? version(await queue(f), transferId);
  return operatorPost(f.session, `/operator/transfers/${transferId}/${action}`, options.cookie ?? f.session.cookie, options.origin ? { origin: options.origin } : {}, { expectedVersion, ...fields });
}

async function assertStandardRefusals(f: SignedInOperator, transferId: string, action: "confirm" | "reject", fields: Record<string, string>) {
  const current = version(await queue(f), transferId);
  assert.equal((await act(f, transferId, action, fields, { cookie: "", expectedVersion: current })).status, 401, "no session");
  assert.equal((await act(f, transferId, action, fields, { origin: FOREIGN_ORIGIN, expectedVersion: current })).status, 403, "cross-origin POST");
  assert.equal((await act(f, transferId, action, fields, { expectedVersion: String(Number(current) - 1) })).status, 409, "stale version");
  assert.equal(card(await queue(f), transferId).status, "awaiting_verification");
}

test("AC1 — The queue lists each manual transfer awaiting verification, soonest deadline first, with owner, apartment, exact amount, booking reference, upload time, the receipt, and the absolute WAT verification deadline", async () => {
  const f = await startSignedInOperator();
  const guest = guestManualTransfers(f.server.environment);
  try {
    const first = await manualTransfer(f, guest, "2026-09-10", "2026-09-12");
    f.advance(3 * MINUTE);
    const second = await manualTransfer(f, guest, "2026-09-14", "2026-09-16");
    const noReceipt = await manualTransfer(f, guest, "2026-09-18", "2026-09-20", { upload: false });
    const html = await queue(f);
    assert.deepEqual(order(html).slice(0, 3), [first.transfer.transferId, second.transfer.transferId, noReceipt.transfer.transferId], "waiting for your check first, soonest deadline first");
    const shown = card(html, first.transfer.transferId);
    assert.equal(shown.status, "awaiting_verification");
    for (const fact of [OWNER, APARTMENT, `Exact amount ${formatMoney(first.transfer.amountKobo)}`, `Booking reference ${first.transfer.bookingReference}`, `Uploaded ${formatWat(first.transfer.receipt!.uploadedAt)}`, `Verify by ${formatWat(first.transfer.verificationDeadlineAt)}`]) {
      assert.ok(shown.text.includes(fact), `shows ${fact}`);
    }
    assert.equal(Date.parse(first.transfer.verificationDeadlineAt) - Date.parse(first.transfer.paymentDeadlineAt), MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES * MINUTE, "60 minutes after the Payment Window deadline");
    assert.match(shown.html, new RegExp(`href="/operator/transfers/${first.transfer.transferId}/receipt"`));
    assert.match(card(html, noReceipt.transfer.transferId).text, /Waiting for the Guest's receipt/);
    assert.match(visibleText(html), /2 transfers are waiting for your check, soonest deadline first\./);
    // Home lists it as waiting on you; the Bookings page says it is awaiting your check.
    const home = visibleText(await (await operatorGet(f.session, "/operator")).text());
    assert.match(home, /Manual transfer to verify/);
    assert.ok(home.includes(`Verify by ${formatWat(first.transfer.verificationDeadlineAt)}`));
    const bookings = visibleText(await (await operatorGet(f.session, "/operator/bookings")).text());
    assert.ok(bookings.includes(`Awaiting your check by ${formatWat(first.transfer.verificationDeadlineAt)}`));
    assert.match(bookings, /Payment method: Manual transfer/);
    // A revoked grant lists nothing.
    revokeRepresentativeGrant(f.server.environment);
    assert.equal(order(await queue(f)).length, 0);
  } finally { guest.close(); await f.close(); }
});

test("AC2 — Confirming requires the bank transaction reference and the received amount; an amount that doesn't match exactly is refused, and a confirmed transfer confirms the booking once", async () => {
  const f = await startSignedInOperator();
  const guest = guestManualTransfers(f.server.environment);
  try {
    const { requestId, transfer } = await manualTransfer(f, guest, "2026-09-10", "2026-09-12");
    const amount = (transfer.amountKobo / 100).toLocaleString("en-NG");
    for (const fields of [{ amountReceived: amount }, { bankTransactionReference: "FT260903ABC1" }, { bankTransactionReference: "FT260903ABC1", amountReceived: "lots" }, { bankTransactionReference: "FT260903ABC1", amountReceived: amount, note: "free text" }] as Record<string, string>[]) {
      assert.equal((await act(f, transfer.transferId, "confirm", fields)).status, 400, JSON.stringify(fields));
    }
    const short = await act(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903ABC1", amountReceived: String(transfer.amountKobo / 100 - 1) });
    assert.equal(short.status, 409);
    assert.match(visibleText(await short.text()), /does not match the booking amount exactly/);
    assert.equal(contracts(f), 0);
    await assertStandardRefusals(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903ABC1", amountReceived: amount });

    const confirmed = await act(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903ABC1", amountReceived: `₦${amount}` });
    assert.equal(confirmed.status, 303);
    assert.equal(contracts(f), 1, "one Reservation");
    assert.equal(card(await queue(f), transfer.transferId).status, "confirmed");
    const booking = visibleText(await (await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(requestId)}`)).text());
    assert.match(booking, /Reservation confirmed/);
    assert.match(booking, /Payment method Manual transfer/);
    // Once: a repeat confirms nothing more.
    assert.equal((await act(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903ABC1", amountReceived: amount }, { expectedVersion: String(transfer.version) })).status, 409);
    assert.equal(contracts(f), 1);
    // A bank transaction reference confirms at most one booking (ADR 0090).
    const other = await manualTransfer(f, guest, "2026-09-14", "2026-09-16");
    const reused = await act(f, other.transfer.transferId, "confirm", { bankTransactionReference: " ft260903abc1 ", amountReceived: String(other.transfer.amountKobo / 100) });
    assert.equal(reused.status, 409);
    assert.match(visibleText(await reused.text()), /already confirmed another booking/);
    assert.equal(contracts(f), 1);
    // The bank reference is kept on the transfer, never in the audit (ADR 0075).
    assert.ok(!JSON.stringify(f.server.environment.audit.entries()).includes("FT260903ABC1"));
  } finally { guest.close(); await f.close(); }
});

test("AC3 — Rejecting records the reason (not received or amount mismatch), releases the dates, and tells the Guest that no Reservation was made", async () => {
  const f = await startSignedInOperator();
  const guest = guestManualTransfers(f.server.environment);
  try {
    const { requestId, transfer } = await manualTransfer(f, guest, "2026-09-10", "2026-09-12");
    assert.equal(datesFree(f, requestId), false, "held while waiting");
    assert.equal((await act(f, transfer.transferId, "reject", {})).status, 400, "a reason is required");
    assert.equal((await act(f, transfer.transferId, "reject", { reason: "changed_mind" })).status, 400);
    await assertStandardRefusals(f, transfer.transferId, "reject", { reason: "not_received" });
    assert.equal((await act(f, transfer.transferId, "reject", { reason: "amount_mismatch" })).status, 303);
    const shown = card(await queue(f), transfer.transferId);
    assert.equal(shown.status, "rejected");
    assert.match(shown.text, /Declined \(Amount doesn't match\)/);
    assert.equal(datesFree(f, requestId), true, "dates released");
    assert.equal(contracts(f), 0);
    // The Guest's page, from the same record, says no Reservation was made.
    const declined = f.server.environment.listOperatorManualTransfers(f.server.environment.getRepresentativePrincipal()).find((item) => item.transfer.transferId === transfer.transferId)!.transfer;
    assert.match(visibleText(renderManualTransferPageHtml({ transfer: declined, now: f.now(), receiptMaxBytes: 1024, error: "", threadId: null, contractId: null })), /No Reservation was made/);
    assert.match(visibleText(await (await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(requestId)}`)).text()), /The manual transfer was declined; no Reservation was made/);
  } finally { guest.close(); await f.close(); }
});

test("AC4 — A transfer not verified by its deadline is expired on the next read, the dates are released, and any money that later arrives is refunded in full and never confirms the booking", async () => {
  const f = await startSignedInOperator();
  const guest = guestManualTransfers(f.server.environment);
  try {
    const { requestId, transfer } = await manualTransfer(f, guest, "2026-09-10", "2026-09-12");
    const current = version(await queue(f), transfer.transferId);
    f.advance(Date.parse(transfer.verificationDeadlineAt) - f.now().getTime());
    const html = await queue(f);
    assert.equal(card(html, transfer.transferId).status, "expired", "expired on the next read, no background job");
    assert.equal(datesFree(f, requestId), true);
    // A confirmation that arrives late is refused and never confirms.
    const late = await act(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903LATE", amountReceived: String(transfer.amountKobo / 100) }, { expectedVersion: current });
    assert.equal(late.status, 409);
    assert.match(visibleText(await late.text()), /expired before it was verified; any money received is refunded in full/);
    assert.equal(contracts(f), 0);
    // Money that later arrives is recorded as owed back in full.
    assert.equal((await act(f, transfer.transferId, "late-credit", { bankTransactionReference: "FT260903LATE", amountReceived: String(transfer.amountKobo / 100) })).status, 303);
    const shown = card(await queue(f), transfer.transferId);
    assert.ok(shown.text.includes(`${formatMoney(transfer.amountKobo)} is owed back to the Guest in full`));
    assert.equal(contracts(f), 0);
    assert.match(visibleText(await (await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(requestId)}`)).text()), /Payment arrived after the deadline; a full refund is owed to the Guest/);
  } finally { guest.close(); await f.close(); }
});

test("AC5 — Receipts are viewable only by a signed-in grant holder for that owner, never logged, and deleted 90 days after the stay (ADR 0090)", async () => {
  const f = await startSignedInOperator();
  const guest = guestManualTransfers(f.server.environment);
  try {
    const { transfer } = await manualTransfer(f, guest, "2026-09-10", "2026-09-12");
    const path = `/operator/transfers/${transfer.transferId}/receipt`;
    const shown = await operatorGet(f.session, path);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get("content-type"), "image/png");
    assert.equal(shown.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), TEST_RECEIPTS.png);
    // No session: to sign-in, never the file.
    const anonymous = await operatorGet(f.session, path, "");
    assert.equal(anonymous.status, 303);
    // Never logged: the audit notes that it was opened, not what it contains.
    const audit = JSON.stringify(f.server.environment.audit.entries());
    assert.ok(!audit.includes(TEST_RECEIPTS.png.toString("base64")) && !audit.includes(TEST_RECEIPTS.png.toString("hex")));

    // Confirmed, then 90 days after the stay's 11:00 WAT checkout the receipt is deleted.
    assert.equal((await act(f, transfer.transferId, "confirm", { bankTransactionReference: "FT260903RET1", amountReceived: String(transfer.amountKobo / 100) })).status, 303);
    f.advance(Date.parse("2026-09-12T10:00:00.000Z") + RECEIPT_RETENTION_DAYS * DAY - 1 - f.now().getTime());
    const cookieAfterSleep = await (await import("./helpers/operator-session.js")).signInOperator(f.server);
    assert.equal((await operatorGet(f.session, path, cookieAfterSleep)).status, 200, "kept until 90 days after checkout");
    f.advance(1);
    const later = await (await import("./helpers/operator-session.js")).signInOperator(f.server);
    const html = await (await operatorGet(f.session, "/operator/transfers", later)).text();
    assert.match(card(html, transfer.transferId).text, /Deleted after 90 days/);
    assert.equal((await operatorGet(f.session, path, later)).status, 404);
  } finally { guest.close(); await f.close(); }

  // A revoked grant cannot open the receipt: not found, never the file (ADR 0082).
  const r = await startSignedInOperator();
  const other = guestManualTransfers(r.server.environment);
  try {
    const { transfer } = await manualTransfer(r, other, "2026-09-10", "2026-09-12");
    assert.equal((await operatorGet(r.session, `/operator/transfers/${transfer.transferId}/receipt`)).status, 200);
    revokeRepresentativeGrant(r.server.environment);
    assert.equal((await operatorGet(r.session, `/operator/transfers/${transfer.transferId}/receipt`)).status, 404);
  } finally { other.close(); await r.close(); }
});
