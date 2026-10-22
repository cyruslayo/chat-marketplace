/** The authoritative staging demo policy for issue 08, derived from ADR 0092 and ADR 0105. */
export interface ExtendedStayPolicy {
  readonly minimumNights: number;
  readonly maximumNights: number;
  readonly billingPeriodNights: number;
}

/** Issue 08 enables one 30-night Billing Period. Issue 09 extends this staging-only value. */
export const DEMO_EXTENDED_STAY_POLICY: ExtendedStayPolicy = Object.freeze({
  minimumNights: 30,
  maximumNights: 30,
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

export function assertStayLength(nights: number, policy?: ExtendedStayPolicy): "short" | "extended" {
  if (nights >= 1 && nights <= 14) return "short";
  if (isExtendedStayLength(nights, policy)) return "extended";
  if (policy === undefined && nights > 14) throw new RangeError("stay cannot exceed 14 nights");
  throw new RangeError("stay length is outside the configured ranges (Short Stay is 14 nights or fewer)");
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
