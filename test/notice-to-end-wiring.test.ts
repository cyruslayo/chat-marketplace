import assert from "node:assert/strict";
import test from "node:test";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION, type GuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import { SqliteCheckInSupportStore, type CheckInSupportState } from "../domains/shortlet/src/checkin-support.js";
import { EXTENDED_STAY_POLICY, NoticeToEndManager, recordedNoticeRefundPort } from "../domains/shortlet/src/index.js";
import { DEMO_OPERATOR_ACTOR_ID } from "../apps/local-owner/src/demo-operator-acceptance.js";
import type { BookingContract } from "../domains/shortlet/src/card-payment.js";
import { addDays, extendUnit, withDemoExtendedJourney, type DemoJourneyContext } from "./helpers/demo-extended-journey.js";
import { cookieOf, locationOf, sendGuest } from "./helpers/guest-route-harness.js";
import type { Unit } from "../domains/shortlet/src/browse.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";
import { SqliteBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import { demoDatabase, removeDemoDatabase } from "./helpers/demo-mode-fixture.js";

// Monthly-stays issue 17 (ADR 0092 amended, ADR 0060, ADR 0106, ADR 0077/0080, ADR 0089). Notice to End is reachable from
// the guest's confirmed Extended Stay through the real guest HTTP handler, and recorded as a versioned Booking Amendment.
// Synthetic data only; the Paystack TEST provider is stubbed by the demo journey helper.

const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
/** Inside period 1 and after Verified Access. The notice date is 10 Sep (WAT), so the new last night is 23 Sep. */
const PERIOD_1_STARTED = `${CHECK_IN}T10:00:00.000Z`;
const NEW_LAST_NIGHT = addDays(CHECK_IN, 13);

function unitWithTerms(): (seeded: Unit) => Unit {
  return (seeded) => extendUnit(seeded, { claimsThrough: CHECK_OUT });
}

function systemPrincipal(context: DemoJourneyContext) {
  return { id: "synthetic-system", role: "system" as const, tenantId: context.guest.config.tenantId };
}

function handlerFor(context: DemoJourneyContext): GuestRequestHandler {
  return createGuestRequestHandler({
    environment: context.guest,
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    assets: { text: () => "/* stub */" },
    landingBinaryAssets: { read: () => new Uint8Array([1]) },
  });
}

/** Records Verified Access for the Reservation in the shared check-in store (the owner and guest share one database). */
function recordVerifiedAccess(context: DemoJourneyContext, reservationId: string): void {
  const database = openNodeSqliteDatabase(context.databasePath);
  const store = new SqliteCheckInSupportStore(database);
  const state: CheckInSupportState = {
    schedule: null,
    window: null,
    evidence: [],
    result: { reservationId, status: "verified_access", verifiedAt: PERIOD_1_STARTED, protectionWindowStartsAt: PERIOD_1_STARTED },
    complaints: [],
  };
  try {
    store.save(reservationId, state);
  } finally {
    database.close();
  }
}

/** A confirmed Extended Stay with Verified Access, the clock inside period 1, and a guest cookie from the home page. */
async function withNoticeStay(run: (context: DemoJourneyContext & { readonly handler: GuestRequestHandler; readonly cookie: string }) => Promise<void> | void): Promise<void> {
  await withDemoExtendedJourney({ unit: unitWithTerms(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context) => {
    const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    const confirmed = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, systemPrincipal(context));
    assert.equal(confirmed.outcome, "confirmed");
    context.setClock(PERIOD_1_STARTED);
    recordVerifiedAccess(context, contractOf(context).reservationId);
    const handler = handlerFor(context);
    const home = await sendGuest(handler, "GET", "/");
    await run({ ...context, handler, cookie: cookieOf(home) });
  });
}

function contractOf(context: DemoJourneyContext): BookingContract {
  return context.guest.cardPaymentApp.getBookingContract(context.offerId)!;
}

function noticePath(offerId: string): string {
  return `/bookings/notice/${encodeURIComponent(offerId)}`;
}

test("AC1: Every composition constructs the Notice to End manager, and a verified Extended Stay gives notice through the guest composition", async () => {
  await withNoticeStay(async (context) => {
    assert.ok(context.guest.noticeToEnd, "the guest composition constructs NoticeToEndManager");
    assert.ok(context.owner.noticeToEnd, "the owner composition constructs NoticeToEndManager");
    const guest = context.guest.guestPrincipal();
    const preview = context.guest.noticeToEnd.previewNotice(contractOf(context).contractId, guest);
    assert.equal(preview.newLastNight, NEW_LAST_NIGHT, "the policy-backed preview is computed, not refused for a missing policy");
    const result = context.guest.noticeToEnd.giveNotice(contractOf(context).contractId, guest);
    assert.equal(result.newVersion, result.previousVersion + 1, "the notice commits one versioned amendment");
  });
});

test("AC2: After Verified Access the confirmation page shows the new last night, refund and amount owed from the domain", async () => {
  await withNoticeStay(async (context) => {
    const response = await sendGuest(context.handler, "GET", noticePath(context.offerId), { cookie: context.cookie });
    assert.equal(response.statusCode, 200, "the confirmed Extended Stay shows the Give notice confirmation step");
    const html = response.bodyText;
    assert.match(html, /End your stay early/, "the confirmation heading is shown");
    assert.match(html, />Give notice<\/button>/, "the confirm action is shown on the step");
    const schedule = await sendGuest(context.handler, "GET", `/bookings/periods/${encodeURIComponent(context.offerId)}`, { cookie: context.cookie });
    assert.match(schedule.bodyText, /Give notice to end your stay/, "the action is offered on the confirmed Extended Stay's schedule after Verified Access");
    assert.match(html, new RegExp(`data-new-last-night="${NEW_LAST_NIGHT}"`), "the new last night is the domain's");
    const period = contractOf(context).quote as { billingPeriods: { nightlyContractedValuesKobo: number[] }[] };
    const refund = period.billingPeriods[0]!.nightlyContractedValuesKobo.slice(14).reduce((sum, value) => sum + value, 0);
    assert.match(html, new RegExp(`data-refund-kobo="${refund}"`), "the refund for the paid nights after the new last night is the domain's");
    assert.match(html, /data-owed-kobo="0"/, "no unpaid night is owed up to the new last night");
    assert.match(html, /Keep my stay/, "the back action is shown");
  });
});

test("AC2: Before Verified Access the action is not shown, and a Short Stay refuses it", async () => {
  await withDemoExtendedJourney({ unit: unitWithTerms(), checkIn: CHECK_IN, checkOut: CHECK_OUT }, async (context) => {
    const session = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    await context.guest.cardPaymentApp.verifyAndConfirmPaystack(session.pspReference, systemPrincipal(context));
    context.setClock(PERIOD_1_STARTED);
    const home = await sendGuest(handlerFor(context), "GET", "/");
    const response = await sendGuest(handlerFor(context), "GET", noticePath(context.offerId), { cookie: cookieOf(home) });
    assert.notEqual(response.statusCode, 200, "no confirmation step before Verified Access");
    assert.doesNotMatch(response.bodyText, /Give notice to end your stay/, "the action is not shown before Verified Access");
  });
});

test("AC2: a Short Stay has no Notice to End: the domain refuses a Short Stay contract", async () => {
  await withNoticeStay(async (context) => {
    const contract = contractOf(context);
    const shortContract = { ...contract, quote: { ...(contract.quote as object), stayType: "short" } } as unknown as BookingContract;
    const manager = new NoticeToEndManager({
      contracts: { getContract: () => shortContract, mutateContract: () => { throw new Error("a refused notice must not commit"); } },
      periods: { projectBillingPeriods: () => [], paymentsFor: () => [] },
      owners: context.owner.ownerPayableLedger,
      arrival: { hasVerifiedAccess: () => true },
      failures: { hasOpenFailure: () => false },
      refunds: recordedNoticeRefundPort(),
      extendedStayPolicy: EXTENDED_STAY_POLICY,
      clock: context.clock,
    });
    assert.throws(() => manager.previewNotice(contract.contractId, context.guest.guestPrincipal()), /Extended Stays/, "a Short Stay is refused by the domain");
  });
});

test("AC2: a Short Stay shows no Notice to End step, even after its Verified Access is recorded", async () => {
  await withDemoExtendedJourney({ unit: unitWithTerms(), checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 5) }, async (context) => {
    context.setClock(PERIOD_1_STARTED);
    const home = await sendGuest(handlerFor(context), "GET", "/");
    const response = await sendGuest(handlerFor(context), "GET", noticePath(context.offerId), { cookie: cookieOf(home) });
    assert.notEqual(response.statusCode, 200, "no notice step for a Short Stay");
    assert.doesNotMatch(response.bodyText, /data-notice-step/, "the confirmation step is not rendered");
  });
});

