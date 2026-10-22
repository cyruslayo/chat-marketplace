import assert from "node:assert/strict";
import test from "node:test";
import { CardPaymentManager, SqliteGuestInteractionStore } from "../domains/shortlet/src/index.js";
import { PeriodPaymentManager } from "../domains/shortlet/src/period-payment.js";
import { DEMO_EXTENDED_STAY_POLICY } from "../domains/shortlet/src/extended-stay.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { Payments } from "../packages/platform-core/src/payments/index.js";
import { addDays, extendUnit, withDemoExtendedJourney, type DemoJourneyContext } from "./helpers/demo-extended-journey.js";
import type { Unit } from "../domains/shortlet/src/browse.js";

// Demo-launch issue 10 (ADR 0092 Later Period Payments, ADR 0105 staging demo, ADR 0044/0045/0046 payment rules).
// Each later Billing Period is paid through its own Paystack TEST session. Provider responses are stubbed.

const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
/** Period 2 starts 30 nights after check-in and is payable once period 1 has started (ADR 0092). */
const PERIOD_2_START = addDays(CHECK_IN, 30);
/** Period 2 is due seven days before its first night. */
const PERIOD_2_DUE = addDays(PERIOD_2_START, -7);
/** Synthetic instants inside the demo's stay. */
const BEFORE_PERIOD_1_START = "2026-09-03T10:00:00.000Z";
const PERIOD_1_STARTED = `${CHECK_IN}T10:00:00.000Z`;
const PAYMENT_WINDOW_MS = 20 * 60_000;

type Context = DemoJourneyContext;

function journeyUnit(): (seeded: Unit) => Unit {
  return (seeded) => extendUnit(seeded, { claimsThrough: CHECK_OUT });
}

function systemPrincipal(context: Context) {
  return { id: "synthetic-system", role: "system" as const, tenantId: context.guest.config.tenantId };
}

/** Runs the real demo journey and confirms the first Period Payment through the TEST provider stub. */
async function withConfirmedStay(run: (context: Context) => Promise<void> | void): Promise<void> {
  await withDemoExtendedJourney({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context) => {
    const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    const confirmed = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, systemPrincipal(context));
    assert.equal(confirmed.outcome, "confirmed");
    await run(context);
  });
}

function startPeriod(context: Context, periodIndex: number) {
  return context.guest.cardPaymentApp.initializePeriodPaystackCheckout(context.offerId, periodIndex, context.guest.guestPrincipal());
}

function verifyPeriod(context: Context, pspReference: string, provider?: Payments) {
  return context.guest.cardPaymentApp.verifyAndConfirmPaystack(pspReference, systemPrincipal(context), provider);
}

/** A Payments stub whose confirmation is the given provider state. It answers only for the reference it is asked about. */
function providerReturning(fields: Record<string, unknown>): Payments {
  return {
    async confirm(reference: string) {
      return {
        reference,
        method: "card",
        verified: true,
        status: "success",
        amountKobo: 0,
        currency: "NGN",
        providerReference: reference,
        payerId: "",
        environment: "test",
        ...fields,
      };
    },
  } as unknown as Payments;
}

function projectionFor(context: Context, periodIndex: number, now?: string) {
  const projection = context.guest.cardPaymentApp.projectBillingPeriods(context.offerId, now === undefined ? undefined : new Date(now));
  const period = projection.find((entry) => entry.periodIndex === periodIndex);
  assert.ok(period, `period ${periodIndex} is projected`);
  return period;
}

test("AC1: Verifying the first Period Payment confirms the stay once and snapshots every Billing Period from issue 09.", async () => {
  await withConfirmedStay(async (context) => {
    const contract = context.guest.cardPaymentApp.getBookingContract(context.offerId)!;
    const periods = (contract.quote as { billingPeriods: { amountKobo: number }[]; allInStayTotalKobo: number }).billingPeriods;
    assert.equal(periods.length, 6, "all six Billing Periods are snapshotted");
    assert.equal(periods.reduce((total, period) => total + period.amountKobo, 0), (contract.quote as { allInStayTotalKobo: number }).allInStayTotalKobo);
    assert.equal(contract.paymentDetails.amountKobo, periods[0]!.amountKobo, "the first payment is the first Billing Period");
    const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    const replay = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, systemPrincipal(context));
    assert.equal(replay.outcome, "confirmed", "a replayed first verification is accepted");
    if (replay.outcome !== "confirmed") return;
    assert.equal(replay.bookingContract.contractId, contract.contractId, "the replay does not form a second contract");
    assert.equal(projectionFor(context, 1).status, "paid");
    assert.notEqual(projectionFor(context, 2).status, "paid", "no later period is paid by the first payment");
  });
});

