import test from "node:test";
import assert from "node:assert/strict";
import {
  OwnerTermsError,
  StayDateRange,
  createStayQuote,
  getUnitOnboardingStatus,
  seedIssue01Units,
  toDiscoveryProjection,
  unitPriceFromOwnerTerms,
  UnitRepository,
  type ConditionalBookingOffer,
  type Unit,
} from "../domains/shortlet/src/index.js";
import { importInventoryCsv, operatorResolverFromUnitRepository } from "../domains/shortlet/src/inventory-import.js";
import { conditionalOfferArtifactFromOffer } from "../apps/web/src/conditional-offer-artifact.js";
import { bookingRequestArtifactFromRequest } from "../apps/web/src/booking-request-artifact.js";
import { decideRequest, startSignedInOperator } from "./helpers/operator-session.js";
import { guestCardPayments } from "./helpers/guest-card-payment.js";
import { repricedByOwner } from "./helpers/owner-terms.js";

// P4 — margin pricing and owner payable (.scratch/guest-payments/issues/04-margin-pricing.md, ADR 0089).

const NOW = new Date("2026-09-01T09:00:00.000Z");
/** Owner-side values that must never reach a Guest projection. */
const OWNER_ONLY = /ownerSettlement|ownerTerms|ownerPayable|marginKobo|marginBasisPoints/;

/** ADR 0089's example: the owner agrees ₦100,000 for the stay and the unit's margin is 15%. */
function adrExampleUnit(): Unit {
  const seeded = new UnitRepository();
  seedIssue01Units(seeded);
  const base = seeded.findById("unit-lagos-001") as Unit;
  return {
    ...base,
    price: unitPriceFromOwnerTerms({ ownerNightlyKobo: 10_000_000, ownerMandatoryChargesKobo: 0, marginBasisPoints: 1500, refundableSecurityDepositKobo: 0, version: "price-adr-0089" }),
  };
}

test("AC1 — For a unit with agreed amounts and a margin rate, the quote's All-In Stay Total equals the agreed amounts plus the margin, and the Guest sees only that one total", async () => {
  const unit = adrExampleUnit();
  const quote = createStayQuote({ unit, checkIn: "2026-09-10", checkOut: "2026-09-11", clock: () => NOW });

  assert.equal(quote.ownerSettlement.ownerPayableKobo, 10_000_000, "the owner receives ₦100,000");
  assert.equal(quote.ownerSettlement.marginKobo, 1_500_000, "the platform keeps ₦15,000");
  assert.equal(quote.allInStayTotalKobo, 11_500_000, "the Guest's All-In Stay Total is ₦115,000");
  assert.equal(quote.allInStayTotalKobo, quote.ownerSettlement.ownerPayableKobo + quote.ownerSettlement.marginKobo);
  assert.equal(quote.totalAmountDueNowKobo, 11_500_000, "zero deposit: one payment (ADR 0089)");

  // Several nights and mandatory charges: the margin applies to every agreed amount.
  const charged = { ...unit, price: unitPriceFromOwnerTerms({ ownerNightlyKobo: 10_000_000, ownerMandatoryChargesKobo: 1_000_000, marginBasisPoints: 1500, refundableSecurityDepositKobo: 0, version: "price-charges" }) };
  const longer = createStayQuote({ unit: charged, checkIn: "2026-09-10", checkOut: "2026-09-13", clock: () => NOW });
  assert.equal(longer.ownerSettlement.ownerPayableKobo, 31_000_000);
  assert.equal(longer.ownerSettlement.marginKobo, 4_650_000);
  assert.equal(longer.allInStayTotalKobo, 35_650_000);

  // Discovery shows the same one total, and nothing owner-side.
  const discovery = toDiscoveryProjection({ ...unit, published: true }, new StayDateRange("2026-09-10", "2026-09-11", NOW));
  assert.equal(discovery.price.allInStayTotalKobo, 11_500_000);
  assert.equal(discovery.price.nightlyKobo, 11_500_000, "the nightly rate a Guest sees already includes the margin");
  assert.doesNotMatch(JSON.stringify(discovery), OWNER_ONLY);

  // The Guest's request and offer projections carry the total only.
  const f = await startSignedInOperator();
  try {
    const env = f.server.environment;
    const requestId = env.createDemoIncomingBookingRequest({ guestId: "margin-guest-1", guestName: "Margin Guest", checkIn: "2026-09-10", checkOut: "2026-09-12" }).facts.requestId;
    assert.equal((await decideRequest(f.session, requestId, "confirm")).status, 303);
    const request = env.bookingRequestApp.manager.getRequest(requestId) as Parameters<typeof bookingRequestArtifactFromRequest>[0] & { tenantId: string };
    const offer = JSON.parse(env.interactionStore.findConditionalOfferByRequestId(requestId)!.offerJson) as ConditionalBookingOffer;
    assert.ok((offer.quote as { ownerSettlement?: unknown }).ownerSettlement, "the back office has the settlement");
    const guest = { id: "margin-guest-1", role: "guest" as const, tenantId: request.tenantId };
    const requestArtifact = bookingRequestArtifactFromRequest(request, guest);
    const offerArtifact = conditionalOfferArtifactFromOffer(offer, guest, env.clock());
    assert.equal(offerArtifact.facts.allInStayTotalKobo, offer.quote.allInStayTotalKobo);
    assert.doesNotMatch(JSON.stringify(requestArtifact), OWNER_ONLY);
    assert.doesNotMatch(JSON.stringify(offerArtifact), OWNER_ONLY);
  } finally {
    await f.close();
  }
});

