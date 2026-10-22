import { formatBookingMoney } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, formatGuestDate, guestFact } from "./guest-content.js";

/**
 * Demo-launch issue 12: presentation of an Extended Stay's monthly price, included utilities and Billing Period schedule.
 * One helper feeds the chat surfaces (discovery card, unit detail, request review) and the standalone pages, so both read
 * the same words (ADR 0077). Figures come from the domain quote (ADR 0092): nothing here computes a price or a policy.
 */

/** The utilities and servicing statement a unit publishes for Extended Stays (ADR 0092). */
export interface ExtendedStayUtilitiesFacts {
  readonly powerAndGeneratorFuelIncluded: boolean;
  readonly waterIncluded: boolean;
  readonly internetIncluded: boolean;
  readonly cleaningIncluded: boolean;
  readonly cleaningFrequency: string;
}

/** The monthly terms a 30-night Extended Stay result carries (the first Billing Period's guest amount). */
export interface ExtendedStayUnitFacts {
  readonly periodNights: number;
  readonly monthlyPeriodAmountKobo: number;
  readonly utilitiesAndServicing: ExtendedStayUtilitiesFacts;
}

/** One Billing Period of a quoted Extended Stay, as the Booking Contract snapshots it. */
export interface BillingPeriodFacts {
  readonly index: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly amountKobo: number;
  readonly dueDate: string;
}

const CLEANING_FREQUENCY_LABELS: Readonly<Record<string, string>> = {
  daily: "daily",
  weekly: "weekly",
  fortnightly: "fortnightly",
  "at-checkout": "at checkout",
};

/** "Utilities and servicing: power and generator fuel, water, internet, cleaning weekly included." */
export function utilitiesSummary(statement: ExtendedStayUtilitiesFacts): string {
  const included: string[] = [];
  const notIncluded: string[] = [];
  const sort = (name: string, isIncluded: boolean): void => {
    (isIncluded ? included : notIncluded).push(name);
  };
  sort("power and generator fuel", statement.powerAndGeneratorFuelIncluded);
  sort("water", statement.waterIncluded);
  sort("internet", statement.internetIncluded);
  sort(`cleaning ${CLEANING_FREQUENCY_LABELS[statement.cleaningFrequency] ?? statement.cleaningFrequency}`, statement.cleaningIncluded);
  const parts = [
    included.length > 0 ? `${included.join(", ")} included` : undefined,
    notIncluded.length > 0 ? `${notIncluded.join(", ")} not included` : undefined,
  ].filter((part): part is string => part !== undefined);
  return `${parts.join("; ")}.`;
}

/** The monthly price fact, on the chat card and the detail: the first Billing Period's guest amount. */
export function monthlyPriceFact(terms: ExtendedStayUnitFacts): string {
  return guestFact(GUEST_FACT_LABELS.monthlyPrice, `${formatBookingMoney(terms.monthlyPeriodAmountKobo)} for ${terms.periodNights} nights`);
}

/** The included utilities fact, on the chat card and the detail. */
export function utilitiesFact(terms: ExtendedStayUnitFacts): string {
  return guestFact(GUEST_FACT_LABELS.utilitiesIncluded, utilitiesSummary(terms.utilitiesAndServicing));
}

/** Every Extended Stay fact a unit surface shows, in order. Empty for a Short Stay result. */
export function extendedStayUnitFacts(terms: ExtendedStayUnitFacts | undefined): readonly string[] {
  return terms === undefined ? [] : [monthlyPriceFact(terms), utilitiesFact(terms)];
}

/** One Billing Period line: its number, dates, amount and due date. */
export function billingPeriodLine(period: BillingPeriodFacts): string {
  const dates = `${formatGuestDate(period.checkIn) ?? period.checkIn} to ${formatGuestDate(period.checkOut) ?? period.checkOut}`;
  return `${GUEST_FACT_LABELS.billingPeriod} ${period.index}: ${dates} (${period.nights} nights) · ${formatBookingMoney(period.amountKobo)} · due ${formatGuestDate(period.dueDate) ?? period.dueDate}`;
}

/** The whole payment schedule: one line per Billing Period, in order. */
export function billingPeriodLines(periods: readonly BillingPeriodFacts[] | undefined): readonly string[] {
  return (periods ?? []).map(billingPeriodLine);
}

/**
 * The Billing Period schedule of a quoted Extended Stay, for a request draft or review. A Short Stay quote, which has no
 * periods, yields nothing. The quote's own amounts and dates are copied unchanged (ADR 0092).
 */
export function extendedStayDraftFacts(quote: {
  readonly stayType?: string;
  readonly billingPeriods?: readonly BillingPeriodFacts[];
  readonly utilitiesAndServicing?: unknown;
}): { readonly billingPeriods?: readonly BillingPeriodFacts[]; readonly utilitiesAndServicing?: ExtendedStayUtilitiesFacts } {
  if (quote.stayType !== "extended" || quote.billingPeriods === undefined) return {};
  return {
    billingPeriods: quote.billingPeriods.map((period) => ({ index: period.index, checkIn: period.checkIn, checkOut: period.checkOut, nights: period.nights, amountKobo: period.amountKobo, dueDate: period.dueDate })),
    ...(quote.utilitiesAndServicing === undefined ? {} : { utilitiesAndServicing: quote.utilitiesAndServicing as ExtendedStayUtilitiesFacts }),
  };
}

/** One Billing Period's status line on the schedule (ADR 0092). It never describes a future period as paid. */
export function billingPeriodStatusText(period: { readonly status: string; readonly overdue: boolean; readonly live: boolean }): string {
  if (period.status === "paid") return "Paid";
  if (period.status === "payable") return period.live ? "Payable now. A payment is in progress." : "Payable now.";
  if (period.status === "overdue" || period.overdue) return "Overdue. The payment was not received by its due date.";
  if (period.status === "unpaid_at_start") return "Unpaid at the start of this Billing Period.";
  return "Not payable yet. Payable once the previous Billing Period has started.";
}