test("AC2: The next unpaid period accepts one new live attempt only after it becomes payable. A future period or a second live attempt is refused.", async () => {
  await withConfirmedStay(async (context) => {
    context.setClock(BEFORE_PERIOD_1_START);
    await assert.rejects(startPeriod(context, 2), /not payable until/i, "period 2 is not payable before period 1 starts");
    context.setClock(PERIOD_1_STARTED);
    await assert.rejects(startPeriod(context, 3), /next unpaid Billing Period/i, "a future period cannot be paid ahead");
    const started = await startPeriod(context, 2);
    assert.equal(started.periodIndex, 2);
    const periods = (context.guest.cardPaymentApp.getBookingContract(context.offerId)!.quote as { billingPeriods: { amountKobo: number }[] }).billingPeriods;
    assert.equal(started.amountKobo, periods[1]!.amountKobo, "the session collects period 2 only");
    await assert.rejects(startPeriod(context, 2), /live attempt/i, "a second live attempt for period 2 is refused");
  });
});

test("AC2: a later Period Payment is refused when the Unit no longer covers that period's checkout", async () => {
  await withConfirmedStay(async (context) => {
    context.setClock(PERIOD_1_STARTED);
    const stored = context.guest.unitRepository.findById(context.unitId)!;
    context.guest.unitRepository.save({ ...stored, inspection: { ...stored.inspection, expiresAt: addDays(CHECK_OUT, -1) } });
    await assert.rejects(startPeriod(context, 2), /eligible through checkout/i, "the payment initialization rechecks eligibility through checkout");
  });
});

test("AC3: A valid verified payment marks only its period paid. Replaying the same valid webhook is idempotent and does not cause a refund.", async () => {
  await withConfirmedStay(async (context) => {
    context.setClock(PERIOD_1_STARTED);
    const started = await startPeriod(context, 2);
    const outcome = await verifyPeriod(context, started.pspReference);
    assert.equal(outcome.outcome, "period_paid");
    assert.equal(projectionFor(context, 2).status, "paid");
    assert.equal(projectionFor(context, 1).status, "paid");
    assert.notEqual(projectionFor(context, 3).status, "paid", "only period 2 is marked paid");
    const replay = await verifyPeriod(context, started.pspReference);
    assert.equal(replay.outcome, "already_paid", "the same valid success is idempotent");
    assert.deepEqual(context.guest.cardPaymentApp.periodRefunds(context.offerId), [], "a replayed valid success is never refunded");
    assert.equal(context.guest.cardPaymentApp.getPeriodPayments(context.offerId).length, 1, "period 2 is recorded once");
  });
});

test("AC4: A separate successful attempt that was superseded is recorded for refund and does not advance the period.", async () => {
  await withConfirmedStay(async (context) => {
    context.setClock(`${PERIOD_1_STARTED}`);
    const first = await startPeriod(context, 2);
    context.setClock(new Date(Date.parse(`${PERIOD_1_STARTED}`) + PAYMENT_WINDOW_MS + 60_000).toISOString());
    const second = await startPeriod(context, 2);
    assert.notEqual(second.pspReference, first.pspReference, "the replacement uses a unique reference");
    const superseded = await verifyPeriod(context, first.pspReference);
    assert.equal(superseded.outcome, "refund_recorded");
    assert.equal(projectionFor(context, 2).status !== "paid", true, "the superseded success does not advance period 2");
    const refunds = context.guest.cardPaymentApp.periodRefunds(context.offerId);
    assert.deepEqual(refunds.map((refund) => [refund.pspReference, refund.reason, refund.amountKobo]), [[first.pspReference, "superseded", first.amountKobo]]);
    const paid = await verifyPeriod(context, second.pspReference);
    assert.equal(paid.outcome, "period_paid", "the designated attempt pays period 2");
    assert.equal(context.guest.cardPaymentApp.periodRefunds(context.offerId).length, 1, "the designated payment is not refunded");
  });
});

