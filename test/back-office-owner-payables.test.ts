import test from "node:test";
import assert from "node:assert/strict";
import { CancellationNoShowManager } from "../domains/shortlet/src/index.js";
import { FOREIGN_ORIGIN, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { TEST_CARD_LAST4, TEST_PAYER_EMAIL } from "./helpers/guest-card-payment.js";
import { repricedByOwner } from "./helpers/owner-terms.js";
import { cookieOf, openComplaint, principal, recordAccess, reservation, travelTo, windowOpens } from "./helpers/back-office-reservation.js";
import { contractOf, naira, ownerTotals, pay, payableRow, payoutRecords, payoutVersion, payoutsPage, settlement } from "./helpers/back-office-payouts.js";
import { SECOND_OWNER, SECOND_OWNER_ID, SECOND_UNIT_ID, addSecondOwner as addSecondOwnerTo, visibleText } from "./helpers/back-office-page.js";
import { formatWat } from "../apps/local-owner/src/back-office-view.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";

// B7 — what you owe each owner (scratch/operator-dashboard/issues/07-owner-payables.md, ADR 0089).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const OWNER = "Eko Prime Living Ltd";
const addSecondOwner = (f: SignedInOperator) => addSecondOwnerTo(f.server.environment);


test("AC1 — Each booking shows the amount received, the owner payable, your margin, the due date and the status (not yet due, due, paused, or paid), all from the booking snapshot and the ledger", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const id = await reservation(f, "2026-09-10", "2026-09-12");
    const captured = settlement(f, id);
    const received = contractOf(f, id).paymentDetails.amountKobo;
    // The seeded unit: ₦100,000/night + ₦8,333.34 agreed at 20%, two nights.
    assert.equal(captured.ownerPayableKobo, 20_833_334);
    assert.equal(captured.marginKobo, 4_166_666);

    // Not yet due: no Verified Access yet.
    let shown = await payoutsPage(f);
    assert.equal(shown.status, 200);
    assert.match(shown.html, /aria-current="page"[^>]*>[\s\S]*?Payouts|href="\/operator\/payouts" aria-current="page"/);
    let row = payableRow(shown.html, id);
    assert.equal(row.status, "not_yet_due");
    assert.ok(shown.html.includes(`>${OWNER}</h2>`), "grouped under its owner");
    for (const fact of ["Luxury 2-Bedroom Apartment in Old Ikoyi", `Amount received ${formatMoney(received)}`, `Owner payable ${formatMoney(captured.ownerPayableKobo)}`, `Your margin ${formatMoney(captured.marginKobo)}`, "Status Not yet due", "Due 24 hours after Verified Access"]) {
      assert.ok(row.text.includes(fact), `shows ${fact}`);
    }
    for (const secret of [TEST_CARD_LAST4, TEST_PAYER_EMAIL, "psp_ref_"]) assert.ok(!shown.html.includes(secret), `no ${secret}`);
    assert.doesNotMatch(row.html, /<form/, "no payout form before it is due");

    // Verified Access starts the 24 hours (ADR 0089); the status turns due lazily, with no command.
    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, id);
    const dueAt = new Date(f.now().getTime() + 24 * HOUR).toISOString();
    row = payableRow((await payoutsPage(f)).html, id);
    assert.equal(row.status, "not_yet_due");
    assert.ok(row.text.includes(`Due ${formatWat(dueAt)}`));
    assert.ok(row.html.includes(`<time datetime="${dueAt}">`));
    await travelTo(f, new Date(Date.parse(dueAt) - MINUTE));
    assert.equal(payableRow((await payoutsPage(f)).html, id).status, "not_yet_due");
    await travelTo(f, new Date(dueAt));
    shown = await payoutsPage(f);
    row = payableRow(shown.html, id);
    assert.equal(row.status, "due");
    assert.ok(row.text.includes("Status Due"));

    // The unit is repriced later; the payable keeps its confirmation snapshot (ADR 0077).
    const unit = env.unitRepository.findById(env.config.unitId)!;
    env.unitRepository.save({ ...unit, price: repricedByOwner(unit.price, { ownerNightlyKobo: 30_000_000, marginBasisPoints: 5000 }) });
    row = payableRow((await payoutsPage(f)).html, id);
    assert.ok(row.text.includes(`Owner payable ${formatMoney(captured.ownerPayableKobo)}`));
    assert.ok(row.text.includes(`Your margin ${formatMoney(captured.marginKobo)}`));

    // Paid, from the ledger.
    assert.equal((await pay(f, id, { amount: naira(captured.ownerPayableKobo), paidOn: "2026-09-11", reference: "GTB-OWNER-0001" })).status, 303);
    row = payableRow((await payoutsPage(f)).html, id);
    assert.equal(row.status, "paid");
    assert.ok(row.text.includes("Status Paid"));
    assert.ok(row.text.includes(`${formatMoney(captured.ownerPayableKobo)} paid 11 Sept 2026, reference GTB-OWNER-0001`));

    // Paused: an open Blocking Fulfilment Complaint on another Reservation.
    const paused = await reservation(f, "2026-09-12", "2026-09-14");
    await travelTo(f, new Date(windowOpens("2026-09-12").getTime() + 30 * MINUTE));
    recordAccess(f, paused);
    openComplaint(f, paused);
    await travelTo(f, new Date(f.now().getTime() + 25 * HOUR));
    row = payableRow((await payoutsPage(f)).html, paused);
    assert.equal(row.status, "paused");
    assert.ok(row.text.includes("Status Paused"));
    assert.ok(row.text.includes("Not due while a Blocking Fulfilment Complaint is open"));

    // A booking that never became a Reservation received nothing and owes nothing: it is not listed.
    const unpaid = env.createDemoIncomingBookingRequest({ guestId: "payable-unpaid", checkIn: "2026-09-20", checkOut: "2026-09-22" }).facts.requestId;
    assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, unpaid, "confirm")).status, 303);
    assert.doesNotMatch((await payoutsPage(f)).html, new RegExp(`data-request-id="${unpaid}"`));
  } finally { await f.close(); }
});

