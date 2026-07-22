import { StayDateRange } from "./browse.js";

/**
 * Controlled catalogue for optional services under launch policy.
 * Optional services come ONLY from this catalogue and CANNOT request off-platform payment.
 */
export const CONTROLLED_OPTIONAL_SERVICES_CATALOGUE = Object.freeze([
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

export function getCatalogueService(serviceId) {
  return CONTROLLED_OPTIONAL_SERVICES_CATALOGUE.find((svc) => svc.id === serviceId) ?? null;
}

/**
 * Validates selected optional services against the controlled catalogue.
 * Rejects uncatalogued services or any service that attempts off-platform payment.
 */
export function validateAndResolveOptionalServices(selectedServices = [], nights = 1, partySize = 1) {
  const resolved = [];
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

/**
 * Computes tax in kobo using counsel-approved tax configuration.
 * Money arithmetic uses integer precision (kobo) without floating-point rounding errors.
 */
export function calculateTaxKobo(taxConfig, taxableAmountKobo) {
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

/**
 * Explicitly classifies Revenue into Commissionable Operator Revenue and Excluded amounts.
 * - Commissionable: accommodation, mandatory property non-tax fees, operator-supplied optional services.
 * - Excluded: refundable security deposit, taxes, damage awards, pass-through amounts.
 */
export function classifyRevenue({
  accommodationKobo,
  mandatoryFeesKobo = 0,
  taxesKobo = 0,
  optionalServices = [],
  refundableSecurityDepositKobo = 0,
  commissionRate = 0.12,
  operatorTier = "standard"
}) {
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
  
  // Rate: 12% standard, 8% founding (first 6 months), 10% preferred
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

/**
 * Calculates and returns a versioned Stay Quote.
 */
export function createStayQuote({
  unit,
  checkIn,
  checkOut,
  partySize = 1,
  selectedOptionalServices = [],
  commissionRate = 0.12,
  clock = () => new Date(),
  idFactory = () => crypto.randomUUID()
}) {
  if (!unit || !unit.id || !unit.price) {
    throw new TypeError("A valid unit with price details is required");
  }

  const now = clock();
  const dateRange = new StayDateRange(checkIn, checkOut, now);
  const nights = dateRange.nights;

  if (partySize < 1 || (unit.capacity && partySize > unit.capacity)) {
    throw new RangeError(`Party size (${partySize}) exceeds unit capacity (${unit.capacity})`);
  }

  const accommodationKobo = unit.price.nightlyKobo * nights;
  const mandatoryFeesKobo = unit.price.mandatoryFeesKobo ?? 0;

  const resolvedOptionalServices = validateAndResolveOptionalServices(selectedOptionalServices, nights, partySize);
  const optionalServicesTotalKobo = resolvedOptionalServices.reduce((acc, item) => acc + item.totalKobo, 0);

  const taxableBaseKobo = accommodationKobo + mandatoryFeesKobo;
  const taxesKobo = calculateTaxKobo(unit.price.taxConfig, taxableBaseKobo);

  const allInStayTotalKobo = accommodationKobo + mandatoryFeesKobo + taxesKobo + optionalServicesTotalKobo;
  const refundableSecurityDepositKobo = unit.price.refundableSecurityDepositKobo ?? 0;
  const totalAmountDueNowKobo = allInStayTotalKobo + refundableSecurityDepositKobo;

  const cancellationPolicy = Object.freeze({
    type: unit.cancellationPolicy?.type ?? "standard",
    version: unit.cancellationPolicy?.version ?? "cancellation-v1",
    policySummary: unit.cancellationPolicy?.summary ?? "Standard launch cancellation policy"
  });

  const revenueClassification = classifyRevenue({
    accommodationKobo,
    mandatoryFeesKobo,
    taxesKobo,
    optionalServices: resolvedOptionalServices,
    refundableSecurityDepositKobo,
    commissionRate,
    operatorTier: unit.operator?.tier ?? "standard"
  });

  const createdAtIso = now.toISOString();
  const expiresAtMs = now.getTime() + 30 * 60 * 1000; // Quote valid for 30 minutes
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  const quoteId = `quote-${idFactory()}`;

  return Object.freeze({
    quoteId,
    quoteVersion: "v1",
    unitId: unit.id,
    propertyId: unit.propertyId,
    checkIn: dateRange.checkIn,
    checkOut: dateRange.checkOut,
    nights,
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
    totalAmountDueNowKobo,
    cancellationPolicy,
    revenueClassification,
    policyVersions: Object.freeze({
      eligibility: "launch-2026-07",
      pricing: "all-in/v1",
      cancellation: cancellationPolicy.version
    }),
    disclosures: Object.freeze([
      "All-In Stay Total includes nightly accommodation, mandatory property charges, taxes, and selected catalogue services.",
      "Refundable Security Deposit is quoted separately and held as guest liability.",
      "Optional services come strictly from the controlled catalogue with no off-platform payment."
    ])
  });
}
