import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { OPERATOR_RESPONSE_WINDOW_MINUTES, TECHNICAL_DELIVERY_WINDOW_MINUTES, operatorResponseReminderDue } from "../domains/shortlet/src/index.js";
import { setupBookingRequestManager } from "./helpers/booking-request-manager.js";

// Issue 09 — start the 30-minute response window at delivery, not disclosure
// (.scratch/operator-dashboard/issues/09-response-window-starts-at-delivery.md, ADR 0041, 0043, 0077).

const MINUTE = 60_000;
const DISCLOSED = new Date("2026-07-22T10:00:00Z");
const at = (minutes: number) => new Date(DISCLOSED.getTime() + minutes * MINUTE);
const iso = (minutes: number) => at(minutes).toISOString();

/** A request disclosed at 11:00 AM WAT and left in Delivery Pending (no channel has accepted it yet). */
function pendingRequest() {
  const context = setupBookingRequestManager();
  const { manager, unit } = context;
  const draft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-delivery", name: "Delivery Guest" },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Delivery Guest" }],
    checkIn: "2026-08-20",
    checkOut: "2026-08-22",
  }, { clock: () => DISCLOSED });
  const request = manager.discloseBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.disclose", principal: { id: "guest-delivery", role: "guest", tenantId: "tenant-lagos" }, payload: { draftId: draft.draftId, autoDeliver: false } }), { clock: () => DISCLOSED });
  const operator = { id: unit.operator.id, role: "operator" as const, tenantId: "tenant-lagos" };
  const deliver = (minutes: number) => manager.markDelivered(createPlatformCommandEnvelope({ commandName: "booking_request.mark_delivered", principal: operator, payload: { requestId: request.requestId } }), { clock: () => at(minutes) });
  const confirm = (minutes: number) => manager.confirmBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.confirm", principal: operator, payload: { requestId: request.requestId } }), { clock: () => at(minutes) });
  const available = (minutes: number) => context.calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: request.checkIn, checkOut: request.checkOut, clock: () => at(minutes) }).isAvailable;
  const block = (minutes: number) => context.calendar.listActiveCommitments({ unitId: unit.id, start: request.checkIn, end: request.checkOut, clock: () => at(minutes) }).find((commitment) => commitment.commitmentId === request.inventoryCommitmentId);
  return { ...context, request, deliver, confirm, available, block };
}

test("AC1 — A request delivered after disclosure expires 30 minutes after deliveredAt, not after disclosedAt", () => {
  const { manager, request, deliver, confirm } = pendingRequest();
  const delivered = deliver(4);
  assert.equal(delivered.deliveredAt, iso(4));
  assert.equal(delivered.operatorResponseDeadlineAt, iso(4 + OPERATOR_RESPONSE_WINDOW_MINUTES), "a fresh full window from delivery (ADR 0043)");
  // Still open at minute 31, past disclosure + 30: those four minutes belong to the owner.
  assert.equal(manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: () => at(31) }).status, "disclosed");
  assert.equal(confirm(33).status, "confirmed");

  // A second request, left unanswered, expires at delivery + 30.
  const other = pendingRequest();
  other.deliver(4);
  assert.equal(other.manager.checkAndResolveExpiry({ requestId: other.request.requestId }, { clock: () => at(33) }).status, "disclosed");
  assert.equal(other.manager.checkAndResolveExpiry({ requestId: other.request.requestId }, { clock: () => at(34) }).status, "expired");
  assert.throws(() => other.confirm(34), /expired/i);
});

test("AC2 — Before delivery, no response deadline or reminder is shown or enforced. Delivery Failed never becomes an operator timeout", () => {
  const { manager, audit, request, confirm } = pendingRequest();
  // Until a channel accepts, the only deadline is the 5-minute delivery window (ADR 0043).
  assert.equal(request.delivered, false);
  assert.equal(request.deliveryDeadlineAt, iso(TECHNICAL_DELIVERY_WINDOW_MINUTES));
  assert.equal(request.operatorResponseDeadlineAt, request.deliveryDeadlineAt, "no response window has started");
  assert.equal(operatorResponseReminderDue(manager.getRequest(request.requestId), at(4)), null, "no reminder before delivery");
  assert.throws(() => confirm(2), /not been delivered/i, "nothing can be enforced on the owner before delivery");
  // Checked for expiry long after, an undelivered request is Delivery Failed, never an operator timeout (ADR 0041).
  assert.equal(manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: () => at(31) }).status, "delivery_failed");
  const types = audit.entries().map((entry) => entry.type);
  assert.ok(types.includes("booking_request.delivery_failed"));
  assert.ok(!types.includes("booking_request.expired"), "no operator timeout is recorded");
  // Within the delivery window it is simply still pending.
  const early = pendingRequest();
  assert.equal(early.manager.checkAndResolveExpiry({ requestId: early.request.requestId }, { clock: () => at(3) }).status, "disclosed");
});

test("AC3 — The inventory block is released at the new expiry, and the projected deadline is the single source for the back office and the Guest", () => {
  const { manager, request, deliver, available, block } = pendingRequest();
  // In Delivery Pending the block lasts at most the 5-minute delivery window (ADR 0043).
  assert.equal(block(0)?.expiresAt, iso(TECHNICAL_DELIVERY_WINDOW_MINUTES));
  // Acceptance extends it to the new response deadline, so the dates stay held for the whole window (ADR 0041).
  deliver(4);
  const deadline = manager.getRequest(request.requestId).operatorResponseDeadlineAt;
  assert.equal(block(4)?.expiresAt, deadline);
  assert.equal(available(31), false, "still held after disclosure + 30");
  assert.equal(available(33), false);
  assert.equal(available(34), true, "released at the new expiry");
  // Reminders measure back from the same projected deadline (ADR 0077): 10 minutes into the window is minute 14.
  const projected = manager.getRequest(request.requestId);
  assert.equal(operatorResponseReminderDue(projected, at(13)), null);
  assert.equal(operatorResponseReminderDue(projected, at(14)), 10);
  assert.equal(operatorResponseReminderDue(projected, at(29)), 25);

  // Delivery after the 5-minute window cannot revive the request or its block.
  const late = pendingRequest();
  assert.throws(() => late.deliver(5), /delivery deadline/i);
  assert.equal(late.manager.getRequest(late.request.requestId).status, "delivery_failed");
  assert.equal(late.available(5), true);
});
