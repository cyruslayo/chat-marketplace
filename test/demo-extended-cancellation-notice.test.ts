import assert from "node:assert/strict";
import test from "node:test";
import { CancellationNoShowManager } from "../domains/shortlet/src/cancellation-noshow.js";
import { ownerShareAfterCancellation } from "../domains/shortlet/src/owner-payable.js";
import { InMemoryBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import type { BookingContract, Reservation } from "../domains/shortlet/src/card-payment.js";
import { DEMO_EXTENDED_STAY_POLICY } from "../domains/shortlet/src/extended-stay.js";
import {
  EXTENDED_CANCELLATION_DEMO_SUMMARY,
  EXTENDED_CANCELLATION_POLICY_VERSION,
  NOTICE_TO_END_DAYS,
  NOTICE_TO_END_DEMO_TERMS,
  NoticeToEndManager,
  calculateNoticeToEnd,
  extendedCancellationEconomics,
} from "../domains/shortlet/src/extended-stay-changes.js";
import type { BillingPeriodQuote } from "../domains/shortlet/src/quote.js";
import { PeriodPaymentManager } from "../domains/shortlet/src/period-payment.js";
import { CancellationApplication } from "../apps/web/src/cancellation-application.js";
import { addDays, extendUnit, withConfirmedExtendedStay, type DemoJourneyContext } from "./helpers/demo-extended-journey.js";

// Demo-launch issue 13 (ADR 0092 cancellation and Notice to End, ADR 0061 failure precedence, ADR 0060 versioned
// amendments, ADR 0105 synthetic staging demo). Synthetic data and stubbed providers only.

const DAY_MS = 86_400_000;
const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
/** Contractual Check-In Window start: 14:00 WAT. */
const WINDOW_START = `${CHECK_IN}T13:00:00.000Z`;
const COMMISSION_RATE = 0.1;
const PERIOD_2_START = addDays(CHECK_IN, 30);
const PERIOD_2_DUE = addDays(PERIOD_2_START, -7);

type Context = DemoJourneyContext;

function journeyUnit(): (seeded: Parameters<typeof extendUnit>[0]) => ReturnType<typeof extendUnit> {
  return (seeded) => extendUnit(seeded, { claimsThrough: CHECK_OUT });
}

function contractOf(context: Context): BookingContract {
  const contract = context.guest.cardPaymentApp.getBookingContract(context.offerId);
  assert.ok(contract, "the confirmed Extended Stay contract exists");
  return contract;
}

function periodsOf(contract: BookingContract): readonly BillingPeriodQuote[] {
  return (contract.quote as { readonly billingPeriods: readonly BillingPeriodQuote[] }).billingPeriods;
}

function principalOf(contract: BookingContract) {
  return { id: contract.parties.primaryGuest.id, role: "guest" as const, tenantId: contract.tenantId ?? "" };
}

function shiftedIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

interface PaidLedger {
  projectBillingPeriods(offerId: string, now: Date): readonly { periodIndex: number; status: string }[];
  paymentsFor(offerId: string): readonly { periodIndex: number; pspReference: string }[];
}

/** A stub ledger that reports the given Billing Periods as paid. Period 1 is always paid by the confirmed contract. */
function paidLedger(periods: readonly BillingPeriodQuote[], paid: readonly number[]): PaidLedger {
  return {
    projectBillingPeriods: () => periods.map((period) => ({ periodIndex: period.index, status: paid.includes(period.index) ? "paid" : "scheduled" })),
    paymentsFor: () => paid.filter((index) => index > 1).map((index) => ({ periodIndex: index, pspReference: `psp_ref_period_${index}` })),
  };
}

class ContractStore {
  current: BookingContract;
  constructor(contract: BookingContract) { this.current = contract; }
  getContract(id: string): BookingContract {
    if (id !== this.current.contractId) throw new Error("Access denied or resource not found");
    return this.current;
  }
  mutateContract(id: string, expectedVersion: number, mutation: (value: BookingContract) => BookingContract): BookingContract {
    if (id !== this.current.contractId || this.current.contractVersion !== expectedVersion) throw new Error("STALE_ACTION");
    this.current = mutation(this.current);
    return this.current;
  }
}

function noticeManager(contract: BookingContract, options: {
  paid?: readonly number[];
  verified?: boolean;
  failure?: boolean;
  /** True models a production composition: no staging demo policy is supplied. */
  noPolicy?: boolean;
  now: string;
}) {
  const store = new ContractStore(contract);
  const refunds: Array<{ periodIndex: number; amountKobo: number; amendmentId: string }> = [];
  const manager = new NoticeToEndManager({
    contracts: store,
    periods: paidLedger(periodsOf(contract), options.paid ?? [1]),
    arrival: { hasVerifiedAccess: () => options.verified ?? true },
    failures: { hasOpenFailure: () => options.failure ?? false },
    refunds: {
      initiateOrGetRefund(input) {
        refunds.push({ periodIndex: input.periodIndex, amountKobo: input.amountKobo, amendmentId: input.amendmentId });
        return { refundId: `refund:${input.amendmentId}:${input.periodIndex}`, status: "pending" as const, amountKobo: input.amountKobo, currency: "NGN" as const };
      },
    },
    ...(options.noPolicy ? {} : { extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY }),
    clock: () => new Date(options.now),
  });
  return { store, refunds, manager };
}

function cancellationApp(context: Context, contract: BookingContract, at: string, calls: Array<{ amountKobo: number; originalPaymentReference: string; cancellationId: string }>) {
  const reservation: Reservation = {
    reservationId: contract.reservationId,
    contractId: contract.contractId,
    unitId: contract.unitId,
    primaryGuestId: contract.parties.primaryGuest.id,
    dates: { checkIn: contract.dates.checkIn, checkOut: contract.dates.checkOut },
    status: "confirmed",
    confirmedAt: "2026-08-01T00:00:00Z",
    inventoryCommitmentId: "commit-extended-1",
  };
  const state = new InMemoryBookingStateRepository({ contracts: [contract], reservations: [reservation] });
  return new CancellationApplication({
    state,
    manager: new CancellationNoShowManager(),
    timing: { getWindow: () => ({ startIso: WINDOW_START, timezone: "Africa/Lagos" as const }) },
    economics: { getEconomics: ({ contract: current }) => extendedCancellationEconomics({ contract: current, paidPeriodIndices: [1], commissionRate: COMMISSION_RATE }) },
    arrival: { getState: () => ({ status: "awaiting_access" as const, version: "arrival-1" }) },
    refunds: {
      initiateOrGetRefund(input) {
        calls.push({ amountKobo: input.amountKobo, originalPaymentReference: input.originalPaymentReference, cancellationId: input.cancellationId });
        return { refundId: `refund:${input.cancellationId}`, status: "pending" as const, amountKobo: input.amountKobo, currency: "NGN" as const };
      },
    },
    ledger: { postCancellation: () => ({ ledgerRecordId: "ledger-extended-1", status: "posted" as const }) },
    availability: { releaseConfirmedBooking: () => undefined },
    clock: () => new Date(at),
  });
}

// ---- AC1: pre-check-in cancellation of the first Period Payment only ----

test("AC1: Before check-in, a demo Extended Stay cancelled at T-30d refunds 100% of the first Period Payment base", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const calls: Array<{ amountKobo: number; originalPaymentReference: string; cancellationId: string }> = [];
    const at = shiftedIso(WINDOW_START, -30);
    const artifact = cancellationApp(context, contract, at, calls).cancel(contract.reservationId, principalOf(contract));
    const base = periodsOf(contract)[0]!.ownerPayableKobo + periodsOf(contract)[0]!.marginKobo;
    assert.equal(artifact.facts.currentRefundEstimate.refundPercentage, 100);
    assert.equal(calls.length, 1, "one refund is initiated");
    assert.equal(calls[0]!.amountKobo, base, "the refund is the first Period Payment's Cancellation Base");
  });
});