test("AC5: Missing, wrong, late or mismatched provider verification pays no period and preserves the contract state.", async () => {
  type Provider = (amount: number, payer: string) => Payments;
  const variants: readonly { readonly name: string; readonly provider: Provider; readonly pattern: RegExp; readonly late?: boolean }[] = [
    { name: "missing", provider: (amount, payer) => providerReturning({ amountKobo: amount, payerId: payer, verified: false, status: "failed", failureReason: "not found" }), pattern: /verification failed/i },
    { name: "still processing", provider: (amount, payer) => providerReturning({ amountKobo: amount, payerId: payer, verified: false, status: "processing" }), pattern: /processing/i },
    { name: "wrong amount", provider: (amount, payer) => providerReturning({ amountKobo: amount + 1, payerId: payer }), pattern: /Amount verification failed/i },
    { name: "wrong currency", provider: (amount, payer) => providerReturning({ amountKobo: amount, payerId: payer, currency: "USD" }), pattern: /Currency verification failed/i },
    { name: "mismatched reference", provider: (amount, payer) => providerReturning({ amountKobo: amount, payerId: payer, providerReference: "psp_ref_other" }), pattern: /Reference verification failed/i },
    { name: "wrong payer", provider: (amount) => providerReturning({ amountKobo: amount, payerId: "someone-else" }), pattern: /Payer attribution verification failed/i },
    { name: "late", provider: (amount, payer) => providerReturning({ amountKobo: amount, payerId: payer }), pattern: /Payment Window/i, late: true },
  ];
  for (const variant of variants) {
    await withConfirmedStay(async (context) => {
      context.setClock(PERIOD_1_STARTED);
      const started = await startPeriod(context, 2);
      const contractBefore = JSON.stringify(context.guest.cardPaymentApp.getBookingContract(context.offerId));
      if (variant.late) context.setClock(new Date(Date.parse(PERIOD_1_STARTED) + PAYMENT_WINDOW_MS + 60_000).toISOString());
      await assert.rejects(verifyPeriod(context, started.pspReference, variant.provider(started.amountKobo, context.guest.guestPrincipal().id)), variant.pattern, `${variant.name} is refused`);
      assert.notEqual(projectionFor(context, 2).status, "paid", `${variant.name} pays no period`);
      assert.equal(JSON.stringify(context.guest.cardPaymentApp.getBookingContract(context.offerId)), contractBefore, `${variant.name} preserves the contract`);
    });
  }
});

test("AC6: Period due dates and 7/3/1-day reminders follow ADR 0092. Reminder records contain no credentials, account numbers or identity evidence.", async () => {
  await withConfirmedStay(async (context) => {
    assert.equal(projectionFor(context, 2).dueDate, PERIOD_2_DUE, "period 2 is due seven days before its first night");
    const reminders = (at: string) => context.guest.cardPaymentApp.periodRemindersDue(context.offerId, new Date(at));
    assert.deepEqual(reminders(`${addDays(PERIOD_2_DUE, -8)}T10:00:00.000Z`), [], "no reminder before seven days out");
    const sevenDay = reminders(`${addDays(PERIOD_2_DUE, -7)}T10:00:00.000Z`);
    assert.deepEqual(sevenDay.map((reminder) => [reminder.periodIndex, reminder.daysBeforeDue]), [[2, 7]]);
    assert.deepEqual(reminders(`${addDays(PERIOD_2_DUE, -3)}T10:00:00.000Z`).map((reminder) => reminder.daysBeforeDue), [7, 3]);
    assert.deepEqual(reminders(`${addDays(PERIOD_2_DUE, -1)}T10:00:00.000Z`).map((reminder) => reminder.daysBeforeDue), [7, 3, 1]);
    const serialised = JSON.stringify(reminders(`${addDays(PERIOD_2_DUE, -1)}T10:00:00.000Z`));
    for (const forbidden of ["psp_ref", "pspReference", "contactEmail", "email", "accountNumber", "authorization", "secret", "identity"]) {
      assert.equal(serialised.includes(forbidden), false, `a reminder record carries no ${forbidden}`);
    }
    assert.equal(reminders(`${PERIOD_2_DUE}T10:00:00.000Z`).length, 0, "no reminder is sent on the due date itself");
    for (const reminder of reminders(`${addDays(PERIOD_2_DUE, -1)}T10:00:00.000Z`)) {
      assert.deepEqual(Object.keys(reminder).sort(), ["daysBeforeDue", "offerId", "periodIndex", "reminderDate"]);
    }
  });
});

