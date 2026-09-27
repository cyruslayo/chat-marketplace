import test from "node:test";
import assert from "node:assert/strict";
import { FOREIGN_ORIGIN, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { TEST_CARD_LAST4, TEST_PAYER_EMAIL, guestCardPayments, type GuestCardPayments } from "./helpers/guest-card-payment.js";
import { formatWat } from "../apps/local-owner/src/back-office-view.js";
import { PAYMENT_PROCESSING_GRACE_MINUTES } from "../domains/shortlet/src/index.js";

// B4 — bookings and their payment state (scratch/operator-dashboard/issues/04-bookings.md).

const MINUTE = 60_000;
/** ADR 0044: the Payment Window opens at confirmation and lasts 20 minutes. */
const PAYMENT_WINDOW_MINUTES = 20;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";

let guests = 0;
function request(f: SignedInOperator, checkIn: string, checkOut: string): string {
  guests += 1;
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `booking-guest-${guests}`, guestName: `Booking Guest ${guests}`, checkIn, checkOut }).facts.requestId;
}

async function confirmed(f: SignedInOperator, checkIn: string, checkOut: string): Promise<string> {
  const id = request(f, checkIn, checkOut);
  assert.equal((await decideRequest(f.session, id, "confirm")).status, 303);
  return id;
}

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function bookingsPage(f: SignedInOperator): Promise<string> {
  const response = await operatorGet(f.session, "/operator/bookings");
  assert.equal(response.status, 200);
  return response.text();
}

/** Booking rows in page order, keyed by request id. */
function rows(html: string): Map<string, { readonly stage: string; readonly text: string; readonly html: string }> {
  const found = new Map<string, { stage: string; text: string; html: string }>();
  for (const match of html.matchAll(/<li class="bo-booking" data-request-id="([^"]+)" data-stage="([^"]+)">([\s\S]*?)<\/li>/g)) {
    found.set(match[1]!, { stage: match[2]!, text: visibleText(match[3]!), html: match[3]! });
  }
  return found;
}

function row(html: string, id: string) {
  const found = rows(html).get(id);
  assert.ok(found, `booking ${id} is listed`);
  return found;
}

const paymentDeadline = (f: SignedInOperator, id: string) => {
  const offer = f.server.environment.interactionStore.findConditionalOfferByRequestId(id);
  assert.ok(offer, "offer issued");
  return (JSON.parse(offer.offerJson) as { paymentWindow: { expiresAt: string } }).paymentWindow.expiresAt;
};

async function withGuest(f: SignedInOperator, run: (guest: GuestCardPayments) => Promise<void>, options: Parameters<typeof guestCardPayments>[1] = {}) {
  const guest = guestCardPayments(f.server.environment, options);
  try { await run(guest); } finally { guest.close(); }
}

