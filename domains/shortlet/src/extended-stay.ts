import { MAX_STAY_NIGHTS } from "./browse.js";

/** The authoritative staging demo policy for issue 08, derived from ADR 0092 and ADR 0105. */
export interface ExtendedStayPolicy {
  readonly minimumNights: number;
  readonly maximumNights: number;
  readonly billingPeriodNights: number;
}

/**
 * ADR 0105 (amended 22 Oct 2026): the staging demo accepts Extended Stays of 30 to 180 nights, six 30-night Billing
 * Periods at most. Only the demo composition supplies this policy; production keeps ADR 0092's 30-90 nights and
 * receives no policy at all until its ordinary launch gates close.
 */
export const DEMO_EXTENDED_STAY_POLICY: ExtendedStayPolicy = Object.freeze({
  minimumNights: 30,
  maximumNights: 180,
  billingPeriodNights: 30,
});

export interface MonthlyAgreedAmounts {
  readonly accommodationKobo: number;
  readonly mandatoryChargesKobo: number;
  readonly version: string;
}

export interface UtilitiesAndServicingStatement {
  readonly powerAndGeneratorFuelIncluded: boolean;
  readonly waterIncluded: boolean;
  readonly internetIncluded: boolean;
  readonly cleaningIncluded: boolean;
  readonly cleaningFrequency: "daily" | "weekly" | "fortnightly" | "at-checkout";
}

export interface UnitExtendedStayTerms {
  readonly optedIn: boolean;
  readonly monthlyAgreedAmounts?: MonthlyAgreedAmounts;
  readonly utilitiesAndServicing?: UtilitiesAndServicingStatement;
}

export function isExtendedStayLength(nights: number, policy: ExtendedStayPolicy | undefined): boolean {
  return policy !== undefined && nights >= policy.minimumNights && nights <= policy.maximumNights;
}

/** ADR-0023 as amended 1 Nov 2026: the Short Stay maximum is MAX_STAY_NIGHTS (29); no other constant holds it. */
export function assertStayLength(nights: number, policy?: ExtendedStayPolicy): "short" | "extended" {
  if (nights >= 1 && nights <= MAX_STAY_NIGHTS) return "short";
  if (isExtendedStayLength(nights, policy)) return "extended";
  if (policy === undefined && nights > MAX_STAY_NIGHTS) throw new RangeError(`stay cannot exceed ${MAX_STAY_NIGHTS} nights`);
  throw new RangeError(`stay length is outside the configured ranges (Short Stay is ${MAX_STAY_NIGHTS} nights or fewer)`);
}

export function monthlyAmountsAreValid(value: MonthlyAgreedAmounts | undefined): value is MonthlyAgreedAmounts {
  return value !== undefined
    && Number.isSafeInteger(value.accommodationKobo) && value.accommodationKobo > 0
    && Number.isSafeInteger(value.mandatoryChargesKobo) && value.mandatoryChargesKobo >= 0
    && typeof value.version === "string" && value.version.trim() !== "";
}

export function utilitiesStatementIsValid(value: UtilitiesAndServicingStatement | undefined): value is UtilitiesAndServicingStatement {
  return value !== undefined
    && typeof value.powerAndGeneratorFuelIncluded === "boolean"
    && typeof value.waterIncluded === "boolean"
    && typeof value.internetIncluded === "boolean"
    && typeof value.cleaningIncluded === "boolean"
    && ["daily", "weekly", "fortnightly", "at-checkout"].includes(value.cleaningFrequency);
}

/**
 * Demo-launch issue 13 (ADR 0092, ADR 0105). The Extended catalogue entry used by every Extended Stay. Its thresholds
 * (T-30d, T-14d) and the 14-day Notice to End are ADR 0092 values that await counsel approval [counsel]; they are
 * demonstrated only by the synthetic staging demo, labelled as demo terms. They are not counsel-approved.
 */
export const EXTENDED_CANCELLATION_POLICY_VERSION = "cancellation-extended-adr0092-v1";
export const EXTENDED_CANCELLATION_DEMO_SUMMARY =
  "Demo terms for a synthetic staging booking, pending counsel review: 100% of the first Billing Period's cancellation base is refunded if you cancel 30 or more days before check-in, 50% if you cancel 14 or more days before, and nothing after that. Later Billing Periods are never charged.";
/** ADR 0092: a Notice to End takes effect 14 days after notice. The 14 days await counsel approval [counsel]. */
export const NOTICE_TO_END_DAYS = 14;
export const NOTICE_TO_END_DEMO_TERMS =
  "Demo Notice to End terms for a synthetic staging booking, pending counsel review: the stay ends 14 days after notice, and paid nights after that date are refunded at their nightly values.";