test("AC1: Before check-in, a demo Extended Stay cancelled at T-14d refunds 50% of the first Period Payment base", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const calls: Array<{ amountKobo: number; originalPaymentReference: string; cancellationId: string }> = [];
    const artifact = cancellationApp(context, contract, shiftedIso(WINDOW_START, -14), calls).cancel(contract.reservationId, principalOf(contract));
    const base = periodsOf(contract)[0]!.ownerPayableKobo + periodsOf(contract)[0]!.marginKobo;
    assert.equal(artifact.facts.currentRefundEstimate.refundPercentage, 50);
    assert.equal(calls[0]!.amountKobo, Math.floor(base * 50 / 100));
  });
});

test("AC1: Before check-in, a demo Extended Stay cancelled after T-14d retains the first Period Payment base", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const calls: Array<{ amountKobo: number; originalPaymentReference: string; cancellationId: string }> = [];
    const justAfterT14 = new Date(Date.parse(WINDOW_START) - 14 * DAY_MS + 3_600_000).toISOString();
    const artifact = cancellationApp(context, contract, justAfterT14, calls).cancel(contract.reservationId, principalOf(contract));
    assert.equal(artifact.facts.currentRefundEstimate.refundPercentage, 0);
    assert.equal(calls[0]!.amountKobo, 0, "no base is refunded after T-14d");
  });
});