test("AC1 — Every confirmed request appears with its owner, apartment, current stage and payment method, read from the authoritative artifacts on each view", async () => {
  const f = await startSignedInOperator();
  try {
    await withGuest(f, async (guest) => {
      const offerIssued = await confirmed(f, "2026-09-10", "2026-09-12");
      const awaiting = await confirmed(f, "2026-09-14", "2026-09-16");
      const reserved = await confirmed(f, "2026-09-18", "2026-09-20");
      const pending = request(f, "2026-09-22", "2026-09-24");
      const declined = request(f, "2026-09-26", "2026-09-28");
      assert.equal((await decideRequest(f.session, declined, "decline")).status, 303);

      guest.startCard(awaiting);
      guest.pay(reserved);

      const html = await bookingsPage(f);
      const listed = rows(html);
      assert.deepEqual([...listed.keys()].sort(), [offerIssued, awaiting, reserved].sort(), "only confirmed requests are bookings");
      assert.ok(!listed.has(pending) && !listed.has(declined));

      for (const id of [offerIssued, awaiting, reserved]) {
        assert.match(row(html, id).text, new RegExp(OWNER), "owner");
        assert.match(row(html, id).text, new RegExp(APARTMENT), "apartment");
      }
      assert.equal(row(html, offerIssued).stage, "offer_issued");
      assert.match(row(html, offerIssued).text, /Offer issued/);
      assert.match(row(html, offerIssued).text, /Payment method: Not chosen yet/);
      assert.equal(row(html, awaiting).stage, "awaiting_payment");
      assert.match(row(html, awaiting).text, /Awaiting payment/);
      assert.match(row(html, awaiting).text, /Payment method: Card/);
      assert.equal(row(html, reserved).stage, "reservation_confirmed");
      assert.match(row(html, reserved).text, /Reservation confirmed/);
      assert.match(row(html, reserved).text, /Payment method: Card/);

      // Each view re-reads what the Guest side wrote through its own connection: no restart, no cache.
      guest.pay(awaiting);
      assert.equal(row(await bookingsPage(f), awaiting).stage, "reservation_confirmed");

      // The detail page reads the same artifacts.
      const detail = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(reserved)}`);
      assert.equal(detail.status, 200);
      const detailText = visibleText(await detail.text());
      for (const fact of [OWNER, APARTMENT, "Reservation confirmed", "Card"]) assert.match(detailText, new RegExp(fact));

      // The page never issues a command: there is no POST route, same-origin or not, and nothing changes.
      for (const origin of [undefined, FOREIGN_ORIGIN]) {
        const headers: Record<string, string> = origin === undefined ? {} : { origin };
        assert.equal((await operatorPost(f.session, "/operator/bookings", f.session.cookie, headers)).status, 404);
        assert.equal((await operatorPost(f.session, `/operator/bookings/${encodeURIComponent(offerIssued)}`, f.session.cookie, headers)).status, 404);
      }
      assert.equal(row(await bookingsPage(f), offerIssued).stage, "offer_issued");

      // No session fails closed to sign-in.
      for (const path of ["/operator/bookings", `/operator/bookings/${encodeURIComponent(reserved)}`]) {
        const anonymous = await operatorGet(f.session, path, "");
        assert.equal(anonymous.status, 303, path);
        assert.equal(anonymous.headers.get("location"), "/operator/login", path);
      }

      // Bookings sits in the shared back-office navigation.
      assert.match(await (await operatorGet(f.session, "/operator")).text(), /<a[^>]*href="\/operator\/bookings"[^>]*>[\s\S]*?Bookings<\/a>/);
      assert.match(html, /<a[^>]*href="\/operator\/bookings" aria-current="page"/);
    });
  } finally { await f.close(); }
});

test("AC2 — Payment deadlines are shown as absolute WAT, and an ended booking says why without card or account details", async () => {
  const f = await startSignedInOperator();
  try {
    await withGuest(f, async (guest) => {
      const neverAccepted = await confirmed(f, "2026-09-10", "2026-09-12");
      const cardOpen = await confirmed(f, "2026-09-14", "2026-09-16");
      const processing = await confirmed(f, "2026-09-18", "2026-09-20");
      const late = await confirmed(f, "2026-09-22", "2026-09-24");
      const deadline = paymentDeadline(f, neverAccepted);
      assert.equal(Date.parse(deadline) - f.now().getTime(), PAYMENT_WINDOW_MINUTES * MINUTE);

      guest.startCard(cardOpen);
      guest.startCard(processing);
      guest.verify(processing, "processing");
      guest.startCard(late);

      let html = await bookingsPage(f);
      for (const id of [neverAccepted, cardOpen]) {
        const found = row(html, id);
        assert.match(found.text, new RegExp(`Pay by ${escapeRegExp(formatWat(paymentDeadline(f, id)))}`), "absolute WAT Payment Window deadline");
        assert.match(found.html, new RegExp(`<time datetime="${escapeRegExp(paymentDeadline(f, id))}">`));
      }
      // A designated in-flight transaction shows its one Payment-Processing Grace (ADR 0044).
      const graceEnds = new Date(Date.parse(paymentDeadline(f, processing)) + PAYMENT_PROCESSING_GRACE_MINUTES * MINUTE).toISOString();
      assert.equal(row(html, processing).stage, "awaiting_payment");
      assert.match(row(html, processing).text, new RegExp(`Payment-Processing Grace until ${escapeRegExp(formatWat(graceEnds))}`));

      // Past the Payment Window, the next read ends them without a background job.
      f.advance(PAYMENT_WINDOW_MINUTES * MINUTE);
      html = await bookingsPage(f);
      assert.equal(row(html, neverAccepted).stage, "ended");
      assert.match(row(html, neverAccepted).text, /Ended The offer expired before the Guest accepted it/);
      assert.equal(row(html, cardOpen).stage, "ended");
      assert.match(row(html, cardOpen).text, /Ended The Payment Window ended without a verified payment/);
      assert.equal(row(html, processing).stage, "awaiting_payment", "still inside its grace");

      // Money that succeeds after the grace is a late payment: never confirms, refunded in full (ADR 0045).
      f.advance(PAYMENT_PROCESSING_GRACE_MINUTES * MINUTE + 1);
      guest.verify(late, "success");
      html = await bookingsPage(f);
      assert.equal(row(html, processing).stage, "ended");
      assert.equal(row(html, late).stage, "ended");
      assert.match(row(html, late).text, /Ended Payment arrived after the deadline; a full refund is owed to the Guest/);

      // No card, account, reference or contact details anywhere on the page.
      for (const secret of [TEST_CARD_LAST4, TEST_PAYER_EMAIL, "psp_ref_", "chk_", "+234"]) assert.ok(!html.includes(secret), `no ${secret}`);
    });
  } finally { await f.close(); }

  // A refund after the stay was paid but the booking could not complete: started, then received.
  for (const refundStatus of ["pending", "settled"] as const) {
    const r = await startSignedInOperator();
    try {
      await withGuest(r, async (guest) => {
        const id = await confirmed(r, "2026-09-10", "2026-09-12");
        guest.startCard(id);
        guest.verify(id, "success"); // the stay; the fixture unit also takes a deposit
        guest.startCard(id);
        guest.verify(id, "failed"); // the deposit fails, so the stay is refunded
        const found = row(await bookingsPage(r), id);
        assert.equal(found.stage, "ended");
        assert.match(found.text, refundStatus === "pending" ? /Ended Refund started; not yet received by the Guest/ : /Ended Payment refunded in full/);
        for (const secret of [TEST_CARD_LAST4, TEST_PAYER_EMAIL, "psp_ref_", "refund-"]) assert.ok(!found.html.includes(secret), `no ${secret}`);
      }, { refundStatus });
    } finally { await r.close(); }
  }
});

test("AC3 — Only bookings for owners you hold a grant for are listed, and any other booking is not found", async () => {
  const f = await startSignedInOperator();
  try {
    const booked = await confirmed(f, "2026-09-10", "2026-09-12");
    const notABooking = request(f, "2026-09-14", "2026-09-16");
    assert.equal((await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(booked)}`)).status, 200);

    for (const id of [notABooking, "request-that-does-not-exist"]) {
      const response = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(id)}`);
      assert.equal(response.status, 404, id);
      assert.match(visibleText(await response.text()), /Booking not found/);
    }

    revokeRepresentativeGrant(f.server.environment);
    assert.equal(rows(await bookingsPage(f)).size, 0, "a revoked grant lists nothing");
    assert.match(visibleText(await bookingsPage(f)), /No bookings yet/);
    const revoked = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(booked)}`);
    assert.equal(revoked.status, 404, "a booking for an owner you no longer act for is not found");
  } finally { await f.close(); }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
