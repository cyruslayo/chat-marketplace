import assert from "node:assert/strict";
import test from "node:test";
import { UnitDiscoveryQuery, UnitRepository } from "../domains/shortlet/src/index.js";
import type { Unit } from "../domains/shortlet/src/browse.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { PaymentOutcome } from "../packages/platform-core/src/payments/payments.js";
import { demoDatabase, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { optedInUnit, withDemoExtendedJourney } from "./helpers/demo-extended-journey.js";
import { loadPilotCoreConfiguration } from "../apps/pilot/src/pilot-config-core.js";
import { PRODUCTION_WITH_DEMO_SOURCE } from "./helpers/demo-mode-fixture.js";
import { createOpsHandler, type OpsRouteDependencies } from "../apps/cloudflare/src/ops-routes.js";
import { ACCESS_JWT_HEADER, OPS_SECRET_HEADER } from "../apps/cloudflare/src/ops-auth.js";
import { PILOT_INVENTORY_HEADERS, importInventoryCsv } from "../domains/shortlet/src/inventory-import.js";
import { SqliteUnitRepository } from "../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteOperatorRepository } from "../domains/shortlet/src/sqlite-operator-repository.js";
import { createProvisionedOperator } from "../domains/shortlet/src/operator.js";

const NOW = new Date("2026-09-03T10:00:00.000Z");
const DEMO_POLICY = Object.freeze({ minimumNights: 30, maximumNights: 30, billingPeriodNights: 30 });


test("AC1: authenticated demo inventory import creates opted-in monthly terms; missing, wrong, or malformed inputs write nothing", async () => {
  const repository = new UnitRepository();
  const operator = { id: "demo-operator-001", tenantId: "tenant-demo", name: "Synthetic Demo Operator", status: "approved", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), legalForm: "private-company-limited-by-shares", cacVerified: true, responsiblePersonsVerified: true, beneficialOwnersVerified: true, paymentProviderApproved: true, settlementAccountVerified: true, approvedAt: "2026-01-01", approvalExpiresAt: "2027-12-31" };
  const handler = createOpsHandler({
    database: { transaction: <T>(operation: () => T) => operation() },
    sharedSecret: "synthetic-ops-secret",
    verifier: { async verify(assertion: string) { return assertion === "synthetic-access-jwt"; } },
    tenantId: "tenant-demo",
    demoEnabled: true,
    operatorRepository: { findById(id: string) { return id === operator.id ? operator : null; }, findAll() { return [operator]; } },
    unitRepository: repository,
    clock: () => NOW,
  } as unknown as OpsRouteDependencies);
  const values: Record<string, string> = {
    external_listing_id: "demo-monthly-001", unit_id: "demo-unit-monthly-001", property_id: "demo-property-monthly-001", operator_id: operator.id,
    title: "Synthetic demo apartment", city: "Lagos", neighbourhood: "Ikeja", capacity: "2", bedrooms: "1",
    owner_nightly_ngn: "100000", owner_mandatory_charges_ngn: "0", margin_percent: "15", refundable_security_deposit_ngn: "0", currency: "NGN", amenities: "wifi",
    inspection_status: "passed", inspection_date: "2026-08-01", inspection_expiry: "2027-08-01",
    inspection_scope: "entire-place-possession|structure-and-sanitation|fire-and-emergency-readiness|electrical-and-utilities|locks-and-privacy|access-controls|cameras|listing-accuracy|current-media",
    inspection_material_change_pending: "false", management_authority_status: "verified", management_authority_date: "2026-08-01", management_authority_expiry: "2027-08-01",
    management_authority_permissions: "advertise|accept-bookings|contract-guests|provide-access|collect-revenue|manage-cancellations|issue-refunds|manage-incidents",
    licensing_status: "verified", licensing_date: "2026-08-01", licensing_expiry: "2027-08-01", insurance_status: "verified", insurance_date: "2026-08-01", insurance_expiry: "2027-08-01",
    insurance_public_liability_ngn: "10000000", insurance_annual_aggregate_ngn: "20000000", insurance_property_cover_verified: "true", cancellation_policy: "standard", description: "Synthetic demo apartment.", bathrooms: "1", photo_urls: "",
    extended_stay_opt_in: "true", monthly_accommodation_ngn: "150000", monthly_mandatory_charges_ngn: "5000", power_generator_fuel_included: "true", water_included: "true", internet_included: "true", cleaning_included: "true", cleaning_frequency: "weekly",
  };
  const headers = [...PILOT_INVENTORY_HEADERS];
  const csv = `${headers.join(",")}\n${headers.map((header) => values[header] ?? "").join(",")}`;
  const staged = new UnitRepository();
  const preview = importInventoryCsv(csv, {
    repository: staged,
    operatorResolver: { findById: (id) => id === operator.id ? operator : null },
    tenantId: "tenant-demo",
    clock: () => NOW,
  });
  assert.equal(preview.valid, 1, JSON.stringify(preview.errors));
  assert.equal(preview.publicationReady, 1, JSON.stringify(preview.errors));
  const request = (jwt?: string, secret?: string, body = csv) => handler.handle(new Request("https://pilot.test/_ops/demo/inventory/import", {
    method: "POST",
    headers: { ...(jwt === undefined ? {} : { [ACCESS_JWT_HEADER]: jwt }), ...(secret === undefined ? {} : { [OPS_SECRET_HEADER]: secret }), "content-type": "text/csv" },
    body,
  }));
  const missingCredentials = await request();
  assert.ok(missingCredentials);
  assert.equal(missingCredentials.status, 401);
  const wrongCredentials = await request("synthetic-access-jwt", "wrong-secret");
  assert.ok(wrongCredentials);
  assert.equal(wrongCredentials.status, 401);
  assert.equal(repository.findAll().length, 0);
  const malformed = csv.replace(/weekly$/, "monthly");
  const invalid = await request("synthetic-access-jwt", "synthetic-ops-secret", malformed);
  assert.equal(invalid?.status, 400);
  assert.equal(repository.findAll().length, 0);
  const imported = await request("synthetic-access-jwt", "synthetic-ops-secret");
  assert.equal(imported?.status, 200);
  const unit = repository.findById("demo-unit-monthly-001");
  assert.equal(unit?.extendedStay?.optedIn, true);
  assert.match(unit?.extendedStay?.monthlyAgreedAmounts?.version ?? "", /^monthly-import-demo-unit-monthly-001-/);
  assert.equal(unit?.extendedStay?.utilitiesAndServicing?.cleaningFrequency, "weekly");

  const importOptions = { operatorResolver: { findById: (id: string) => id === operator.id ? operator : null }, tenantId: "tenant-demo", clock: () => NOW };
  const optOutValues: Record<string, string> = { ...values, extended_stay_opt_in: "false", monthly_accommodation_ngn: "", monthly_mandatory_charges_ngn: "", power_generator_fuel_included: "", water_included: "", internet_included: "", cleaning_included: "", cleaning_frequency: "" };
  const optOutCsv = `${headers.join(",")}\n${headers.map((header) => optOutValues[header] ?? "").join(",")}`;
  const optOutRepository = new UnitRepository();
  const optOutResult = importInventoryCsv(optOutCsv, { ...importOptions, repository: optOutRepository });
  assert.equal(optOutResult.imported, 1, "an explicit opt-out remains a valid inventory import");
  assert.equal(optOutRepository.findById("demo-unit-monthly-001")?.extendedStay, undefined);

  const versionRepository = new UnitRepository();
  importInventoryCsv(csv, { ...importOptions, repository: versionRepository });
  const initialUnit = versionRepository.findById("demo-unit-monthly-001")!;
  const captured = createStayQuote({ unit: initialUnit, checkIn: "2026-09-10", checkOut: "2026-10-10", clock: () => NOW, extendedStayPolicy: DEMO_POLICY });
  const priorMonthlyVersion = initialUnit.extendedStay!.monthlyAgreedAmounts!.version;
  const revisedCsv = csv.replace(",150000,", ",160000,");
  importInventoryCsv(revisedCsv, { ...importOptions, repository: versionRepository });
  const revisedUnit = versionRepository.findById("demo-unit-monthly-001")!;
  assert.notEqual(revisedUnit.extendedStay!.monthlyAgreedAmounts!.version, priorMonthlyVersion);
  assert.equal(captured.allInStayTotalKobo, 17_825_000, "an existing quote keeps its captured price after an import changes the next price");
});

