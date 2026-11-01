import { MAX_STAY_NIGHTS } from "./browse.js";

/** The Extended Stay policy (ADR 0092 as amended 1 Nov 2026, ADR 0023 as amended 1 Nov 2026). */
export interface ExtendedStayPolicy {
  readonly minimumNights: number;
  readonly maximumNights: number;
  readonly billingPeriodNights: number;
}

/**
 * ADR 0092 as amended 1 Nov 2026: Extended Stays of 30 to 180 nights (six 30-night Billing Periods) are on in every
 * deployment, including production (owner decision, 1 Nov 2026). Each unit must still opt in.
 */
export const EXTENDED_STAY_POLICY: ExtendedStayPolicy = Object.freeze({
  minimumNights: 30,
  maximumNights: 180,
  billingPeriodNights: 30,
});

/**
 * Alias kept so existing imports keep working. It is the same object as EXTENDED_STAY_POLICY: the staging demo no longer
 * has its own Extended Stay limit (ADR 0105, amended 1 Nov 2026). Demo labels are a separate concern (see demoTerms).
 */
export const DEMO_EXTENDED_STAY_POLICY: ExtendedStayPolicy = EXTENDED_STAY_POLICY;

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
 * (T-30d, T-14d) and the 14-day Notice to End are ADR 0092 values, approved by counsel on 1 Nov 2026 (ADR 0092 amendment).
 * Demo mode labels the same sentences as demo terms for a synthetic staging booking (ADR 0105); other deployments show
 * them unlabelled.
 */
export const EXTENDED_CANCELLATION_POLICY_VERSION = "cancellation-extended-adr0092-v1";
const CANCELLATION_TERMS_BODY =
  "100% of the first Billing Period's cancellation base is refunded if you cancel 30 or more days before check-in, 50% if you cancel 14 or more days before, and nothing after that. Later Billing Periods are never charged.";
/** ADR 0092: a Notice to End takes effect 14 days after notice. */
export const NOTICE_TO_END_DAYS = 14;
const NOTICE_TO_END_TERMS_BODY =
  "the stay ends 14 days after notice, and paid nights after that date are refunded at their nightly values.";
/** The demo label. It omits "pending counsel review", because counsel has approved these values. */
const DEMO_TERMS_PREFIX = "Demo terms for a synthetic staging booking: ";

/** The Extended cancellation terms. Only demo mode carries the demo label. */
export function extendedCancellationTerms(demoTerms: boolean): string {
  return demoTerms ? DEMO_TERMS_PREFIX + CANCELLATION_TERMS_BODY : CANCELLATION_TERMS_BODY;
}

/** The Notice to End terms. Only demo mode carries the demo label. */
export function noticeToEndTerms(demoTerms: boolean): string {
  if (demoTerms) return DEMO_TERMS_PREFIX + NOTICE_TO_END_TERMS_BODY;
  return NOTICE_TO_END_TERMS_BODY.charAt(0).toUpperCase() + NOTICE_TO_END_TERMS_BODY.slice(1);
}

/** Demo-mode values, kept as constants for existing demo tests and imports. */
export const EXTENDED_CANCELLATION_DEMO_SUMMARY = extendedCancellationTerms(true);
export const NOTICE_TO_END_DEMO_TERMS = noticeToEndTerms(true);
