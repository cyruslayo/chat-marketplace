import assert from "node:assert/strict";
import test from "node:test";
import { UnitDiscoveryQuery, UnitRepository } from "../domains/shortlet/src/index.js";
import type { Unit } from "../domains/shortlet/src/browse.js";
import { createStayQuote, type BillingPeriodQuote } from "../domains/shortlet/src/quote.js";
import { DEMO_EXTENDED_STAY_POLICY, assertStayLength, isExtendedStayLength } from "../domains/shortlet/src/extended-stay.js";
import { marginOnKobo } from "../domains/shortlet/src/owner-terms.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { demoDatabase, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";
import {
  DEFAULT_MONTHLY,
  DEFAULT_UTILITIES,
  SYNTHETIC_NOW,
  acceptDemoOffer,
  addDays,
  createDemoDraft,
  discloseDemoDraft,
  extendUnit,
  extendedStayUnit,
  offerFromDemoRequest,
  withDemoExtendedJourney,
  withDemoGuest,
} from "./helpers/demo-extended-journey.js";

const CHECK_IN = "2026-09-10";
const CHECK_OUT_180 = addDays(CHECK_IN, 180);
const TODAY = "2026-09-03";
/** A synthetic clock that places the same check-in more than 90 days ahead. */
const EARLIER_CLOCK = "2026-06-01T10:00:00.000Z";

/** The demo's seeded Unit, with Extended Stay terms and claims that cover the given checkout date. */
function journeyUnit(claimsThrough: string): (seeded: Unit) => Unit {
  return (seeded) => extendUnit(seeded, { claimsThrough });
}

/** A quote whose Billing Periods are present; Short Stay quotes carry none, and the tests that expect that read the quote directly. */
type PeriodQuote = ReturnType<typeof createStayQuote> & { readonly billingPeriods: readonly BillingPeriodQuote[] };

function quoteFor(unit: Unit, checkOut: string, checkIn = CHECK_IN): PeriodQuote {
  return createStayQuote({ unit, checkIn, checkOut, clock: () => SYNTHETIC_NOW, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY }) as PeriodQuote;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The guest price of an owner amount: the agreed amount plus margin, as ADR 0089 derives it. */
function guestAmount(ownerKobo: number, marginBasisPoints: number): number {
  return ownerKobo + marginOnKobo(ownerKobo, marginBasisPoints);
}

function discoveryFor(units: readonly Unit[]): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  for (const unit of units) repository.save(unit);
  return new UnitDiscoveryQuery({ repository, audit: { record() {} }, telemetry: { track() {} }, clock: () => SYNTHETIC_NOW, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY });
}

test("AC1: a six-period 180-night demo quote totals the six period amounts and snapshots all six periods", () => {
  const unit = extendedStayUnit({ marginBasisPoints: 1234 });
  const quote = quoteFor(unit, CHECK_OUT_180);
  assert.equal(quote.stayType, "extended");
  assert.equal(quote.nights, 180);
  assert.equal(quote.billingPeriods.length, 6);
  const expectedPeriod = guestAmount(DEFAULT_MONTHLY.accommodationKobo, 1234) + guestAmount(DEFAULT_MONTHLY.mandatoryChargesKobo, 1234);
  quote.billingPeriods.forEach((period, index) => {
    assert.equal(period.index, index + 1);
    assert.equal(period.nights, 30);
    assert.equal(period.checkIn, addDays(CHECK_IN, index * 30));
    assert.equal(period.checkOut, addDays(CHECK_IN, (index + 1) * 30));
    assert.equal(period.dueDate, addDays(period.checkIn, -7), "each period is due 7 days before its first night");
    assert.equal(period.amountKobo, expectedPeriod);
    assert.equal(period.nightlyContractedValuesKobo.length, 30);
    assert.equal(sum(period.nightlyContractedValuesKobo), period.amountKobo);
  });
  assert.equal(sum(quote.billingPeriods.map((period) => period.amountKobo)), quote.allInStayTotalKobo);
  assert.equal(quote.allInStayTotalKobo, expectedPeriod * 6);
  assert.equal(quote.totalAmountDueNowKobo, expectedPeriod, "the first payment is the first Billing Period only");
  assert.equal(quote.refundableSecurityDepositKobo, 0, "ADR 0092 keeps Extended Stay deposits at zero");
  assert.ok(Object.isFrozen(quote.billingPeriods), "the period snapshot is frozen");

  const taxed = quoteFor(extendedStayUnit({ marginBasisPoints: 1234, taxConfig: { ratePercentage: 7 } }), CHECK_OUT_180);
  assert.ok(taxed.lineItems.taxesKobo > 0, "the 7% tax is actually charged");
  assert.equal(sum(taxed.billingPeriods.map((period) => period.amountKobo)), taxed.allInStayTotalKobo, "taxes are allocated so the periods still total the stay");
});

