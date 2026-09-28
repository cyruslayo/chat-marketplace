import test from "node:test";
import assert from "node:assert/strict";
import { ownerShareAfterCancellation } from "../domains/shortlet/src/index.js";
import { FOREIGN_ORIGIN, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { cookieOf, openComplaint, principal, recordAccess, reservation, travelTo, windowOpens } from "./helpers/back-office-reservation.js";
import { contractOf, naira, pay, payableRow, payoutsPage, settlement } from "./helpers/back-office-payouts.js";
import { visibleText } from "./helpers/back-office-page.js";
import { lagosCalendarDate } from "../apps/local-owner/src/local-owner-environment.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";

// Issue 14 — uphold a Blocking Fulfilment Complaint and record the Guest's refund
// (.scratch/operator-dashboard/issues/14-record-an-upheld-complaint-outcome.md, ADR 0061, 0028, 0089, 0091).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function reservationPage(f: SignedInOperator, id: string, cookie = cookieOf(f)): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(id)}`, cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

const openIds = (f: SignedInOperator, id: string) => f.server.environment.operatorReservation(id, principal(f)).openComplaints.map((complaint) => complaint.complaintId);

function formVersion(html: string, action: string): string {
  const version = html.match(new RegExp(`action="${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?name="basedOnVersion" value="([^"]+)"`))?.[1];
  assert.ok(version, `form ${action}`);
  return version;
}

const upholdAction = (id: string, complaintId: string) => `/operator/bookings/${id}/blocking-complaint/${complaintId}/uphold`;
const refundAction = (id: string) => `/operator/bookings/${id}/guest-refund`;

async function uphold(f: SignedInOperator, id: string, complaintId: string, firstNight: string, options: { cookie?: string; origin?: string; basedOnVersion?: string; extra?: Record<string, string> } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? formVersion((await reservationPage(f, id)).html, upholdAction(id, complaintId));
  return operatorPost(f.session, upholdAction(id, complaintId), options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, { basedOnVersion, firstNight, ...options.extra });
}

async function refund(f: SignedInOperator, id: string, fields: { amount: string; refundedOn: string; reference: string }, options: { cookie?: string; origin?: string; basedOnVersion?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? formVersion((await reservationPage(f, id)).html, refundAction(id));
  return operatorPost(f.session, refundAction(id), options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, { basedOnVersion, ...fields });
}

/** A three-night stay, 10–13 Sept, with Verified Access at 2:30 PM WAT on the 10th and a complaint the next morning. */
async function complainedStay(f: SignedInOperator): Promise<{ id: string; complaintId: string; accessAt: Date }> {
  const id = await reservation(f, "2026-09-10", "2026-09-13");
  const accessAt = new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE);
  await travelTo(f, accessAt);
  recordAccess(f, id);
  await travelTo(f, new Date("2026-09-11T08:00:00Z"));
  openComplaint(f, id);
  const [complaintId] = openIds(f, id);
  assert.ok(complaintId);
  return { id, complaintId, accessAt };
}

/** The Guest's contracted nightly price, from the Booking Contract's quote (ADR 0061: each night's contracted value). */
function nightlyKobo(f: SignedInOperator, id: string): number {
  const quote = contractOf(f, id).quote as { lineItems: { nightlyKobo: number } };
  return quote.lineItems.nightlyKobo;
}

const upheldAudits = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_blocking_complaint_upheld");
const refundAudits = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_guest_refund_recorded");

test("AC1 — From the Reservation page you can uphold an open Blocking Fulfilment Complaint by choosing the first affected night from the stay's nights. The complaint closes as upheld, and the Guest's refund is fixed: 100% of the nightly price for each night from the first affected night to checkout, or the whole amount paid when the first night is affected", async () => {
  const f = await startSignedInOperator();
  try {
    const { id, complaintId } = await complainedStay(f);
    const page = await reservationPage(f, id);
    // The night choices are the stay's own nights, with no free text.
    for (const night of ["2026-09-10", "2026-09-11", "2026-09-12"]) assert.match(page.html, new RegExp(`name="firstNight" value="${night}"`));
    assert.doesNotMatch(page.html, /name="firstNight" value="2026-09-13"/, "checkout day is not a night");

    const done = await uphold(f, id, complaintId, "2026-09-11");
    assert.equal(done.status, 303);
    assert.equal(done.headers.get("location"), `/operator/bookings/${id}`);
    assert.deepEqual(openIds(f, id), []);
    const expected = 2 * nightlyKobo(f, id);
    const outcome = f.server.environment.operatorReservation(id, principal(f)).stayOutcome;
    assert.ok(outcome);
    assert.equal(outcome.firstAffectedNight, "2026-09-11");
    assert.equal(outcome.refundKobo, expected, "two unused nights at the contracted nightly price");
    const text = (await reservationPage(f, id)).text;
    assert.match(text, /Blocking Fulfilment Complaint upheld/);
    assert.ok(text.includes(`Refund owed to the Guest ${formatMoney(expected)}`));
    // The audit keeps codes and amounts only (ADR 0075).
    const [entry] = upheldAudits(f);
    assert.ok(entry);
    assert.equal(entry.firstAffectedNight, "2026-09-11");
    assert.equal(entry.refundKobo, expected);

    // Affected from the first night: everything paid is refunded.
    const other = await reservation(f, "2026-09-20", "2026-09-22");
    await travelTo(f, new Date(windowOpens("2026-09-20").getTime() + 30 * MINUTE));
    recordAccess(f, other);
    openComplaint(f, other);
    assert.equal((await uphold(f, other, openIds(f, other)[0]!, "2026-09-20")).status, 303);
    const env = f.server.environment;
    assert.equal(env.operatorReservation(other, principal(f)).stayOutcome!.refundKobo, env.operatorReservation(other, principal(f)).amountPaidKobo);
  } finally { await f.close(); }
});

test("AC2 — Upholding posts the outcome as the booking's cancellation outcome. The owner payable becomes the owner's share of what is kept, due at once, and a payout already above it shows as an Owner Overpayment", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const { id, complaintId } = await complainedStay(f);
    const captured = settlement(f, id);
    const refundKobo = 2 * nightlyKobo(f, id);
    assert.equal((await uphold(f, id, complaintId, "2026-09-11")).status, 303);
    const retained = captured.ownerPayableKobo + captured.marginKobo - refundKobo;
    const share = ownerShareAfterCancellation(captured, retained);
    let payable = env.ownerPayable(id, principal(f)).payable!;
    assert.equal(payable.ownerPayableKobo, share.ownerPayableKobo, "the owner keeps the share of the nights enjoyed");
    assert.equal(payable.status, "due", "due at once: the stay has ended");
    assert.equal(payable.dueAt, f.now().toISOString());
    assert.match(payableRow((await payoutsPage(f)).html, id).text, /Ended by an upheld Blocking Fulfilment Complaint/);

    // A payout made before the upheld outcome: the excess is an Owner Overpayment (issue 11).
    const second = await reservation(f, "2026-09-20", "2026-09-23");
    await travelTo(f, new Date(windowOpens("2026-09-20").getTime() + 30 * MINUTE));
    recordAccess(f, second);
    await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));
    const full = settlement(f, second).ownerPayableKobo;
    assert.equal((await pay(f, second, { amount: naira(full), paidOn: lagosCalendarDate(f.now()), reference: "GTB-OWNER-UPHELD" })).status, 303);
    openComplaint(f, second);
    assert.equal((await uphold(f, second, openIds(f, second)[0]!, "2026-09-22")).status, 303);
    payable = env.ownerPayable(second, principal(f)).payable!;
    assert.equal(payable.status, "overpaid");
    assert.equal(payable.overpaidKobo, full - payable.ownerPayableKobo);
  } finally { await f.close(); }
});

