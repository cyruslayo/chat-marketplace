import test from "node:test";
import assert from "node:assert/strict";
import { ownerShareAfterCancellation } from "../domains/shortlet/src/index.js";
import { FOREIGN_ORIGIN, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { cookieOf, principal, recordAccess, reservation, travelTo, windowOpens } from "./helpers/back-office-reservation.js";
import { naira, ownerTotals, pay, payableRow, payoutsPage, settlement } from "./helpers/back-office-payouts.js";
import { visibleText } from "./helpers/back-office-page.js";
import { lagosCalendarDate } from "../apps/local-owner/src/local-owner-environment.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";

// Issue 11 — flag an Owner Overpayment and record its recovery (.scratch/operator-dashboard/issues/11-flag-owner-over-payment.md,
// ADR 0089, 0014; CONTEXT.md "Owner Overpayment").

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const OWNER = "Eko Prime Living Ltd";

/** Verified Access 30 minutes into the window, then 24 hours on: the payable is due. */
async function makeDue(f: SignedInOperator, id: string, checkIn: string): Promise<void> {
  await travelTo(f, new Date(windowOpens(checkIn).getTime() + 30 * MINUTE));
  recordAccess(f, id);
  await travelTo(f, new Date(f.now().getTime() + 24 * HOUR));
  assert.equal(f.server.environment.ownerPayable(id, principal(f)).payable!.status, "due");
}

/**
 * Pays the full owner payable, then posts a later cancellation outcome that keeps half the Cancellation Base, as an
 * operator-failure or legal-override refund after the stay began would (the upheld path, issue 14). Returns amounts.
 */
async function overpay(f: SignedInOperator, id: string): Promise<{ paid: number; owed: number; overpaid: number }> {
  const captured = settlement(f, id);
  assert.equal((await pay(f, id, { amount: naira(captured.ownerPayableKobo), paidOn: lagosCalendarDate(f.now()), reference: `GTB-OWNER-${id.slice(-6)}` })).status, 303);
  const retained = Math.floor((captured.ownerPayableKobo + captured.marginKobo) / 2);
  const reservationId = f.server.environment.ownerPayable(id, principal(f)).reservationId;
  f.server.environment.ownerPayableLedger.postCancellation({ cancellationId: `cancellation:${reservationId}`, reservationId, liability: "operator_failure", amountKobo: captured.ownerPayableKobo + captured.marginKobo - retained, retainedCancellationBaseKobo: retained, retainedCommissionKobo: 0, currency: "NGN" });
  const owed = ownerShareAfterCancellation(captured, retained).ownerPayableKobo;
  return { paid: captured.ownerPayableKobo, owed, overpaid: captured.ownerPayableKobo - owed };
}

function recoveryVersion(html: string, id: string): string {
  const value = payableRow(html, id).html.match(new RegExp(`action="/operator/payouts/${id}/recovery"[\\s\\S]*?name="basedOnVersion" value="([^"]+)"`))?.[1];
  assert.ok(value, `recovery form for ${id}`);
  return value;
}

async function recover(f: SignedInOperator, id: string, fields: { amount: string; receivedOn: string; reference: string }, options: { cookie?: string; origin?: string; basedOnVersion?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? recoveryVersion((await payoutsPage(f)).html, id);
  return operatorPost(f.session, `/operator/payouts/${encodeURIComponent(id)}/recovery`, options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, { basedOnVersion, ...fields });
}

const recoveries = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_owner_recovery_recorded");

test("AC1 — When recorded payouts exceed the owner payable after a cancellation policy outcome, the booking shows \"Over-paid\" (not \"Paid\") and the amount over-paid", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-11");
    await makeDue(f, id, "2026-09-10");
    const amounts = await overpay(f, id);
    assert.ok(amounts.overpaid > 0);
    const row = payableRow((await payoutsPage(f)).html, id);
    assert.equal(row.status, "overpaid");
    assert.match(row.text, /Over-paid/);
    assert.ok(row.text.includes(`Owner payable ${formatMoney(amounts.owed)}`), "the payable the outcome leaves");
    assert.ok(row.text.includes(`Over-paid ${formatMoney(amounts.overpaid)}`), "the amount over-paid");
    assert.doesNotMatch(row.text, /Status Paid/);
    const projection = f.server.environment.ownerPayable(id, principal(f)).payable!;
    assert.equal(projection.overpaidKobo, amounts.overpaid);
    assert.equal(projection.outstandingKobo, 0);
  } finally { await f.close(); }
});