test("AC2: a shorter final period is priced at the nightly price for only its nights, with exact nightly contracted values", () => {
  const unit = extendedStayUnit({ ownerNightlyKobo: 1_000_001, ownerMandatoryChargesKobo: 0, marginBasisPoints: 1234 });
  const nightly = unit.price.nightlyKobo;
  const quote = quoteFor(unit, addDays(CHECK_IN, 40));
  assert.deepEqual(quote.billingPeriods.map((period) => period.nights), [30, 10]);
  const finalPeriod = quote.billingPeriods[1]!;
  assert.equal(finalPeriod.checkIn, addDays(CHECK_IN, 30));
  assert.equal(finalPeriod.checkOut, addDays(CHECK_IN, 40));
  assert.equal(finalPeriod.amountKobo, nightly * 10, "ten nights at the Short Stay nightly price, without rounding drift");
  assert.deepEqual([...finalPeriod.nightlyContractedValuesKobo], Array.from({ length: 10 }, () => nightly));
  assert.equal(quoteFor(unit, addDays(CHECK_IN, 31)).billingPeriods[1]!.amountKobo, nightly, "a one-night final period is one nightly price");

  const withCharges = extendedStayUnit({ ownerNightlyKobo: 1_000_001, ownerMandatoryChargesKobo: 100_000, marginBasisPoints: 1234 });
  const chargedQuote = quoteFor(withCharges, addDays(CHECK_IN, 35));
  assert.deepEqual(chargedQuote.billingPeriods.map((period) => period.nights), [30, 5]);
  const chargedFinal = chargedQuote.billingPeriods[1]!;
  assert.equal(chargedFinal.amountKobo, withCharges.price.nightlyKobo * 5 + (withCharges.price.mandatoryFeesKobo ?? 0));
  assert.equal(sum(chargedFinal.nightlyContractedValuesKobo), chargedFinal.amountKobo, "nightly values allocate the final period exactly");
  assert.equal(sum(chargedQuote.billingPeriods.map((period) => period.amountKobo)), chargedQuote.allInStayTotalKobo);
});

test("AC3: staging demo requests from 30 through 180 nights pass only for opted-in units with complete monthly pricing and utilities facts", async () => {
  for (const nights of [30, 31, 179, 180]) {
    assert.equal(quoteFor(extendedStayUnit(), addDays(CHECK_IN, nights)).nights, nights);
  }
  const incomplete: readonly { readonly label: string; readonly unit: Unit }[] = [
    { label: "not opted in", unit: extendedStayUnit({ extendedStay: { optedIn: false, monthlyAgreedAmounts: DEFAULT_MONTHLY, utilitiesAndServicing: DEFAULT_UTILITIES } }) },
    { label: "missing monthly amounts", unit: extendedStayUnit({ extendedStay: { optedIn: true, utilitiesAndServicing: DEFAULT_UTILITIES } }) },
    { label: "zero accommodation amount", unit: extendedStayUnit({ monthly: { ...DEFAULT_MONTHLY, accommodationKobo: 0 } }) },
    { label: "missing utilities statement", unit: extendedStayUnit({ extendedStay: { optedIn: true, monthlyAgreedAmounts: DEFAULT_MONTHLY } }) },
    { label: "unknown cleaning frequency", unit: extendedStayUnit({ utilities: { ...DEFAULT_UTILITIES, cleaningFrequency: "hourly" as never } }) },
  ];
  for (const { label, unit } of incomplete) {
    for (const nights of [30, 180]) {
      assert.throws(() => quoteFor(unit, addDays(CHECK_IN, nights)), /not configured for Extended Stay/i, `${label} at ${nights} nights`);
    }
  }
  const opted = extendedStayUnit({ claimsThrough: CHECK_OUT_180 });
  const notOpted = { ...extendedStayUnit({ claimsThrough: CHECK_OUT_180 }), id: "unit-not-opted-in", extendedStay: { optedIn: false } } as Unit;
  const results = discoveryFor([opted, notOpted]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_180, partySize: 1 }).facts.results;
  assert.deepEqual(results.map((result: { id: string }) => result.id), [opted.id], "discovery shows only the opted-in Unit for 180 nights");

  await withDemoGuest({ unit: journeyUnit(CHECK_OUT_180) }, (context) => {
    const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 });
    const stored = context.guest.unitRepository.findById(context.unitId)!;
    context.guest.unitRepository.save({ ...stored, extendedStay: { optedIn: false } });
    assert.throws(() => discloseDemoDraft(context, draft.draftId), /not configured for Extended Stay/i, "disclosure rechecks opt-in before the request is made");
  });
});