test("AC1: A pre-check-in cancellation never charges or refunds unpaid later Billing Periods", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const periods = periodsOf(contract);
    const economics = extendedCancellationEconomics({ contract, paidPeriodIndices: [1], commissionRate: COMMISSION_RATE });
    assert.equal(economics.cancellationBaseKobo, periods[0]!.ownerPayableKobo + periods[0]!.marginKobo, "only Period 1 forms the base");
    assert.ok(economics.cancellationBaseKobo < periods.reduce((sum, period) => sum + period.amountKobo, 0), "the unpaid later periods are excluded");
  });
});

test("AC1: A pre-check-in economics calculation fails closed when a later Billing Period is recorded as paid", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    assert.throws(() => extendedCancellationEconomics({ contract, paidPeriodIndices: [1, 2], commissionRate: COMMISSION_RATE }), /later Billing Period/);
  });
});

// ---- AC2: snapshot of the cancellation entry ----

test("AC2: The cancellation entry is snapshotted at confirmation, so a later unit catalogue change does not change the booking", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const before = cancellationApp(context, contract, shiftedIso(WINDOW_START, -40), []).getArtifact(contract.reservationId, principalOf(contract));
    const unit = context.guest.unitRepository.findById(contract.unitId)!;
    context.guest.unitRepository.save({ ...unit, cancellationPolicy: { type: "flexible", version: "cancellation-v9", summary: "Changed later" } } as typeof unit);
    const after = cancellationApp(context, contract, shiftedIso(WINDOW_START, -40), []).getArtifact(contract.reservationId, principalOf(contract));
    assert.equal(after.facts.policy.type, "extended");
    assert.equal(after.facts.policy.version, EXTENDED_CANCELLATION_POLICY_VERSION);
    assert.deepEqual(after.facts.policy, before.facts.policy, "the booking keeps its captured entry");
    assert.equal(after.facts.currentRefundEstimate.totalRefundKobo, before.facts.currentRefundEstimate.totalRefundKobo);
  });
});

// ---- AC3: Notice to End as a versioned Booking Amendment ----

test("AC3: A 14-day Notice to End records a versioned Booking Amendment that sets the last night from the notice date", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context) => {
    const contract = contractOf(context);
    const { store, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2] });
    const result = manager.giveNotice(contract.contractId, principalOf(contract));
    assert.equal(NOTICE_TO_END_DAYS, 14);
    assert.equal(result.effectiveDate, addDays("2026-10-01", 14));
    assert.equal(result.newLastNight, addDays("2026-10-01", 13), "the last night is the night before the date 14 days after notice");
    assert.equal(result.newVersion, result.previousVersion + 1, "the amendment moves the contract one version");
    assert.equal(store.current.contractVersion, result.newVersion);
    assert.equal(store.current.dates.checkOut, result.newCheckOut);
    assert.match(result.amendmentId, /^notice-to-end:/);
  });
});

test("AC3: A Notice to End settles only through that date and refunds paid nights after it at the nightly contracted values", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { refunds, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2] });
    const result = manager.giveNotice(contract.contractId, principalOf(contract));
    const period2 = periodsOf(contract)[1]!;
    const expected = period2.nightlyContractedValuesKobo.slice(5).reduce((sum, value) => sum + value, 0);
    assert.equal(result.refundedNights, 25, "nights 15 October to 8 November are after the new last night");
    assert.deepEqual(refunds.map((refund) => [refund.periodIndex, refund.amountKobo]), [[2, expected]]);
    assert.equal(result.owedKobo, 0);
  });
});

test("AC3: Unpaid nights up to the new last night are owed at their nightly contracted values, not as a full period", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { refunds, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1] });
    const result = manager.giveNotice(contract.contractId, principalOf(contract));
    const period2 = periodsOf(contract)[1]!;
    const owed = period2.nightlyContractedValuesKobo.slice(0, 5).reduce((sum, value) => sum + value, 0);
    assert.equal(result.owedKobo, owed);
    assert.notEqual(result.owedKobo, period2.amountKobo, "the owed amount is not the whole period");
    assert.equal(refunds.length, 0, "no refund is due for unpaid nights");
  });
});

