import { generatePlatformId } from "../../../packages/platform-core/src/index.js";
import { StayDateRange } from "./browse.js";
import { guestPriceFromOwnerTerms, marginOnKobo, ownerSettlementFor, unitOwnerTerms } from "./owner-terms.js";
import type { OwnerSettlementSnapshot } from "./owner-terms.js";
import { EXTENDED_CANCELLATION_POLICY_VERSION, assertStayLength, extendedCancellationTerms, monthlyAmountsAreValid, utilitiesStatementIsValid, type ExtendedStayPolicy, type MonthlyAgreedAmounts, type UtilitiesAndServicingStatement } from "./extended-stay.js";
import { calculateSecurityDepositPolicySnapshot, calculateRefundableSecurityDeposit, SECURITY_DEPOSIT_POLICY_VERSION, type SecurityDepositPolicySnapshot } from "./security-deposit.js";

export interface OptionalServiceCatalogueItem {
  id: string;
  code: string;
  title: string;
  priceKobo: number;
  pricingType: "fixed" | "per-night" | "per-guest";
  supplier: "operator" | "platform-partner";
  offPlatformPaymentAllowed: boolean;
}

/**
 * Controlled catalogue for optional services under launch policy.
 * Optional services come ONLY from this catalogue and CANNOT request off-platform payment.
 */
export const CONTROLLED_OPTIONAL_SERVICES_CATALOGUE: readonly OptionalServiceCatalogueItem[] = Object.freeze([
  {
    id: "svc-airport-pickup-lagos",
    code: "airport-pickup",
    title: "Airport Transfer (Lagos MMIA)",
    priceKobo: 2500000,
    pricingType: "fixed",
    supplier: "operator",
    offPlatformPaymentAllowed: false
  },
  {
    id: "svc-daily-housekeeping",
    code: "daily-housekeeping",
    title: "Daily Housekeeping Service",
    priceKobo: 1000000,
    pricingType: "per-night",
    supplier: "operator",
    offPlatformPaymentAllowed: false
  },
  {
    id: "svc-private-chef",
    code: "private-chef",
    title: "Private Chef (Daily)",
    priceKobo: 5000000,
    pricingType: "per-night",
    supplier: "platform-partner",
    offPlatformPaymentAllowed: false
  },
  {
    id: "svc-late-checkout-greeting",
    code: "late-checkout-greeting",
    title: "Dedicated In-Person Check-in Greeting",
    priceKobo: 1500000,
    pricingType: "fixed",
    supplier: "operator",
    offPlatformPaymentAllowed: false
  }
]);

export function getCatalogueService(serviceId: string): OptionalServiceCatalogueItem | null {
  return CONTROLLED_OPTIONAL_SERVICES_CATALOGUE.find((svc) => svc.id === serviceId) ?? null;
}

export function validateAndResolveOptionalServices(selectedServices: any[] = [], nights = 1, partySize = 1): readonly any[] {
  const resolved: any[] = [];
  for (const item of selectedServices) {
    const catalogueItem = typeof item === "string" ? getCatalogueService(item) : getCatalogueService(item.id ?? item.serviceId);
    if (!catalogueItem) {
      throw new Error(`Invalid optional service: service '${item.id || item}' is not in the controlled catalogue`);
    }
    const requestedOffPlatform = item.offPlatformPaymentAllowed === true || catalogueItem.offPlatformPaymentAllowed === true;
    if (requestedOffPlatform) {
      throw new Error(`Invalid optional service '${catalogueItem.id}': off-platform payment is prohibited`);
    }
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(`Optional service quantity must be a positive integer`);
    }

    let unitPriceKobo = catalogueItem.priceKobo;
    let itemTotalKobo = 0;
    if (catalogueItem.pricingType === "per-night") {
      itemTotalKobo = unitPriceKobo * nights * quantity;
    } else if (catalogueItem.pricingType === "per-guest") {
      itemTotalKobo = unitPriceKobo * partySize * quantity;
    } else {
      itemTotalKobo = unitPriceKobo * quantity;
    }

    resolved.push(Object.freeze({
      serviceId: catalogueItem.id,
      code: catalogueItem.code,
      title: catalogueItem.title,
      pricingType: catalogueItem.pricingType,
      unitPriceKobo,
      quantity,
      totalKobo: itemTotalKobo,
      supplier: catalogueItem.supplier,
      offPlatformPaymentAllowed: false
    }));
  }
  return Object.freeze(resolved);
}