test("AC3 — The Reservation page and Home show the refund owed to the Guest until it is fully recorded. You record it with its date, amount and reference. Recording more than is owed, when nothing is owed, with a reference already used for another amount, or from a stale version is refused", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const { id, complaintId } = await complainedStay(f);
    // Nothing is owed before an upheld outcome: there is no refund form, and a post is refused.
    const before = (await reservationPage(f, id)).html;
    assert.doesNotMatch(before, /\/guest-refund"/);
    const early = await refund(f, id, { amount: "1", refundedOn: lagosCalendarDate(f.now()), reference: "RF-0" }, { basedOnVersion: formVersion(before, upholdAction(id, complaintId)) });
    assert.equal(early.status, 409);
    assert.match(visibleText(await early.text()), /No refund is owed to the Guest on this booking\./);

    assert.equal((await uphold(f, id, complaintId, "2026-09-11")).status, 303);
    const owed = 2 * nightlyKobo(f, id);
    const home = async () => await (await operatorGet(f.session, "/operator", cookieOf(f))).text();
    let html = await home();
    assert.match(html, /data-kind="guest_refund"/);
    assert.match(visibleText(html), /Refund owed to the Guest/);
    assert.ok(html.includes(`href="/operator/bookings/${id}"`));

    const today = lagosCalendarDate(f.now());
    const version = formVersion((await reservationPage(f, id)).html, refundAction(id));
    for (const [fields, message] of [
      [{ amount: "", refundedOn: today, reference: "RF-1" }, /Enter the amount refunded in naira/],
      [{ amount: naira(owed), refundedOn: "2099-01-01", reference: "RF-1" }, /Enter the date you refunded the Guest, not later than today/],
      [{ amount: naira(owed), refundedOn: today, reference: "" }, /Enter the refund reference/],
    ] as const) {
      const refused = await refund(f, id, fields, { basedOnVersion: version });
      assert.equal(refused.status, 400);
      assert.match(visibleText(await refused.text()), message);
    }
    let refused = await refund(f, id, { amount: naira(owed + 100), refundedOn: today, reference: "RF-1" }, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /The amount is more than is owed to the Guest\. Nothing was recorded\./);

    // A part, then the rest.
    const part = Math.floor(owed / 4);
    assert.equal((await refund(f, id, { amount: naira(part), refundedOn: today, reference: "RF-1" }, { basedOnVersion: version })).status, 303);
    assert.ok((await reservationPage(f, id)).text.includes(`Still to refund ${formatMoney(owed - part)}`));
    assert.match(await home(), /data-kind="guest_refund"/, "listed until fully refunded");
    refused = await refund(f, id, { amount: naira(part), refundedOn: today, reference: "RF-2" }, { basedOnVersion: version });
    assert.equal(refused.status, 409, "a stale version");
    assert.match(visibleText(await refused.text()), /changed since you opened it/);
    refused = await refund(f, id, { amount: "1", refundedOn: today, reference: "RF-1" });
    assert.equal(refused.status, 409, "a reference already used for another amount");
    assert.equal((await refund(f, id, { amount: naira(owed - part), refundedOn: today, reference: "RF-2" })).status, 303);
    const outcome = env.operatorReservation(id, principal(f)).stayOutcome!;
    assert.equal(outcome.refundedKobo, owed);
    assert.equal(outcome.refundOutstandingKobo, 0);
    html = await home();
    assert.doesNotMatch(html, /data-kind="guest_refund"/);
    const page = await reservationPage(f, id);
    assert.match(page.text, /Refunded in full/);
    assert.doesNotMatch(page.html, /\/guest-refund"/);
    // Nothing more is owed.
    refused = await refund(f, id, { amount: "1", refundedOn: today, reference: "RF-3" }, { basedOnVersion: env.operatorReservation(id, principal(f)).version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /No refund is owed to the Guest on this booking\./);
    // The audit keeps the amount, never the reference (ADR 0075).
    assert.equal(refundAudits(f).length, 2);
    assert.doesNotMatch(JSON.stringify(refundAudits(f)), /RF-1|RF-2/);
  } finally { await f.close(); }
});

test("AC4 — Upholding is refused for a complaint that is already closed, for a night outside the stay, for a stay an earlier outcome already ended, or from a stale version. The standard failure paths apply", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const { id, complaintId } = await complainedStay(f);
    const version = formVersion((await reservationPage(f, id)).html, upholdAction(id, complaintId));

    // The standard failure paths.
    assert.equal((await uphold(f, id, complaintId, "2026-09-11", { cookie: "", basedOnVersion: version })).status, 401, "no session");
    assert.equal((await uphold(f, id, complaintId, "2026-09-11", { origin: FOREIGN_ORIGIN, basedOnVersion: version })).status, 403, "cross-origin POST");
    assert.equal((await uphold(f, "req-unknown", complaintId, "2026-09-11", { basedOnVersion: version })).status, 404, "an unknown booking");
    // What was chosen.
    for (const night of ["2026-09-13", "2026-09-09", "", "11-09-2026"]) {
      const refused = await uphold(f, id, complaintId, night, { basedOnVersion: version });
      assert.equal(refused.status, 400, `night "${night}"`);
      assert.match(visibleText(await refused.text()), /Choose the first affected night of the stay/);
    }
    assert.equal((await uphold(f, id, complaintId, "2026-09-11", { basedOnVersion: version, extra: { note: "free text" } })).status, 400, "an unexpected field");
    assert.equal((await uphold(f, id, "cmpl_unknown", "2026-09-11", { basedOnVersion: version })).status, 409, "an unknown complaint");
    // A stale version.
    openComplaint(f, id, "access_failure");
    let refused = await uphold(f, id, complaintId, "2026-09-11", { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /changed since you opened it/);
    assert.equal(upheldAudits(f).length, 0);

    // An earlier outcome ended the stay: the second complaint cannot be upheld as well.
    assert.equal((await uphold(f, id, complaintId, "2026-09-11")).status, 303);
    const [second] = openIds(f, id);
    assert.ok(second);
    const current = env.operatorReservation(id, principal(f)).version;
    refused = await uphold(f, id, second, "2026-09-12", { basedOnVersion: current });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This stay already has an upheld outcome\. Nothing was recorded\./);
    // Already closed.
    refused = await uphold(f, id, complaintId, "2026-09-11", { basedOnVersion: current });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This complaint is already closed|This stay already has an upheld outcome/);
    assert.equal(upheldAudits(f).length, 1);

    // A revoked grant fails closed (ADR 0082).
    revokeRepresentativeGrant(env);
    assert.equal((await refund(f, id, { amount: "1", refundedOn: lagosCalendarDate(f.now()), reference: "RF-9" }, { basedOnVersion: current })).status, 404);
    assert.equal((await uphold(f, id, second, "2026-09-12", { basedOnVersion: current })).status, 404);
  } finally { await f.close(); }
});
