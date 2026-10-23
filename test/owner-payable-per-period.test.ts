import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_LEDGER_PERIOD_SCHEMA,
  OWNER_PAYABLE_SCHEMA,
  OwnerPayoutError,
  OwnerRecoveryError,
  SqliteOwnerPayableLedger,
  projectOwnerPeriodPayables,
  recordOwnerPayout,
  recordOwnerRecovery,
  type OwnerPayableCancellation,
  type OwnerPeriodPayable,
  type OwnerPeriodSettlement,
} from "../domains/shortlet/src/owner-payable.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SHORTLET_SCHEMA_MIGRATIONS } from "../apps/cloudflare/src/schema.js";
import { DEMO_OPERATOR_ACTOR_ID } from "../apps/local-owner/src/demo-operator-acceptance.js";
import { addDays, extendUnit, withDemoExtendedJourney, type DemoJourneyContext } from "./helpers/demo-extended-journey.js";

// Demo-launch issue 11 (ADR 0089 Period 1 timing and margin, ADR 0092 later Period timing, ADR 0014 cancellation
// outcome, ADR 0075 no references in owner output, ADR 0095 SQLite authority). Every value is synthetic.

const RESERVATION = "reservation-demo-1";
const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
/** ADR 0089: Period 1 becomes due 24 hours after Verified Access. */
const ACCESS_AT = `${CHECK_IN}T14:00:00.000Z`;
const PERIOD_1_PAID_AT = "2026-09-03T10:00:00.000Z";

/** Three synthetic 30-night Billing Periods. The amounts are the owner payable and margin captured at confirmation. */
const PERIODS: readonly OwnerPeriodSettlement[] = Object.freeze([
  { periodIndex: 1, checkIn: "2026-09-10", nights: 30, ownerPayableKobo: 7_500_000, marginKobo: 1_500_000 },
  { periodIndex: 2, checkIn: "2026-10-10", nights: 30, ownerPayableKobo: 7_500_000, marginKobo: 1_500_000 },
  { periodIndex: 3, checkIn: "2026-11-09", nights: 30, ownerPayableKobo: 7_500_000, marginKobo: 1_500_000 },
]);

const PAID_LATER = new Map<number, string>([
  [1, PERIOD_1_PAID_AT],
  [2, "2026-09-25T09:00:00.000Z"],
  [3, "2026-10-01T09:00:00.000Z"],
]);

interface ProjectOptions {
  readonly now: string;
  readonly paidAt?: ReadonlyMap<number, string>;
  readonly access?: string | null;
  readonly complaintOpen?: boolean;
  readonly cancellation?: OwnerPayableCancellation | null;
  readonly payouts?: Parameters<typeof projectOwnerPeriodPayables>[0]["payouts"];
  readonly recoveries?: Parameters<typeof projectOwnerPeriodPayables>[0]["recoveries"];
}

function project(options: ProjectOptions): readonly OwnerPeriodPayable[] {
  return projectOwnerPeriodPayables({
    periods: PERIODS,
    paidAt: options.paidAt ?? PAID_LATER,
    protectionWindowStartsAt: options.access === undefined ? ACCESS_AT : options.access,
    blockingComplaintOpen: options.complaintOpen ?? false,
    cancellation: options.cancellation ?? null,
    payouts: options.payouts ?? [],
    recoveries: options.recoveries ?? [],
    now: new Date(options.now),
  });
}

function period(periods: readonly OwnerPeriodPayable[], index: number): OwnerPeriodPayable {
  const found = periods.find((entry) => entry.periodIndex === index);
  assert.ok(found, `period ${index} is projected`);
  return found;
}

