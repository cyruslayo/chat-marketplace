import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { canTransition } from "../packages/platform-core/src/state-transition.js";
import {
  BOOKING_REQUEST_STATUSES,
  BOOKING_REQUEST_TRANSITIONS,
  SqliteGuestInteractionStore,
  projectBookingRequestStatus,
  type BookingRequestStatus,
} from "../domains/shortlet/src/index.js";
import { setupBookingRequestManager } from "./helpers/booking-request-manager.js";

// Issue 04 (state-machines, Track B, no behaviour change): characterisation of today's BookingRequest moves and
// refusal texts. These tests were written and run green against the unchanged code, and the refactor leaves them
// unchanged. Every value is synthetic. Offsets are measured from the disclosure instant.

type Fixture = ReturnType<typeof setupBookingRequestManager>;

const TENANT = "tenant-lagos";
const GUEST = "guest-transitions";
const MINUTE_MS = 60_000;
/** 11:00 AM WAT, inside Operator Active Hours (ADR 0041). */
const DISCLOSED_AT = new Date("2026-07-22T10:00:00Z");

/** A clock that reads `offsetMs` after the disclosure instant. */
function clockAt(offsetMs: number): () => Date {
  return () => new Date(DISCLOSED_AT.getTime() + offsetMs);
}

/** Creates a draft and discloses it. `autoDeliver: false` leaves the request undelivered (ADR 0043). */
function createDisclosed(fx: Fixture, autoDeliver: boolean) {
  const clock = clockAt(0);
  const draft = fx.manager.createDraft({
    unitId: fx.unit.id,
    primaryGuest: { id: GUEST, name: "Transition Guest" },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Transition Guest" }],
    checkIn: "2026-08-20",
    checkOut: "2026-08-22",
  }, { tenantId: TENANT, clock });
  const request = fx.manager.discloseBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: GUEST, role: "guest", tenantId: TENANT },
    payload: { draftId: draft.draftId, autoDeliver },
  }), { clock });
  return { draft, request };
}

function operator(fx: Fixture) {
  return { id: fx.unit.operator.id, role: "operator" as const, tenantId: TENANT };
}

function confirm(fx: Fixture, requestId: string, offsetMs: number) {
  return fx.manager.confirmBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.confirm",
    principal: operator(fx),
    payload: { requestId },
  }), { clock: clockAt(offsetMs) });
}

function decline(fx: Fixture, requestId: string, offsetMs: number, reason: string) {
  return fx.manager.declineBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.decline",
    principal: operator(fx),
    payload: { requestId, reason },
  }), { clock: clockAt(offsetMs) });
}

function markDelivered(fx: Fixture, requestId: string, offsetMs: number) {
  return fx.manager.markDelivered(createPlatformCommandEnvelope({
    commandName: "booking_request.mark_delivered",
    principal: operator(fx),
    payload: { requestId },
  }), { clock: clockAt(offsetMs) });
}