test("AC4: lengths of more than 180 nights are rejected before search results, quote, identity verification, hold or payment", async () => {
  const unit = extendedStayUnit({ claimsThrough: addDays(CHECK_IN, 220) });
  for (const nights of [181]) {
    const checkOut = addDays(CHECK_IN, nights);
    assert.throws(() => discoveryFor([unit]).search({ checkIn: CHECK_IN, checkOut, partySize: 1 }), /outside the configured ranges/i, `search ${nights}`);
    assert.throws(() => quoteFor(unit, checkOut), /outside the configured ranges/i, `quote ${nights}`);
    await withDemoGuest({ unit: journeyUnit(addDays(CHECK_IN, 220)) }, (context) => {
      assert.throws(() => createDemoDraft(context, { checkIn: CHECK_IN, checkOut }), /outside the configured ranges/i, `draft ${nights}`);
    });
  }
  assert.equal(isExtendedStayLength(15, DEMO_EXTENDED_STAY_POLICY), false);
  assert.equal(isExtendedStayLength(181, DEMO_EXTENDED_STAY_POLICY), false);
  assert.equal(isExtendedStayLength(180, DEMO_EXTENDED_STAY_POLICY), true);

  assert.throws(() => assertStayLength(91), /stay cannot exceed 29 nights/, "without the demo policy a 91-night stay is refused");
  const files = demoDatabase();
  const nonDemo = LocalGuestEnvironment.openNode({ databasePath: files.path, demo: false, clock: () => SYNTHETIC_NOW });
  try {
    for (const nights of [30, 91]) {
      assert.throws(() => nonDemo.bookingRequestApp.createDraft({
        unitId: nonDemo.unitRepository.findAll()[0]!.id,
        primaryGuest: { id: nonDemo.config.guestId, name: nonDemo.config.guestName },
        occupants: nonDemo.demoOccupants(1),
        selfBookingAttestation: nonDemo.selfBookingAttestation(),
        checkIn: CHECK_IN,
        checkOut: addDays(CHECK_IN, nights),
      }, nonDemo.guestPrincipal()), /not configured for Extended Stay/i, `non-demo ${nights} nights`);
    }
  } finally {
    nonDemo.close();
    removeDemoDatabase(files.dir);
  }
});

test("AC5: a check-in beyond the 90-day horizon is rejected at search, draft, disclosure, confirmation and payment initialization", async () => {
  const beyond = addDays(TODAY, 91);
  const unit = extendedStayUnit({ claimsThrough: addDays(beyond, 260) });
  assert.throws(() => discoveryFor([unit]).search({ checkIn: beyond, checkOut: addDays(beyond, 30), partySize: 1 }), /booking horizon/i, "search");
  const atLimit = addDays(TODAY, 90);
  assert.equal(discoveryFor([unit]).search({ checkIn: atLimit, checkOut: addDays(atLimit, 180), partySize: 1 }).facts.results.length, 1, "check-in on day 90 is inside the horizon and its checkout is not");

  await withDemoGuest({ unit: journeyUnit(addDays(beyond, 260)) }, (context) => {
    assert.throws(() => createDemoDraft(context, { checkIn: beyond, checkOut: addDays(beyond, 30) }), /booking horizon/i, "draft");
  });

  await withDemoGuest({ unit: journeyUnit(CHECK_OUT_180) }, (context) => {
    const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 });
    context.setClock(EARLIER_CLOCK);
    assert.throws(() => discloseDemoDraft(context, draft.draftId), /booking horizon/i, "disclosure");
  });

  await withDemoGuest({ unit: journeyUnit(CHECK_OUT_180) }, (context) => {
    const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 });
    const requestId = discloseDemoDraft(context, draft.draftId);
    context.setClock(EARLIER_CLOCK);
    assert.throws(() => offerFromDemoRequest(context, requestId), /booking horizon/i, "confirmation");
  });

  await withDemoGuest({ unit: journeyUnit(CHECK_OUT_180) }, async (context) => {
    const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 });
    const offerId = offerFromDemoRequest(context, discloseDemoDraft(context, draft.draftId));
    acceptDemoOffer(context, offerId);
    context.setClock(EARLIER_CLOCK);
    await assert.rejects(context.guest.cardPaymentApp.initializePaystackCheckout(offerId, context.guest.guestPrincipal()), /booking horizon/i, "payment initialization");
  });
});