test("AC1: the demo import and publication roll back together in the real SQLite database", async () => {
  const files = demoDatabase();
  const database = openNodeSqliteDatabase(files.path);
  const units = new SqliteUnitRepository(database);
  const operators = new SqliteOperatorRepository(database, { clock: () => NOW });
  const operator = {
    ...createProvisionedOperator({ id: "demo-operator-rollback", tenantId: "tenant-demo-rollback", name: "Synthetic rollback operator", now: NOW }),
    status: "approved" as const,
    legalForm: "private-company-limited-by-shares" as const,
    cacVerified: true,
    responsiblePersonsVerified: true,
    beneficialOwnersVerified: true,
    paymentProviderApproved: true,
    settlementAccountVerified: true,
    approvedAt: "2026-08-01",
    approvalExpiresAt: "2027-08-01",
  };
  operators.create(operator);
  const handler = createOpsHandler({
    database,
    sharedSecret: "synthetic-ops-secret",
    verifier: { async verify(assertion: string) { return assertion === "synthetic-access-jwt"; } },
    tenantId: "tenant-demo-rollback",
    demoEnabled: true,
    operatorRepository: operators,
    unitRepository: units,
    clock: () => NOW,
    audit: { record(event: Record<string, unknown>) { if (event.type === "unit.publication.attempted") throw new Error("synthetic publication audit failure"); } },
  } as unknown as OpsRouteDependencies);
  const values: Record<string, string> = {
    external_listing_id: "demo-rollback-listing", unit_id: "demo-rollback-unit", property_id: "demo-rollback-property", operator_id: operator.id,
    title: "Synthetic rollback apartment", city: "Lagos", neighbourhood: "Ikoyi", capacity: "2", bedrooms: "1",
    owner_nightly_ngn: "100000", owner_mandatory_charges_ngn: "0", margin_percent: "15", refundable_security_deposit_ngn: "0", currency: "NGN", amenities: "wifi",
    inspection_status: "passed", inspection_date: "2026-08-01", inspection_expiry: "2027-08-01",
    inspection_scope: "entire-place-possession|structure-and-sanitation|fire-and-emergency-readiness|electrical-and-utilities|locks-and-privacy|access-controls|cameras|listing-accuracy|current-media",
    inspection_material_change_pending: "false", management_authority_status: "verified", management_authority_date: "2026-08-01", management_authority_expiry: "2027-08-01",
    management_authority_permissions: "advertise|accept-bookings|contract-guests|provide-access|collect-revenue|manage-cancellations|issue-refunds|manage-incidents",
    licensing_status: "verified", licensing_date: "2026-08-01", licensing_expiry: "2027-08-01", insurance_status: "verified", insurance_date: "2026-08-01", insurance_expiry: "2027-08-01",
    insurance_public_liability_ngn: "10000000", insurance_annual_aggregate_ngn: "20000000", insurance_property_cover_verified: "true", cancellation_policy: "standard", description: "Synthetic rollback listing.", bathrooms: "1", photo_urls: "",
    extended_stay_opt_in: "true", monthly_accommodation_ngn: "150000", monthly_mandatory_charges_ngn: "5000", power_generator_fuel_included: "true", water_included: "true", internet_included: "true", cleaning_included: "true", cleaning_frequency: "weekly",
  };
  const headers = [...PILOT_INVENTORY_HEADERS];
  const csv = `${headers.join(",")}\n${headers.map((header) => values[header] ?? "").join(",")}`;
  try {
    const response = await handler.handle(new Request("https://pilot.test/_ops/demo/inventory/import?tenantId=tenant-demo-rollback", {
      method: "POST",
      headers: { [ACCESS_JWT_HEADER]: "synthetic-access-jwt", [OPS_SECRET_HEADER]: "synthetic-ops-secret", "content-type": "text/csv" },
      body: csv,
    }));
    assert.equal(response?.status, 400);
    assert.equal(units.findById("demo-rollback-unit"), null);
    assert.equal(units.findAll().length, 0);
    assert.equal(operators.findById(operator.id)?.tenantId, "tenant-demo-rollback");
  } finally {
    database.close();
    removeDemoDatabase(files.dir);
  }
});

