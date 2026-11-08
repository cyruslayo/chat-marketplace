import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lagosCalendarDate } from "../apps/local-owner/src/local-owner-environment.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";
import { decideRequest, operatorGet, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { naira, settlement } from "./helpers/back-office-payouts.js";
import { cookieOf, openComplaint, principal, recordAccess, reservation, travelTo, windowOpens } from "./helpers/back-office-reservation.js";
import { assertNoPaymentMaterial, visibleText } from "./helpers/back-office-page.js";
import { guestCardPayments, TEST_CARD_LAST4, TEST_PAYER_EMAIL } from "./helpers/guest-card-payment.js";
import { pilotMetricsSeed } from "./helpers/pilot-metrics.js";

// Production-launch issue 09 — Pilot metrics operators can see, wrapping pilot-launch-readiness/13.
// Sources and definitions: domains/shortlet/CONTEXT.md "Pilot metrics", ADR 0075, 0086, 0089, 0092, 0096.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function metricsPage(f: SignedInOperator, cookie = cookieOf(f)): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, "/operator/metrics", cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

function request(f: SignedInOperator, checkIn: string, checkOut: string): string {
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `metrics-guest-${checkIn}-${checkOut}`, checkIn, checkOut }).facts.requestId;
}

function offerIdOf(f: SignedInOperator, requestId: string): string {
  const offer = f.server.environment.interactionStore.findConditionalOfferByRequestId(requestId);
  assert.ok(offer, `offer for ${requestId}`);
  return offer.offerId;
}

function paymentRow(html: string, method: string): string {
  const match = html.match(new RegExp(`<tr data-method="${method}">([\\s\\S]*?)</tr>`));
  assert.ok(match, `payment row for ${method}`);
  return visibleText(match[1]!);
}

test("AC1 — Requests received, share confirmed, and median time to confirm", async () => {
  const f = await startSignedInOperator();
  try {
    const first = request(f, "2026-09-10", "2026-09-12");
    f.advance(10 * MINUTE);
    const second = request(f, "2026-09-12", "2026-09-14");
    f.advance(5 * MINUTE);
    assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, first, "confirm")).status, 303);
    f.advance(5 * MINUTE);
    assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, second, "confirm")).status, 303);
    f.advance(1 * MINUTE);
    const declined = request(f, "2026-09-20", "2026-09-21");
    f.advance(1 * MINUTE);
    assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, declined, "decline")).status, 303);

    const { status, text } = await metricsPage(f);
    assert.equal(status, 200);
    assert.match(text, /Requests received 3/);
    assert.match(text, /Confirmed 2 \(67%\)/);
    assert.match(text, /Declined 1/);
    // 15 minutes and 10 minutes from disclosure to confirmation: the median is 12.5 minutes, shown rounded.
    assert.match(text, /Median time to confirm 13 minutes/);
  } finally {
    await f.close();
  }
});

test("AC2 — Payments started, completed, expired and refunded, by payment method", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    // One real completed card payment.
    const paid = await reservation(f, "2026-09-10", "2026-09-11");
    // A second confirmed offer carries the statuses a deterministic provider cannot produce.
    const unpaid = request(f, "2026-09-12", "2026-09-13");
    assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, unpaid, "confirm")).status, 303);
    const offerId = offerIdOf(f, unpaid);

    const seed = pilotMetricsSeed(env);
    try {
      seed.cardSession(offerId, "initiated");
      seed.cardSession(offerId, "expired");
      seed.cardSession(offerId, "failed");
      seed.manualTransfer(offerId, { status: "confirmed", amountKobo: 100_000_00 });
      seed.manualTransfer(offerId, { status: "expired", amountKobo: 100_000_00 });
      seed.manualTransfer(offerId, { status: "rejected", amountKobo: 100_000_00 });
      seed.manualTransfer(offerId, { status: "awaiting_verification", amountKobo: 100_000_00, refundOwedKobo: 50_000_00 });
      seed.bankTransferSession(offerId, { status: "completed", amountKobo: 70_000_00 });
      seed.bankTransferSession(offerId, { status: "refunded", amountKobo: 70_000_00 });
    } finally {
      seed.close();
    }

    const { status, html } = await metricsPage(f);
    assert.equal(status, 200);
    assert.equal(offerIdOf(f, paid).length > 0, true);
    assert.match(paymentRow(html, "fresh_card"), /Card 4 1 1 1 0/);
    assert.match(paymentRow(html, "manual_transfer"), /Manual bank transfer 4 1 1 1 1/);
    assert.match(paymentRow(html, "bank_transfer"), /Paystack bank transfer 2 1 0 0 1/);
    assert.ok(paymentRow(html, "manual_transfer").includes(formatMoney(50_000_00)), "manual refund amount");
    assert.ok(paymentRow(html, "bank_transfer").includes(formatMoney(70_000_00)), "bank refund amount");
  } finally {
    await f.close();
  }
});

