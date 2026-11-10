import assert from "node:assert/strict";
import test from "node:test";
import { extendedFixture, extendedToReservation, contractOf, recordVerifiedAccess } from "./helpers/notice-chat-journey.js";
import { ExtendedStayExtensionManager, ExtensionRefusedError, type ExtensionRefusalCode } from "../domains/shortlet/src/extended-stay-extension.js";
import { ownerPeriodSettlementsFromQuote } from "../domains/shortlet/src/owner-payable.js";
import type { BookingContract } from "../domains/shortlet/src/card-payment.js";
import type { CommandPrincipal } from "../packages/platform-core/src/index.js";
import type { DatedFixture } from "./helpers/guest-date-fixtures.js";
import type { ContinuousOccupancyLedger } from "../domains/shortlet/src/continuous-occupancy.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0060, ADR 0023, ADR 0056, ADR 0057, ADR 0015, ADR 0041-0043). The domain
// extension manager, driven on a real confirmed Extended Stay from the chat journey. Each test names the criterion it checks.

const THREAD = "g-0ee1000100";
const CLOCK = new Date("2026-10-27T10:00:00Z");
/** The contract stays 31 nights (28 Oct to 28 Nov 2026); an extension to 8 Dec 2026 adds 10 nights (a shorter final period). */
const EXTEND_TO = "2026-12-08";
const WINDOW_MS = 30 * 60_000;

function operatorOf(contract: BookingContract): CommandPrincipal {
  return { id: contract.parties.operator.id, role: "operator", tenantId: contract.tenantId };
}

/** A confirmed Extended Stay on a clock the test controls, so the Operator Response Window can be passed. */
async function confirmedStay(clock: { now: Date }) {
  const f = extendedFixture([], () => clock.now);
  const { offerId } = await extendedToReservation(f, THREAD);
  return { f, offerId, contract: () => contractOf(f, offerId) };
}

function refusalCode(error: unknown): ExtensionRefusalCode | undefined {
  return error instanceof ExtensionRefusedError ? error.code : undefined;
}

/**
 * A manager over the same stay with one dependency replaced, to show a single guard in isolation. The contract is read from
 * the test's own copy; any mutation it attempts throws, so a guard that should refuse first is observed as the refusal.
 */
function managerWith(f: DatedFixture, clock: () => Date, current: BookingContract, overrides: Partial<ConstructorParameters<typeof ExtendedStayExtensionManager>[0]>): ExtendedStayExtensionManager {
  const env = f.environment;
  return new ExtendedStayExtensionManager({
    contracts: {
      getContract: () => current,
      mutateContract: () => { throw new Error("the guard must refuse before any mutation"); },
    },
    units: env.unitRepository,
    calendar: env.calendar,
    continuousOccupancy: env.bookingRequestApp.continuousOccupancy,
    extendedStayPolicy: { minimumNights: 30, maximumNights: 180, billingPeriodNights: 30 },
    clock,
    ...overrides,
  });
}

test("AC1: An extension request with available nights, operator approval and valid inspection and authority commits as a Booking Amendment that appends priced periods", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const guest = f.environment.guestPrincipal();
    const preview = f.environment.extensions.preview(before.contractId, guest, EXTEND_TO);
    assert.equal(preview.addedNights, 10, "the preview adds 10 nights");
    assert.equal(preview.addedPeriods.length, 1, "the added nights form one shorter period");
    assert.equal(preview.addedPeriods[0]!.nights, 10, "the shorter period is priced per night");

    const requested = f.environment.extensions.requestExtension(before.contractId, guest, { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    assert.equal(requested.status, "awaiting_operator");
    const approved = f.environment.extensions.approveExtension(before.contractId, operatorOf(before), requested.extensionId);
    assert.equal(approved.status, "approved");
    assert.ok(approved.amendmentId, "the approval records a Booking Amendment");

    const after = contract();
    assert.equal(after.dates.checkOut, EXTEND_TO, "the checkout moves to the new checkout");
    const priorPeriods = (before.quote as { billingPeriods: unknown[] }).billingPeriods.length;
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, priorPeriods + 1, "one Billing Period is appended");
    assert.deepEqual((after.quote as { billingPeriods: unknown[] }).billingPeriods.at(-1), preview.addedPeriods[0], "the appended period is the one quoted");
    assert.equal(preview.addedPeriods[0]!.index, priorPeriods + 1, "the appended period continues the contract numbering");
    assert.equal(after.contractVersion, before.contractVersion + 2, "the request and the approval are two versioned steps");
    assert.equal(after.totalAmountDueNowKobo, before.totalAmountDueNowKobo, "nothing is paid at approval (ADR 0092)");
  } finally {
    f.close();
  }
});