test("AC1: Characterisation, success paths: each status move the code makes today still produces the same status", async (t) => {
  await t.test("draft -> disclosed: a draft is stored as draft and disclosure stores the request as disclosed", () => {
    const fx = setupBookingRequestManager();
    const { draft, request } = createDisclosed(fx, true);
    assert.equal(draft.status, "draft");
    assert.equal(fx.manager.getDraft(draft.draftId).status, "draft");
    assert.equal(request.status, "disclosed");
    assert.equal(fx.manager.getRequest(request.requestId).status, "disclosed");
  });

  await t.test("disclosed -> confirmed: confirming a delivered request inside its response window", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    const confirmed = confirm(fx, request.requestId, MINUTE_MS);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(fx.manager.getRequest(request.requestId).status, "confirmed");
  });

  await t.test("disclosed -> declined: declining a delivered request inside its response window keeps the reason", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    const declined = decline(fx, request.requestId, MINUTE_MS, "Dates no longer free");
    assert.equal(declined.status, "declined");
    assert.equal(declined.declineReason, "Dates no longer free");
    assert.equal(fx.manager.getRequest(request.requestId).status, "declined");
  });

  await t.test("disclosed -> expired: the response deadline is inclusive, so the request expires at exactly 30 minutes", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.equal(fx.manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: clockAt(30 * MINUTE_MS - 1) }).status, "disclosed");
    assert.equal(fx.manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: clockAt(30 * MINUTE_MS) }).status, "expired");
    assert.equal(fx.manager.getRequest(request.requestId).status, "expired");
  });

  await t.test("disclosed -> delivery_failed: an undelivered request fails at exactly the 5-minute delivery deadline", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.equal(fx.manager.checkAndResolveDeliveryFailure({ requestId: request.requestId }, { clock: clockAt(5 * MINUTE_MS - 1) }).status, "disclosed");
    assert.equal(fx.manager.checkAndResolveDeliveryFailure({ requestId: request.requestId }, { clock: clockAt(5 * MINUTE_MS) }).status, "delivery_failed");
    assert.equal(fx.manager.getRequest(request.requestId).status, "delivery_failed");
  });

  await t.test("disclosed -> delivery_failed: the expiry check hands an undelivered request to the delivery rule", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.equal(fx.manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: clockAt(5 * MINUTE_MS) }).status, "delivery_failed");
  });

  await t.test("moves that leave the status alone: marking delivery, and lazy checks before any deadline", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    const delivered = markDelivered(fx, request.requestId, MINUTE_MS);
    assert.equal(delivered.status, "disclosed");
    assert.equal(delivered.delivered, true);
    // The fresh 30-minute window starts at delivery (ADR 0043), so the request is still disclosed 29 minutes later.
    assert.equal(fx.manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: clockAt(MINUTE_MS + 29 * MINUTE_MS) }).status, "disclosed");
    // A delivered request never becomes delivery_failed, even after the original delivery deadline.
    assert.equal(fx.manager.checkAndResolveDeliveryFailure({ requestId: request.requestId }, { clock: clockAt(10 * MINUTE_MS) }).status, "disclosed");
  });

  await t.test("the read projection agrees with the write path at each deadline", () => {
    const delivered = setupBookingRequestManager();
    const deliveredRequest = createDisclosed(delivered, true).request;
    assert.equal(projectBookingRequestStatus(deliveredRequest, clockAt(30 * MINUTE_MS - 1)()), "disclosed");
    assert.equal(projectBookingRequestStatus(deliveredRequest, clockAt(30 * MINUTE_MS)()), "expired");

    const undelivered = setupBookingRequestManager();
    const undeliveredRequest = createDisclosed(undelivered, false).request;
    assert.equal(projectBookingRequestStatus(undeliveredRequest, clockAt(5 * MINUTE_MS - 1)()), "disclosed");
    assert.equal(projectBookingRequestStatus(undeliveredRequest, clockAt(5 * MINUTE_MS)()), "delivery_failed");
  });
});

test("AC2: Characterisation, refusal paths: each refused move still produces today's error text", async (t) => {
  await t.test("declining an undelivered request inside the delivery window is refused as not delivered", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => decline(fx, request.requestId, MINUTE_MS, "x"), { message: "Booking request has not been delivered and cannot be declined" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "disclosed");
  });

  await t.test("declining an undelivered request after the delivery deadline resolves delivery failure and is refused", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => decline(fx, request.requestId, 5 * MINUTE_MS, "x"), { message: "Booking request delivery failed and cannot be declined" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "delivery_failed");
  });

  await t.test("confirming an undelivered request inside the delivery window is refused as not delivered", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => confirm(fx, request.requestId, MINUTE_MS), { message: "Booking request has not been delivered and cannot be confirmed" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "disclosed");
  });

  await t.test("confirming an undelivered request after the delivery deadline resolves delivery failure and is refused", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => confirm(fx, request.requestId, 5 * MINUTE_MS), { message: "Booking request delivery failed and cannot be confirmed" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "delivery_failed");
  });

  await t.test("confirming after the response deadline resolves expiry and is refused", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.throws(() => confirm(fx, request.requestId, 30 * MINUTE_MS), { message: "Booking request has expired and can no longer be confirmed" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "expired");
  });

  await t.test("confirming a declined request is refused with its status named", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    decline(fx, request.requestId, MINUTE_MS, "x");
    assert.throws(() => confirm(fx, request.requestId, 2 * MINUTE_MS), { message: "Cannot confirm booking request in status 'declined'" });
  });

  await t.test("declining a confirmed request is refused with its status named", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    confirm(fx, request.requestId, MINUTE_MS);
    assert.throws(() => decline(fx, request.requestId, 2 * MINUTE_MS, "x"), { message: "Cannot decline booking request in status 'confirmed'" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "confirmed");
  });

  await t.test("confirming a confirmed request a second time is refused with its status named", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    confirm(fx, request.requestId, MINUTE_MS);
    assert.throws(() => confirm(fx, request.requestId, 2 * MINUTE_MS), { message: "Cannot confirm booking request in status 'confirmed'" });
  });

  await t.test("confirming a declined request after its response deadline reports expiry and leaves it declined", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    decline(fx, request.requestId, MINUTE_MS, "x");
    assert.throws(() => confirm(fx, request.requestId, 31 * MINUTE_MS), { message: "Booking request has expired and can no longer be confirmed" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "declined");
  });

  await t.test("marking delivery on a confirmed request is refused with its status named", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    confirm(fx, request.requestId, MINUTE_MS);
    assert.throws(() => markDelivered(fx, request.requestId, 2 * MINUTE_MS), { message: "Cannot mark delivery for request in status 'confirmed'" });
  });

  await t.test("marking delivery after the 5-minute deadline fails delivery and is refused", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => markDelivered(fx, request.requestId, 5 * MINUTE_MS), { message: "Technical delivery deadline (5 minutes) expired; request delivery failed" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "delivery_failed");
  });

  await t.test("a stored status outside the union is refused as today, with the raw value named", () => {
    const database = openNodeSqliteDatabase(":memory:");
    const fx = setupBookingRequestManager({ store: new SqliteGuestInteractionStore(database) });
    const { request } = createDisclosed(fx, true);
    database.prepare("UPDATE guest_booking_requests SET status = $status WHERE request_id = $requestId").run({ $status: "legacy_status", $requestId: request.requestId });
    assert.throws(() => confirm(fx, request.requestId, MINUTE_MS), { message: "Cannot confirm booking request in status 'legacy_status'" });
    assert.equal(fx.manager.getRequest(request.requestId).status, "legacy_status");
  });
});

