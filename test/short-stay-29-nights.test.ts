import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { BookingAmendmentManager, MAX_STAY_NIGHTS, UnitDiscoveryQuery, UnitRepository, type BookingAmendmentDependencies, type BookingContract } from "../domains/shortlet/src/index.js";
import type { Unit } from "../domains/shortlet/src/browse.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";
import { DEMO_EXTENDED_STAY_POLICY } from "../domains/shortlet/src/extended-stay.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import { SYNTHETIC_NOW, addDays, extendedStayUnit } from "./helpers/demo-extended-journey.js";
import { demoDatabase, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";

const CHECK_IN = "2026-09-10";
const SRC_DIR = fileURLToPath(new URL("../domains/shortlet/src/", import.meta.url));

/** A production-shaped (no Extended Stay policy) discovery over the given Units. */
function productionDiscovery(units: readonly Unit[]): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  for (const unit of units) repository.save(unit);
  return new UnitDiscoveryQuery({ repository, audit: { record() {} }, telemetry: { track() {} }, clock: () => SYNTHETIC_NOW });
}

/** A quote built without any Extended Stay policy, as production builds it. */
function productionQuote(unit: Unit, checkOut: string) {
  return createStayQuote({ unit, checkIn: CHECK_IN, checkOut, clock: () => SYNTHETIC_NOW });
}

/** A quote built under the staging demo policy (30 to 180 nights). */
function demoQuote(unit: Unit, checkOut: string) {
  return createStayQuote({ unit, checkIn: CHECK_IN, checkOut, clock: () => SYNTHETIC_NOW, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY });
}

/** Opens the production (non-demo) guest environment over a fresh synthetic database. */
function withProductionGuest(run: (guest: LocalGuestEnvironment) => void): void {
  const files = demoDatabase();
  const guest = LocalGuestEnvironment.openNode({ databasePath: files.path, demo: false, clock: () => SYNTHETIC_NOW });
  try {
    run(guest);
  } finally {
    guest.close();
    removeDemoDatabase(files.dir);
  }
}

function productionDraft(guest: LocalGuestEnvironment, nights: number) {
  return guest.bookingRequestApp.createDraft({
    unitId: guest.unitRepository.findAll()[0]!.id,
    primaryGuest: { id: guest.config.guestId, name: guest.config.guestName },
    occupants: guest.demoOccupants(1),
    selfBookingAttestation: guest.selfBookingAttestation(),
    checkIn: CHECK_IN,
    checkOut: addDays(CHECK_IN, nights),
  }, guest.guestPrincipal());
}

test("AC1: A search, quote, Request Draft and Booking Request of 15, 21 and 29 nights succeed as a Short Stay with no Extended Stay policy, and the Stay Quote records the stay type as short", () => {
  assert.equal(MAX_STAY_NIGHTS, 29, "the one constant carries the 29-night maximum");
  for (const nights of [15, 21, 29]) {
    const unit = extendedStayUnit({ claimsThrough: addDays(CHECK_IN, 60) });
    const found = productionDiscovery([unit]).search({ checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, nights), partySize: 1 });
    assert.deepEqual(found.facts.results.map((result: { id: string }) => result.id), [unit.id], `search ${nights} nights`);
    const quote = productionQuote(unit, addDays(CHECK_IN, nights));
    assert.equal(quote.stayType, "short", `quote ${nights} nights is a Short Stay`);
    assert.equal(quote.nights, nights);
  }

  // Each length gets a fresh guest environment: a Request blocks its nights, so the lengths cannot share one database.
  for (const nights of [15, 21, 29]) {
    withProductionGuest((guest) => {
      const draft = productionDraft(guest, nights);
      assert.ok(draft.draftId, `draft ${nights} nights is created`);
      const requestId = guest.bookingRequestApp.disclose(draft.draftId, guest.guestPrincipal()).requestId;
      assert.ok(requestId, `Booking Request ${nights} nights`);
    });
  }
});

test("AC2: Without an Extended Stay policy (production), 30 nights is refused before search, quoting, inventory blocking or payment, with an error that names the 29-night maximum. 0 nights is still refused.", () => {
  const unit = extendedStayUnit({ claimsThrough: addDays(CHECK_IN, 60) });
  assert.throws(() => productionDiscovery([unit]).search({ checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 30), partySize: 1 }), /29 nights/, "search refuses 30 nights before any results are produced");
  assert.throws(() => productionQuote(unit, addDays(CHECK_IN, 30)), /29 nights/, "quoting names the 29-night maximum");
  assert.throws(() => productionQuote(unit, addDays(CHECK_IN, 0)), /must be after checkIn|outside the configured ranges/i, "0 nights is refused");

  withProductionGuest((guest) => {
    const blockedBefore = guest.unitRepository.findAll()[0]!.blockedDates.length;
    assert.throws(() => productionDraft(guest, 30), /29 nights/, "the Request Draft refuses 30 nights before inventory is blocked");
    assert.throws(() => productionDraft(guest, 0), /must be after checkIn|outside the configured ranges/i, "the Request Draft refuses 0 nights");
    assert.equal(guest.unitRepository.findAll()[0]!.blockedDates.length, blockedBefore, "a refused 30-night draft blocks no inventory");
  });
});