test("AC5: a checkout beyond inspection, authority, licence or insurance expiry is rejected at search, draft, disclosure, acceptance and payment initialization", async () => {
  const claimVariants: readonly { readonly name: string; readonly expire: (unit: Unit, date: string) => Unit }[] = [
    { name: "inspection", expire: (unit, date) => ({ ...unit, inspection: { ...unit.inspection, expiresAt: date } }) },
    { name: "management authority", expire: (unit, date) => ({ ...unit, managementAuthority: { ...unit.managementAuthority, expiresAt: date } }) },
    { name: "licensing", expire: (unit, date) => ({ ...unit, regulatory: { ...unit.regulatory, licensing: { ...unit.regulatory.licensing, expiresAt: date } } }) },
    { name: "insurance", expire: (unit, date) => ({ ...unit, regulatory: { ...unit.regulatory, insurance: { ...unit.regulatory.insurance, expiresAt: date } } }) },
  ];
  const dayBeforeCheckout = addDays(CHECK_OUT_180, -1);
  const standalone = extendedStayUnit({ claimsThrough: CHECK_OUT_180 });
  for (const variant of claimVariants) {
    assert.equal(discoveryFor([standalone]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_180, partySize: 1 }).facts.results.length, 1, `${variant.name} valid through checkout`);
    assert.equal(discoveryFor([variant.expire(standalone, dayBeforeCheckout)]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_180, partySize: 1 }).facts.results.length, 0, `search excludes a ${variant.name} that expires before checkout`);

    const expireOnStored = (context: { readonly guest: LocalGuestEnvironment; readonly unitId: string }) => {
      context.guest.unitRepository.save(variant.expire(context.guest.unitRepository.findById(context.unitId)!, dayBeforeCheckout));
    };

    await withDemoGuest({ unit: (seeded) => variant.expire(extendUnit(seeded, { claimsThrough: CHECK_OUT_180 }), dayBeforeCheckout) }, (context) => {
      assert.throws(() => createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 }), /eligible through checkout/i, `draft rejects ${variant.name}`);
    });

    await withDemoGuest({ unit: journeyUnit(CHECK_OUT_180) }, (context) => {
      const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: CHECK_OUT_180 });
      expireOnStored(context);
      assert.throws(() => discloseDemoDraft(context, draft.draftId), /eligible through checkout/i, `disclosure rejects ${variant.name}`);
    });

    await withDemoExtendedJourney({ unit: journeyUnit(CHECK_OUT_180), checkIn: CHECK_IN, checkOut: CHECK_OUT_180, beforeAcceptance: (context) => expireOnStored(context) }, () => {
      assert.fail(`acceptance must reject ${variant.name}`);
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || /must reject/.test(error.message)) throw error;
      assert.match(error.message, /stale or changed|eligibility/i, `acceptance rejects ${variant.name}`);
    });

    await withDemoExtendedJourney({ unit: journeyUnit(CHECK_OUT_180), checkIn: CHECK_IN, checkOut: CHECK_OUT_180, beforeCheckout: (context) => expireOnStored(context) }, () => {
      assert.fail(`payment initialization must reject ${variant.name}`);
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || /must reject/.test(error.message)) throw error;
      assert.match(error.message, /eligible through checkout/i, `payment initialization rejects ${variant.name}`);
    });
  }
});