test("AC3: Going back changes nothing, and confirming commits one versioned Booking Amendment that moves the last night and the owner payables", async () => {
  await withNoticeStay(async (context) => {
    const before = contractOf(context);
    // Going back: the guest only reads the confirmation step.
    await sendGuest(context.handler, "GET", noticePath(context.offerId), { cookie: context.cookie });
    assert.equal(contractOf(context).contractVersion, before.contractVersion, "reading the step changes nothing");
    assert.equal(contractOf(context).dates.checkOut, CHECK_OUT, "the checkout is unchanged before confirmation");

    const page = await sendGuest(context.handler, "GET", noticePath(context.offerId), { cookie: context.cookie });
    const noticeDate = /data-notice-date="([^"]+)"/.exec(page.bodyText)?.[1];
    assert.ok(noticeDate, "the confirmation form carries the notice date it showed");
    const confirmed = await sendGuest(context.handler, "POST", noticePath(context.offerId), {
      cookie: context.cookie,
      form: { noticeDate, contractVersion: String(before.contractVersion) },
    });
    assert.equal(confirmed.statusCode, 303, "confirming redirects back to the booking");
    assert.equal(locationOf(confirmed), noticePath(context.offerId), "the redirect returns to the notice page");

    const after = contractOf(context);
    assert.equal(after.contractVersion, before.contractVersion + 1, "one versioned amendment");
    assert.equal(after.dates.checkOut, addDays(NEW_LAST_NIGHT, 1), "the new checkout follows the new last night");
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, 6, "the Billing Periods are kept on the quote");
    const adjustments = context.owner.ownerPayableLedger.listPeriodNoticeAdjustments(before.reservationId);
    assert.ok(adjustments.some((entry) => entry.periodIndex === 1 && entry.reductionKobo > 0), "the owner payable for period 1 falls by the owner's share of the refunded nights");
  });
});