test("AC1: Confirmation captures one immutable Period Owner Payable for each of six Billing Periods.", async () => {
  await withDemoExtendedJourney({ unit: (seeded) => extendUnit(seeded, { claimsThrough: CHECK_OUT }), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context: DemoJourneyContext) => {
    const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    assert.ok(session);
    const confirmed = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, {
      id: "synthetic-system",
      role: "system",
      tenantId: context.guest.config.tenantId,
    });
    assert.equal(confirmed.outcome, "confirmed");

    const snapshot = context.owner.interactionStore.findBookingSnapshotByOfferId(context.offerId);
    assert.ok(snapshot, "the confirmed booking snapshot is stored");
    const contract = JSON.parse(snapshot.contractJson) as {
      quote: {
        ownerSettlement: { ownerPayableKobo: number; marginKobo: number };
        billingPeriods: { index: number; nights: number; amountKobo: number; ownerPayableKobo: number; marginKobo: number }[];
      };
    };
    const periods = contract.quote.billingPeriods;
    assert.equal(periods.length, 6, "six 30-night periods are captured");
    for (const entry of periods) {
      assert.equal(entry.nights, 30);
      assert.ok(Number.isSafeInteger(entry.ownerPayableKobo) && entry.ownerPayableKobo > 0, `period ${entry.index} owner payable is captured`);
      assert.ok(Number.isSafeInteger(entry.marginKobo) && entry.marginKobo > 0, `period ${entry.index} margin is captured`);
      assert.equal(entry.amountKobo, entry.ownerPayableKobo + entry.marginKobo, `period ${entry.index} amount is owner payable plus margin`);
    }
    assert.equal(periods.reduce((sum, entry) => sum + entry.ownerPayableKobo, 0), contract.quote.ownerSettlement.ownerPayableKobo);
    assert.equal(periods.reduce((sum, entry) => sum + entry.marginKobo, 0), contract.quote.ownerSettlement.marginKobo);

    // Immutable: reading the stored snapshot again returns the same captured periods (ADR 0077, ADR 0089).
    const after = (JSON.parse(context.owner.interactionStore.findBookingSnapshotByOfferId(context.offerId)!.contractJson) as typeof contract).quote.billingPeriods;
    assert.equal(JSON.stringify(after), JSON.stringify(periods));

    // The owner-facing list carries one payable per period: Period 1 is paid by the confirmation, later periods are not.
    // It holds no Period Payment reference and no guest identity (ADR 0075).
    const principal = { id: DEMO_OPERATOR_ACTOR_ID, role: "operator" as const, tenantId: context.owner.config.tenantId };
    const row = context.owner.listOwnerPayables(principal).find((entry) => entry.requestId === context.requestId);
    assert.ok(row?.periods, "the Extended Stay lists its Billing Period payables");
    assert.equal(row.periods.length, 6);
    assert.deepEqual(row.periods.map((entry) => entry.paid), [true, false, false, false, false, false]);
    assert.equal(row.periods[0]!.ownerPayableKobo, periods[0]!.ownerPayableKobo);
    assert.ok(row.periods.every((entry) => entry.earnedOwnerPayableKobo === 0 && entry.marginEarnedKobo === 0), "no period is earned before Verified Access or its first night");
    assert.equal(row.payable?.ownerPayableKobo, periods[0]!.ownerPayableKobo, "the booking payable is Period 1's projection");
    assert.equal(JSON.stringify(row).includes(session.pspReference), false, "no Period Payment reference reaches the owner view");
  });
});

test("AC2: Period 1 becomes due only 24 hours after Verified Access and only when no Blocking Fulfilment Complaint is open.", () => {
  // Not yet Verified Access: nothing is due and nothing is earned.
  const noAccess = period(project({ now: "2026-09-12T10:00:00.000Z", access: null }), 1);
  assert.equal(noAccess.status, "not_yet_due");
  assert.equal(noAccess.dueAt, null);
  assert.equal(noAccess.marginEarnedKobo, 0);

  // Verified Access, but inside the 24-hour protection window.
  const inside = period(project({ now: "2026-09-11T13:00:00.000Z" }), 1);
  assert.equal(inside.status, "not_yet_due");
  assert.equal(inside.marginEarnedKobo, 0);

  // Past the window: due, and the margin is earned.
  const due = period(project({ now: "2026-09-11T15:00:00.000Z" }), 1);
  assert.equal(due.status, "due");
  assert.equal(due.earnedOwnerPayableKobo, 7_500_000);
  assert.equal(due.marginEarnedKobo, 1_500_000);

  // An open Blocking Fulfilment Complaint pauses it, however long ago access was verified.
  const paused = period(project({ now: "2026-09-20T10:00:00.000Z", complaintOpen: true }), 1);
  assert.equal(paused.status, "paused");
  assert.equal(paused.marginEarnedKobo, 0);
});

test("AC3: A later Billing Period becomes due only after its payment is verified, its first night has started, and no Blocking Fulfilment Complaint is open.", () => {
  // Paid early, before its first night: not due yet, even though it is verified.
  const beforeStart = period(project({ now: "2026-10-05T10:00:00.000Z" }), 2);
  assert.equal(beforeStart.paid, true);
  assert.equal(beforeStart.status, "not_yet_due");
  assert.equal(beforeStart.dueAt, "2026-10-10T00:00:00.000Z");
  assert.equal(beforeStart.marginEarnedKobo, 0);

  // Paid and started: due.
  const started = period(project({ now: "2026-10-11T10:00:00.000Z" }), 2);
  assert.equal(started.status, "due");
  assert.equal(started.marginEarnedKobo, 1_500_000);

  // Paid and started, but a complaint is open: paused.
  const paused = period(project({ now: "2026-10-11T10:00:00.000Z", complaintOpen: true }), 2);
  assert.equal(paused.status, "paused");
  assert.equal(paused.marginEarnedKobo, 0);

  // Started but never verified as paid: never due (failure path, ADR 0092).
  const unpaid = period(project({ now: "2026-10-20T10:00:00.000Z", paidAt: new Map([[1, PERIOD_1_PAID_AT]]) }), 2);
  assert.equal(unpaid.paid, false);
  assert.equal(unpaid.status, "not_yet_due");
  assert.equal(unpaid.dueAt, null);
});