test("AC2: a 30-night quote uses Monthly Agreed Amounts plus margin and carries utilities and Billing Period values into the Request to Book", async () => {
  const unit = optedInUnit();
  const quote = createStayQuote({
    unit,
    checkIn: "2026-09-10",
    checkOut: "2026-10-10",
    clock: () => NOW,
    extendedStayPolicy: DEMO_POLICY,
  } as Parameters<typeof createStayQuote>[0] & { extendedStayPolicy: typeof DEMO_POLICY });

  assert.equal(quote.stayType, "extended");
  assert.equal(quote.nights, 30);
  const monthly = unit.extendedStay.monthlyAgreedAmounts;
  const marginRate = unit.price.ownerTerms!.marginBasisPoints;
  const expectedAccommodation = monthly.accommodationKobo + Math.floor(monthly.accommodationKobo * marginRate / 10_000);
  const expectedCharges = monthly.mandatoryChargesKobo + Math.floor(monthly.mandatoryChargesKobo * marginRate / 10_000);
  assert.equal(quote.billingPeriods!.length, 1);
  assert.equal(quote.billingPeriods![0]!.amountKobo, expectedAccommodation + expectedCharges);
  assert.equal(quote.allInStayTotalKobo, expectedAccommodation + expectedCharges);
  assert.equal(quote.ownerSettlement.agreed.nightlyKobo, unit.price.ownerTerms!.agreed.nightlyKobo);
  assert.equal(quote.ownerSettlement.monthlyAgreedAmounts?.accommodationKobo, monthly.accommodationKobo);
  assert.equal(quote.refundableSecurityDepositKobo, 0, "ADR 0092 keeps Extended Stay deposits at zero");
  const shortQuote = createStayQuote({ unit, checkIn: "2026-09-10", checkOut: "2026-09-13", clock: () => NOW });
  assert.equal(shortQuote.refundableSecurityDepositKobo, unit.price.refundableSecurityDepositKobo, "the same Unit keeps its existing Short Stay deposit");
  assert.deepEqual(quote.utilitiesAndServicing, unit.extendedStay.utilitiesAndServicing);
  assert.equal(quote.billingPeriods![0]!.nightlyContractedValuesKobo.reduce((sum: number, amount: number) => sum + amount, 0), quote.billingPeriods![0]!.amountKobo);
  const quotedWithExtras = createStayQuote({
    unit: { ...unit, price: { ...unit.price, taxConfig: { ratePercentage: 5 } } },
    checkIn: "2026-09-10", checkOut: "2026-10-10", clock: () => NOW,
    extendedStayPolicy: DEMO_POLICY, selectedOptionalServices: ["svc-airport-pickup-lagos"],
  } as Parameters<typeof createStayQuote>[0] & { extendedStayPolicy: typeof DEMO_POLICY });
  assert.equal(quotedWithExtras.billingPeriods![0]!.amountKobo, quotedWithExtras.allInStayTotalKobo);
  const repository = new UnitRepository();
  repository.save(unit);
  const discovery = new UnitDiscoveryQuery({ repository, audit: { record: () => {} }, telemetry: { track: () => {} }, clock: () => NOW, extendedStayPolicy: DEMO_POLICY });
  const monthlyResults = discovery.search({ checkIn: "2026-09-10", checkOut: "2026-10-10", partySize: 1 });
  assert.equal(monthlyResults.facts.results[0]!.price.allInStayTotalKobo, expectedAccommodation + expectedCharges);
  assert.equal(monthlyResults.facts.results[0]!.price.refundableSecurityDepositKobo, 0, "Extended Stay discovery uses the quoted zero deposit");
  assert.equal(monthlyResults.facts.results[0]!.price.amountDueNowKobo, expectedAccommodation + expectedCharges);
  assert.throws(() => createStayQuote({ unit: { ...unit, extendedStay: { optedIn: true } }, checkIn: "2026-09-10", checkOut: "2026-10-10", clock: () => NOW, extendedStayPolicy: DEMO_POLICY }), /not configured for Extended Stay/i);
  assert.throws(() => createStayQuote({ unit: { ...unit, extendedStay: { optedIn: true, monthlyAgreedAmounts: unit.extendedStay.monthlyAgreedAmounts } }, checkIn: "2026-09-10", checkOut: "2026-10-10", clock: () => NOW, extendedStayPolicy: DEMO_POLICY }), /not configured for Extended Stay/i);
  await withDemoJourney(() => {}, undefined, undefined, ({ guest, requestId }) => {
    const request = guest.bookingRequestApp.getRequest(requestId);
    assert.equal(request.quote.stayType, "extended");
    assert.equal(request.quote.allInStayTotalKobo, expectedAccommodation + expectedCharges);
    assert.equal(request.quote.billingPeriods[0].amountKobo, expectedAccommodation + expectedCharges);
    assert.deepEqual(request.quote.utilitiesAndServicing, unit.extendedStay.utilitiesAndServicing);
    const captured = structuredClone(request.quote);
    const stored = guest.unitRepository.findById(request.unitId)!;
    guest.unitRepository.save({ ...stored, extendedStay: { ...stored.extendedStay!, monthlyAgreedAmounts: { ...stored.extendedStay!.monthlyAgreedAmounts!, accommodationKobo: 11_000_000, version: "monthly-revised" } } });
    assert.deepEqual(guest.bookingRequestApp.getRequest(requestId).quote, captured);
  });
});