test("AC2 — For each owner, the page totals what is due now, what has been paid, and what is not yet due", async () => {
  const f = await startSignedInOperator();
  try {
    addSecondOwner(f);
    const due = await reservation(f, "2026-09-10", "2026-09-12");
    const paid = await reservation(f, "2026-09-12", "2026-09-13");
    const notYet = await reservation(f, "2026-09-20", "2026-09-22");
    const secondDue = await reservation(f, "2026-09-10", "2026-09-11", SECOND_UNIT_ID);
    const secondNotYet = await reservation(f, "2026-09-15", "2026-09-17", SECOND_UNIT_ID);

    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, due);
    recordAccess(f, secondDue);
    await travelTo(f, new Date(windowOpens("2026-09-12").getTime() + 30 * MINUTE));
    recordAccess(f, paid);
    await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));
    assert.equal((await pay(f, paid, { amount: naira(settlement(f, paid).ownerPayableKobo), paidOn: "2026-09-13", reference: "GTB-OWNER-0002" })).status, 303);
    // A part payment counts as paid, and the rest stays due.
    assert.equal((await pay(f, due, { amount: "50000", paidOn: "2026-09-13", reference: "GTB-OWNER-0003" })).status, 303);

    const { html } = await payoutsPage(f);
    assert.equal(payableRow(html, due).status, "due");
    assert.equal(payableRow(html, paid).status, "paid");
    assert.equal(payableRow(html, notYet).status, "not_yet_due");
    assert.deepEqual(ownerTotals(html, OWNER), {
      due: formatMoney(settlement(f, due).ownerPayableKobo - 5_000_000),
      paid: formatMoney(settlement(f, paid).ownerPayableKobo + 5_000_000),
      notYetDue: formatMoney(settlement(f, notYet).ownerPayableKobo),
      overpaid: "", // shown only when an owner has an Owner Overpayment (issue 11)
    });
    assert.deepEqual(ownerTotals(html, SECOND_OWNER), {
      due: formatMoney(settlement(f, secondDue).ownerPayableKobo),
      paid: formatMoney(0),
      notYetDue: formatMoney(settlement(f, secondNotYet).ownerPayableKobo),
      overpaid: "",
    });
    assert.equal(settlement(f, secondDue).ownerPayableKobo, 8_000_000, "the second owner's own agreed amount");
    // Each owner's bookings sit under that owner.
    const secondSection = html.slice(html.indexOf(`${SECOND_OWNER}</h2>`));
    assert.ok(secondSection.includes(`data-request-id="${secondDue}"`));

    // A revoked grant hides that owner's payables (ADR 0082).
    revokeRepresentativeGrant(f.server.environment, SECOND_OWNER_ID);
    const after = await payoutsPage(f);
    assert.doesNotMatch(after.html, new RegExp(`data-request-id="${secondDue}"|${SECOND_OWNER}`));

    // Home lists the payouts due, with their due dates (B1).
    const home = visibleText(await (await operatorGet(f.session, "/operator", cookieOf(f))).text());
    assert.match(home, /Owner payout due/);
  } finally { await f.close(); }
});