test("AC2 — A confirmed booking's snapshot records the owner payable and the margin, and neither changes if the unit's rate or margin changes later", async () => {
  const f = await startSignedInOperator();
  const guest = guestCardPayments(f.server.environment);
  try {
    const env = f.server.environment;
    const requestId = env.createDemoIncomingBookingRequest({ guestId: "margin-guest-2", guestName: "Snapshot Guest", checkIn: "2026-09-10", checkOut: "2026-09-12" }).facts.requestId;
    assert.equal((await decideRequest(f.session, requestId, "confirm")).status, 303);
    const storedOffer = () => JSON.parse(env.interactionStore.findConditionalOfferByRequestId(requestId)!.offerJson) as ConditionalBookingOffer & { quote: { ownerSettlement: { ownerPayableKobo: number; marginKobo: number; marginBasisPoints: number } } };

    // The seeded unit: ₦100,000/night + ₦8,333.34 agreed at 20% (2 nights).
    const atConfirmation = storedOffer().quote.ownerSettlement;
    assert.equal(atConfirmation.ownerPayableKobo, 2 * 10_000_000 + 833_334);
    assert.equal(atConfirmation.marginKobo, 2 * 2_000_000 + 166_666);
    assert.equal(atConfirmation.marginBasisPoints, 2000);

    guest.pay(requestId);
    const offerId = storedOffer().offerId;
    const contract = () => JSON.parse(env.interactionStore.findBookingSnapshotByOfferId(offerId)!.contractJson) as { quote: { ownerSettlement: unknown; allInStayTotalKobo: number } };
    assert.deepEqual(contract().quote.ownerSettlement, atConfirmation, "the Booking Contract carries the confirmation snapshot");

    // The owner agrees a new rate and the margin changes; the booking keeps what was captured (ADR 0077).
    const unit = env.unitRepository.findById(env.config.unitId)!;
    env.unitRepository.save({ ...unit, price: repricedByOwner(unit.price, { ownerNightlyKobo: 15_000_000, ownerMandatoryChargesKobo: 2_000_000, marginBasisPoints: 3000, version: "price-ikoyi-v2" }) });
    assert.deepEqual(storedOffer().quote.ownerSettlement, atConfirmation);
    assert.deepEqual(contract().quote.ownerSettlement, atConfirmation);
    assert.equal(contract().quote.allInStayTotalKobo, atConfirmation.ownerPayableKobo + atConfirmation.marginKobo);

    // A new quote uses the new terms.
    const fresh = createStayQuote({ unit: env.unitRepository.findById(env.config.unitId)!, checkIn: "2026-09-20", checkOut: "2026-09-22", clock: () => env.clock() });
    assert.equal(fresh.ownerSettlement.ownerPayableKobo, 2 * 15_000_000 + 2_000_000);
  } finally {
    guest.close();
    await f.close();
  }
});

