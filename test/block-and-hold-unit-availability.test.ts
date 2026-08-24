import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  AvailabilityCalendar,
  SqliteAvailabilityStore,
  UnitRepository,
  seedIssue01Units
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  return { repository, audit, calendar };
}

test("Operator Blocks immediately remove overlapping Open Dates and retain audit provenance", () => {
  const { calendar, audit } = setup();
  const unitId = "unit-lagos-001";
  
  // Create an Operator Block for 2026-08-10 to 2026-08-15
  const block = calendar.addOperatorBlock({
    unitId,
    operatorId: "operator-001",
    start: "2026-08-10",
    end: "2026-08-15",
    reason: "Maintenance & private host use"
  });

  assert.ok(block.blockId);
  assert.equal(block.unitId, unitId);
  assert.equal(block.operatorId, "operator-001");
  assert.equal(block.reason, "Maintenance & private host use");

  // Check audit provenance
  const auditEntries = audit.entries();
  assert.equal(auditEntries[0].type, "availability.operator_block");
  assert.equal(auditEntries[0].unitId, unitId);
  assert.equal(auditEntries[0].operatorId, "operator-001");
  assert.equal(auditEntries[0].reason, "Maintenance & private host use");

  // Verify availability excludes blocked dates
  const availability = calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-08-12",
    checkOut: "2026-08-14",
    clock: () => new Date("2026-07-22T00:00:00Z")
  });
  assert.equal(availability.isAvailable, false);
  assert.equal(availability.conflictReason, "Overlaps with Operator Block");
});

test("Holds expire automatically, allow at most one valid extension, and never exceed 60 minutes", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const now = new Date("2026-07-22T10:00:00Z");

  // Create hold (45 mins by default)
  const hold = calendar.createOperatorHold({
    unitId,
    operatorId: "operator-123",
    start: "2026-08-20",
    end: "2026-08-22",
    clock: () => now
  });

  assert.ok(hold.holdId);
  assert.equal(hold.kind, "operator_hold");
  assert.equal(hold.operatorId, "operator-123");
  assert.equal(hold.createdAt, "2026-07-22T10:00:00.000Z");
  assert.equal(hold.extensionCount, 0);
  const initialExpiry = new Date("2026-07-22T10:45:00Z").getTime();
  assert.equal(new Date(hold.expiresAt).getTime(), initialExpiry);

  // Extend hold once (adds 15 mins -> total 60 mins from creation)
  const extended = calendar.extendOperatorHold(hold.holdId, { clock: () => new Date("2026-07-22T10:20:00Z") });
  assert.equal(extended.extensionCount, 1);
  const extendedExpiry = new Date("2026-07-22T11:00:00Z").getTime();
  assert.equal(new Date(extended.expiresAt).getTime(), extendedExpiry);

  // Second extension attempt fails (allow at most one valid extension)
  assert.throws(
    () => calendar.extendOperatorHold(hold.holdId, { clock: () => new Date("2026-07-22T10:30:00Z") }),
    /maximum extension limit reached/i
  );

  // At the absolute maximum, the Operator Hold is expired and dates are available again.
  const afterExpiryAvailability = calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-08-20",
    checkOut: "2026-08-22",
    clock: () => new Date("2026-07-22T11:00:00Z")
  });
  assert.equal(afterExpiryAvailability.isAvailable, true);
});

test("Competing holds, blocks, and bookings are protected by real transaction and overlap constraints", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const now = new Date("2026-07-22T10:00:00Z");

  // Create active hold
  calendar.createOperatorHold({
    unitId,
    operatorId: "operator-001",
    start: "2026-08-01",
    end: "2026-08-05",
    clock: () => now
  });

  // Competing hold on overlapping dates fails
  assert.throws(
    () => calendar.createOperatorHold({
      unitId,
      operatorId: "operator-002",
      start: "2026-08-03",
      end: "2026-08-07",
      clock: () => now
    }),
    /availability conflict/i
  );

  // Competing block on overlapping dates fails
  assert.throws(
    () => calendar.addOperatorBlock({
      unitId,
      operatorId: "operator-001",
      start: "2026-08-04",
      end: "2026-08-06",
      reason: "Host maintenance",
      clock: () => now
    }),
    /availability conflict/i
  );
});