test("AC2 — The owner's totals show the over-paid amount separately. \"Paid\" is net of recoveries, and over-paid money is never counted as due now", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-11");
    await makeDue(f, id, "2026-09-10");
    const amounts = await overpay(f, id);
    let totals = ownerTotals((await payoutsPage(f)).html, OWNER);
    assert.equal(totals.overpaid, formatMoney(amounts.overpaid));
    assert.equal(totals.paid, formatMoney(amounts.paid));
    assert.equal(totals.due, formatMoney(0));
    // A partial recovery: "Paid" nets it off and the rest stays over-paid.
    const part = Math.floor(amounts.overpaid / 3);
    assert.equal((await recover(f, id, { amount: naira(part), receivedOn: lagosCalendarDate(f.now()), reference: "OWNER-BACK-1" })).status, 303);
    totals = ownerTotals((await payoutsPage(f)).html, OWNER);
    assert.equal(totals.paid, formatMoney(amounts.paid - part));
    assert.equal(totals.overpaid, formatMoney(amounts.overpaid - part));
    assert.equal(totals.due, formatMoney(0));
  } finally { await f.close(); }
});

test("AC3 — Home lists each over-paid booking as waiting on you until it is fully recovered", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f, "2026-09-10", "2026-09-11");
    await makeDue(f, id, "2026-09-10");
    const amounts = await overpay(f, id);
    const home = async () => (await (await operatorGet(f.session, "/operator", cookieOf(f))).text());
    let html = await home();
    assert.match(html, /data-kind="owner_overpayment"/);
    assert.match(visibleText(html), /Owner over-payment to recover/);
    assert.ok(html.includes(`href="/operator/payouts#payable-${id}"`));
    const part = Math.floor(amounts.overpaid / 2);
    assert.equal((await recover(f, id, { amount: naira(part), receivedOn: lagosCalendarDate(f.now()), reference: "OWNER-BACK-1" })).status, 303);
    assert.match(await home(), /data-kind="owner_overpayment"/, "still listed while any is unrecovered");
    assert.equal((await recover(f, id, { amount: naira(amounts.overpaid - part), receivedOn: lagosCalendarDate(f.now()), reference: "OWNER-BACK-2" })).status, 303);
    html = await home();
    assert.doesNotMatch(html, /data-kind="owner_overpayment"/);
  } finally { await f.close(); }
});