export function calculateTaxKobo(taxConfig: any, taxableAmountKobo: number): number {
  if (!taxConfig) return 0;
  if (typeof taxConfig.fixedTaxKobo === "number") {
    return Math.max(0, Math.floor(taxConfig.fixedTaxKobo));
  }
  if (typeof taxConfig.ratePercentage === "number") {
    if (taxConfig.ratePercentage < 0) throw new RangeError("Tax rate cannot be negative");
    return Math.floor((taxableAmountKobo * taxConfig.ratePercentage) / 100);
  }
  return 0;
}

export interface RevenueClassificationParams {
  accommodationKobo: number;
  mandatoryFeesKobo?: number;
  taxesKobo?: number;
  optionalServices?: any[];
  refundableSecurityDepositKobo?: number;
  securityDeposit?: SecurityDepositPolicySnapshot;
  commissionRate?: number;
  operatorTier?: string;
}

export function classifyRevenue({
  accommodationKobo,
  mandatoryFeesKobo = 0,
  taxesKobo = 0,
  optionalServices = [],
  refundableSecurityDepositKobo = 0,
  commissionRate = 0.12,
  operatorTier = "standard"
}: RevenueClassificationParams) {
  let operatorOptionalServicesKobo = 0;
  let passThroughOptionalServicesKobo = 0;

  for (const svc of optionalServices) {
    if (svc.supplier === "operator") {
      operatorOptionalServicesKobo += svc.totalKobo;
    } else {
      passThroughOptionalServicesKobo += svc.totalKobo;
    }
  }

  const commissionableOperatorRevenueKobo = accommodationKobo + mandatoryFeesKobo + operatorOptionalServicesKobo;

  let rate = commissionRate;
  if (operatorTier === "founding") rate = 0.08;
  else if (operatorTier === "preferred") rate = 10 / 100;

  const estimatedCommissionKobo = Math.floor(commissionableOperatorRevenueKobo * rate);
  const estimatedOperatorNetKobo = commissionableOperatorRevenueKobo - estimatedCommissionKobo;

  return Object.freeze({
    commissionableOperatorRevenueKobo,
    commissionRate: rate,
    estimatedCommissionKobo,
    estimatedOperatorNetKobo,
    excludedAmounts: Object.freeze({
      refundableSecurityDepositKobo,
      taxesKobo,
      damageAwardsKobo: 0,
      passThroughKobo: passThroughOptionalServicesKobo
    })
  });
}

/** ADR 0092 Billing Period pricing for one Extended Stay unit; the same refusal as the quote when it is not configured. */
function extendedTermsOf(unit: { readonly extendedStay?: unknown }): { readonly monthlyAgreedAmounts: MonthlyAgreedAmounts; readonly utilitiesAndServicing: UtilitiesAndServicingStatement } {
  const terms = unit.extendedStay as { readonly optedIn?: unknown; readonly monthlyAgreedAmounts?: MonthlyAgreedAmounts; readonly utilitiesAndServicing?: UtilitiesAndServicingStatement } | undefined;
  if (terms?.optedIn !== true || !monthlyAmountsAreValid(terms.monthlyAgreedAmounts) || !utilitiesStatementIsValid(terms.utilitiesAndServicing)) {
    throw new Error("Unit is not configured for Extended Stay pricing and servicing");
  }
  return { monthlyAgreedAmounts: terms.monthlyAgreedAmounts!, utilitiesAndServicing: terms.utilitiesAndServicing! };
}

/** One Billing Period before the taxes and optional-service extras are allocated to it (ADR 0092). */
export interface ExtendedPeriodBase {
  readonly index: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly baseAmountKobo: number;
  readonly ownerPayableKobo: number;
  readonly dueDate: string;
}

export interface ExtendedPeriodPlan {
  readonly periods: readonly ExtendedPeriodBase[];
  readonly accommodationKobo: number;
  readonly mandatoryFeesKobo: number;
  readonly ownerPayableKobo: number;
}

/**
 * ADR 0092: consecutive Billing Periods of the policy's length from `startDate`, the last one shorter when the nights do not
 * divide. A full period prices at the Monthly Agreed Amounts; a shorter period prices each night at the Short Stay nightly
 * guest price. `firstIndex` numbers the first period (an extension continues the contract's numbering).
 */