test("AC3 — A unit missing its agreed amounts or margin rate cannot be quoted and fails closed at inventory import", () => {
  const unit = adrExampleUnit();
  const quote = (candidate: Unit) => () => createStayQuote({ unit: candidate, checkIn: "2026-09-10", checkOut: "2026-09-11", clock: () => NOW });
  const { ownerTerms, ...legacyPrice } = unit.price;
  assert.ok(ownerTerms);

  // Quote: no terms, no margin rate, no agreed nightly amount, or a Guest price that no longer derives from them.
  assert.throws(quote({ ...unit, price: legacyPrice }), OwnerTermsError);
  assert.throws(quote({ ...unit, price: { ...unit.price, ownerTerms: { agreed: ownerTerms.agreed } as never } }), /no margin rate/);
  assert.throws(quote({ ...unit, price: { ...unit.price, ownerTerms: { ...ownerTerms, agreed: { mandatoryChargesKobo: 0 } } as never } }), /no owner agreed amounts/);
  assert.throws(quote({ ...unit, price: { ...unit.price, nightlyKobo: unit.price.nightlyKobo - 1 } }), /does not derive/);
  assert.equal(getUnitOnboardingStatus({ ...unit, price: legacyPrice }, NOW).blockers.includes("Owner agreed amounts or margin rate missing"), true, "it cannot be published either");
  assert.equal(getUnitOnboardingStatus(unit, NOW).blockers.includes("Owner agreed amounts or margin rate missing"), false);

  // Import: a row without the agreed amounts or the margin rate is rejected and nothing is written.
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const headers = ["external_listing_id", "unit_id", "property_id", "operator_id", "title", "description", "city", "neighbourhood", "capacity", "bedrooms", "bathrooms", "owner_nightly_ngn", "owner_mandatory_charges_ngn", "margin_percent", "refundable_security_deposit_ngn", "currency", "amenities", "blocked_dates"];
  const row = (values: Record<string, string>) => headers.map((header) => `"${values[header] ?? ""}"`).join(",");
  const good: Record<string, string> = { external_listing_id: "p4-001", unit_id: "unit-p4-001", property_id: "property-p4-001", operator_id: "operator-001", title: "P4 apartment", description: "A bright entire-place apartment with a quiet living room and reliable power.", city: "Lagos", neighbourhood: "Ikeja", capacity: "2", bedrooms: "1", bathrooms: "1", owner_nightly_ngn: "100000", owner_mandatory_charges_ngn: "0", margin_percent: "15", refundable_security_deposit_ngn: "0", currency: "NGN", amenities: "wifi", blocked_dates: "" };
  const importRows = (rows: Record<string, string>[], header = headers) => importInventoryCsv([header.join(","), ...rows.map(row)].join("\n"), { repository, operatorResolver: operatorResolverFromUnitRepository(repository), clock: () => NOW });

  const failures = importRows([
    { ...good, unit_id: "unit-p4-no-margin", external_listing_id: "p4-no-margin", margin_percent: "" },
    { ...good, unit_id: "unit-p4-bad-margin", external_listing_id: "p4-bad-margin", margin_percent: "15%" },
    { ...good, unit_id: "unit-p4-no-nightly", external_listing_id: "p4-no-nightly", owner_nightly_ngn: "" },
    { ...good, unit_id: "unit-p4-zero-nightly", external_listing_id: "p4-zero-nightly", owner_nightly_ngn: "0" },
    { ...good, unit_id: "unit-p4-no-charges", external_listing_id: "p4-no-charges", owner_mandatory_charges_ngn: "" },
  ]);
  assert.equal(failures.invalid, 5);
  assert.deepEqual(failures.errors.map((error) => error.message), [
    "margin_percent is required",
    "margin_percent must be a non-negative percentage with at most 2 decimal places",
    "owner_nightly_ngn is required",
    "owner_nightly_ngn must be more than zero",
    "owner_mandatory_charges_ngn is required",
  ]);
  assert.equal(repository.findAll().some((unit) => unit.id.startsWith("unit-p4-")), false);

  // A file without the columns, or with the retired guest-price columns, is refused outright.
  assert.throws(() => importRows([good], headers.filter((header) => header !== "margin_percent")), /missing required columns: margin_percent/);
  assert.throws(() => importRows([good], [...headers, "nightly_price_ngn"]), /nightly_price_ngn.*replaced by owner_nightly_ngn/);

  // The complete row imports with the derived Guest price and its owner terms.
  assert.equal(importRows([good]).inserted, 1);
  const imported = repository.findById("unit-p4-001")!;
  assert.equal(imported.price.nightlyKobo, 11_500_000);
  assert.deepEqual(imported.price.ownerTerms, { agreed: { nightlyKobo: 10_000_000, mandatoryChargesKobo: 0 }, marginBasisPoints: 1500 });
});