test("AC4 — You can record a recovery with its date, amount and reference, and a full recovery clears the flag. Recording one when nothing is over-paid, for more than is over-paid, with a reference already used for another amount, or from a stale version is refused. The standard failure paths apply", async () => {
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const id = await reservation(f, "2026-09-10", "2026-09-11");
    await makeDue(f, id, "2026-09-10");
    const amounts = await overpay(f, id);
    const today = lagosCalendarDate(f.now());
    const version = recoveryVersion((await payoutsPage(f)).html, id);
    const good = { amount: naira(amounts.overpaid), receivedOn: today, reference: "OWNER-BACK-1" };

    // The standard failure paths, before anything is recorded.
    assert.equal((await recover(f, id, good, { cookie: "", basedOnVersion: version })).status, 401, "no session");
    assert.equal((await recover(f, id, good, { origin: FOREIGN_ORIGIN, basedOnVersion: version })).status, 403, "cross-origin POST");
    assert.equal((await recover(f, "req-unknown", good, { basedOnVersion: version })).status, 404, "an unknown booking");
    // What was typed.
    for (const [fields, message] of [
      [{ ...good, amount: "" }, /Enter the amount recovered in naira/],
      [{ ...good, receivedOn: "2099-01-01" }, /Enter the date the owner paid it back, not later than today/],
      [{ ...good, reference: " " }, /Enter the payment reference/],
    ] as const) {
      const refused = await recover(f, id, fields, { basedOnVersion: version });
      assert.equal(refused.status, 400);
      assert.match(visibleText(await refused.text()), message);
    }
    // More than is over-paid.
    let refused = await recover(f, id, { ...good, amount: naira(amounts.overpaid + 100) }, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /The amount is more than is over-paid\. Nothing was recorded\./);
    assert.equal(recoveries(f).length, 0);

    // A full recovery clears the flag.
    assert.equal((await recover(f, id, good, { basedOnVersion: version })).status, 303);
    const payable = env.ownerPayable(id, principal(f)).payable!;
    assert.equal(payable.status, "paid");
    assert.equal(payable.overpaidKobo, 0);
    assert.equal(payable.recoveredKobo, amounts.overpaid);
    const row = payableRow((await payoutsPage(f)).html, id);
    assert.ok(row.text.includes(`Recovered ${formatMoney(amounts.overpaid)} received`));
    assert.doesNotMatch(row.html, /\/recovery"/, "no recovery form once nothing is over-paid");
    // The audit keeps ids and the amount, never the reference (ADR 0075).
    const [entry] = recoveries(f);
    assert.ok(entry);
    assert.equal(entry.amountKobo, amounts.overpaid);
    assert.doesNotMatch(JSON.stringify(entry), /OWNER-BACK-1/);

    // A replay of the same recovery records nothing new (ADR 0072); the same reference with another amount is refused.
    assert.equal((await recover(f, id, good, { basedOnVersion: version })).status, 303);
    assert.equal(recoveries(f).length, 1);
    refused = await recover(f, id, { ...good, amount: "1" }, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    // Nothing is over-paid now; a stale form says so.
    refused = await recover(f, id, { ...good, reference: "OWNER-BACK-2" }, { basedOnVersion: version });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /changed since you opened it|Nothing is over-paid on this booking/);
    const current = env.ownerPayable(id, principal(f)).payable!.version;
    refused = await recover(f, id, { ...good, reference: "OWNER-BACK-2" }, { basedOnVersion: current });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /Nothing is over-paid on this booking\. Nothing was recorded\./);

    // A revoked grant fails closed (ADR 0082).
    revokeRepresentativeGrant(env);
    assert.equal((await recover(f, id, { ...good, reference: "OWNER-BACK-3" }, { basedOnVersion: current })).status, 404);
    assert.equal(recoveries(f).length, 1);
  } finally { await f.close(); }
});

test("AC5 — While an owner has an unrecovered Owner Overpayment, their other due payables can still be paid, and the payout form warns with the amount", async () => {
  const f = await startSignedInOperator();
  try {
    const first = await reservation(f, "2026-09-10", "2026-09-11");
    const second = await reservation(f, "2026-09-12", "2026-09-13");
    await makeDue(f, first, "2026-09-10");
    const amounts = await overpay(f, first);
    await makeDue(f, second, "2026-09-12");
    const row = payableRow((await payoutsPage(f)).html, second);
    assert.equal(row.status, "due");
    assert.ok(row.text.includes(`${OWNER} has ${formatMoney(amounts.overpaid)} over-paid that is not yet recovered`), "the payout form warns");
    const owed = settlement(f, second).ownerPayableKobo;
    assert.equal((await pay(f, second, { amount: naira(owed), paidOn: lagosCalendarDate(f.now()), reference: "GTB-OWNER-SECOND" })).status, 303, "not held");
    assert.equal(f.server.environment.ownerPayable(second, principal(f)).payable!.status, "paid");
  } finally { await f.close(); }
});
