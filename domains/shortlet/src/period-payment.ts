import type { PSPVerifyResult } from "../../../packages/platform-core/src/payments/index.js";
import type { GuestContactSource } from "../../../packages/platform-core/src/accounts/contact.js";
import { isEligibleExtendedStayUnit, isEligibleUnit, type Unit } from "./browse.js";
import type { BookingContract } from "./card-payment.js";
import type { ExtendedStayPolicy } from "./extended-stay.js";
import type { DurablePeriodPayment, DurablePeriodPaymentRefund, DurablePeriodPaymentSession, SqliteGuestInteractionStore } from "./guest-interaction-store.js";
import type { BillingPeriodQuote } from "./quote.js";

/** ADR 0044: each Period Payment is a fresh session under the same Payment Window as the first payment (ADR 0092). */
export const PERIOD_PAYMENT_WINDOW_MINUTES = 20;
/** ADR 0092: a later Billing Period is due seven days before its first night. */
export const PERIOD_DUE_DAYS_BEFORE_FIRST_NIGHT = 7;
/** ADR 0092: reminders go to the Primary Guest seven, three and one days before a due date. */
export const PERIOD_REMINDER_DAYS_BEFORE_DUE: readonly number[] = Object.freeze([7, 3, 1]);

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export type BillingPeriodStatus = "scheduled" | "payable" | "paid" | "overdue" | "unpaid_at_start";

/** A lazily projected Billing Period. It holds no credential, account number or identity evidence. */
export interface BillingPeriodProjection {
  readonly offerId: string;
  readonly periodIndex: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly amountKobo: number;
  readonly dueDate: string;
  readonly status: BillingPeriodStatus;
  /** Unpaid at or after the due date (ADR 0092 missed payment). */
  readonly overdue: boolean;
  /** ADR 0092: the back office must contact the guest; the system takes no access action. */
  readonly humanContactRequired: boolean;
  /** A payment session for this period is open and inside its Payment Window. */
  readonly live: boolean;
}

export interface PeriodReminder {
  readonly offerId: string;
  readonly periodIndex: number;
  readonly daysBeforeDue: number;
  readonly reminderDate: string;
}

export interface BackOfficePeriodEntry {
  readonly offerId: string;
  readonly periodIndex: number;
  readonly status: BillingPeriodStatus;
  readonly dueDate: string;
  readonly amountKobo: number;
}

export type PeriodVerificationOutcome =
  | { readonly outcome: "period_paid"; readonly offerId: string; readonly periodIndex: number; readonly pspReference: string }
  | { readonly outcome: "already_paid"; readonly offerId: string; readonly periodIndex: number; readonly pspReference: string }
  | { readonly outcome: "refund_recorded"; readonly offerId: string; readonly periodIndex: number; readonly pspReference: string; readonly reason: DurablePeriodPaymentRefund["reason"] };

export interface PeriodPaymentManagerOptions {
  readonly store: SqliteGuestInteractionStore | null;
  readonly contracts: { getBookingContract(offerId: string): BookingContract | undefined };
  /** Supplied only by the authoritative staging demo composition (ADR 0105); absent in production. */
  readonly extendedStayPolicy?: ExtendedStayPolicy;
  /** The authoritative Unit source, rechecked at each Period Payment (ADR 0092, ADR 0055). */
  readonly unitSource?: { findById(id: string): unknown };
  readonly guestContacts?: GuestContactSource;
}

interface PaidPeriod {
  readonly periodIndex: number;
  readonly reference: string;
  readonly amountKobo: number;
  readonly paidAt: string;
}

function dayStartMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function addDaysKey(dateKey: string, days: number): string {
  return new Date(dayStartMs(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * ADR 0092 Later Period Payments. The first Period Payment stays on the Short Stay card path; this manager owns each
 * later Billing Period: its payable window, its one live payment session, its verification and its refund records.
 * Every value comes from the Booking Contract snapshot (issue 09), so the amounts never drift from what was agreed.
 */
export class PeriodPaymentManager {
  readonly #store: SqliteGuestInteractionStore | null;
  readonly #contracts: PeriodPaymentManagerOptions["contracts"];
  readonly #policy?: ExtendedStayPolicy;
  readonly #units?: PeriodPaymentManagerOptions["unitSource"];
  readonly #contacts?: GuestContactSource;

  constructor(options: PeriodPaymentManagerOptions) {
    this.#store = options.store;
    this.#contracts = options.contracts;
    this.#policy = options.extendedStayPolicy;
    this.#units = options.unitSource;
    this.#contacts = options.guestContacts;
  }

  #requireStore(): SqliteGuestInteractionStore {
    if (!this.#store) throw new Error("Period payments need the authoritative payment store");
    return this.#store;
  }

  #extendedContract(offerId: string): { readonly contract: BookingContract; readonly periods: readonly BillingPeriodQuote[] } {
    const contract = this.#contracts.getBookingContract(offerId);
    if (!contract || !isExtendedContract(contract)) throw new Error("Period payments apply only to a confirmed Extended Stay");
    return { contract, periods: (contract.quote as { readonly billingPeriods: readonly BillingPeriodQuote[] }).billingPeriods };
  }

  /** Billing Period 1 is paid by the first Period Payment that formed the contract; later periods come from the store. */
  #paidPeriods(offerId: string, contract: BookingContract): Map<number, PaidPeriod> {
    const paid = new Map<number, PaidPeriod>();
    const details = contract.paymentDetails;
    paid.set(1, {
      periodIndex: 1,
      reference: details.paymentMethod === "fresh_card" ? details.pspReference : details.transferReference,
      amountKobo: details.amountKobo,
      paidAt: details.paidAt,
    });
    for (const record of this.#store?.listPeriodPayments(offerId) ?? []) {
      paid.set(record.periodIndex, { periodIndex: record.periodIndex, reference: record.pspReference, amountKobo: record.amountKobo, paidAt: record.paidAt });
    }
    return paid;
  }

  #hasLiveSession(offerId: string, periodIndex: number, now: Date): boolean {
    return (this.#store?.listPeriodPaymentSessions(offerId, periodIndex) ?? []).some(
      (session) => session.status === "initiated" && now.getTime() <= Date.parse(session.expiresAt),
    );
  }

  #projectPeriods(offerId: string, now: Date): BillingPeriodProjection[] {
    const { contract, periods } = this.#extendedContract(offerId);
    const paid = this.#paidPeriods(offerId, contract);
    const nowMs = now.getTime();
    return periods.map((period, index) => {
      const isPaid = paid.has(period.index);
      const startMs = dayStartMs(period.checkIn);
      const dueMs = dayStartMs(period.dueDate);
      // ADR 0092: a later period becomes payable once the previous period has started.
      const previous = periods[index - 1];
      const payableFromMs = previous ? dayStartMs(previous.checkIn) : startMs;
      const overdue = !isPaid && nowMs >= dueMs;
      const status: BillingPeriodStatus = isPaid
        ? "paid"
        : nowMs >= startMs
          ? "unpaid_at_start"
          : overdue
            ? "overdue"
            : nowMs >= payableFromMs
              ? "payable"
              : "scheduled";
      // Demo-launch issue 13: a period cut short by a Notice to End projects only the nights kept (ADR 0092).
      const cutShort = dayStartMs(period.checkOut) > dayStartMs(contract.dates.checkOut);
      const keptNights = cutShort ? Math.round((dayStartMs(contract.dates.checkOut) - startMs) / DAY_MS) : period.nights;
      const keptAmountKobo = cutShort ? period.nightlyContractedValuesKobo.slice(0, keptNights).reduce((sum, value) => sum + value, 0) : period.amountKobo;
      return Object.freeze({
        offerId,
        periodIndex: period.index,
        checkIn: period.checkIn,
        checkOut: cutShort ? contract.dates.checkOut : period.checkOut,
        nights: keptNights,
        amountKobo: keptAmountKobo,
        dueDate: period.dueDate,
        status,
        overdue,
        humanContactRequired: overdue,
        live: !isPaid && this.#hasLiveSession(offerId, period.index, now),
      });
    }).filter((projection) => dayStartMs(projection.checkIn) < dayStartMs(contract.dates.checkOut));
  }

  /** Lazily projected Billing Periods of a confirmed Extended Stay, as of `now`. No background job changes them. */
  projectBillingPeriods(offerId: string, now: Date): readonly BillingPeriodProjection[] {
    return Object.freeze(this.#projectPeriods(offerId, now));
  }

  /** Reminders 7, 3 and 1 days before each unpaid period's due date, once the reminder date has arrived (ADR 0092). */
  remindersDue(offerId: string, now: Date): readonly PeriodReminder[] {
    const today = utcDayKey(now);
    const reminders: PeriodReminder[] = [];
    for (const period of this.#projectPeriods(offerId, now)) {
      if (period.status === "paid" || today >= period.dueDate) continue;
      for (const daysBeforeDue of PERIOD_REMINDER_DAYS_BEFORE_DUE) {
        const reminderDate = addDaysKey(period.dueDate, -daysBeforeDue);
        if (reminderDate <= today) reminders.push(Object.freeze({ offerId, periodIndex: period.periodIndex, daysBeforeDue, reminderDate }));
      }
    }
    return Object.freeze(reminders);
  }

  /** Unpaid periods the back office must act on (payable, overdue or unpaid at start), by due date. */
  backOfficeList(now: Date): readonly BackOfficePeriodEntry[] {
    const entries: BackOfficePeriodEntry[] = [];
    for (const offerId of this.#store?.listBookingSnapshotOfferIds() ?? []) {
      if (!isExtendedContract(this.#contracts.getBookingContract(offerId))) continue;
      for (const period of this.#projectPeriods(offerId, now)) {
        if (period.status === "payable" || period.status === "overdue" || period.status === "unpaid_at_start") {
          entries.push(Object.freeze({ offerId, periodIndex: period.periodIndex, status: period.status, dueDate: period.dueDate, amountKobo: period.amountKobo }));
        }
      }
    }
    return Object.freeze(entries.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.offerId.localeCompare(right.offerId)));
  }

  /** The later Period Payments that were recorded as paid, one per period. */
  paymentsFor(offerId: string) {
    return this.#store?.listPeriodPayments(offerId) ?? [];
  }

  /** Money recorded for refund: superseded, expired, late, or a success for a period already paid (ADR 0045, ADR 0046). */
  refundsFor(offerId: string): readonly DurablePeriodPaymentRefund[] {
    return this.#store?.listRefundablePeriodPayments(offerId) ?? [];
  }

  /** Whether a PSP reference belongs to a later Period Payment session. */
  hasPeriodSession(pspReference: string): boolean {
    return this.#store?.findPeriodPaymentSessionByReference(pspReference) != null;
  }

  /** The offer a later Period Payment reference belongs to. Unknown references fail closed. */
  offerIdForPeriodReference(pspReference: string): string {
    const session = this.#store?.findPeriodPaymentSessionByReference(pspReference);
    if (!session) throw new Error("PSP reference is not bound to an authoritative period checkout session");
    return session.offerId;
  }

  /** Starts the one live payment session for the next unpaid Billing Period, when it is payable and eligible. */
  initializePeriodCheckout(input: { readonly offerId: string; readonly periodIndex: number; readonly now: Date; readonly payerId: string; readonly tenantId: string }): DurablePeriodPaymentSession {
    const store = this.#requireStore();
    if (!this.#policy) throw new Error("Extended Stay payment is disabled in this runtime");
    const { contract, periods } = this.#extendedContract(input.offerId);
    const period = periods.find((candidate) => candidate.index === input.periodIndex);
    if (!period) throw new RangeError("Billing Period is not part of this stay");
    if (dayStartMs(period.checkOut) > dayStartMs(contract.dates.checkOut)) {
      throw new Error(`Billing Period ${period.index} was cut short by a Notice to End and cannot start a new payment session`);
    }
    const paid = this.#paidPeriods(input.offerId, contract);
    if (paid.has(period.index)) throw new Error(`Billing Period ${period.index} is already paid`);
    const nextUnpaid = periods.find((candidate) => !paid.has(candidate.index))!;
    if (nextUnpaid.index !== period.index) throw new Error(`Only the next unpaid Billing Period (${nextUnpaid.index}) may be paid`);
    const nowMs = input.now.getTime();
    const startMs = dayStartMs(period.checkIn);
    if (nowMs >= startMs) throw new Error(`Billing Period ${period.index} has started and can no longer be paid`);
    const previous = periods[period.index - 2];
    if (previous && nowMs < dayStartMs(previous.checkIn)) throw new Error(`Billing Period ${period.index} is not payable until Billing Period ${previous.index} has started`);

    const unit = this.#units?.findById(contract.unitId);
    if (!unit || typeof unit !== "object" || !isEligibleExtendedStayUnit(unit as Unit, this.#policy)) throw new Error("Extended Stay unit terms are no longer eligible");
    if (!isEligibleUnit(unit as Unit, input.now, contract.dates)) throw new Error("Unit is no longer eligible through checkout");

    const contact = this.#contacts?.find(input.payerId, input.tenantId);
    if (!contact?.contactEmail) throw new Error("A valid email address is required before payment continuation");

    for (const existing of store.listPeriodPaymentSessions(input.offerId, period.index)) {
      if (existing.status !== "initiated") continue;
      if (nowMs <= Date.parse(existing.expiresAt)) throw new Error(`A live attempt already exists for Billing Period ${period.index}`);
      // An expired attempt is replaced, so it is superseded: a later success on it is refunded, never confirmed (ADR 0046).
      store.savePeriodPaymentSession({ ...existing, status: "superseded" });
    }

    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const session: DurablePeriodPaymentSession = {
      pspReference: `psp_ref_period_${period.index}_${token}`,
      checkoutId: `chk_period_${period.index}_${token}`,
      offerId: input.offerId,
      periodIndex: period.index,
      amountKobo: period.amountKobo,
      currency: "NGN",
      contactEmail: contact.contactEmail,
      startedAt: input.now.toISOString(),
      expiresAt: new Date(Math.min(nowMs + PERIOD_PAYMENT_WINDOW_MINUTES * MINUTE_MS, startMs)).toISOString(),
      status: "initiated",
    };
    store.savePeriodPaymentSession(session);
    return session;
  }

  /** Binds the provider environment reported when the hosted checkout was started, so verification can compare it. */
  bindProviderEnvironment(pspReference: string, environment: "test" | "live"): void {
    const store = this.#requireStore();
    const session = store.findPeriodPaymentSessionByReference(pspReference);
    if (!session) throw new Error("PSP reference is not bound to an authoritative period checkout session");
    store.savePeriodPaymentSession({ ...session, providerEnvironment: environment });
  }

  /**
   * Verifies a provider result against the session's immutable amount, currency, reference, environment and payer.
   * Only a designated, in-window success pays its period. Duplicates are idempotent. Superseded, expired or
   * non-designated successes are recorded for refund and never advance the period.
   */
  verifyPeriodPayment(input: { readonly pspReference: string; readonly providerResult: PSPVerifyResult; readonly now: Date }): PeriodVerificationOutcome {
    const store = this.#requireStore();
    const { pspReference, providerResult: result, now } = input;
    const session = store.findPeriodPaymentSessionByReference(pspReference);
    if (!session) throw new Error("PSP reference is not bound to an authoritative period checkout session");
    const { contract, periods } = this.#extendedContract(session.offerId);
    const period = periods.find((candidate) => candidate.index === session.periodIndex);
    if (!period) throw new Error("Billing Period is not part of this stay");
    const paid = this.#paidPeriods(session.offerId, contract);
    const replayed = [...paid.values()].find((record) => record.reference === pspReference);
    if (replayed) return { outcome: "already_paid", offerId: session.offerId, periodIndex: replayed.periodIndex, pspReference };

    const expired = now.getTime() > Date.parse(session.expiresAt);
    if (!result.verified || result.status !== "success") {
      if (["ongoing", "pending", "processing", "queued"].includes(result.status) && !expired) {
        throw new Error("Period payment is still processing; no Billing Period is paid yet");
      }
      throw new Error(`Server-side payment verification failed: ${result.failureReason ?? "PSP transaction unsuccessful"}`);
    }
    if (result.currency !== "NGN") throw new Error(`Currency verification failed: Expected NGN, got '${result.currency}'`);
    if (result.amountKobo !== period.amountKobo || result.amountKobo !== session.amountKobo) {
      throw new Error(`Amount verification failed: Expected ${period.amountKobo} kobo, got ${result.amountKobo} kobo`);
    }
    if (result.pspReference !== pspReference) throw new Error(`Reference verification failed: Expected ${pspReference}, got ${result.pspReference}`);
    if (session.providerEnvironment !== undefined && result.environment !== session.providerEnvironment) {
      throw new Error(`Environment verification failed: Expected ${session.providerEnvironment}, got ${result.environment ?? "unknown"}`);
    }
    const expectedPayer = contract.parties.distinctPayer?.id ?? contract.parties.primaryGuest.id;
    if (!result.payerId || result.payerId !== expectedPayer) {
      throw new Error(`Payer attribution verification failed: Expected ${expectedPayer}, got ${result.payerId ?? "none"}`);
    }

    const recordRefund = (reason: DurablePeriodPaymentRefund["reason"]): PeriodVerificationOutcome => {
      store.saveRefundablePeriodPayment({ pspReference, offerId: session.offerId, periodIndex: session.periodIndex, amountKobo: result.amountKobo, currency: "NGN", reason, recordedAt: now.toISOString() });
      return { outcome: "refund_recorded", offerId: session.offerId, periodIndex: session.periodIndex, pspReference, reason };
    };
    if (session.status === "initiated" && expired) {
      store.savePeriodPaymentSession({ ...session, status: "expired" });
      recordRefund("late");
      throw new Error("Payment verification failed: the Payment Window has expired; the money is recorded for refund");
    }
    if (session.status !== "initiated" || paid.has(session.periodIndex)) {
      const reason = session.status === "superseded" ? "superseded" : session.status === "expired" ? "expired" : "period_already_paid";
      return recordRefund(reason);
    }

    store.savePeriodPayment({ offerId: session.offerId, periodIndex: session.periodIndex, pspReference, amountKobo: session.amountKobo, currency: "NGN", paidAt: now.toISOString() });
    store.savePeriodPaymentSession({ ...session, status: "completed" });
    return { outcome: "period_paid", offerId: session.offerId, periodIndex: session.periodIndex, pspReference };
  }
}

function isExtendedContract(contract: BookingContract | undefined): contract is BookingContract {
  const quote = contract?.quote as { readonly stayType?: unknown; readonly billingPeriods?: unknown } | undefined;
  return contract !== undefined && quote?.stayType === "extended" && Array.isArray(quote.billingPeriods) && quote.billingPeriods.length > 0;
}
