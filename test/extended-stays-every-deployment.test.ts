/**
 * Issue 05: Extended Stays (30 to 180 nights, ADR 0092 as amended 1 Nov 2026) are on in every deployment, including
 * production and non-demo staging. Demo mode keeps its labels and refusal in production (ADR 0105).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import {
  DEMO_EXTENDED_STAY_POLICY,
  EXTENDED_STAY_POLICY,
  extendedCancellationTerms,
  noticeToEndTerms,
} from "../domains/shortlet/src/extended-stay.js";
import { PeriodPaymentManager } from "../domains/shortlet/src/period-payment.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";
import { UnitRepository, seedIssue01Units, type BookingContract } from "../domains/shortlet/src/index.js";
import type { Unit } from "../domains/shortlet/src/browse.js";
import { addDays, extendUnit, SYNTHETIC_NOW } from "./helpers/demo-extended-journey.js";
import { demoDatabase, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";

const CHECK_IN = "2026-09-10";

/** A production-shaped guest over a fresh synthetic database: no demo flag, no demo acceptor (ADR 0105). */
function withProductionGuest(run: (guest: LocalGuestEnvironment) => void): void {
  const files = demoDatabase();
  const guest = LocalGuestEnvironment.openNode({ databasePath: files.path, demo: false, deployment: "production", clock: () => SYNTHETIC_NOW });
  try {
    run(guest);
  } finally {
    guest.close();
    removeDemoDatabase(files.dir);
  }
}

/** Gives the seeded Unit opted-in Extended Stay terms, derived pricing and claims through the checkout dates used here. */
function optIn(guest: LocalGuestEnvironment, options: Parameters<typeof extendUnit>[1] = {}): string {
  const seeded = guest.unitRepository.findAll()[0]!;
  guest.unitRepository.save(extendUnit(seeded, options));
  return seeded.id;
}

/** The issue 01 Unit, before any Extended Stay terms are applied. */
function withSeededUnit(): Unit {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  return repository.findAll()[0]!;
}

/** A confirmed 60-night Extended Stay (two Billing Periods) whose first period is paid, built by the real quote path. */
function extendedContractFixture(): BookingContract & { readonly offerId: string } {
  const quote = createStayQuote({ unit: extendUnit(withSeededUnit()), checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 60), clock: () => SYNTHETIC_NOW, extendedStayPolicy: EXTENDED_STAY_POLICY });
  const first = quote.billingPeriods![0]!;
  return {
    contractId: "contract-extended-every-deployment",
    contractVersion: 1,
    reservationId: "reservation-extended-every-deployment",
    offerId: "offer-extended-every-deployment",
    unitId: quote.unitId,
    dates: { checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 60), nights: 60 },
    quote,
    paymentDetails: { paymentMethod: "fresh_card", pspReference: "psp-ref-period-1-every", amountKobo: first.amountKobo, currency: "NGN", paidAt: "2026-09-01T00:00:00.000Z" },
  } as unknown as BookingContract & { readonly offerId: string };
}

function draftFor(guest: LocalGuestEnvironment, unitId: string, nights: number) {
  return guest.bookingRequestApp.createDraft({
    unitId,
    primaryGuest: { id: guest.config.guestId, name: guest.config.guestName },
    occupants: guest.demoOccupants(1),
    selfBookingAttestation: guest.selfBookingAttestation(),
    checkIn: CHECK_IN,
    checkOut: addDays(CHECK_IN, nights),
  }, guest.guestPrincipal());
}

test("AC1: A production composition accepts a search, quote and Booking Request of 30, 90 and 180 nights at an opted-in unit, and refuses 181 nights", () => {
  // Each length runs on a fresh guest: a Booking Request holds its dates, so the lengths cannot share one Unit's calendar.
  for (const nights of [30, 90, 180]) {
    withProductionGuest((guest) => {
      assert.equal(guest.extendedStayPolicy?.maximumNights, 180, "production composition supplies the Extended Stay policy");
      const unitId = optIn(guest);
      const found = guest.discoveryQuery.search({ checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, nights), partySize: 1 });
      assert.ok(found.facts.results.some((unit: { id: string }) => unit.id === unitId), `${nights} nights are searchable in production`);
      const draft = draftFor(guest, unitId, nights);
      const requestId = guest.bookingRequestApp.disclose(draft.draftId, guest.guestPrincipal()).requestId;
      assert.equal(guest.bookingRequestApp.getRequest(requestId).quote.stayType, "extended", `${nights} nights is an Extended Stay request`);
    });
  }
  withProductionGuest((guest) => {
    const unitId = optIn(guest);
    assert.throws(() => draftFor(guest, unitId, 181), /stay|nights|range|maximum|180/i, "181 nights is refused in production");
  });
});