test("AC4: An unpaid or ended Billing Period never earns its owner payable or margin.", () => {
  // Unpaid and past its first night: no payable and no margin is earned, and the snapshot is still shown as captured.
  const unpaid = period(project({ now: "2026-10-20T10:00:00.000Z", paidAt: new Map([[1, PERIOD_1_PAID_AT]]) }), 2);
  assert.equal(unpaid.earnedOwnerPayableKobo, 0);
  assert.equal(unpaid.marginEarnedKobo, 0);
  assert.equal(unpaid.captured.ownerPayableKobo, 7_500_000);

  // Ended by a cancellation outcome that keeps none of the Cancellation Base for this period: nothing owed, nothing earned.
  const ended: OwnerPayableCancellation = {
    cancellationId: "cancel-period-2",
    reservationId: RESERVATION,
    liability: "guest",
    refundKobo: 0,
    retainedCancellationBaseKobo: 0,
    postedAt: "2026-10-01T10:00:00.000Z",
  };
  const endedPeriod = period(project({ now: "2026-10-20T10:00:00.000Z", cancellation: ended }), 2);
  assert.equal(endedPeriod.status, "nothing_owed");
  assert.equal(endedPeriod.earnedOwnerPayableKobo, 0);
  assert.equal(endedPeriod.marginEarnedKobo, 0);
});

test("AC5: A payout binds to one Billing Period, refuses more than that period's payable, and a payout over it surfaces as an Owner Overpayment.", () => {
  const ledger = new SqliteOwnerPayableLedger(openNodeSqliteDatabase(":memory:"));
  const now = new Date("2026-10-11T10:00:00.000Z");
  const payable2 = period(project({ now: now.toISOString() }), 2);
  const { payout } = recordOwnerPayout({
    ledger,
    reservationId: RESERVATION,
    payable: payable2,
    basedOnVersion: payable2.version,
    amountKobo: 7_500_000,
    paidOn: "2026-10-11",
    reference: "REF-PERIOD-2",
    recordedBy: "owner-staff",
    now,
    periodIndex: 2,
  });
  assert.equal(payout.amountKobo, 7_500_000);
  const stored = ledger.listPayouts(RESERVATION);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.periodIndex, 2, "the payout is bound to Billing Period 2");

  // Period 1 is untouched by a payment to period 2.
  const afterPeriod2 = project({ now: now.toISOString(), payouts: stored });
  assert.equal(period(afterPeriod2, 1).paidKobo, 0);
  assert.equal(period(afterPeriod2, 2).paidKobo, 7_500_000);

  // A reference already used on another period is refused, so one bank reference never pays two periods.
  const period3 = period(project({ now: "2026-11-10T10:00:00.000Z", payouts: stored }), 3);
  assert.throws(
    () => recordOwnerPayout({ ledger, reservationId: RESERVATION, payable: period3, basedOnVersion: period3.version, amountKobo: 1_000, paidOn: "2026-11-10", reference: "REF-PERIOD-2", recordedBy: "owner-staff", now: new Date("2026-11-10T10:00:00.000Z"), periodIndex: 3 }),
    (error: unknown) => error instanceof OwnerPayoutError && error.problem === "reference_used",
  );

  // More than period 3 is due is refused.
  assert.throws(
    () => recordOwnerPayout({ ledger, reservationId: RESERVATION, payable: period3, basedOnVersion: period3.version, amountKobo: 7_500_001, paidOn: "2026-11-10", reference: "REF-PERIOD-3-TOO-MUCH", recordedBy: "owner-staff", now: new Date("2026-11-10T10:00:00.000Z"), periodIndex: 3 }),
    (error: unknown) => error instanceof OwnerPayoutError && error.problem === "exceeds_due",
  );

  // Pay period 3 in full, then a cancellation outcome shrinks its payable below what was paid: an Owner Overpayment on
  // period 3 only, and a recovery bound to period 3 clears it.
  const paid3 = recordOwnerPayout({ ledger, reservationId: RESERVATION, payable: period3, basedOnVersion: period3.version, amountKobo: 7_500_000, paidOn: "2026-11-10", reference: "REF-PERIOD-3", recordedBy: "owner-staff", now: new Date("2026-11-10T10:00:00.000Z"), periodIndex: 3 });
  const cancellation: OwnerPayableCancellation = { cancellationId: "cancel-after-pay", reservationId: RESERVATION, liability: "guest", refundKobo: 0, retainedCancellationBaseKobo: 4_500_000, postedAt: "2026-11-10T11:00:00.000Z" };
  const overpaid = project({ now: "2026-11-11T10:00:00.000Z", cancellation, payouts: ledger.listPayouts(RESERVATION) });
  assert.equal(period(overpaid, 3).status, "overpaid");
  assert.ok(period(overpaid, 3).overpaidKobo > 0);
  // The stay-level outcome shrinks each period's share pro rata (ADR 0014, B7). Period 1 was never paid, so it is not
  // over-paid; period 2 was paid in full, so it is over-paid by exactly the share its payable lost.
  assert.equal(period(overpaid, 1).overpaidKobo, 0, "period 1 is not over-paid");
  assert.equal(period(overpaid, 2).overpaidKobo, period(overpaid, 2).paidKobo - period(overpaid, 2).ownerPayableKobo);
  assert.equal(paid3.payout.periodIndex, 3);

  const overpaidPeriod3 = period(overpaid, 3);
  const { recovery } = recordOwnerRecovery({ ledger, reservationId: RESERVATION, payable: overpaidPeriod3, basedOnVersion: overpaidPeriod3.version, amountKobo: overpaidPeriod3.overpaidKobo, receivedOn: "2026-11-11", reference: "REF-RECOVER-3", recordedBy: "owner-staff", now: new Date("2026-11-11T10:00:00.000Z"), periodIndex: 3 });
  assert.equal(recovery.amountKobo, overpaidPeriod3.overpaidKobo);
  assert.equal(recovery.periodIndex, 3);
  // Recovering more than is over-paid on period 3 is refused.
  const afterRecovery = period(project({ now: "2026-11-11T12:00:00.000Z", cancellation, payouts: ledger.listPayouts(RESERVATION), recoveries: ledger.listRecoveries(RESERVATION) }), 3);
  assert.throws(
    () => recordOwnerRecovery({ ledger, reservationId: RESERVATION, payable: afterRecovery, basedOnVersion: afterRecovery.version, amountKobo: 1, receivedOn: "2026-11-11", reference: "REF-RECOVER-3-MORE", recordedBy: "owner-staff", now: new Date("2026-11-11T12:00:00.000Z"), periodIndex: 3 }),
    (error: unknown) => error instanceof OwnerRecoveryError && error.problem === "not_overpaid",
  );
});