test("AC3: A Notice to End never moves the checkout after the contracted checkout", () => {
  const periods = [{ index: 1, checkIn: "2027-02-01", checkOut: "2027-03-03", nights: 30, amountKobo: 30_000, ownerPayableKobo: 27_000, marginKobo: 3_000, dueDate: "2027-01-25", nightlyContractedValuesKobo: Array.from({ length: 30 }, () => 1_000) }] as unknown as readonly BillingPeriodQuote[];
  const contract = { dates: { checkIn: "2027-02-01", checkOut: "2027-03-03", nights: 30 }, quote: { billingPeriods: periods } } as unknown as BookingContract;
  const result = calculateNoticeToEnd({ contract, periods, paidPeriodIndices: new Set([1]), noticeDate: "2027-02-20" });
  assert.equal(result.newCheckOut, "2027-03-03", "the contracted checkout is never exceeded");
  assert.equal(result.newLastNight, "2027-03-02");
});

test("AC3: After a Notice to End, Billing Periods that start on or after the new checkout leave the payment projection", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { store, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2] });
    manager.giveNotice(contract.contractId, principalOf(contract));
    const amended = store.current;
    const periodManager = new PeriodPaymentManager({ store: null, contracts: { getBookingContract: () => amended } });
    const projected = periodManager.projectBillingPeriods(contract.offerId, new Date("2026-10-02T00:00:00.000Z"));
    assert.deepEqual(projected.map((period) => period.periodIndex), [1, 2], "Period 3 starts after the new checkout and is no longer payable");
  });
});

test("AC3: Owner Payables fall by the owner's share of the refunded nights", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2] });
    const result = manager.giveNotice(contract.contractId, principalOf(contract));
    const period2 = periodsOf(contract)[1]!;
    const base = period2.ownerPayableKobo + period2.marginKobo;
    const refunded = period2.nightlyContractedValuesKobo.slice(5).reduce((sum, value) => sum + value, 0);
    const retained = base - Math.floor((refunded * base) / period2.amountKobo);
    const expected = ownerShareAfterCancellation({ ownerPayableKobo: period2.ownerPayableKobo, marginKobo: period2.marginKobo }, retained).ownerPayableKobo;
    const after = result.ownerPayables.find((entry) => entry.periodIndex === 2)!;
    assert.equal(after.ownerPayableKobo, expected);
    assert.ok(after.ownerPayableKobo < period2.ownerPayableKobo, "the owner's payable for period 2 falls");
    assert.equal(result.ownerPayables.find((entry) => entry.periodIndex === 1)!.ownerPayableKobo, periodsOf(contract)[0]!.ownerPayableKobo, "Period 1 is untouched");
  });
});

test("AC3: A Notice to End without verified access is refused and the contract is unchanged", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { store, refunds, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", verified: false });
    assert.throws(() => manager.giveNotice(contract.contractId, principalOf(contract)), /Verified Access/);
    assert.equal(store.current.contractVersion, contract.contractVersion);
    assert.equal(refunds.length, 0);
  });
});

test("AC3: A second Notice to End on the same contract is refused", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2] });
    manager.giveNotice(contract.contractId, principalOf(contract));
    assert.throws(() => manager.giveNotice(contract.contractId, principalOf(contract)), /already/);
  });
});

test("AC3: Only the Primary Guest of the contract can give a Notice to End", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { store, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z" });
    assert.throws(() => manager.giveNotice(contract.contractId, { id: "someone-else", role: "guest", tenantId: contract.tenantId ?? "" }), /not authorized/);
    assert.throws(() => manager.giveNotice(contract.contractId, { id: contract.parties.primaryGuest.id, role: "guest", tenantId: "other-tenant" }), /not authorized/);
    assert.equal(store.current.contractVersion, contract.contractVersion);
  });
});

test("AC3: A Short Stay cannot take a Notice to End", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const shortContract = { ...contract, quote: { ...(contract.quote as object), stayType: "short" } } as BookingContract;
    const { manager } = noticeManager(shortContract, { now: "2026-10-01T09:00:00.000Z" });
    assert.throws(() => manager.giveNotice(contract.contractId, principalOf(contract)), /Extended Stays/);
  });
});

test("AC3: Notice to End is refused outside the staging demo policy, so production policy is unchanged", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { store, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", noPolicy: true, paid: [1, 2] });
    assert.throws(() => manager.giveNotice(contract.contractId, principalOf(contract)), /staging demo/);
    assert.equal(store.current.contractVersion, contract.contractVersion);
  });
});

