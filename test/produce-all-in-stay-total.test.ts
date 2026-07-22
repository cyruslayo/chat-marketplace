import test from "node:test";
import assert from "node:assert/strict";
import { UnitRepository, seedIssue01Units, UnitDiscoveryQuery } from "../domains/shortlet/src/index.js";
import {
  createStayQuote,
  CONTROLLED_OPTIONAL_SERVICES_CATALOGUE,
  validateAndResolveOptionalServices,
  calculateTaxKobo,
  classifyRevenue
} from "../domains/shortlet/src/index.js";

function setupUnit() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findAll()[0];
  return { repository, unit };
}

test("discovery, comparison, and stay quote display the exact same mandatory All-In Stay Total", () => {
  const { repository, unit } = setupUnit();
  const checkIn = "2026-08-10";
  const checkOut = "2026-08-12"; // 2 nights

  // 1. Discovery view
  const query = new UnitDiscoveryQuery({
    repository,
    audit: { record: () => {} },
    telemetry: { track: () => {} },
    clock: () => new Date("2026-07-22T00:00:00Z")
  });
  const discoveryResult = query.search({ checkIn, checkOut, partySize: 2 });
  const discoveryUnit = discoveryResult.facts.results.find((u) => u.id === unit.id);
  assert.ok(discoveryUnit);

  // 2. Stay Quote view
  const quote = createStayQuote({
    unit,
    checkIn,
    checkOut,
    partySize: 2,
    clock: () => new Date("2026-07-22T00:00:00Z")
  });

  // Discovery total: 85,000 * 2 + 10,000 = 180,000 NGN = 18,000,000 Kobo
  assert.equal(discoveryUnit.price.allInStayTotalKobo, 18000000);
  assert.equal(quote.allInStayTotalKobo, 18000000);
  assert.equal(discoveryUnit.price.allInStayTotalKobo, quote.allInStayTotalKobo);
  assert.equal(quote.totalAmountDueNowKobo, quote.allInStayTotalKobo + quote.refundableSecurityDepositKobo);
});

test("Commissionable Operator Revenue and excluded amounts (deposit, tax, damage, pass-through) are classified explicitly", () => {
  const { unit } = setupUnit();
  unit.price.taxConfig = { ratePercentage: 7.5 }; // 7.5% tax

  const quote = createStayQuote({
    unit,
    checkIn: "2026-08-10",
    checkOut: "2026-08-12", // 2 nights
    partySize: 2,
    selectedOptionalServices: [
      { id: "svc-daily-housekeeping", quantity: 1 }, // operator optional svc: 1,000,000 * 2 = 2,000,000
      { id: "svc-private-chef", quantity: 1 } // partner optional svc: 5,000,000 * 2 = 10,000,000
    ],
    commissionRate: 0.12,
    clock: () => new Date("2026-07-22T00:00:00Z")
  });

  // Accommodation = 17,000,000. Mandatory = 1,000,000. Housekeeping = 2,000,000.
  // Commissionable = 17,000,000 + 1,000,000 + 2,000,000 = 20,000,000 Kobo.
  assert.equal(quote.revenueClassification.commissionableOperatorRevenueKobo, 20000000);

  // Commission = 12% of 20,000,000 = 2,400,000 Kobo.
  assert.equal(quote.revenueClassification.estimatedCommissionKobo, 2400000);
  assert.equal(quote.revenueClassification.estimatedOperatorNetKobo, 17600000);

  // Excluded amounts: deposit = quote.refundableSecurityDepositKobo, tax = 1,350,000 (7.5% of 18m), pass-through chef = 10,000,000
  assert.equal(quote.revenueClassification.excludedAmounts.refundableSecurityDepositKobo, quote.refundableSecurityDepositKobo);
  assert.equal(quote.revenueClassification.excludedAmounts.taxesKobo, 1350000);
  assert.equal(quote.revenueClassification.excludedAmounts.passThroughKobo, 10000000);
  assert.equal(quote.revenueClassification.excludedAmounts.damageAwardsKobo, 0);
});

test("Optional services come only from the controlled catalogue and reject off-platform payment", () => {
  assert.ok(CONTROLLED_OPTIONAL_SERVICES_CATALOGUE.length > 0);
  assert.equal(CONTROLLED_OPTIONAL_SERVICES_CATALOGUE.every((s) => s.offPlatformPaymentAllowed === false), true);

  // Uncatalogued service throws error
  assert.throws(
    () => validateAndResolveOptionalServices([{ id: "unapproved-cash-cleaning", priceKobo: 500 }]),
    /not in the controlled catalogue/
  );

  // Attempted off-platform payment throws error
  assert.throws(
    () => validateAndResolveOptionalServices([{ id: "svc-daily-housekeeping", offPlatformPaymentAllowed: true }]),
    /off-platform payment is prohibited/
  );
});

test("Money arithmetic, integer kobo precision, tax configuration, quote versioning, and policy capture operate deterministically", () => {
  const { unit } = setupUnit();

  // Test tax calculation: integer kobo arithmetic without floating point errors
  const taxConfig = { ratePercentage: 7.5 };
  const taxKobo = calculateTaxKobo(taxConfig, 1000005);
  assert.equal(taxKobo, 75000); // Math.floor(1000005 * 0.075) = 75000

  const quote = createStayQuote({
    unit,
    checkIn: "2026-08-10",
    checkOut: "2026-08-11", // 1 night
    partySize: 1,
    clock: () => new Date("2026-07-22T10:00:00Z")
  });

  assert.equal(quote.quoteVersion, "v1");
  assert.equal(quote.currency, "NGN");
  assert.equal(quote.cancellationPolicy.type, "standard");
  assert.equal(quote.policyVersions.eligibility, "launch-2026-07");
  assert.equal(quote.policyVersions.pricing, "all-in/v1");

  // Expiry is exactly 30 minutes after creation
  const createdMs = new Date(quote.createdAt).getTime();
  const expiresMs = new Date(quote.expiresAt).getTime();
  assert.equal(expiresMs - createdMs, 30 * 60 * 1000);
});