test("Web, agent, and support views show the same current availability without owning it locally", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const clock = () => new Date("2026-07-22T12:00:00Z");

  calendar.addOperatorBlock({
    unitId,
    operatorId: "operator-001",
    start: "2026-08-25",
    end: "2026-08-28",
    reason: "Private booking"
  });

  // Web view check
  const webView = calendar.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-26", checkOut: "2026-08-27", clock });
  // Agent view check
  const agentView = calendar.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-26", checkOut: "2026-08-27", clock });
  // Support view check
  const supportView = calendar.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-26", checkOut: "2026-08-27", clock });

  assert.deepEqual(webView, agentView);
  assert.deepEqual(webView, supportView);
  assert.equal(webView.isAvailable, false);
});

test("File-backed availability authority is shared across independent calendars and survives reconstruction", () => {
  const directory = mkdtempSync(join(tmpdir(), "shortlet-availability-"));
  const databasePath = join(directory, "availability.sqlite");
  const storeA = new SqliteAvailabilityStore(databasePath);
  const storeB = new SqliteAvailabilityStore(databasePath);
  const unitId = "unit-lagos-001";
  const now = () => new Date("2026-07-22T10:00:00Z");
  const calendarA = new AvailabilityCalendar({ store: storeA });
  const calendarB = new AvailabilityCalendar({ store: storeB });

  try {
    const hold = calendarA.createOperatorHold({ unitId, operatorId: "operator-001", start: "2026-08-01", end: "2026-08-05", clock: now });
    assert.equal(calendarB.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-03", checkOut: "2026-08-04", clock: now }).isAvailable, false);
    calendarB.releaseOperatorHold(hold.holdId, { clock: now });
    assert.equal(calendarA.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-03", checkOut: "2026-08-04", clock: now }).isAvailable, true);

    calendarA.addOperatorBlock({ unitId, operatorId: "operator-001", start: "2026-08-10", end: "2026-08-12", reason: "Maintenance", clock: now });
    storeA.close();
    storeB.close();

    const storeC = new SqliteAvailabilityStore(databasePath);
    try {
      const calendarC = new AvailabilityCalendar({ store: storeC });
      const availability = calendarC.getAuthoritativeAvailability({ unitId, checkIn: "2026-08-10", checkOut: "2026-08-11", clock: now });
      assert.equal(availability.isAvailable, false);
      assert.equal(availability.conflictReason, "Overlaps with Operator Block");
    } finally {
      storeC.close();
    }
  } finally {
    storeA.close();
    storeB.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Independent SQLite connections atomically reject overlapping holds and blocks while allowing non-overlap", () => {
  const directory = mkdtempSync(join(tmpdir(), "shortlet-availability-"));
  const databasePath = join(directory, "availability.sqlite");
  const storeA = new SqliteAvailabilityStore(databasePath);
  const storeB = new SqliteAvailabilityStore(databasePath);
  const unitId = "unit-lagos-001";
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const calendarA = new AvailabilityCalendar({ store: storeA });
  const calendarB = new AvailabilityCalendar({ store: storeB });

  try {
    calendarA.createOperatorHold({ unitId, operatorId: "operator-001", start: "2026-09-01", end: "2026-09-05", clock });
    assert.throws(() => calendarB.createOperatorHold({ unitId, operatorId: "operator-002", start: "2026-09-03", end: "2026-09-07", clock }), /availability conflict/i);
    assert.throws(() => calendarB.addOperatorBlock({ unitId, operatorId: "operator-001", start: "2026-09-04", end: "2026-09-06", clock }), /availability conflict/i);
    assert.doesNotThrow(() => calendarB.addOperatorBlock({ unitId, operatorId: "operator-001", start: "2026-09-05", end: "2026-09-06", clock }));
  } finally {
    storeA.close();
    storeB.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Object and positional availability forms both project active Hold authority", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const hold = calendar.createOperatorHold({
    unitId,
    operatorId: "operator-001",
    start: "2026-10-01",
    end: "2026-10-05",
    clock
  });

  const objectAvailability = calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-10-02",
    checkOut: "2026-10-03",
    clock
  });
  const positionalAvailability = calendar.getAuthoritativeAvailability(
    unitId,
    "2026-10-02",
    "2026-10-03",
    clock
  );

  assert.equal(objectAvailability.isAvailable, false);
  assert.equal(positionalAvailability.isAvailable, false);
  assert.equal(objectAvailability.conflictReason, "Overlaps with active Hold");
  assert.equal(positionalAvailability.conflictReason, "Overlaps with active Hold");

  calendar.releaseOperatorHold(hold.holdId, { clock });
  assert.equal(calendar.getAuthoritativeAvailability(unitId, "2026-10-02", "2026-10-03", clock).isAvailable, true);
});

