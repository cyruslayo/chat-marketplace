import assert from "node:assert/strict";
import test from "node:test";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { ExtensionRefusedError, type BookingContract } from "../domains/shortlet/src/index.js";
import { extendedFixture, extendedToReservation, contractOf } from "./helpers/notice-chat-journey.js";
import type { DatedFixture } from "./helpers/guest-date-fixtures.js";
import { SqliteBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0041-0043): the Operator decides an extension in the back office. The owner
// environment reads the same store as the guest chat fixture, so the request the guest sent is the one the Operator sees.

const THREAD = "g-0ee1000901";
const CLOCK = new Date("2026-10-27T10:00:00Z");
const EXTEND_TO = "2026-12-08";
const WINDOW_MS = 30 * 60_000;

/** The back-office principal is the representative who holds the grant for the contract's Operator (ADR 0082). */
function operatorOf(owner: LocalApartmentOwnerEnvironment) {
  return { id: owner.config.representativePersonId, role: "operator" as const, tenantId: owner.config.tenantId };
}

async function requestedStay(clock: { now: Date }): Promise<{ f: DatedFixture; owner: LocalApartmentOwnerEnvironment; contract: () => BookingContract }> {
  const f = extendedFixture([], () => clock.now);
  const { offerId } = await extendedToReservation(f, THREAD);
  const before = contractOf(f, offerId);
  f.environment.extensions.requestExtension(before.contractId, f.environment.guestPrincipal(), { newCheckOut: EXTEND_TO, contractVersion: before.contractVersion });
  const owner = LocalApartmentOwnerEnvironment.openNode({ databasePath: f.databasePath!, clock: () => clock.now });
  // The unit repository is per environment in tests: the Operator's view carries the same Extended Stay terms as the guest's.
  const unit = f.environment.unitRepository.findById(before.unitId)!;
  owner.unitRepository.save(unit);
  // The store is the source of truth both environments read; the guest's contract cache is not, so the stored contract is read directly.
  const contract = () => {
    const database = openNodeSqliteDatabase(f.databasePath!);
    try {
      const stored = new SqliteBookingStateRepository(database).findContractById(before.contractId);
      if (!stored) throw new Error("the contract is stored");
      return stored;
    } finally {
      database.close();
    }
  };
  return { f, owner, contract };
}

test("The Operator's inbox lists the extension request awaiting a decision", async () => {
  const clock = { now: CLOCK };
  const { f, owner, contract } = await requestedStay(clock);
  try {
    const listed = owner.listExtensionRequests(operatorOf(owner));
    assert.equal(listed.length, 1, "one extension request awaits the Operator");
    assert.equal(listed[0]!.request.newCheckOut, EXTEND_TO);
    assert.equal(listed[0]!.status, "awaiting_operator");
  } finally {
    f.close();
  }
});

test("Operator approves in the back office: the Billing Periods are appended", async () => {
  const clock = { now: CLOCK };
  const { f, owner, contract } = await requestedStay(clock);
  try {
    const before = contract();
    const request = owner.listExtensionRequests(operatorOf(owner))[0]!.request;
    owner.approveExtensionRequest(before.contractId, operatorOf(owner), request.extensionId);
    const after = contract();
    assert.equal(after.dates.checkOut, EXTEND_TO);
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length + 1);
    assert.equal(owner.listExtensionRequests(operatorOf(owner)).length, 0, "an approved request leaves the inbox");
  } finally {
    f.close();
  }
});

test("Operator declines in the back office: nothing changes except the recorded decision", async () => {
  const clock = { now: CLOCK };
  const { f, owner, contract } = await requestedStay(clock);
  try {
    const before = contract();
    const request = owner.listExtensionRequests(operatorOf(owner))[0]!.request;
    owner.declineExtensionRequest(before.contractId, operatorOf(owner), request.extensionId);
    const after = contract();
    assert.equal(after.dates.checkOut, before.dates.checkOut, "the checkout is unchanged");
    assert.equal(after.extensionRequest?.status, "declined");
    assert.equal(owner.listExtensionRequests(operatorOf(owner)).length, 0, "a declined request leaves the inbox");
  } finally {
    f.close();
  }
});

test("No Operator reply within the response window: the request expires and the stay is unchanged", async () => {
  const clock = { now: CLOCK };
  const { f, owner, contract } = await requestedStay(clock);
  try {
    const before = contract();
    const request = owner.listExtensionRequests(operatorOf(owner))[0]!.request;
    clock.now = new Date(CLOCK.getTime() + WINDOW_MS);
    assert.equal(owner.listExtensionRequests(operatorOf(owner)).length, 0, "an expired request is not awaiting a decision");
    let code: string | undefined;
    try { owner.approveExtensionRequest(before.contractId, operatorOf(owner), request.extensionId); } catch (error) { code = error instanceof ExtensionRefusedError ? error.code : undefined; }
    assert.equal(code, "EXPIRED", "a late approval is refused");
    const after = contract();
    assert.equal(after.dates.checkOut, before.dates.checkOut, "the checkout is unchanged");
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length, "no period is appended");
  } finally {
    f.close();
  }
});

test("A non-operator principal cannot approve an extension in the back office", async () => {
  const clock = { now: CLOCK };
  const { f, owner, contract } = await requestedStay(clock);
  try {
    const before = contract();
    const request = owner.listExtensionRequests(operatorOf(owner))[0]!.request;
    let code: string | undefined;
    try { owner.approveExtensionRequest(before.contractId, f.environment.guestPrincipal(), request.extensionId); } catch (error) { code = error instanceof ExtensionRefusedError ? error.code : undefined; }
    assert.equal(code, "NOT_OPERATOR", "the guest cannot approve");
    assert.equal(contract().dates.checkOut, before.dates.checkOut, "the stay is unchanged");
    assert.equal(owner.listExtensionRequests(operatorOf(owner)).length, 1, "the request still awaits the Operator");
  } finally {
    f.close();
  }
});