export function planExtendedBillingPeriods(input: {
  readonly ownerTerms: ReturnType<typeof unitOwnerTerms>;
  readonly monthly: MonthlyAgreedAmounts;
  readonly startDate: string;
  readonly nights: number;
  readonly policy: ExtendedStayPolicy;
  readonly firstIndex: number;
}): ExtendedPeriodPlan {
  const { ownerTerms, monthly, nights, policy } = input;
  const periods: ExtendedPeriodBase[] = [];
  let accommodationKobo = 0;
  let mandatoryFeesKobo = 0;
  let ownerPayableKobo = 0;
  for (let offset = 0, step = 0; offset < nights; offset += policy.billingPeriodNights, step += 1) {
    const periodNights = Math.min(policy.billingPeriodNights, nights - offset);
    const checkInDate = new Date(Date.parse(`${input.startDate}T00:00:00Z`) + offset * 86_400_000);
    const checkOutDate = new Date(checkInDate.getTime() + periodNights * 86_400_000);
    const isFullPeriod = periodNights === policy.billingPeriodNights;
    const ownerAccommodation = isFullPeriod ? monthly.accommodationKobo : ownerTerms.agreed.nightlyKobo * periodNights;
    const ownerCharges = isFullPeriod ? monthly.mandatoryChargesKobo : ownerTerms.agreed.mandatoryChargesKobo;
    // ADR 0092: a shorter final period is each of its nights at the Short Stay nightly guest price (ADR 0089), so it
    // carries no monthly discount and no rounding drift from pricing its nights as one block.
    const guestPrice = guestPriceFromOwnerTerms(ownerTerms);
    const guestAccommodation = isFullPeriod
      ? ownerAccommodation + marginOnKobo(ownerAccommodation, ownerTerms.marginBasisPoints)
      : guestPrice.nightlyKobo * periodNights;
    const guestCharges = isFullPeriod
      ? ownerCharges + marginOnKobo(ownerCharges, ownerTerms.marginBasisPoints)
      : guestPrice.mandatoryFeesKobo;
    const baseAmountKobo = guestAccommodation + guestCharges;
    accommodationKobo += guestAccommodation;
    mandatoryFeesKobo += guestCharges;
    const periodOwnerPayableKobo = ownerAccommodation + ownerCharges;
    ownerPayableKobo += periodOwnerPayableKobo;
    const dueDate = new Date(checkInDate.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    periods.push({ index: input.firstIndex + step, checkIn: checkInDate.toISOString().slice(0, 10), checkOut: checkOutDate.toISOString().slice(0, 10), nights: periodNights, baseAmountKobo, ownerPayableKobo: periodOwnerPayableKobo, dueDate });
  }
  return { periods, accommodationKobo, mandatoryFeesKobo, ownerPayableKobo };
}

/**
 * The Billing Period allocation of the taxes and optional-service extras, with each period's amount, margin and nightly
 * contracted values fixed (ADR 0092, ADR 0089). The last period takes the rounding remainder.
 */
export function periodsWithExtras(rawPeriods: readonly ExtendedPeriodBase[], extrasKobo: number, taxableBaseKobo: number): readonly BillingPeriodQuote[] {
  let allocatedExtras = 0;
  return Object.freeze(rawPeriods.map((period, index) => {
    const extras = index === rawPeriods.length - 1
      ? extrasKobo - allocatedExtras
      : Math.floor((extrasKobo) * period.baseAmountKobo / taxableBaseKobo);
    allocatedExtras += extras;
    const amountKobo = period.baseAmountKobo + extras;
    const nightlyBase = Math.floor(amountKobo / period.nights);
    const nightlyContractedValuesKobo = Array.from({ length: period.nights }, (_unused, day) => nightlyBase + (day === period.nights - 1 ? amountKobo - nightlyBase * period.nights : 0));
    // Demo-launch issue 11 (ADR 0089, ADR 0092): each period's owner payable and margin are captured with the quote.
    // The margin is the period's accommodation and charges less its owner payable; taxes and optional services are
    // not owner money, so they stay out of the margin, as they do in the stay-level ownerSettlement.
    return Object.freeze({ index: period.index, checkIn: period.checkIn, checkOut: period.checkOut, nights: period.nights, amountKobo, ownerPayableKobo: period.ownerPayableKobo, marginKobo: period.baseAmountKobo - period.ownerPayableKobo, dueDate: period.dueDate, nightlyContractedValuesKobo: Object.freeze(nightlyContractedValuesKobo) });
  }));
}

/**
 * ADR 0092 Extensions: the Billing Periods an extension appends, priced with the same rules as the contract quote. The
 * segment starts at the current checkout, so the contract's existing periods keep their dates, amounts and payables.
 * Its taxes are allocated as in the contract quote; an extension sells no optional services.
 */
export function extendedStayExtensionPeriods(input: { readonly unit: { readonly id?: unknown; readonly extendedStay?: unknown; readonly price: { readonly taxConfig?: unknown; readonly nightlyKobo?: number; readonly mandatoryFeesKobo?: number } }; readonly checkIn: string; readonly checkOut: string; readonly firstIndex: number; readonly policy: ExtendedStayPolicy }): { readonly periods: readonly BillingPeriodQuote[]; readonly amountKobo: number; readonly ownerPayableKobo: number; readonly marginKobo: number; readonly monthlyAgreedAmountsVersion: string } {
  const nights = Math.round((Date.parse(`${input.checkOut}T00:00:00Z`) - Date.parse(`${input.checkIn}T00:00:00Z`)) / 86_400_000);
  if (!Number.isInteger(nights) || nights < 1) throw new RangeError("An extension adds at least one night");
  const terms = extendedTermsOf(input.unit);
  const plan = planExtendedBillingPeriods({ ownerTerms: unitOwnerTerms(input.unit as never), monthly: terms.monthlyAgreedAmounts, startDate: input.checkIn, nights, policy: input.policy, firstIndex: input.firstIndex });
  const taxableBaseKobo = plan.accommodationKobo + plan.mandatoryFeesKobo;
  const taxesKobo = calculateTaxKobo((input.unit.price as { taxConfig?: unknown }).taxConfig, taxableBaseKobo);
  const periods = periodsWithExtras(plan.periods, taxesKobo, taxableBaseKobo);
  return Object.freeze({
    periods,
    amountKobo: periods.reduce((sum, period) => sum + period.amountKobo, 0),
    ownerPayableKobo: periods.reduce((sum, period) => sum + period.ownerPayableKobo, 0),
    marginKobo: periods.reduce((sum, period) => sum + period.marginKobo, 0),
    monthlyAgreedAmountsVersion: terms.monthlyAgreedAmounts.version,
  });
}

export interface CreateStayQuoteOptions {
  unit: any;
  checkIn: any;
  checkOut: any;
  partySize?: number;
  selectedOptionalServices?: any[];
  commissionRate?: number;
  clock?: () => Date;
  idFactory?: () => string;
  /** The Extended Stay policy (ADR 0092 as amended 1 Nov 2026). Supplied by every guest composition. */
  extendedStayPolicy?: ExtendedStayPolicy;
  /** ADR 0105: true only in the staging demo, which labels the Extended cancellation terms as demo terms. */
  demoTerms?: boolean;
}

export interface BillingPeriodQuote {
  readonly index: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly amountKobo: number;
  /** Demo-launch issue 11: the owner payable captured for this period at confirmation, never recalculated (ADR 0089). */
  readonly ownerPayableKobo: number;
  /** Demo-launch issue 11: the platform margin captured for this period; the periods' margins sum to the stay's margin. */
  readonly marginKobo: number;
  readonly dueDate: string;
  readonly nightlyContractedValuesKobo: readonly number[];
}

/** The quote fields that decide what the first Period Payment collects. */
export interface StayAmountSource {
  readonly stayType?: string;
  readonly allInStayTotalKobo?: number;
  readonly billingPeriods?: readonly { readonly amountKobo: number }[];
}

/**
 * ADR 0092: the stay component of the first Period Payment. An Extended Stay collects its first Billing Period only;
 * a Short Stay collects its whole All-In Stay Total. Returns undefined when the quote carries no such amount.
 */
export function stayAmountDueNowKobo(quote: StayAmountSource | null | undefined): number | undefined {
  if (!quote) return undefined;
  if (quote.stayType === "extended") return quote.billingPeriods?.[0]?.amountKobo;
  return typeof quote.allInStayTotalKobo === "number" ? quote.allInStayTotalKobo : undefined;
}

export function createStayQuote({
  unit,
  checkIn,
  checkOut,
  partySize = 1,
  selectedOptionalServices = [],
  commissionRate = 0.12,
  clock = () => new Date(),
  idFactory = () => crypto.randomUUID(),
  extendedStayPolicy,
  demoTerms = false
}: CreateStayQuoteOptions) {
  if (!unit || !unit.id || !unit.price) {
    throw new TypeError("A valid unit with price details is required");
  }

  const now = clock();
  const dateRange = new StayDateRange(checkIn, checkOut, now, extendedStayPolicy);
  const nights = dateRange.nights;
  const stayType = assertStayLength(nights, extendedStayPolicy);

  if (partySize < 1 || (unit.capacity && partySize > unit.capacity)) {
    throw new RangeError(`Party size (${partySize}) exceeds unit capacity (${unit.capacity})`);
  }

  // ADR 0089 (P4 AC3): a unit without owner agreed amounts and a margin rate cannot be quoted.
  const ownerTerms = unitOwnerTerms(unit);
  let ownerSettlement: OwnerSettlementSnapshot;
  let accommodationKobo: number;
  let mandatoryFeesKobo: number;
  let billingPeriods: readonly BillingPeriodQuote[] = Object.freeze([]);
  let baseBillingPeriods: readonly { readonly index: number; readonly checkIn: string; readonly checkOut: string; readonly nights: number; readonly baseAmountKobo: number; readonly ownerPayableKobo: number; readonly dueDate: string }[] = Object.freeze([]);
  let utilitiesAndServicing: unknown;
  let monthlyAgreedAmountsVersion: string | undefined;
  let periodOwnerPayableKobo = 0;
  if (stayType === "extended") {
    const terms = extendedTermsOf(unit);
    const monthly = terms.monthlyAgreedAmounts;
    monthlyAgreedAmountsVersion = monthly.version;
    const plan = planExtendedBillingPeriods({ ownerTerms, monthly, startDate: dateRange.checkIn, nights, policy: extendedStayPolicy!, firstIndex: 1 });
    accommodationKobo = plan.accommodationKobo;
    mandatoryFeesKobo = plan.mandatoryFeesKobo;
    periodOwnerPayableKobo = plan.ownerPayableKobo;
    baseBillingPeriods = plan.periods;
    ownerSettlement = Object.freeze({
      ownerPayableKobo: periodOwnerPayableKobo,
      marginKobo: accommodationKobo + mandatoryFeesKobo - periodOwnerPayableKobo,
      marginBasisPoints: ownerTerms.marginBasisPoints,
      agreed: ownerTerms.agreed,
      nights,
      currency: "NGN" as const,
      pricingBasis: "monthly" as const,
      monthlyAgreedAmounts: Object.freeze({ ...monthly }),
    });
    utilitiesAndServicing = Object.freeze({ ...terms.utilitiesAndServicing });
  } else {
    ownerSettlement = ownerSettlementFor(ownerTerms, nights);
    accommodationKobo = unit.price.nightlyKobo * nights;
    mandatoryFeesKobo = unit.price.mandatoryFeesKobo ?? 0;
  }

  const resolvedOptionalServices = validateAndResolveOptionalServices(selectedOptionalServices, nights, partySize);
  const optionalServicesTotalKobo = resolvedOptionalServices.reduce((acc, item) => acc + item.totalKobo, 0);

  const taxableBaseKobo = accommodationKobo + mandatoryFeesKobo;
  const taxesKobo = calculateTaxKobo(unit.price.taxConfig, taxableBaseKobo);
  const allInStayTotalKobo = accommodationKobo + mandatoryFeesKobo + taxesKobo + optionalServicesTotalKobo;
  if (stayType === "extended") {
    billingPeriods = periodsWithExtras(baseBillingPeriods, taxesKobo + optionalServicesTotalKobo, accommodationKobo + mandatoryFeesKobo);
  }
  // ADR 0092: Extended Stays have a zero Refundable Security Deposit, including demo periods.
  const configuredDepositKobo = stayType === "extended" ? 0 : (unit.price.refundableSecurityDepositKobo ?? 0);
  const bedrooms = unit.bedrooms ?? unit.bedroomCount;
  // Older catalogue records predate the bedroom classification. Keep their historical
  // quote compatibility while all new/authoritative records use the fail-closed policy API.
  const securityDeposit: SecurityDepositPolicySnapshot = typeof bedrooms === "number" && Object.prototype.hasOwnProperty.call(unit.price, "refundableSecurityDepositKobo")
    ? calculateSecurityDepositPolicySnapshot({ accommodationSubtotalKobo: accommodationKobo, bedrooms, configuredDepositKobo })
    : Object.freeze({
      policyVersion: SECURITY_DEPOSIT_POLICY_VERSION, currency: "NGN" as const, accommodationSubtotalKobo: accommodationKobo,
      bedroomBand: "studio_or_one_bedroom" as const, percentageCapKobo: Math.floor(accommodationKobo / 4), unitSizeCapKobo: 10_000_000,
      unitConfiguredDepositKobo: configuredDepositKobo ?? 0,
      amountKobo: calculateRefundableSecurityDeposit({ accommodationKobo, requestedDepositKobo: configuredDepositKobo }), collectionRequired: calculateRefundableSecurityDeposit({ accommodationKobo, requestedDepositKobo: configuredDepositKobo }) > 0
    });
  const refundableSecurityDepositKobo = securityDeposit.amountKobo;
  // ADR 0092: an Extended Stay's first Period Payment collects its first Billing Period only; the whole stay is contracted.
  const amountDueNowStayKobo = stayType === "extended" ? billingPeriods[0]!.amountKobo : allInStayTotalKobo;
  const totalAmountDueNowKobo = amountDueNowStayKobo + securityDeposit.amountKobo;

  const configuredCancellationPolicy = unit.cancellationPolicy;
  // Demo-launch issue 13 (ADR 0092): every Extended Stay snapshots the Extended catalogue entry, whatever the unit's
  // Short Stay policy. Short Stays keep the unit's configured Flexible, Standard or Firm policy unchanged.
  const isExtendedQuote = stayType === "extended";
  const policyType = isExtendedQuote ? "extended" : configuredCancellationPolicy?.type ?? "standard";
  if (policyType !== "flexible" && policyType !== "standard" && policyType !== "firm" && policyType !== "extended") {
    throw new Error("Unit cancellation policy must be Flexible, Standard, or Firm");
  }
  const policyVersion = isExtendedQuote ? EXTENDED_CANCELLATION_POLICY_VERSION : configuredCancellationPolicy?.version ?? "cancellation-v1";
  if (typeof policyVersion !== "string" || policyVersion.trim().length === 0) {
    throw new Error("Unit cancellation policy version is required");
  }
  const cancellationPolicy = Object.freeze({
    type: policyType,
    version: policyVersion,
    policySummary: isExtendedQuote ? extendedCancellationTerms(demoTerms) : configuredCancellationPolicy?.summary ?? "Standard launch cancellation policy"
  });

  const revenueClassification = classifyRevenue({
    accommodationKobo,
    mandatoryFeesKobo,
    taxesKobo,
    optionalServices: [...resolvedOptionalServices],
    refundableSecurityDepositKobo,
    commissionRate,
    operatorTier: unit.operator?.tier ?? "standard"
  });

  const createdAtIso = now.toISOString();
  const expiresAtMs = now.getTime() + 30 * 60 * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const quoteId = generatePlatformId("quote", idFactory);

  return Object.freeze({
    quoteId,
    quoteVersion: "v1",
    unitId: unit.id,
    propertyId: unit.propertyId,
    checkIn: dateRange.checkIn,
    checkOut: dateRange.checkOut,
    nights,
    stayType,
    ...(stayType === "extended" ? { billingPeriods, utilitiesAndServicing, monthlyAgreedAmountsVersion } : {}),
    partySize,
    createdAt: createdAtIso,
    expiresAt: expiresAtIso,
    pricingVersion: unit.price.version ?? "price-v1",
    currency: "NGN",
    lineItems: Object.freeze({
      nightlyKobo: unit.price.nightlyKobo,
      nights,
      accommodationKobo,
      mandatoryFeesKobo,
      taxesKobo,
      optionalServices: resolvedOptionalServices,
      optionalServicesTotalKobo
    }),
    allInStayTotalKobo,
    refundableSecurityDepositKobo,
    securityDeposit,
    totalAmountDueNowKobo,
    cancellationPolicy,
    revenueClassification,
    // ADR 0089: back-office only; guest projections show the one All-In Stay Total.
    ownerSettlement,
    policyVersions: Object.freeze({
      eligibility: "launch-2026-07",
      pricing: "all-in/v1",
      cancellation: cancellationPolicy.version,
      commission: "adr-0062-launch-v1",
      securityDeposit: SECURITY_DEPOSIT_POLICY_VERSION
    }),
    disclosures: Object.freeze([
      "All-In Stay Total includes nightly accommodation, mandatory property charges, taxes, and selected catalogue services.",
      "Refundable Security Deposit is quoted separately and held as guest liability.",
      "Optional services come strictly from the controlled catalogue with no off-platform payment."
    ])
  });
}