test("AC3: With the demo policy (30 to 180 nights), 29 nights is a Short Stay and 30 nights is an Extended Stay; no length from 1 to 180 is refused at an opted-in unit", () => {
  const unit = extendedStayUnit({ claimsThrough: addDays(CHECK_IN, 220) });
  assert.equal(demoQuote(unit, addDays(CHECK_IN, 29)).stayType, "short");
  assert.equal(demoQuote(unit, addDays(CHECK_IN, 30)).stayType, "extended");
  for (let nights = 1; nights <= 180; nights += 1) {
    const quote = demoQuote(unit, addDays(CHECK_IN, nights));
    assert.equal(quote.nights, nights, `${nights} nights is quoted`);
    assert.equal(quote.stayType, nights <= 29 ? "short" : "extended", `${nights} nights has the right stay type`);
  }
});

test("AC4: A Booking Amendment that brings a Short Stay to 29 nights is accepted under the existing extension rules; one that brings it to 30 nights is refused", () => {
  const seen: string[] = [];
  const contract = shortStayContract();
  const deps: BookingAmendmentDependencies = {
    contractRepository: {
      getContract: () => contract,
      mutateContract: (_id, _version, mutation) => mutation(contract),
    },
    calendar: { getAuthoritativeAvailability: () => ({ isAvailable: true, version: "av-1" }) },
    inspectionRepository: { isPassedAndValidThrough: () => ({ valid: true, version: "ins-1" }) },
    authorityRepository: { isValidThrough: () => ({ valid: true, version: "auth-1" }) },
    quoteProvider: {
      quote: ({ resultingDates }) => {
        seen.push(String(resultingDates.nights));
        return {
          quoteId: `quote-${resultingDates.nights}`,
          quoteVersion: "1",
          currency: "NGN",
          revisedAllInStayTotalKobo: 50000,
          financialAdjustment: { type: "none", amountKobo: 0, currency: "NGN" },
        };
      },
    },
  };
  const manager = new BookingAmendmentManager(deps);
  const guest: CommandPrincipal = { id: "guest-1", role: "guest", tenantId: "tenant-1" };
  const request = (checkOut: string) => manager.requestAmendment(createPlatformCommandEnvelope({
    commandName: "booking_amendment.request",
    principal: guest,
    payload: { contractId: contract.contractId, changes: { dates: { checkIn: "2026-08-20", checkOut } } },
  }), () => new Date("2026-08-10T10:00:00Z"));

  // 20 August to 18 September is 29 nights; to 19 September is 30 nights.
  const extendedTo29 = request("2026-09-18");
  assert.equal(extendedTo29.status, "proposed", "a Short Stay extended to 29 nights is proposed");
  assert.equal(seen.at(-1), "29", "the quote is asked for the 29-night stay");
  manager.acceptAmendment(extendedTo29.amendmentId, guest, () => new Date("2026-08-10T10:00:00Z"));
  assert.equal(manager.getAmendment(extendedTo29.amendmentId)?.status, "accepted");

  assert.throws(() => request("2026-09-19"), /29 nights/, "a Short Stay extended to 30 nights is refused and names the 29-night maximum");
});

test("AC5: No literal `14` remains as a stay-length limit in domains/shortlet/src (the 14-day review window in verified-stay-review.ts and the cancellation thresholds are not stay-length limits)", async () => {
  const files = (await readdir(SRC_DIR)).filter((name) => name.endsWith(".ts"));
  const lengthComparison = /\b(?:nights|n|stayNights|nightCount)\s*(?:<=|<|>=|>|===|!==)\s*14\b/;
  const fourteenNightText = /\b14[- ]night|fourteen[- ]night|exceeds? 14 nights?\b/i;
  const offenders: string[] = [];
  for (const name of files) {
    const lines = (await readFile(join(SRC_DIR, name), "utf8")).split("\n");
    lines.forEach((line, index) => {
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/**")) return;
      if (lengthComparison.test(line) || fourteenNightText.test(line)) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "no stay-length literal 14 remains in code");
});

/** A minimal Short Stay contract for the amendment tests: 20 to 25 August 2026, five nights, one guest. */
function shortStayContract(): BookingContract {
  return {
    contractId: "ctr-29-1",
    reservationId: "res-29-1",
    offerId: "off-29-1",
    unitId: "unit-29-1",
    tenantId: "tenant-1",
    parties: { primaryGuest: { id: "guest-1", name: "Ada" }, operator: { id: "op-1" }, distinctPayer: null },
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 },
    occupants: [{ name: "Ada" }],
    quote: { allInStayTotalKobo: 50000, refundableSecurityDepositKobo: 0, currency: "NGN", cancellation: "captured" },
    totalAmountDueNowKobo: 50000,
    policies: { cancellationPolicy: { version: "v1" }, guestConductRules: ["No smoking"] },
    paymentDetails: { paymentMethod: "fresh_card", pspReference: "original", amountKobo: 50000, currency: "NGN", paidAt: "2026-08-01T00:00:00Z", cardMetadata: { brand: "Visa", last4: "1234" } },
    createdAt: "2026-08-01T00:00:00Z",
    contractVersion: 1,
    checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" },
    financialSummary: { originalBookingTotalKobo: 50000, currentContractTotalKobo: 50000, currency: "NGN", amendmentAdjustments: [] },
  } as unknown as BookingContract;
}