/** Issue 08 journey: the 30-night stay from 10 to 10 September 2026, on the shared demo journey helper. */
function withDemoJourney(
  run: Parameters<typeof withDemoExtendedJourney>[1],
  outcomeFactory?: (reference: string, amount: number, payerId: string) => PaymentOutcome,
  offsetClock?: { now: number },
  beforeOffer?: Parameters<typeof withDemoExtendedJourney>[0]["beforeOffer"],
  afterCheckout?: Parameters<typeof withDemoExtendedJourney>[0]["afterCheckout"],
  beforeAcceptance?: Parameters<typeof withDemoExtendedJourney>[0]["beforeAcceptance"],
  beforeCheckout?: Parameters<typeof withDemoExtendedJourney>[0]["beforeCheckout"],
): Promise<void> {
  return withDemoExtendedJourney({ checkIn: "2026-09-10", checkOut: "2026-10-10", outcomeFactory, offsetClock, beforeOffer, afterCheckout, beforeAcceptance, beforeCheckout }, run);
}

test("AC3: a valid verified test-mode first Period Payment confirms once and blocks all 30 nights", async () => {
  await withDemoJourney(async ({ guest, offerId, clock }) => {
    const offer = guest.conditionalOfferApp.getOffer(offerId);
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    const confirmed = await guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId });
    assert.equal(confirmed.outcome, "confirmed");
    if (confirmed.outcome !== "confirmed") return;
    assert.equal(confirmed.bookingContract.dates.nights, 30);
    const again = await guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId });
    assert.equal(again.outcome, "confirmed");
    for (let day = 0; day < 30; day += 1) {
      const date = new Date(Date.parse(`${offer.dates.checkIn}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
      assert.equal(guest.calendar.getAuthoritativeAvailability({ unitId: offer.unitId, checkIn: date, checkOut: new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), clock }).isAvailable, false);
    }
  });
});

test("AC3: inspection, authority, licensing, and insurance claims must cover checkout at offer acceptance, checkout, and verification", async () => {
  const invalidators: readonly { readonly name: string; readonly mutate: (unit: Unit) => Unit }[] = [
    { name: "inspection", mutate: (unit) => ({ ...unit, inspection: { ...unit.inspection, expiresAt: "2026-09-20" } }) },
    { name: "management authority", mutate: (unit) => ({ ...unit, managementAuthority: { ...unit.managementAuthority, expiresAt: "2026-09-20" } }) },
    { name: "licensing", mutate: (unit) => ({ ...unit, regulatory: { ...unit.regulatory, licensing: { ...unit.regulatory.licensing, expiresAt: "2026-09-20" } } }) },
    { name: "insurance", mutate: (unit) => ({ ...unit, regulatory: { ...unit.regulatory, insurance: { ...unit.regulatory.insurance, expiresAt: "2026-09-20" } } }) },
  ];
  for (const invalidator of invalidators) {
    await assert.rejects(withDemoJourney(() => {}, undefined, undefined, undefined, undefined, ({ guest }) => {
      const unit = guest.unitRepository.findAll()[0]!;
      guest.unitRepository.save(invalidator.mutate(unit));
    }), new RegExp("stale or changed|eligibility", "i"), `acceptance rejects expired ${invalidator.name}`);
    await assert.rejects(withDemoJourney(() => {}, undefined, undefined, undefined, undefined, undefined, ({ guest }) => {
      const unit = guest.unitRepository.findAll()[0]!;
      guest.unitRepository.save(invalidator.mutate(unit));
    }), /eligible through checkout/i, `checkout rejects expired ${invalidator.name}`);
    await withDemoJourney(async ({ guest, offerId }) => {
      const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
      await assert.rejects(guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId }), /eligibility is invalid/i);
      assert.equal(guest.contractRepository.findContractById(guest.cardPaymentApp.getPaymentJourney(offerId)?.finalContractId ?? ""), null);
      assert.equal(guest.cardPaymentApp.getPaymentJourney(offerId)?.stage, "reconciliation_required");
    }, undefined, undefined, undefined, ({ guest }) => {
      const unit = guest.unitRepository.findAll()[0]!;
      guest.unitRepository.save(invalidator.mutate(unit));
    });
  }
});

test("AC5: an unverified first Period Payment releases its 30-night hold at the Payment Window deadline", async () => {
  const nowRef = { now: NOW.getTime() };
  await withDemoJourney(async ({ guest, offerId, nowRef: clockRef }) => {
    const offer = guest.conditionalOfferApp.getOffer(offerId);
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    clockRef.now = Date.parse(offer.paymentWindow.expiresAt);
    await assert.rejects(guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId }));
    assert.equal(guest.contractRepository.findContractById(guest.cardPaymentApp.getPaymentJourney(offerId)?.finalContractId ?? ""), null);
    for (let day = 0; day < 30; day += 1) {
      const date = new Date(Date.parse(`${offer.dates.checkIn}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
      assert.equal(guest.calendar.getAuthoritativeAvailability({ unitId: offer.unitId, checkIn: date, checkOut: new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), clock: () => new Date(clockRef.now) }).isAvailable, true);
    }
  }, (_reference, amount, payerId) => ({ reference: "synthetic-ref", method: "card", verified: false, status: "pending", amountKobo: amount, currency: "NGN", providerReference: "synthetic-ref", payerId, environment: "test" }), nowRef);
});