/** Asserts that the observed move `from -> to` is listed in the table, so the table covers what the write path did. */
function assertListed(from: BookingRequestStatus, to: BookingRequestStatus): void {
  assert.equal(canTransition(BOOKING_REQUEST_TRANSITIONS, from, to), true, `${from} -> ${to} is not listed`);
}

test("AC3: every move the code makes is listed in BOOKING_REQUEST_TRANSITIONS, asserted through canTransition on each write path", async (t) => {
  await t.test("draft -> disclosed, written by disclosure", () => {
    const fx = setupBookingRequestManager();
    const { draft, request } = createDisclosed(fx, true);
    assert.equal(draft.status, "draft");
    assert.equal(request.status, "disclosed");
    assertListed("draft", "disclosed");
  });

  await t.test("disclosed -> confirmed, written by confirm", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.equal(confirm(fx, request.requestId, MINUTE_MS).status, "confirmed");
    assertListed("disclosed", "confirmed");
  });

  await t.test("disclosed -> declined, written by decline", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.equal(decline(fx, request.requestId, MINUTE_MS, "x").status, "declined");
    assertListed("disclosed", "declined");
  });

  await t.test("disclosed -> expired, written by the expiry check", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.equal(fx.manager.checkAndResolveExpiry({ requestId: request.requestId }, { clock: clockAt(30 * MINUTE_MS) }).status, "expired");
    assertListed("disclosed", "expired");
  });

  await t.test("disclosed -> expired, written by confirm after the response deadline", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, true);
    assert.throws(() => confirm(fx, request.requestId, 30 * MINUTE_MS));
    assert.equal(fx.manager.getRequest(request.requestId).status, "expired");
    assertListed("disclosed", "expired");
  });

  await t.test("disclosed -> delivery_failed, written by the delivery check", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.equal(fx.manager.checkAndResolveDeliveryFailure({ requestId: request.requestId }, { clock: clockAt(5 * MINUTE_MS) }).status, "delivery_failed");
    assertListed("disclosed", "delivery_failed");
  });

  await t.test("disclosed -> delivery_failed, written by marking delivery after the deadline", () => {
    const fx = setupBookingRequestManager();
    const { request } = createDisclosed(fx, false);
    assert.throws(() => markDelivered(fx, request.requestId, 5 * MINUTE_MS));
    assert.equal(fx.manager.getRequest(request.requestId).status, "delivery_failed");
    assertListed("disclosed", "delivery_failed");
  });

  await t.test("disclosed -> delivery_failed, written by confirm and decline after the deadline", () => {
    const confirmFixture = setupBookingRequestManager();
    const confirmed = createDisclosed(confirmFixture, false);
    assert.throws(() => confirm(confirmFixture, confirmed.request.requestId, 5 * MINUTE_MS));
    assert.equal(confirmFixture.manager.getRequest(confirmed.request.requestId).status, "delivery_failed");
    assertListed("disclosed", "delivery_failed");

    const declineFixture = setupBookingRequestManager();
    const declined = createDisclosed(declineFixture, false);
    assert.throws(() => decline(declineFixture, declined.request.requestId, 5 * MINUTE_MS, "x"));
    assert.equal(declineFixture.manager.getRequest(declined.request.requestId).status, "delivery_failed");
  });

  await t.test("the table refuses moves the code never makes, and terminal states move nowhere", () => {
    assert.equal(canTransition(BOOKING_REQUEST_TRANSITIONS, "confirmed", "declined"), false);
    assert.equal(canTransition(BOOKING_REQUEST_TRANSITIONS, "disclosed", "draft"), false);
    for (const terminal of ["delivery_failed", "expired", "confirmed", "declined"] as const) {
      for (const to of BOOKING_REQUEST_STATUSES) assert.equal(canTransition(BOOKING_REQUEST_TRANSITIONS, terminal, to), false);
    }
  });
});

test("AC4: there is no any in booking-request.ts", () => {
  const source = readFileSync(new URL("../domains/shortlet/src/booking-request.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/\bany\b/.test(code), false);
});