test("AC4: a forged, stale or superseded confirmation is refused and nothing changes", async () => {
  await withNoticeStay(async (context) => {
    const before = contractOf(context);
    const stale = await sendGuest(context.handler, "POST", noticePath(context.offerId), {
      cookie: context.cookie,
      form: { noticeDate: "2026-09-01", contractVersion: String(before.contractVersion) },
    });
    assert.notEqual(stale.statusCode, 303, "a confirmation for a different notice date is refused");
    assert.equal(contractOf(context).contractVersion, before.contractVersion, "a refused confirmation changes nothing");

    const wrongVersion = await sendGuest(context.handler, "POST", noticePath(context.offerId), {
      cookie: context.cookie,
      form: { noticeDate: "2026-09-10", contractVersion: String(before.contractVersion + 5) },
    });
    assert.notEqual(wrongVersion.statusCode, 303, "a superseded contract version is refused");

    const forgedOffer = await sendGuest(context.handler, "POST", noticePath("offer-forged-id"), {
      cookie: context.cookie,
      form: { noticeDate: "2026-09-10", contractVersion: String(before.contractVersion) },
    });
    assert.notEqual(forgedOffer.statusCode, 303, "an unknown offer id is refused");
    assert.equal(contractOf(context).contractVersion, before.contractVersion, "nothing changed");
  });
});