test("AC7: Extended Stay booking is refused when demo mode is disabled and production refuses demo configuration", () => {
  assert.throws(() => loadPilotCoreConfiguration(PRODUCTION_WITH_DEMO_SOURCE), /refused in production/i);
  const productionFiles = demoDatabase();
  try {
    assert.throws(() => LocalGuestEnvironment.openNode({ databasePath: productionFiles.path, demo: true, production: true, deployment: "production", clock: () => NOW }), /refused in production/i);
  } finally {
    removeDemoDatabase(productionFiles.dir);
  }
  const files = demoDatabase();
  const guest = LocalGuestEnvironment.openNode({ databasePath: files.path, demo: false, clock: () => NOW });
  try {
    assert.throws(() => guest.bookingRequestApp.createDraft({
      unitId: guest.unitRepository.findAll()[0]!.id,
      primaryGuest: { id: guest.config.guestId, name: guest.config.guestName },
      occupants: guest.demoOccupants(1),
      selfBookingAttestation: guest.selfBookingAttestation(),
      checkIn: "2026-09-10",
      checkOut: "2026-10-10",
    }, guest.guestPrincipal()), /stay cannot exceed 29 nights/i);
  } finally {
    guest.close();
    removeDemoDatabase(files.dir);
  }
});

test("AC4: missing, invalid, amount-mismatched, or provider-reference-mismatched verification confirms nothing", async () => {
  const variants: readonly ((reference: string, amount: number, payerId: string) => PaymentOutcome)[] = [
    () => { throw new Error("provider verification unavailable"); },
    (reference, amount, payerId) => ({ reference, method: "card", verified: false, status: "failed", amountKobo: amount, currency: "NGN", providerReference: reference, payerId, environment: "test" }),
    (reference, amount, payerId) => ({ reference, method: "card", verified: true, status: "success", amountKobo: amount + 1, currency: "NGN", providerReference: reference, payerId, environment: "test" }),
    (reference, amount, payerId) => ({ reference, method: "card", verified: true, status: "success", amountKobo: amount, currency: "NGN", providerReference: `${reference}-other`, payerId, environment: "test" }),
  ];
  for (const outcome of variants) await withDemoJourney(async ({ guest, offerId }) => {
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    await assert.rejects(guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId }));
    assert.equal(guest.contractRepository.findContractById(guest.cardPaymentApp.getPaymentJourney(offerId)?.finalContractId ?? ""), null);
    assert.equal(guest.cardPaymentApp.getCheckoutSession(offerId)?.status, "initiated");
  }, outcome);
});

test("AC4: a successful response from a superseded persisted attempt cannot confirm the booking", async () => {
  await withDemoJourney(async ({ guest, offerId }) => {
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    await assert.rejects(guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId }));
    assert.equal(guest.contractRepository.findContractById(guest.cardPaymentApp.getPaymentJourney(offerId)?.finalContractId ?? ""), null);
    assert.equal(guest.cardPaymentApp.getPaymentJourney(offerId)?.stage, "reconciliation_required");
  }, undefined, undefined, undefined, ({ guest, offerId, session }) => {
    guest.livePaymentAttempts.release(offerId);
    guest.livePaymentAttempts.acquire({ offerId, method: "fresh_card", purpose: "stay", attemptId: `replacement-${session.checkoutId}`, startedAt: NOW.toISOString(), expiresAt: session.expiresAt });
    guest.livePaymentAttempts.release(offerId);
  });
});