test("AC7: Each period becomes overdue lazily from the clock and appears in the authenticated back-office list.", async () => {
  await withConfirmedStay(async (context) => {
    assert.equal(projectionFor(context, 2, `${addDays(PERIOD_2_DUE, -1)}T23:00:00.000Z`).status, "payable", "unpaid and before due is payable");
    assert.equal(projectionFor(context, 2, `${addDays(PERIOD_2_DUE, -1)}T23:00:00.000Z`).overdue, false);
    const dueMoment = `${PERIOD_2_DUE}T00:00:00.000Z`;
    assert.equal(projectionFor(context, 2, dueMoment).overdue, true, "unpaid at the due date is overdue, from the clock alone");
    assert.equal(projectionFor(context, 2, dueMoment).status, "overdue");
    const staff = { id: "synthetic-staff", role: "authorized_staff" as const, tenantId: context.guest.config.tenantId };
    const list = context.guest.cardPaymentApp.listPeriodPaymentsForBackOffice(staff, new Date(dueMoment));
    assert.ok(list.some((entry) => entry.offerId === context.offerId && entry.periodIndex === 2 && entry.status === "overdue" && entry.dueDate === PERIOD_2_DUE), "period 2 is listed for the back office");
    assert.throws(() => context.guest.cardPaymentApp.listPeriodPaymentsForBackOffice(context.guest.guestPrincipal(), new Date(dueMoment)), /back-office/i, "a guest cannot read the back-office list");
  });
});

test("AC8: An overdue unpaid period requires human contact. The system never changes access, locks out the guest, or ends the stay automatically.", async () => {
  await withConfirmedStay(async (context) => {
    const contractBefore = JSON.stringify(context.guest.cardPaymentApp.getBookingContract(context.offerId));
    const atStart = `${PERIOD_2_START}T00:00:00.000Z`;
    const period = projectionFor(context, 2, atStart);
    assert.equal(period.status, "unpaid_at_start");
    assert.equal(period.humanContactRequired, true, "an overdue unpaid period is flagged for human contact");
    assert.equal((projectionFor(context, 3, atStart).status as string) === "ended", false, "no period is ended automatically");
    assert.equal(Object.keys(period).some((key) => /access|lock|terminat|ended|remov/i.test(key)), false, "the projection carries no access or termination action");
    assert.equal(context.guest.cardPaymentApp.projectInteractionState(context.offerId).paymentStatus, "confirmed", "the Reservation stays confirmed");
    assert.equal(JSON.stringify(context.guest.cardPaymentApp.getBookingContract(context.offerId)), contractBefore, "the contract is unchanged");
    context.setClock(atStart);
    await assert.rejects(startPeriod(context, 2), /has started/i, "an unpaid period cannot be paid once it has started");
  });
});

test("AC9: The payment path survives Durable Object and Node restarts. Existing Short Stay payment tests pass unchanged.", async () => {
  await withConfirmedStay(async (context) => {
    context.setClock(PERIOD_1_STARTED);
    const second = await startPeriod(context, 2);
    assert.equal((await verifyPeriod(context, second.pspReference)).outcome, "period_paid");
    context.setClock(`${PERIOD_2_START}T09:00:00.000Z`);
    const third = await startPeriod(context, 3);

    // A restart is a fresh process over the same authoritative database: no in-memory state survives it.
    const database = openNodeSqliteDatabase(context.databasePath);
    try {
      const store = new SqliteGuestInteractionStore(database);
      const contracts = new CardPaymentManager({ offerManager: { getOffer: () => { throw new Error("offer is not needed after restart"); } }, store });
      assert.ok(contracts.getBookingContract(context.offerId), "the Booking Contract is rehydrated");
      const restarted = new PeriodPaymentManager({ store, contracts, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY, unitSource: { findById: () => undefined }, guestContacts: { find: () => null } });
      const at = new Date(`${PERIOD_2_START}T09:10:00.000Z`);
      const projected = restarted.projectBillingPeriods(context.offerId, at);
      assert.equal(projected.find((entry) => entry.periodIndex === 2)?.status, "paid", "period 2 stays paid after restart");
      assert.equal(projected.find((entry) => entry.periodIndex === 3)?.live, true, "the live period 3 attempt survives restart");
      const providerResult = { verified: true, status: "success" as const, amountKobo: third.amountKobo, currency: "NGN" as const, pspReference: third.pspReference, payerId: context.guest.guestPrincipal().id, environment: "test" as const };
      const outcome = restarted.verifyPeriodPayment({ pspReference: third.pspReference, now: at, providerResult });
      assert.equal(outcome.outcome, "period_paid", "the restarted record verifies the surviving attempt");
    } finally {
      database.close();
    }
  });
});
