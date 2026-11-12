import assert from "node:assert/strict";
import test from "node:test";
import { SqliteBookingStateRepository, type BookingContract } from "../domains/shortlet/src/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { EXTENSION_OPEN_EVENT } from "../apps/web-agent/src/booking-contract-a2ui.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { buttonNamed, contractOf, extendedFixture } from "./helpers/notice-chat-journey.js";
import { bookedExtendedStayOverHttp, ok } from "./helpers/warm-http-journey.js";
import { operatorPost, signInOperator, startOperatorServer, type OperatorServer } from "./helpers/operator-session.js";
import type { DatedFixture } from "./helpers/guest-date-fixtures.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0082): the Operator decides a REAL pending extension over the owner's HTTP routes.
// The stay is booked and paid over the guest routes, the extension is requested over the guest routes, and the Operator then approves
// or declines over the owner routes. Both servers read one SQLite store, as the chat fixture and the back office do.

const CLOCK = new Date("2026-10-27T10:00:00Z");
const THREAD_APPROVE = "g-0ee2000701";
const THREAD_DECLINE = "g-0ee2000801";

/** The stored contract, read from the shared store (the guest's contract cache is not the source of truth for the Operator). */
function storedContract(f: DatedFixture, contractId: string): BookingContract {
  const database = openNodeSqliteDatabase(f.databasePath!);
  try {
    const stored = new SqliteBookingStateRepository(database).findContractById(contractId);
    assert.ok(stored, "the contract is stored");
    return stored;
  } finally {
    database.close();
  }
}

/** Books and pays an Extended Stay over the guest routes, then requests an extension over the same routes. Returns the contract id. */
async function requestExtensionOverGuestRoutes(f: DatedFixture, threadId: string): Promise<{ readonly contractId: string; readonly unitId: string }> {
  const { session, booking, offerId } = await bookedExtendedStayOverHttp(f, threadId);
  try {
    const opened = ok(await session.post("/api/event", { name: EXTENSION_OPEN_EVENT, surfaceId: booking.surfaceId, context: { surfaceId: booking.surfaceId } }), "Extend your stay");
    const card = opened.surfaces.find((surface) => surface.surfaceId.includes(":pending-action:"));
    assert.ok(card, "the extension card opens from the booking");
    const action = buttonNamed(card, ASSISTANT_CONFIRM_ACTION_EVENT);
    ok(await session.post("/api/event", { name: action.name, surfaceId: action.surfaceId, context: action.context }), "Request extension");
  } finally {
    session.close();
  }
  const before = contractOf(f, offerId);
  assert.equal(storedContract(f, before.contractId).extensionRequest?.status, "awaiting_operator", "the request awaits the Operator");
  return { contractId: before.contractId, unitId: before.unitId };
}

/** The owner back office over the same store, with the stay's unit visible to the Operator (as in extension-owner-inbox.test.ts). */
async function operatorServerFor(f: DatedFixture, clock: { now: Date }, unitId: string): Promise<OperatorServer> {
  const owner = await startOperatorServer({ databasePath: f.databasePath!, clock: () => clock.now });
  owner.environment.unitRepository.save(f.environment.unitRepository.findById(unitId)!);
  return owner;
}

test("An Operator approves a real pending extension over the owner HTTP routes: the Billing Periods are appended", async () => {
  const clock = { now: CLOCK };
  const f = extendedFixture([], () => clock.now);
  let owner: OperatorServer | undefined;
  try {
    const { contractId, unitId } = await requestExtensionOverGuestRoutes(f, THREAD_APPROVE);
    owner = await operatorServerFor(f, clock, unitId);
    const cookie = await signInOperator(owner);
    const session = { base: owner.base, cookie };
    const principal = { id: owner.environment.config.representativePersonId, role: "operator" as const, tenantId: owner.environment.config.tenantId };

    const pending = owner.environment.listExtensionRequests(principal);
    assert.equal(pending.length, 1, "the Operator's inbox lists the one pending request");
    const request = pending[0]!.request;
    const inbox = await (await fetch(`${session.base}/operator/requests`, { headers: { cookie } })).text();
    assert.ok(inbox.includes(`data-extension-id="${request.extensionId}"`), "the inbox renders the extension with its decision forms");

    const before = storedContract(f, contractId);
    const approved = await operatorPost(session, `/operator/extensions/${contractId}/${request.extensionId}/approve`);
    assert.equal(approved.status, 303, "the approval is accepted");
    const after = storedContract(f, contractId);
    assert.equal(after.dates.checkOut, request.newCheckOut, "the new checkout is in force");
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length + 1, "one Billing Period is appended");
    assert.equal(owner.environment.listExtensionRequests(principal).length, 0, "an approved request leaves the inbox");
  } finally {
    if (owner) await owner.close();
    f.close();
  }
});

test("An Operator declines a real pending extension over the owner HTTP routes: nothing changes except the recorded decision", async () => {
  const clock = { now: CLOCK };
  const f = extendedFixture([], () => clock.now);
  let owner: OperatorServer | undefined;
  try {
    const { contractId, unitId } = await requestExtensionOverGuestRoutes(f, THREAD_DECLINE);
    owner = await operatorServerFor(f, clock, unitId);
    const cookie = await signInOperator(owner);
    const session = { base: owner.base, cookie };
    const principal = { id: owner.environment.config.representativePersonId, role: "operator" as const, tenantId: owner.environment.config.tenantId };

    const pending = owner.environment.listExtensionRequests(principal);
    assert.equal(pending.length, 1, "the Operator's inbox lists the one pending request");
    const request = pending[0]!.request;

    const before = storedContract(f, contractId);
    const declined = await operatorPost(session, `/operator/extensions/${contractId}/${request.extensionId}/decline`);
    assert.equal(declined.status, 303, "the decline is accepted");
    const after = storedContract(f, contractId);
    assert.equal(after.dates.checkOut, before.dates.checkOut, "the checkout is unchanged");
    assert.equal((after.quote as { billingPeriods: unknown[] }).billingPeriods.length, (before.quote as { billingPeriods: unknown[] }).billingPeriods.length, "no Billing Period is appended");
    assert.equal(after.extensionRequest?.status, "declined", "the decision is recorded");
    assert.equal(owner.environment.listExtensionRequests(principal).length, 0, "a declined request leaves the inbox");
  } finally {
    if (owner) await owner.close();
    f.close();
  }
});