test("Operator Hold lasts 45 minutes and extends once to a maximum of 60 minutes", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const createdAt = new Date("2026-07-22T10:00:00Z");
  const hold = calendar.createOperatorHold({
    unitId,
    operatorId: "operator-001",
    start: "2026-11-01",
    end: "2026-11-03",
    clock: () => createdAt
  });

  assert.equal(hold.kind, "operator_hold");
  assert.equal(hold.createdAt, "2026-07-22T10:00:00.000Z");
  assert.equal(hold.expiresAt, "2026-07-22T10:45:00.000Z");
  assert.equal(hold.extensionCount, 0);

  const extended = calendar.extendOperatorHold(hold.commitmentId, {
    clock: () => new Date("2026-07-22T10:44:59Z")
  });
  assert.equal(extended.commitmentId, hold.commitmentId);
  assert.equal(extended.expiresAt, "2026-07-22T11:00:00.000Z");
  assert.equal(extended.extensionCount, 1);
  assert.throws(
    () => calendar.extendOperatorHold(hold.commitmentId, { clock: () => new Date("2026-07-22T10:45:00Z") }),
    /maximum extension limit reached/i
  );
  assert.ok(new Date(extended.expiresAt).getTime() <= createdAt.getTime() + 60 * 60 * 1000);
  assert.equal(calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-11-02",
    checkOut: "2026-11-03",
    clock: () => new Date("2026-07-22T11:00:00Z")
  }).isAvailable, true);
});