test("AC6: The same owner-payable projection runs through Node SQLite storage and the shared Cloudflare schema, with the period binding migrated.", () => {
  const raw = openNodeSqliteDatabase(":memory:");
  const ledger = new SqliteOwnerPayableLedger(raw);
  const now = new Date("2026-10-11T10:00:00.000Z");
  const payable2 = period(project({ now: now.toISOString() }), 2);
  recordOwnerPayout({ ledger, reservationId: RESERVATION, payable: payable2, basedOnVersion: payable2.version, amountKobo: 3_000_000, paidOn: "2026-10-11", reference: "REF-AC6", recordedBy: "owner-staff", now, periodIndex: 2 });

  // Re-opening the ledger on the same database keeps the period binding (the constructor is idempotent).
  const reopened = new SqliteOwnerPayableLedger(raw);
  const fromNode = project({ now: now.toISOString(), payouts: reopened.listPayouts(RESERVATION) });
  assert.equal(period(fromNode, 2).paidKobo, 3_000_000);
  assert.equal(period(fromNode, 1).paidKobo, 0);

  // The Cloudflare Durable Object applies the shared migrations; the binding table is one of them and is idempotent.
  const migration = SHORTLET_SCHEMA_MIGRATIONS.find((entry) => entry.statements.some((statement) => statement.includes("owner_ledger_period_bindings")));
  assert.ok(migration, "a shared migration creates the period binding table");
  assert.equal(migration.statements.join("\n"), OWNER_LEDGER_PERIOD_SCHEMA, "the migration uses the ledger's own DDL");
  const fresh = openNodeSqliteDatabase(":memory:");
  fresh.exec(OWNER_PAYABLE_SCHEMA);
  fresh.exec(OWNER_LEDGER_PERIOD_SCHEMA);
  fresh.exec(OWNER_LEDGER_PERIOD_SCHEMA);
  const migrated = new SqliteOwnerPayableLedger(fresh);
  assert.deepEqual(migrated.listPayouts(RESERVATION), []);
});