// ---- AC4: ADR 0061 failure precedence ----

test("AC4: An open operator or platform failure blocks the voluntary Notice to End and refunds nothing", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const { store, refunds, manager } = noticeManager(contract, { now: "2026-10-01T09:00:00.000Z", paid: [1, 2], failure: true });
    assert.throws(() => manager.giveNotice(contract.contractId, principalOf(contract)), /ADR 0061/);
    assert.equal(store.current.contractVersion, contract.contractVersion, "no amendment is recorded");
    assert.equal(refunds.length, 0, "the voluntary Notice to End refund rules do not run");
  });
});

// ---- AC5: overdue projection and human contact ----

test("AC5: A missed due date projects an overdue state and requires human contact without changing access", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const offerId = context.offerId;
    const dayBeforeDue = addDays(PERIOD_2_DUE, -1);
    const beforeDue = context.guest.cardPaymentApp.projectBillingPeriods(offerId, new Date(`${dayBeforeDue}T12:00:00.000Z`)).find((entry) => entry.periodIndex === 2)!;
    assert.equal(beforeDue.overdue, false, "the period is not overdue before its due date");
    assert.equal(beforeDue.humanContactRequired, false);
    const dueMoment = context.guest.cardPaymentApp.projectBillingPeriods(offerId, new Date(`${PERIOD_2_DUE}T00:00:00.000Z`)).find((entry) => entry.periodIndex === 2)!;
    assert.equal(dueMoment.dueDate, PERIOD_2_DUE);
    assert.equal(dueMoment.overdue, true);
    assert.equal(dueMoment.humanContactRequired, true);
    assert.equal(dueMoment.status, "overdue", "the projection is lazy and clock-driven");
  });
});

test("AC5: An overdue period changes no access, contract, or stay and records no Notice to End or cancellation", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const offerId = context.offerId;
    const before = JSON.stringify(contractOf(context));
    const afterDueDate = addDays(PERIOD_2_START, 1);
    context.guest.cardPaymentApp.projectBillingPeriods(offerId, new Date(`${afterDueDate}T00:00:00.000Z`));
    assert.equal(JSON.stringify(contractOf(context)), before, "the booking contract is untouched by the projection");
    assert.equal(context.guest.cardPaymentApp.getBookingContract(offerId)!.contractVersion, 1);
  });
});

// ---- AC6: demo wording, never a counsel approval claim ----

test("AC6: Guest-facing Extended Stay cancellation and Notice to End terms carry demo wording and never claim counsel approval", async () => {
  await withConfirmedExtendedStay({ unit: journeyUnit(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, (context) => {
    const contract = contractOf(context);
    const policy = contract.policies.cancellationPolicy as { policySummary: string };
    assert.equal(policy.policySummary, EXTENDED_CANCELLATION_DEMO_SUMMARY);
    for (const text of [EXTENDED_CANCELLATION_DEMO_SUMMARY, NOTICE_TO_END_DEMO_TERMS]) {
      assert.match(text, /demo/i, "the wording labels the terms as demo terms");
      assert.doesNotMatch(text, /counsel[- ]approved|approved by counsel|counsel has approved|legally approved/i);
    }
  });
});

// ---- AC7: Short Stay thresholds are unchanged ----

test("AC7: Short Stay flexible, standard and firm cancellation thresholds are unchanged", () => {
  const manager = new CancellationNoShowManager();
  const check = new Date(`${CHECK_IN}T13:00:00.000Z`).getTime();
  const at = (ms: number) => new Date(check - ms).toISOString();
  const day = DAY_MS;
  const hour = 3_600_000;
  const cases: Array<[string, number, number]> = [
    ["flexible", 72 * hour, 100], ["flexible", 72 * hour - 1, 50], ["flexible", 24 * hour - 1, 0],
    ["standard", 14 * day, 100], ["standard", 14 * day - 1, 50], ["standard", 7 * day - 1, 0],
    ["firm", 30 * day, 100], ["firm", 30 * day - 1, 50], ["firm", 14 * day - 1, 0],
  ];
  for (const [policyType, elapsed, expected] of cases) {
    const result = manager.calculateGuestCancellation({ policyType: policyType as "flexible" | "standard" | "firm", checkInIso: new Date(check).toISOString(), cancellationBaseKobo: 1000, cancelledAtIso: at(elapsed) });
    assert.equal(result.refundPercentage, expected, `${policyType} at ${elapsed} ms`);
  }
});