test("AC3 — You can record a payout for a due payable with its date, amount and reference; paying one not yet due, paying more than is due, or paying twice is refused", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-12");
    const owed = settlement(f, id).ownerPayableKobo;
    const good = { amount: naira(owed), paidOn: "2026-09-03", reference: "GTB-OWNER-0100" };

    // Not yet due: before Verified Access and during the 24 hours, the page offers no form and the POST is refused.
    const notDueVersion = (await f.server.environment.listOwnerPayables(principal(f)))[0]!.payable!.version;
    let refused = await pay(f, id, good, { basedOnVersion: notDueVersion });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This owner payable is not due yet\. Nothing was recorded\./);
    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, id);
    refused = await pay(f, id, good, { basedOnVersion: f.server.environment.listOwnerPayables(principal(f))[0]!.payable!.version });
    assert.equal(refused.status, 409);
    assert.equal(payoutRecords(f), 0);

    await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));
    const before = await payoutsPage(f);
    const form = payableRow(before.html, id).html;
    for (const field of ["amount", "paidOn", "reference"]) assert.match(form, new RegExp(`name="${field}"[^>]*required`), `${field} is required`);

    // Standard refusals: none records anything (ADR 0086, 0072).
    const current = payoutVersion(before.html, id);
    assert.equal((await pay(f, id, good, { cookie: "", basedOnVersion: current })).status, 401, "no session");
    assert.equal((await pay(f, id, good, { origin: FOREIGN_ORIGIN, basedOnVersion: current })).status, 403, "cross-origin POST");
    assert.equal((await pay(f, id, good, { basedOnVersion: "0000000000000000" })).status, 409, "stale version");
    const expired = await (async () => { const cookie = cookieOf(f); f.advance(12 * HOUR + MINUTE); const response = await pay(f, id, good, { cookie, basedOnVersion: current }); f.advance(-(12 * HOUR + MINUTE)); return response; })();
    assert.equal(expired.status, 401, "expired session");
    assert.equal((await operatorPost(f.session, "/operator/payouts/request-unknown", cookieOf(f), {}, { basedOnVersion: current, ...good })).status, 404, "unknown booking");
    assert.equal(payoutRecords(f), 0);

    // Input is checked; nothing is recorded for a bad form.
    for (const [fields, message] of [
      [{ ...good, amount: "" }, "Enter the amount paid in naira"],
      [{ ...good, paidOn: "2026-09-31" }, "Enter the date you paid, not later than today"],
      [{ ...good, paidOn: "2026-12-01" }, "Enter the date you paid, not later than today"],
      [{ ...good, reference: "" }, "Enter the payment reference"],
    ] as const) {
      const response = await pay(f, id, fields);
      assert.equal(response.status, 400);
      assert.ok(visibleText(await response.text()).includes(message), message);
    }
    const extra = await operatorPost(f.session, `/operator/payouts/${id}`, cookieOf(f), {}, { basedOnVersion: current, ...good, ownerAccountNumber: "0123456789" });
    assert.equal(extra.status, 400, "no other fields ride along");

    // More than is due is refused.
    refused = await pay(f, id, { ...good, amount: naira(owed + 1) });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /The amount is more than is due\. Nothing was recorded\./);
    assert.equal(payoutRecords(f), 0);

    // The payout records with its date, amount and reference.
    assert.equal((await pay(f, id, good)).status, 303);
    assert.equal(payoutRecords(f), 1);
    const audit = f.server.environment.audit.entries().find((entry) => entry.type === "operator_owner_payout_recorded")!;
    assert.equal(audit.amountKobo, owed);
    assert.ok(!JSON.stringify(audit).includes("GTB-OWNER-0100"), "the reference is not audited (ADR 0075)");

    // Replaying the same payout is idempotent (ADR 0072); paying again is refused.
    assert.equal((await pay(f, id, good, { basedOnVersion: current })).status, 303);
    assert.equal(payoutRecords(f), 1);
    refused = await pay(f, id, { ...good, reference: "GTB-OWNER-0101" }, { basedOnVersion: f.server.environment.listOwnerPayables(principal(f))[0]!.payable!.version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This owner payable is already paid\. Nothing was recorded\./);
    refused = await pay(f, id, { ...good, amount: "1" }, { basedOnVersion: current });
    assert.equal(refused.status, 409, "the same reference with another amount");
    assert.equal(f.server.environment.listOwnerPayables(principal(f))[0]!.payable!.paidKobo, owed);

    // A revoked grant fails closed (ADR 0082).
    const second = await reservation(f, "2026-09-20", "2026-09-21");
    await travelTo(f, new Date(windowOpens("2026-09-20").getTime() + 30 * MINUTE));
    recordAccess(f, second);
    await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));
    const version = payoutVersion((await payoutsPage(f)).html, second);
    revokeRepresentativeGrant(f.server.environment);
    assert.equal((await pay(f, second, { ...good, reference: "GTB-OWNER-0200" }, { basedOnVersion: version })).status, 404);
    assert.equal(payoutRecords(f), 1);
  } finally { await f.close(); }
});