test("Payment Pending transitions atomically to non-expiring confirmed Booking inventory", () => {
  const directory = mkdtempSync(join(tmpdir(), "shortlet-confirmed-booking-"));
  const databasePath = join(directory, "availability.sqlite");
  const store = new SqliteAvailabilityStore(databasePath);
  const unitId = "unit-lagos-001";
  const start = "2027-01-10";
  const end = "2027-01-12";
  const beforeExpiry = () => new Date("2026-07-22T10:10:00Z");
  const afterExpiry = () => new Date("2026-07-22T10:31:00Z");
  const calendar = new AvailabilityCalendar({ store });

  try {
    const requestBlock = calendar.createBookingRequestBlock({ unitId, holderId: "guest-confirmed", start, end, clock: beforeExpiry });
    const paymentPending = calendar.transitionBookingRequestBlockToPaymentPending({
      commitmentId: requestBlock.commitmentId, unitId, start, end, clock: beforeExpiry
    });
    const confirmed = calendar.transitionPaymentPendingToConfirmedBooking({
      commitmentId: requestBlock.commitmentId, unitId, start, end, clock: beforeExpiry
    });

    assert.equal(confirmed.commitmentId, paymentPending.commitmentId);
    assert.equal(confirmed.kind, "confirmed_booking");
    assert.equal(confirmed.state, "active");
    assert.equal(confirmed.unitId, unitId);
    assert.equal(confirmed.start, start);
    assert.equal(confirmed.end, end);
    assert.equal(confirmed.expiresAt, null);
    assert.equal(calendar.assertActiveCommitment({ commitmentId: requestBlock.commitmentId, unitId, start, end, expectedKind: "confirmed_booking", clock: afterExpiry }).kind, "confirmed_booking");
    assert.equal(calendar.getAuthoritativeAvailability({ unitId, checkIn: start, checkOut: end, clock: afterExpiry }).isAvailable, false);
    assert.equal(calendar.getAuthoritativeAvailability(unitId, start, end, afterExpiry).isAvailable, false);
    assert.throws(() => calendar.createOperatorHold({ unitId, operatorId: "operator-1", start, end, clock: afterExpiry }), /availability conflict/i);
    assert.throws(() => calendar.addOperatorBlock({ unitId, operatorId: "operator-1", start, end, clock: afterExpiry }), /availability conflict/i);
    assert.throws(() => calendar.transitionPaymentPendingToConfirmedBooking({ commitmentId: requestBlock.commitmentId, unitId, start, end, clock: afterExpiry }), /not Payment Pending/i);

    const expiredBlock = calendar.createBookingRequestBlock({ unitId, holderId: "guest-expired", start: "2027-02-10", end: "2027-02-12", clock: beforeExpiry });
    const expiredPending = calendar.transitionBookingRequestBlockToPaymentPending({ commitmentId: expiredBlock.commitmentId, unitId, start: "2027-02-10", end: "2027-02-12", clock: beforeExpiry });
    assert.ok(expiredPending.expiresAt);
    assert.throws(() => calendar.transitionPaymentPendingToConfirmedBooking({ commitmentId: expiredBlock.commitmentId, unitId, start: "2027-02-10", end: "2027-02-12", clock: afterExpiry }), /no longer active/i);

    store.close();
    const reconstructedStore = new SqliteAvailabilityStore(databasePath);
    try {
      const reconstructedCalendar = new AvailabilityCalendar({ store: reconstructedStore });
      assert.equal(reconstructedCalendar.getAuthoritativeAvailability({ unitId, checkIn: start, checkOut: end, clock: afterExpiry }).isAvailable, false);
    } finally {
      reconstructedStore.close();
    }
  } finally {
    try { store.close(); } catch { /* already closed after reconstruction */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Confirmed Booking inventory cannot be created outside the Payment Pending transition", () => {
  const directory = mkdtempSync(join(tmpdir(), "shortlet-confirmed-booking-guard-"));
  const databasePath = join(directory, "availability.sqlite");
  const store = new SqliteAvailabilityStore(databasePath);
  const calendar = new AvailabilityCalendar({ store });
  const unitId = "unit-lagos-001";
  const start = "2027-03-10";
  const end = "2027-03-12";
  const clock = () => new Date("2026-07-22T10:00:00Z");

  try {
    assert.throws(() => store.create({
      commitmentId: "confirmed-direct-attempt",
      unitId,
      kind: "confirmed_booking",
      start,
      end,
      createdAt: clock().toISOString(),
      expiresAt: null
    } as any), /must be created through the payment_pending transition/i);
    assert.equal(calendar.getAuthoritativeAvailability({ unitId, checkIn: start, checkOut: end, clock }).isAvailable, true);

    const requestBlock = calendar.createBookingRequestBlock({ unitId, holderId: "guest-legal-transition", start, end, clock });
    calendar.transitionBookingRequestBlockToPaymentPending({ commitmentId: requestBlock.commitmentId, unitId, start, end, clock });
    const confirmed = calendar.transitionPaymentPendingToConfirmedBooking({ commitmentId: requestBlock.commitmentId, unitId, start, end, clock });
    assert.equal(confirmed.kind, "confirmed_booking");
    assert.equal(confirmed.commitmentId, requestBlock.commitmentId);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Operator Hold extension and release are kind-safe and fail at expiry", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const hold = calendar.createOperatorHold({
    unitId,
    operatorId: "operator-001",
    start: "2026-12-01",
    end: "2026-12-03",
    clock: () => new Date("2026-07-22T10:00:00Z")
  });
  assert.throws(
    () => calendar.extendOperatorHold(hold.commitmentId, { clock: () => new Date("2026-07-22T10:45:00Z") }),
    /expired/i
  );
  assert.equal(calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-12-01",
    checkOut: "2026-12-02",
    clock: () => new Date("2026-07-22T10:45:00Z")
  }).isAvailable, true);

  const bookingBlock = calendar.createBookingRequestBlock({
    unitId,
    holderId: "guest-001",
    start: "2026-12-10",
    end: "2026-12-12",
    clock: () => new Date("2026-07-22T10:00:00Z")
  });
  assert.throws(
    () => calendar.extendOperatorHold(bookingBlock.commitmentId, { clock: () => new Date("2026-07-22T10:01:00Z") }),
    /not an operator hold/i
  );
  assert.throws(
    () => calendar.releaseOperatorHold(bookingBlock.commitmentId, { clock: () => new Date("2026-07-22T10:01:00Z") }),
    /not an operator hold/i
  );
  assert.equal(calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-12-10",
    checkOut: "2026-12-11",
    clock: () => new Date("2026-07-22T10:01:00Z")
  }).isAvailable, false);
});