test("AC2: An extension that would exceed the Extended Stay maximum is rejected before quoting", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const current = contract();
    let quoted = false;
    const manager = managerWith(f, () => clock.now, current, { units: { findById: () => { quoted = true; return f.environment.unitRepository.findById(current.unitId); } } });
    // 28 Oct 2026 + 181 nights = 27 Apr 2027: one night over the 180-night Extended Stay maximum.
    const tooLong = "2027-04-27";
    let code: ExtensionRefusalCode | undefined;
    try { manager.preview(current.contractId, f.environment.guestPrincipal(), tooLong); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "TOO_LONG", "the refusal is the length check");
    assert.equal(quoted, false, "nothing is quoted for a stay over the maximum");
  } finally {
    f.close();
  }
});

test("AC3: An extension whose new checkout falls after inspection or authority expiry is rejected", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const current = contract();
    const unit = f.environment.unitRepository.findById(current.unitId)!;
    // An inspection that expires before the new checkout (8 Dec 2026) must refuse the extension.
    f.environment.unitRepository.save({ ...unit, inspection: { ...unit.inspection, expiresAt: "2026-11-30" } } as typeof unit);
    let code: ExtensionRefusalCode | undefined;
    try { f.environment.extensions.preview(current.contractId, f.environment.guestPrincipal(), EXTEND_TO); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "INSPECTION_NOT_VALID", "an expired inspection refuses the extension");
  } finally {
    f.close();
  }
});

test("AC4: If any night in the extension is unavailable, the extension is rejected and the original contract is unchanged", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const current = contract();
    const manager = managerWith(f, () => clock.now, current, { calendar: { getAuthoritativeAvailability: () => ({ isAvailable: false }) } });
    let code: ExtensionRefusalCode | undefined;
    try { manager.requestExtension(current.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: current.contractVersion }); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "UNAVAILABLE", "an unavailable night refuses the extension");
    assert.deepEqual(contract(), current, "the original contract is unchanged");
  } finally {
    f.close();
  }
});

test("AC5: Existing periods, their amounts and their payables are unchanged by an extension", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const guest = f.environment.guestPrincipal();
    const requested = f.environment.extensions.requestExtension(before.contractId, guest, { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    f.environment.extensions.approveExtension(before.contractId, operatorOf(before), requested.extensionId);
    const after = contract();
    const existingBefore = (before.quote as { billingPeriods: unknown[] }).billingPeriods;
    const existingAfter = (after.quote as { billingPeriods: unknown[] }).billingPeriods.slice(0, existingBefore.length);
    assert.deepEqual(existingAfter, existingBefore, "every existing Billing Period keeps its dates, amounts and nightly values");
    assert.deepEqual(
      ownerPeriodSettlementsFromQuote(after.quote)?.slice(0, existingBefore.length),
      ownerPeriodSettlementsFromQuote(before.quote),
      "every existing Period Owner Payable is unchanged",
    );
    assert.equal(ownerPeriodSettlementsFromQuote(after.quote)?.length, existingBefore.length + 1, "the added period has its own payable");
  } finally {
    f.close();
  }
});

test("AC6: An extension that would make the Continuous Occupancy chain longer than 180 nights is refused", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const current = contract();
    // A counted stay of 160 nights in the same unit ends on the contract's check-in: the chain with this stay is 160 + 31 nights,
    // and the 10-night extension makes it 201 nights.
    const ledger = {
      propertyIdFor: () => "property-1",
      countedStays: () => [{ ref: "prior", unitId: current.unitId, propertyId: "property-1", checkIn: "2026-05-21", checkOut: current.dates.checkIn, nights: 160, stayType: "extended" }],
    } as unknown as ContinuousOccupancyLedger;
    const manager = managerWith(f, () => clock.now, current, { continuousOccupancy: ledger });
    let thrown: unknown;
    try { manager.requestExtension(current.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: current.contractVersion }); } catch (error) { thrown = error; }
    assert.ok(thrown instanceof Error, "the extension is refused");
    assert.match(String(thrown.message), /180|Continuous|continuous|occupancy|chain/i, "the refusal names the Continuous Occupancy limit");
    assert.deepEqual(contract(), current, "the contract is unchanged");
  } finally {
    f.close();
  }
});