test("AC2: In production, a unit that has not opted in, or lacks Monthly Agreed Amounts or a utilities statement, never appears for 30+ nights", () => {
  withProductionGuest((guest) => {
    const seeded = guest.unitRepository.findAll()[0]!;
    const cases: Array<{ name: string; extendedStay: unknown }> = [
      { name: "not opted in", extendedStay: undefined },
      { name: "opted in without Monthly Agreed Amounts", extendedStay: { optedIn: true, utilitiesAndServicing: extendUnit(seeded).extendedStay?.utilitiesAndServicing } },
      { name: "opted in without a utilities statement", extendedStay: { optedIn: true, monthlyAgreedAmounts: extendUnit(seeded).extendedStay?.monthlyAgreedAmounts } },
    ];
    for (const entry of cases) {
      guest.unitRepository.save({ ...extendUnit(seeded), extendedStay: entry.extendedStay } as never);
      for (const nights of [30, 180]) {
        const found = guest.discoveryQuery.search({ checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, nights), partySize: 1 });
        assert.equal(found.facts.results.some((unit) => unit.id === seeded.id), false, `${entry.name} never appears for ${nights} nights`);
      }
    }
    optIn(guest);
    const eligible = guest.discoveryQuery.search({ checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 30), partySize: 1 });
    assert.ok(eligible.facts.results.some((unit) => unit.id === seeded.id), "the opted-in unit does appear for 30 nights");
  });
});

test("AC3: Demo mode in a production deployment is still refused at startup", () => {
  const files = demoDatabase();
  try {
    assert.throws(() => LocalGuestEnvironment.openNode({ databasePath: files.path, demo: true, production: true, deployment: "production", clock: () => SYNTHETIC_NOW }), /refused in production \(ADR 0105\)/);
    assert.throws(() => new LocalApartmentOwnerEnvironment({ tenantId: "tenant-production-demo", demo: true, deployment: "production", clock: () => SYNTHETIC_NOW }, { database: undefined as never, unitRepository: undefined as never, operatorRepository: undefined as never }), /refused in production/);
  } finally {
    removeDemoDatabase(files.dir);
  }
});

test("AC4: Outside demo mode, the Extended cancellation terms and the Notice to End terms contain neither 'Demo' nor 'pending counsel review'; in demo mode they still start with 'Demo terms for a synthetic staging booking'", () => {
  for (const terms of [extendedCancellationTerms(false), noticeToEndTerms(false)]) {
    assert.equal(terms.includes("Demo"), false, "no Demo label outside demo mode");
    assert.equal(terms.includes("pending counsel review"), false, "no pending-counsel wording outside demo mode");
  }
  for (const terms of [extendedCancellationTerms(true), noticeToEndTerms(true)]) {
    assert.ok(terms.startsWith("Demo terms for a synthetic staging booking"), "demo mode keeps the demo label");
    assert.equal(terms.includes("pending counsel review"), false, "demo mode drops pending counsel review");
  }
  const production = createStayQuote({ unit: extendUnit(withSeededUnit()), checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 30), clock: () => SYNTHETIC_NOW, extendedStayPolicy: EXTENDED_STAY_POLICY });
  assert.equal(production.cancellationPolicy.policySummary, extendedCancellationTerms(false), "a production quote carries the non-demo terms");
  const demo = createStayQuote({ unit: extendUnit(withSeededUnit()), checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 30), clock: () => SYNTHETIC_NOW, extendedStayPolicy: EXTENDED_STAY_POLICY, demoTerms: true });
  assert.equal(demo.cancellationPolicy.policySummary, extendedCancellationTerms(true), "a demo quote carries the demo terms");
});

test("AC6: An overdue later period in a production composition ends nothing and changes no access; it is only listed for contact", () => {
  const contract = extendedContractFixture();
  const contractBefore = JSON.stringify(contract);
  // The synthetic store lists the one confirmed Extended Stay; no later period has been paid.
  const store = { listBookingSnapshotOfferIds: () => [contract.offerId], listPeriodPayments: () => [], listPeriodPaymentSessions: () => [], listRefundablePeriodPayments: () => [], findPeriodPaymentSessionByReference: () => null };
  const manager = new PeriodPaymentManager({ store: store as never, contracts: { getBookingContract: () => contract }, extendedStayPolicy: EXTENDED_STAY_POLICY });
  const dueDate = (contract.quote as unknown as { billingPeriods: { dueDate: string }[] }).billingPeriods[1]!.dueDate;
  const dueMoment = new Date(`${dueDate}T00:00:00.000Z`);
  const period = manager.projectBillingPeriods(contract.offerId, dueMoment).find((entry) => entry.periodIndex === 2)!;
  assert.equal(period.status, "overdue");
  assert.equal(period.humanContactRequired, true, "an overdue later period is flagged for human contact only");
  assert.ok(manager.backOfficeList(dueMoment).some((entry) => entry.periodIndex === 2 && entry.status === "overdue"), "it is listed for contact");
  assert.equal(JSON.stringify(contract), contractBefore, "the contract is unchanged");
  assert.equal(Object.keys(period).some((key) => /access|lock|terminat|ended|remov/i.test(key)), false, "the projection carries no access or termination action");
});