test("AC3 — Check-ins with Verified Access, incidents per stay, and relocations and refunds with amounts", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const id = await reservation(f, "2026-09-10", "2026-09-13");
    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, id);
    await travelTo(f, new Date("2026-09-11T08:00:00Z"));
    openComplaint(f, id);

    let page = await metricsPage(f);
    assert.match(page.text, /Check-ins with Verified Access 1 of 1 \(100%\)/);
    assert.match(page.text, /Incidents 1/);
    assert.match(page.text, /Incidents per stay 1\.00/);
    // No durable relocation source: the page says so and never reports a zero.
    assert.match(page.text, /Relocations Not available\./);
    assert.match(page.text, /No durable relocation record exists/);
    assert.doesNotMatch(page.text, /Relocations 0/);

    const current = () => env.operatorReservation(id, principal(f));
    const complaintId = current().openComplaints[0]!.complaintId;
    env.upholdBlockingComplaint(id, principal(f), {
      complaintId,
      firstAffectedNight: "2026-09-11",
      basedOnVersion: current().version,
    });
    const outcome = current().stayOutcome;
    assert.ok(outcome);
    env.recordGuestRefund(id, principal(f), {
      amount: naira(outcome.refundKobo),
      refundedOn: lagosCalendarDate(f.now()),
      reference: "GTB-REFUND-METRICS-1",
      basedOnVersion: current().version,
    });

    page = await metricsPage(f);
    assert.ok(page.text.includes(`Paid to Guests 1 (${formatMoney(outcome.refundKobo)})`), "refunds paid to Guests with the amount");
    assert.ok(page.text.includes(`Decided under a cancellation policy 1 (${formatMoney(outcome.refundKobo)})`), "refund decided by policy with the amount");
  } finally {
    await f.close();
  }
});

test("AC4 — Margin earned, and owner payables due and paid (ADR 0089)", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-12");
    const captured = settlement(f, id);

    let page = await metricsPage(f);
    assert.ok(page.text.includes(`Owner payables not yet due ${formatMoney(captured.ownerPayableKobo)}`));
    assert.ok(page.text.includes(`Margin earned ${formatMoney(0)}`));
    assert.ok(page.text.includes(`Owner payables due ${formatMoney(0)}`));

    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, id);
    await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));

    page = await metricsPage(f);
    assert.ok(page.text.includes(`Margin earned ${formatMoney(captured.marginKobo)}`), "margin earned when the payable is due");
    assert.ok(page.text.includes(`Owner payables due ${formatMoney(captured.ownerPayableKobo)}`));
    assert.ok(page.text.includes(`Owner payables paid ${formatMoney(0)}`));

    const env = f.server.environment;
    env.recordOwnerPayout(id, principal(f), {
      amount: naira(captured.ownerPayableKobo),
      paidOn: lagosCalendarDate(f.now()),
      reference: "GTB-OWNER-METRICS-1",
      basedOnVersion: env.ownerPayable(id, principal(f)).payable!.version,
    });

    page = await metricsPage(f);
    assert.ok(page.text.includes(`Owner payables paid ${formatMoney(captured.ownerPayableKobo)}`));
    assert.ok(page.text.includes(`Owner payables due ${formatMoney(0)}`));
    assert.ok(page.text.includes(`Margin earned ${formatMoney(captured.marginKobo)}`));
  } finally {
    await f.close();
  }
});

test("AC5 — Metric names are defined in domains/shortlet/CONTEXT.md before use", () => {
  const context = readFileSync(new URL("../domains/shortlet/CONTEXT.md", import.meta.url), "utf8");
  assert.match(context, /^## Pilot metrics$/m);
  for (const name of [
    "Requests received",
    "Confirmed share",
    "Median time to confirm",
    "Payment started",
    "Payment completed",
    "Payment expired",
    "Payment failed",
    "Payment refunded",
    "Verified Access check-in",
    "Incident",
    "Incidents per stay",
    "Relocation outcome",
    "Refund amount paid to Guests",
    "Refund decided under a cancellation policy",
    "Refund recorded for refund",
    "Margin earned",
    "Owner payables due / paid / not yet due",
  ]) {
    assert.ok(context.includes(`**${name}**`), `${name} is defined`);
  }
});

test("AC7 — The page refuses a request without operator authentication", async () => {
  const f = await startSignedInOperator();
  try {
    const anonymous = await operatorGet(f.session, "/operator/metrics", "");
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get("location"), "/operator/login");

    // An expired session (ADR 0086) lands on sign-in with the fixed reason.
    f.advance(12 * HOUR + MINUTE);
    const expired = await operatorGet(f.session, "/operator/metrics");
    assert.equal(expired.status, 303);
    assert.equal(expired.headers.get("location"), "/operator/login?reason=expired");

    // A forged session secret is treated as no session.
    const forged = f.session.cookie.replace(/shortlet_operator_secret=[^;]+/, "shortlet_operator_secret=forged");
    assert.equal((await operatorGet(f.session, "/operator/metrics", forged)).headers.get("location"), "/operator/login");
  } finally {
    await f.close();
  }
});

test("AC8 — The page shows no guest contact, card or payment-reference material beyond what ADR 0075 and 0096 allow", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const id = await reservation(f, "2026-09-10", "2026-09-11");
    const offer = env.interactionStore.findConditionalOfferByRequestId(id);
    assert.ok(offer);
    const session = env.interactionStore.findCheckoutSessionByOfferId(offer.offerId);
    assert.ok(session);

    const { html } = await metricsPage(f);
    assertNoPaymentMaterial(html, [TEST_CARD_LAST4, TEST_PAYER_EMAIL, "psp-ref-", "psp_ref_", session.pspReference]);
    assert.doesNotMatch(html, /\+234|@example\.(com|test)/, "no guest contact");
    assert.doesNotMatch(html, /GTB-|transfer reference|bank transaction reference/i, "no payment reference");
  } finally {
    await f.close();
  }
});