test("Operator approves: the Billing Periods are appended", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const requested = f.environment.extensions.requestExtension(before.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    f.environment.extensions.approveExtension(before.contractId, operatorOf(before), requested.extensionId);
    assert.equal((contract().quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length + 1);
  } finally {
    f.close();
  }
});

test("Operator declines: nothing changes except the recorded decision", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const requested = f.environment.extensions.requestExtension(before.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    const declined = f.environment.extensions.declineExtension(before.contractId, operatorOf(before), requested.extensionId);
    assert.equal(declined.status, "declined");
    const after = contract();
    assert.equal(after.dates.checkOut, before.dates.checkOut, "the checkout is unchanged");
    assert.deepEqual((after.quote as { billingPeriods: unknown[] }).billingPeriods, (before.quote as { billingPeriods: unknown[] }).billingPeriods, "the periods are unchanged");
    assert.equal(after.extensionRequest?.status, "declined");
  } finally {
    f.close();
  }
});

test("No Operator reply within the response window: the request expires, and the stay is unchanged", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const requested = f.environment.extensions.requestExtension(before.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    clock.now = new Date(CLOCK.getTime() + WINDOW_MS);
    assert.equal(f.environment.extensions.statusOf(before.contractId)?.status, "expired", "the status reads expired at the clock");
    let code: ExtensionRefusalCode | undefined;
    try { f.environment.extensions.approveExtension(before.contractId, operatorOf(before), requested.extensionId); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "EXPIRED", "a late approval is refused");
    const after = contract();
    assert.equal(after.dates.checkOut, before.dates.checkOut, "the checkout is unchanged");
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length, "no period is appended");
  } finally {
    f.close();
  }
});

test("A non-operator principal cannot approve an extension", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const before = contract();
    const guest = f.environment.guestPrincipal();
    const requested = f.environment.extensions.requestExtension(before.contractId, guest, { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
    let code: ExtensionRefusalCode | undefined;
    try { f.environment.extensions.approveExtension(before.contractId, guest, requested.extensionId); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "NOT_OPERATOR", "the guest cannot approve their own extension");
    let staffCode: ExtensionRefusalCode | undefined;
    try { f.environment.extensions.approveExtension(before.contractId, { id: "staff-1", role: "authorized_staff", tenantId: before.tenantId }, requested.extensionId); } catch (error) { staffCode = refusalCode(error); }
    assert.equal(staffCode, "NOT_OPERATOR", "staff are not the Operator for this decision");
    assert.equal(contract().dates.checkOut, before.dates.checkOut, "the stay is unchanged");
  } finally {
    f.close();
  }
});

test("A Short Stay cannot be extended to 30 nights or more", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    // The Extended Stay fixture is the only confirmed contract here; a Short Stay contract is refused by its quote type.
    const current = contract();
    const shortQuote = { ...(current.quote as Record<string, unknown>), stayType: "short" };
    const manager = managerWith(f, () => clock.now, { ...current, quote: shortQuote }, {});
    let code: ExtensionRefusalCode | undefined;
    try { manager.preview(current.contractId, f.environment.guestPrincipal(), EXTEND_TO); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "NOT_EXTENDED", "a Short Stay is not extended");
  } finally {
    f.close();
  }
});

test("An extension is refused while a Notice to End is in force, and a notice is refused while an extension is pending", async () => {
  const clock = { now: CLOCK };
  const { f, contract } = await confirmedStay(clock);
  try {
    const current = contract();
    recordVerifiedAccess(f, current.reservationId);
    // A pending extension refuses the notice.
    const pendingRequest = f.environment.extensions.requestExtension(current.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: current.contractVersion });
    let noticeError: unknown;
    try { f.environment.noticeToEnd.giveNotice(current.contractId, f.environment.guestPrincipal()); } catch (error) { noticeError = error; }
    assert.ok(noticeError instanceof Error && /extension/i.test(noticeError.message), "a notice is refused while the extension awaits the Operator");
    f.environment.extensions.declineExtension(current.contractId, operatorOf(current), pendingRequest.extensionId);
    // A notice in force refuses the extension.
    f.environment.noticeToEnd.giveNotice(current.contractId, f.environment.guestPrincipal());
    let code: ExtensionRefusalCode | undefined;
    try { f.environment.extensions.preview(current.contractId, f.environment.guestPrincipal(), EXTEND_TO); } catch (error) { code = refusalCode(error); }
    assert.equal(code, "NOTICE_IN_FORCE", "an extension is refused while a Notice to End is in force");
  } finally {
    f.close();
  }
});