test("AC4 — A booking cancelled or refunded under its cancellation policy shows the owner payable that policy outcome leaves, and a paused payable (an open blocking complaint) cannot be paid", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const policy = new CancellationNoShowManager();
    /** Posts the cancellation policy outcome to the ledger, as the cancellation application does. */
    const cancel = (id: string, liability: "guest" | "operator_failure") => {
      const captured = settlement(f, id);
      const contract = contractOf(f, id);
      const outcome = policy.calculateAuthoritative({
        reservationId: contract.reservationId, contract,
        economics: { version: "b7", currency: "NGN", cancellationBaseKobo: captured.ownerPayableKobo + captured.marginKobo, refundableCleaningKobo: 0, refundableUnprovidedServicesKobo: 0, refundableSecurityDepositKobo: 0, refundableAttributableTaxKobo: 0, refundableDuplicatePaymentKobo: 0, commissionRate: 0 },
        policy: { type: "standard", version: "cancellation-v1", policySummary: "" },
        checkInWindowStartIso: windowOpens(contract.dates.checkIn).toISOString(), at: f.now(), liability,
      });
      env.ownerPayableLedger.postCancellation({ cancellationId: `cancellation:${contract.reservationId}`, reservationId: contract.reservationId, liability, amountKobo: outcome.totalRefundKobo, retainedCancellationBaseKobo: outcome.retainedCancellationBaseKobo, retainedCommissionKobo: 0, currency: "NGN" });
      return outcome;
    };

    // Standard policy, cancelled 7–14 days before check-in: 50% of the Cancellation Base is kept, so the owner gets half.
    const half = await reservation(f, "2026-09-12", "2026-09-14");
    const halfOutcome = cancel(half, "guest");
    assert.equal(halfOutcome.refundPercentage, 50);
    const captured = settlement(f, half);
    let row = payableRow((await payoutsPage(f)).html, half);
    assert.equal(row.status, "due", "due once the outcome is posted: no Verified Access will follow");
    // Pro rata: the margin keeps its share (rounded down, as when quoted) and the owner the rest.
    const marginHalf = Math.floor(captured.marginKobo * halfOutcome.retainedCancellationBaseKobo / (captured.ownerPayableKobo + captured.marginKobo));
    assert.equal(marginHalf, Math.floor(captured.marginKobo / 2));
    assert.ok(row.text.includes(`Owner payable ${formatMoney(halfOutcome.retainedCancellationBaseKobo - marginHalf)}`), "the owner's pro-rata share");
    assert.ok(row.text.includes(`Your margin ${formatMoney(marginHalf)}`));
    assert.ok(row.text.includes(`Captured at confirmation: ${formatMoney(captured.ownerPayableKobo)}`));
    assert.ok(row.text.includes("Cancelled under the cancellation policy"));
    // You can pay the share, but not the original amount.
    assert.equal((await pay(f, half, { amount: naira(captured.ownerPayableKobo), paidOn: "2026-09-03", reference: "GTB-OWNER-0300" })).status, 409);
    assert.equal((await pay(f, half, { amount: naira(halfOutcome.retainedCancellationBaseKobo - marginHalf), paidOn: "2026-09-03", reference: "GTB-OWNER-0300" })).status, 303);

    // Cancelled 14+ days out: a full refund leaves the owner nothing, and nothing can be paid.
    const full = await reservation(f, "2026-09-25", "2026-09-26");
    assert.equal(cancel(full, "guest").refundPercentage, 100);
    const { html } = await payoutsPage(f);
    row = payableRow(html, full);
    assert.equal(row.status, "nothing_owed");
    assert.ok(row.text.includes(`Owner payable ${formatMoney(0)}`));
    assert.doesNotMatch(row.html, /<form/);

    // An owner failure refunds the Guest in full: the owner is owed nothing.
    const failed = await reservation(f, "2026-09-06", "2026-09-07");
    cancel(failed, "operator_failure");
    assert.equal(payableRow((await payoutsPage(f)).html, failed).status, "nothing_owed");

    // A paused payable cannot be paid, even once the 24 hours have passed.
    const paused = await reservation(f, "2026-09-10", "2026-09-12");
    await travelTo(f, new Date(windowOpens("2026-09-10").getTime() + 30 * MINUTE));
    recordAccess(f, paused);
    const beforeComplaint = payableRow((await payoutsPage(f)).html, paused);
    assert.equal(beforeComplaint.status, "not_yet_due");
    openComplaint(f, paused);
    await travelTo(f, new Date(f.now().getTime() + 48 * HOUR));
    row = payableRow((await payoutsPage(f)).html, paused);
    assert.equal(row.status, "paused");
    assert.doesNotMatch(row.html, /<form/);
    const version = env.listOwnerPayables(principal(f)).find((item) => item.requestId === paused)!.payable!.version;
    const refused = await pay(f, paused, { amount: naira(settlement(f, paused).ownerPayableKobo), paidOn: "2026-09-12", reference: "GTB-OWNER-0400" }, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This owner payable is paused while a Blocking Fulfilment Complaint is open\. Nothing was recorded\./);
    assert.equal(env.listOwnerPayables(principal(f)).find((item) => item.requestId === paused)!.payable!.paidKobo, 0);
  } finally { await f.close(); }
});
