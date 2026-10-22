import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingContract } from "./card-payment.js";
import type { CancellationEconomics } from "./cancellation-noshow.js";
import { EXTENDED_CANCELLATION_POLICY_VERSION, NOTICE_TO_END_DAYS, NOTICE_TO_END_DEMO_TERMS, type ExtendedStayPolicy } from "./extended-stay.js";
import { ownerShareAfterCancellation } from "./owner-payable.js";
import type { BillingPeriodQuote } from "./quote.js";

export { EXTENDED_CANCELLATION_DEMO_SUMMARY, EXTENDED_CANCELLATION_POLICY_VERSION, NOTICE_TO_END_DAYS, NOTICE_TO_END_DEMO_TERMS } from "./extended-stay.js";

/**
 * Demo-launch issue 13: Extended Stay cancellation allocation and Notice to End (ADR 0092, ADR 0060, ADR 0061, ADR 0105).
 * Every value here is a deterministic calculation over the immutable contract snapshot and the Billing Period quote.
 * The demo-only composition supplies the policy. Production supplies none and cannot reach these commands.
 */

const DAY_MS = 86_400_000;
const WAT_OFFSET_MS = 3_600_000;

function dayMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function addDays(dateKey: string, days: number): string {
  return new Date(dayMs(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

function nightsBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

function billingPeriodsOf(contract: BookingContract): readonly BillingPeriodQuote[] {
  const quote = contract.quote as { readonly stayType?: unknown; readonly billingPeriods?: unknown } | undefined;
  if (quote?.stayType !== "extended" || !Array.isArray(quote.billingPeriods) || quote.billingPeriods.length === 0) {
    throw new Error("Notice to End applies only to Extended Stays");
  }
  return quote.billingPeriods as readonly BillingPeriodQuote[];
}

export interface ExtendedCancellationEconomicsInput {
  readonly contract: BookingContract;
  /** The Billing Periods with a verified payment. Before check-in only Period 1 can be paid (ADR 0092). */
  readonly paidPeriodIndices: readonly number[];
  readonly commissionRate: number;
}

/**
 * ADR 0092: a cancellation before check-in charges only the first Period Payment. Its Cancellation Base is the Period 1
 * owner payable plus margin; attributable taxes in the period amount stay refundable (ADR 0058). Unpaid later periods
 * contribute nothing. A paid later period fails closed, because the pre-check-in base is Period 1 only.
 */
export function extendedCancellationEconomics(input: ExtendedCancellationEconomicsInput): CancellationEconomics {
  const periods = billingPeriodsOf(input.contract);
  const first = periods[0];
  if (!first) throw new Error("Extended Stay has no Billing Periods");
  if (!input.paidPeriodIndices.includes(1)) throw new Error("Billing Period 1 must be paid to form a cancellation base");
  if (input.paidPeriodIndices.some((index) => index > 1)) {
    throw new Error("A later Billing Period is recorded as paid before check-in; the pre-check-in base is Period 1 only (ADR 0092)");
  }
  const base = first.ownerPayableKobo + first.marginKobo;
  return Object.freeze({
    version: EXTENDED_CANCELLATION_POLICY_VERSION,
    currency: "NGN" as const,
    cancellationBaseKobo: base,
    refundableCleaningKobo: 0,
    refundableUnprovidedServicesKobo: 0,
    refundableSecurityDepositKobo: 0,
    refundableAttributableTaxKobo: Math.max(0, first.amountKobo - base),
    refundableDuplicatePaymentKobo: 0,
    commissionRate: input.commissionRate,
  });
}

export interface NoticeCalculationInput {
  readonly contract: BookingContract;
  readonly periods: readonly BillingPeriodQuote[];
  readonly paidPeriodIndices: ReadonlySet<number>;
  /** The notice date, YYYY-MM-DD in WAT. */
  readonly noticeDate: string;
}

export interface NoticeCalculation {
  readonly noticeDate: string;
  readonly effectiveDate: string;
  readonly newLastNight: string;
  readonly newCheckOut: string;
  readonly refundedNights: number;
  readonly refundsByPeriod: readonly { readonly periodIndex: number; readonly amountKobo: number }[];
  /** Unpaid nights up to the new last night, at their nightly contracted values (ADR 0092). */
  readonly owedKobo: number;
  /** The owner's payable and margin for each period after the refunded nights are removed (ADR 0092). */
  readonly ownerPayables: readonly { readonly periodIndex: number; readonly ownerPayableKobo: number; readonly marginKobo: number }[];
}

/**
 * ADR 0092 Notice to End. The effective date is 14 days after the notice. The new last night is the night before that
 * date, and never falls after the contracted last night. Nights after it are refunded only when paid, at their nightly
 * contracted values. Unpaid nights up to it are owed at those values, never as a full period.
 */
export function calculateNoticeToEnd(input: NoticeCalculationInput): NoticeCalculation {
  const contractedLastNight = addDays(input.contract.dates.checkOut, -1);
  const effectiveDate = addDays(input.noticeDate, NOTICE_TO_END_DAYS);
  const candidate = addDays(effectiveDate, -1);
  const newLastNight = candidate < contractedLastNight ? candidate : contractedLastNight;
  if (newLastNight < input.contract.dates.checkIn) throw new Error("The Notice to End would leave no night to stay");
  let refundedNights = 0;
  let owedKobo = 0;
  const refundsByPeriod: { periodIndex: number; amountKobo: number }[] = [];
  const ownerPayables: { periodIndex: number; ownerPayableKobo: number; marginKobo: number }[] = [];
  for (const period of input.periods) {
    const paid = input.paidPeriodIndices.has(period.index);
    let refund = 0;
    period.nightlyContractedValuesKobo.forEach((value, offset) => {
      const night = addDays(period.checkIn, offset);
      if (night > newLastNight) {
        if (paid) {
          refund += value;
          refundedNights += 1;
        }
      } else if (!paid) {
        owedKobo += value;
      }
    });
    if (refund > 0) refundsByPeriod.push({ periodIndex: period.index, amountKobo: refund });
    const base = period.ownerPayableKobo + period.marginKobo;
    const refundedBase = period.amountKobo > 0 ? Math.floor((refund * base) / period.amountKobo) : 0;
    const share = ownerShareAfterCancellation({ ownerPayableKobo: period.ownerPayableKobo, marginKobo: period.marginKobo }, base - refundedBase);
    ownerPayables.push({ periodIndex: period.index, ownerPayableKobo: share.ownerPayableKobo, marginKobo: share.marginKobo });
  }
  return Object.freeze({
    noticeDate: input.noticeDate,
    effectiveDate,
    newLastNight,
    newCheckOut: addDays(newLastNight, 1),
    refundedNights,
    refundsByPeriod: Object.freeze(refundsByPeriod),
    owedKobo,
    ownerPayables: Object.freeze(ownerPayables),
  });
}

export interface NoticeContractRepository {
  getContract(id: string): BookingContract;
  mutateContract(id: string, expectedVersion: number, mutation: (current: BookingContract) => BookingContract): BookingContract;
}

export interface NoticePeriodLedger {
  projectBillingPeriods(offerId: string, now: Date): readonly { readonly periodIndex: number; readonly status: string }[];
  paymentsFor(offerId: string): readonly { readonly periodIndex: number; readonly pspReference: string }[];
}

export interface NoticeRefundPort {
  initiateOrGetRefund(input: {
    amendmentId: string;
    reservationId: string;
    periodIndex: number;
    paymentMethod: "fresh_card" | "bank_transfer";
    originalPaymentReference: string;
    amountKobo: number;
    currency: "NGN";
  }): { refundId: string; status: "pending" | "settled" | "failed"; amountKobo: number; currency: "NGN" };
}

export interface NoticeToEndManagerOptions {
  readonly contracts: NoticeContractRepository;
  readonly periods: NoticePeriodLedger;
  readonly arrival: { hasVerifiedAccess(reservationId: string): boolean };
  /** ADR 0061: an open safety, operator or platform failure takes its remedy path, never the voluntary Notice to End. */
  readonly failures: { hasOpenFailure(reservationId: string): boolean };
  readonly refunds: NoticeRefundPort;
  /** Supplied only by the staging demo composition (ADR 0105). Absent in production, which refuses Notice to End. */
  readonly extendedStayPolicy?: ExtendedStayPolicy;
  readonly clock: () => Date;
}

export interface NoticeToEndResult extends NoticeCalculation {
  readonly amendmentId: string;
  readonly contractId: string;
  readonly previousVersion: number;
  readonly newVersion: number;
  readonly refunds: readonly { readonly periodIndex: number; readonly amountKobo: number; readonly refundId?: string; readonly status: "pending" | "settled" | "failed" | "reconciliation_required" }[];
  readonly demoTerms: string;
}

function guestAuthorized(contract: BookingContract, principal: CommandPrincipal): boolean {
  return principal.role === "guest" && !!principal.id && principal.id === contract.parties.primaryGuest.id && !!contract.tenantId && principal.tenantId === contract.tenantId;
}

/**
 * ADR 0060 versioned Notice to End. The notice commits as one atomic amendment that moves the contract one version and
 * sets the new checkout. The refunds run afterwards, keyed by amendment and period, so a retry never refunds twice.
 */
export class NoticeToEndManager {
  readonly #o: NoticeToEndManagerOptions;

  constructor(options: NoticeToEndManagerOptions) {
    this.#o = options;
  }

  giveNotice(contractId: string, principal: CommandPrincipal): NoticeToEndResult {
    if (!this.#o.extendedStayPolicy) {
      throw new Error("Notice to End is available only in the staging demo (ADR 0105); production policy is unchanged (ADR 0092)");
    }
    const contract = this.#o.contracts.getContract(contractId);
    if (!guestAuthorized(contract, principal)) throw new Error("Notice to End is not authorized for this principal");
    billingPeriodsOf(contract);
    if (contract.noticeToEnd) throw new Error("A Notice to End is already recorded for this contract");
    if (this.#o.failures.hasOpenFailure(contract.reservationId)) {
      throw new Error("An operator or platform failure applies its ADR 0061 remedy; a voluntary Notice to End is not available");
    }
    if (!this.#o.arrival.hasVerifiedAccess(contract.reservationId)) throw new Error("A Notice to End is available only after Verified Access");

    const now = this.#o.clock();
    const noticeDate = new Date(now.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
    const periods = billingPeriodsOf(contract);
    const paidPeriodIndices = new Set(
      this.#o.periods.projectBillingPeriods(contract.offerId, now).filter((period) => period.status === "paid").map((period) => period.periodIndex),
    );
    const calculation = calculateNoticeToEnd({ contract, periods, paidPeriodIndices, noticeDate });
    const amendmentId = `notice-to-end:${contract.contractId}:${contract.contractVersion}`;

    const committed = this.#o.contracts.mutateContract(contractId, contract.contractVersion, (current) => ({
      ...current,
      contractVersion: current.contractVersion + 1,
      dates: { checkIn: current.dates.checkIn, checkOut: calculation.newCheckOut, nights: nightsBetween(current.dates.checkIn, calculation.newCheckOut) },
      noticeToEnd: { amendmentId, noticeDate, effectiveDate: calculation.effectiveDate, newLastNight: calculation.newLastNight },
    }));

    const refunds = calculation.refundsByPeriod.map((entry) => {
      try {
        const source = this.#paymentSource(contract, entry.periodIndex);
        const refund = this.#o.refunds.initiateOrGetRefund({
          amendmentId,
          reservationId: contract.reservationId,
          periodIndex: entry.periodIndex,
          paymentMethod: source.paymentMethod,
          originalPaymentReference: source.reference,
          amountKobo: entry.amountKobo,
          currency: "NGN",
        });
        if (refund.amountKobo !== entry.amountKobo || refund.currency !== "NGN") throw new Error("Refund provider result does not match the obligation");
        return { periodIndex: entry.periodIndex, amountKobo: entry.amountKobo, refundId: refund.refundId, status: refund.status };
      } catch {
        return { periodIndex: entry.periodIndex, amountKobo: entry.amountKobo, status: "reconciliation_required" as const };
      }
    });

    return Object.freeze({
      ...calculation,
      amendmentId,
      contractId,
      previousVersion: contract.contractVersion,
      newVersion: committed.contractVersion,
      refunds: Object.freeze(refunds),
      demoTerms: NOTICE_TO_END_DEMO_TERMS,
    });
  }

  #paymentSource(contract: BookingContract, periodIndex: number): { paymentMethod: "fresh_card" | "bank_transfer"; reference: string } {
    if (periodIndex === 1) {
      const details = contract.paymentDetails;
      return details.paymentMethod === "fresh_card"
        ? { paymentMethod: "fresh_card", reference: details.pspReference }
        : { paymentMethod: "bank_transfer", reference: details.transferReference };
    }
    const record = this.#o.periods.paymentsFor(contract.offerId).find((entry) => entry.periodIndex === periodIndex);
    if (!record) throw new Error(`No verified payment is recorded for Billing Period ${periodIndex}`);
    return { paymentMethod: "fresh_card", reference: record.pspReference };
  }
}