test("AC6: The back office shows the notice (date given, new last night, refund due, owed) and the reduced owner payable", async () => {
  await withNoticeStay(async (context) => {
    const result = context.guest.noticeToEnd.giveNotice(contractOf(context).contractId, context.guest.guestPrincipal());
    const operator = { id: DEMO_OPERATOR_ACTOR_ID, role: "operator" as const, tenantId: context.owner.config.tenantId };
    const payable = context.owner.ownerPayable(context.requestId, operator);
    assert.ok(payable.notice, "the back office booking view carries the notice");
    assert.equal(payable.notice?.noticeDate, result.noticeDate, "the date given is shown");
    assert.equal(payable.notice?.newLastNight, NEW_LAST_NIGHT, "the new last night is shown");
    assert.equal(payable.notice?.refundKobo, result.refunds.reduce((sum, entry) => sum + entry.amountKobo, 0), "the refund due is shown");
    assert.equal(payable.notice?.owedKobo, result.owedKobo, "the amount owed is shown");
    const period = payable.periods?.find((entry) => entry.periodIndex === 1);
    assert.equal(period?.ownerPayableKobo, result.ownerAdjustments[0]?.ownerPayableKobo, "the reduced owner payable for period 1 is shown");
  });
});

test("AC1 non-demo: a production composition with demo off records a Notice to End for a confirmed Extended Stay", () => {
  const files = demoDatabase();
  const clock = () => new Date(PERIOD_1_STARTED);
  const guest = LocalGuestEnvironment.openNode({ databasePath: files.path, demo: false, deployment: "production", clock });
  try {
    assert.equal(guest.config.demo === true, false, "the composition is not the demo");
    const unit = extendUnit(guest.unitRepository.findAll()[0]!, { claimsThrough: CHECK_OUT });
    guest.unitRepository.save(unit);
    const quote = createStayQuote({ unit, checkIn: CHECK_IN, checkOut: CHECK_OUT, clock, extendedStayPolicy: EXTENDED_STAY_POLICY });
    const first = quote.billingPeriods![0]!;
    const contract = {
      contractId: "contract-production-notice",
      contractVersion: 1,
      reservationId: "reservation-production-notice",
      offerId: "offer-production-notice",
      tenantId: guest.config.tenantId,
      unitId: unit.id,
      parties: { primaryGuest: { id: guest.config.guestId, name: guest.config.guestName } },
      dates: { checkIn: CHECK_IN, checkOut: CHECK_OUT, nights: 180 },
      quote,
      paymentDetails: { paymentMethod: "fresh_card", pspReference: "psp-ref-production-notice", amountKobo: first.amountKobo, currency: "NGN", paidAt: PERIOD_1_STARTED },
    } as unknown as BookingContract;
    const database = openNodeSqliteDatabase(files.path);
    try {
      new SqliteBookingStateRepository(database).saveContract(contract);
      new SqliteCheckInSupportStore(database).save(contract.reservationId, {
        schedule: null,
        window: null,
        evidence: [],
        result: { reservationId: contract.reservationId, status: "verified_access", verifiedAt: PERIOD_1_STARTED, protectionWindowStartsAt: PERIOD_1_STARTED },
        complaints: [],
      });
    } finally {
      database.close();
    }
    const result = guest.noticeToEnd.giveNotice(contract.contractId, guest.guestPrincipal());
    assert.equal(result.newVersion, 2, "the production notice commits one versioned amendment");
    assert.equal(result.newLastNight, NEW_LAST_NIGHT, "the production notice uses the same domain calculation");
  } finally {
    guest.close();
    removeDemoDatabase(files.dir);
  }
});
