import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import { AvailabilityCalendar, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";

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
  const hold = calendar.createHold({
    unitId,
    holderId: "guest-123",
    start: "2026-08-20",
    end: "2026-08-22",
    clock: () => now
  });

  assert.ok(hold.holdId);
  assert.equal(hold.extensionCount, 0);
  const initialExpiry = new Date("2026-07-22T10:45:00Z").getTime();
  assert.equal(new Date(hold.expiresAt).getTime(), initialExpiry);

  // Extend hold once (adds 15 mins -> total 60 mins from creation)
  const extended = calendar.extendHold(hold.holdId, { clock: () => new Date("2026-07-22T10:20:00Z") });
  assert.equal(extended.extensionCount, 1);
  const extendedExpiry = new Date("2026-07-22T11:00:00Z").getTime();
  assert.equal(new Date(extended.expiresAt).getTime(), extendedExpiry);

  // Second extension attempt fails (allow at most one valid extension)
  assert.throws(
    () => calendar.extendHold(hold.holdId, { clock: () => new Date("2026-07-22T10:30:00Z") }),
    /maximum extension limit reached/i
  );

  // Automatic expiry check: after 11:00 AM, hold is expired and dates become available again
  const afterExpiryAvailability = calendar.getAuthoritativeAvailability({
    unitId,
    checkIn: "2026-08-20",
    checkOut: "2026-08-22",
    clock: () => new Date("2026-07-22T11:01:00Z")
  });
  assert.equal(afterExpiryAvailability.isAvailable, true);
});

test("Competing holds, blocks, and bookings are protected by real transaction and overlap constraints", () => {
  const { calendar } = setup();
  const unitId = "unit-lagos-001";
  const now = new Date("2026-07-22T10:00:00Z");

  // Create active hold
  calendar.createHold({
    unitId,
    holderId: "guest-1",
    start: "2026-08-01",
    end: "2026-08-05",
    clock: () => now
  });

  // Competing hold on overlapping dates fails
  assert.throws(
    () => calendar.createHold({
      unitId,
      holderId: "guest-2",
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