test("AC6: a 14-night Short Stay under the demo policy keeps its nightly price, its deposit, and no Billing Periods", () => {
  const unit = extendedStayUnit();
  const checkOut = addDays(CHECK_IN, 14);
  const quote = quoteFor(unit, checkOut);
  const withoutDemoPolicy = createStayQuote({ unit, checkIn: CHECK_IN, checkOut, clock: () => SYNTHETIC_NOW });
  assert.equal(quote.stayType, "short");
  assert.equal(quote.billingPeriods, undefined);
  assert.equal(quote.allInStayTotalKobo, withoutDemoPolicy.allInStayTotalKobo);
  assert.equal(quote.totalAmountDueNowKobo, withoutDemoPolicy.totalAmountDueNowKobo);
  assert.equal(quote.refundableSecurityDepositKobo, withoutDemoPolicy.refundableSecurityDepositKobo);
  assert.throws(() => quoteFor(unit, addDays(CHECK_IN, 181)), /outside the configured ranges/i, "181 nights stay unsupported");
});

test("AC1: the first Period Payment collects only the first Billing Period, never the six-period total", async () => {
  await withDemoExtendedJourney({ unit: journeyUnit(CHECK_OUT_180), checkIn: CHECK_IN, checkOut: CHECK_OUT_180 }, async ({ guest, offerId }) => {
    const offer = guest.conditionalOfferApp.getOffer(offerId);
    const firstPeriod = offer.quote.billingPeriods[0]!.amountKobo;
    assert.equal(offer.quote.billingPeriods.length, 6);
    assert.notEqual(firstPeriod, offer.quote.allInStayTotalKobo);
    assert.equal(offer.totalAmountDueNowKobo, firstPeriod);
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    assert.equal(session.amountKobo, firstPeriod, "Paystack is asked for one period");
    const confirmed = await guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId });
    assert.equal(confirmed.outcome, "confirmed");
    if (confirmed.outcome !== "confirmed") return;
    assert.equal(confirmed.bookingContract.paymentDetails.amountKobo, firstPeriod);
    assert.equal(confirmed.ledgerEntries[0]!.amountKobo, firstPeriod);
    assert.equal(confirmed.bookingContract.dates.nights, 180);
  });
});

test("AC1: a verification for the six-period total instead of the first Billing Period confirms nothing", async () => {
  const wholeStay = quoteFor(extendUnit(extendedStayUnit(), { claimsThrough: CHECK_OUT_180 }), CHECK_OUT_180).allInStayTotalKobo;
  await withDemoExtendedJourney({
    unit: journeyUnit(CHECK_OUT_180), checkIn: CHECK_IN, checkOut: CHECK_OUT_180,
    outcomeFactory: (reference, _amount, payerId) => ({ reference, method: "card", verified: true, status: "success", amountKobo: wholeStay, currency: "NGN", providerReference: reference, payerId, environment: "test" }),
  }, async ({ guest, offerId }) => {
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    await assert.rejects(guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId }), /Amount verification failed/i);
    assert.equal(guest.contractRepository.findContractById(guest.cardPaymentApp.getPaymentJourney(offerId)?.finalContractId ?? ""), null);
  });
});

test("AC1: the Booking Contract snapshots all six periods and the whole-stay total, unchanged when Unit terms change", async () => {
  await withDemoExtendedJourney({ unit: journeyUnit(CHECK_OUT_180), checkIn: CHECK_IN, checkOut: CHECK_OUT_180 }, async ({ guest, offerId, unitId }) => {
    const session = guest.cardPaymentApp.getCheckoutSession(offerId)!;
    const confirmed = await guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, { id: "synthetic-system", role: "system", tenantId: guest.config.tenantId });
    assert.equal(confirmed.outcome, "confirmed");
    if (confirmed.outcome !== "confirmed") return;
    const contract = confirmed.bookingContract;
    const captured = structuredClone(contract.quote) as { billingPeriods: unknown[]; allInStayTotalKobo: number };
    assert.equal(captured.billingPeriods.length, 6);
    assert.equal(captured.allInStayTotalKobo, guest.conditionalOfferApp.getOffer(offerId).quote.allInStayTotalKobo);

    const stored = guest.unitRepository.findById(unitId)!;
    guest.unitRepository.save({ ...stored, extendedStay: { ...stored.extendedStay!, monthlyAgreedAmounts: { accommodationKobo: 11_000_000, mandatoryChargesKobo: 600_000, version: "monthly-revised" } } });
    const persisted = guest.contractRepository.findContractById(contract.contractId)!;
    assert.deepEqual(structuredClone(persisted.quote), captured, "the stored contract keeps the captured periods and whole-stay total");
  });
});
