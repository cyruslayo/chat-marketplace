import test, { after } from "node:test";
import assert from "node:assert/strict";
import { flagMaterialUnitChange } from "../domains/shortlet/src/index.js";
import { CONDITIONAL_OFFER_STATUSES, CONDITIONAL_OFFER_TRANSITIONS } from "../domains/shortlet/src/conditional-offer.js";
import { InMemoryBookingStateRepository, SqliteBookingStateRepository, type BookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import { RESERVATION_STATUSES, RESERVATION_TRANSITIONS, type Reservation } from "../domains/shortlet/src/card-payment.js";
import { canTransition } from "../packages/platform-core/src/state-transition.js";
import { openNodeSqliteDatabase, type NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { acceptEnvelopeFor, createConfirmedRequest, issueConditionalOffer, setup } from "./helpers/conditional-offer-issue.js";

// Issue 05 (ADR 0044, 0074, 0086): characterisation of the ConditionalOffer and Reservation status moves as they are today.
// These tests pin behaviour and error text before the unions and transition tables are introduced (Track B: no behaviour change).

const ISSUE_CLOCK = () => new Date("2026-07-22T10:00:00Z");
const ACCEPT_WITHIN_WINDOW = () => new Date("2026-07-22T10:05:00Z");
const ACCEPT_AFTER_WINDOW = () => new Date("2026-07-22T10:21:00Z");

function issuedOffer(s: ReturnType<typeof setup>, guestId = "guest-101", checkIn = "2026-08-01", checkOut = "2026-08-05") {
  const { request } = createConfirmedRequest(s, ISSUE_CLOCK, { guestId, checkIn, checkOut });
  return issueConditionalOffer(s, request, ISSUE_CLOCK);
}

test("AC1: accepting an issued offer gives accepted", () => {
  const s = setup();
  const offer = issuedOffer(s);
  assert.equal(offer.status, "issued");

  const accepted = s.offerManager.acceptOffer(acceptEnvelopeFor(offer), { clock: ACCEPT_WITHIN_WINDOW });

  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.tokenUsed, true);
});

test("AC1: accepting an accepted, expired or stale offer is refused with today's error text", () => {
  // accepted: a replay of a spent offer.
  const replayed = setup();
  const acceptedOffer = issuedOffer(replayed);
  replayed.offerManager.acceptOffer(acceptEnvelopeFor(acceptedOffer), { clock: ACCEPT_WITHIN_WINDOW });
  assert.throws(
    () => replayed.offerManager.acceptOffer(acceptEnvelopeFor(acceptedOffer), { clock: ACCEPT_WITHIN_WINDOW }),
    { message: "Offer has already been accepted" },
  );
  assert.equal(replayed.offerManager.getOffer(acceptedOffer.offerId).status, "accepted");

  // expired: the first accept after the Payment Window marks the offer expired; later accepts see the expired status.
  const late = setup();
  const expiredOffer = issuedOffer(late, "guest-102", "2026-08-10", "2026-08-12");
  assert.throws(
    () => late.offerManager.acceptOffer(acceptEnvelopeFor(expiredOffer, "guest-102"), { clock: ACCEPT_AFTER_WINDOW }),
    { message: "Payment window (20 minutes) has expired; offer is no longer valid" },
  );
  assert.equal(late.offerManager.getOffer(expiredOffer.offerId).status, "expired");
  assert.throws(
    () => late.offerManager.acceptOffer(acceptEnvelopeFor(expiredOffer, "guest-102"), { clock: ACCEPT_WITHIN_WINDOW }),
    { message: "Offer has expired and cannot be accepted" },
  );

  // stale: the unit stops covering checkout, so the accept marks the offer stale; later accepts see the stale status.
  const changed = setup();
  const staleOffer = issuedOffer(changed, "guest-103", "2026-08-20", "2026-08-22");
  flagMaterialUnitChange(changed.repository, changed.unit.id);
  assert.throws(
    () => changed.offerManager.acceptOffer(acceptEnvelopeFor(staleOffer, "guest-103"), { clock: ACCEPT_WITHIN_WINDOW }),
    { message: "Offer terms are stale or changed: Unit eligibility no longer covers checkout" },
  );
  assert.equal(changed.offerManager.getOffer(staleOffer.offerId).status, "stale");
  assert.throws(
    () => changed.offerManager.acceptOffer(acceptEnvelopeFor(staleOffer, "guest-103"), { clock: ACCEPT_WITHIN_WINDOW }),
    { message: "Offer terms are stale or changed" },
  );
});

// Reservation repositories: the in-memory and the SQLite store must behave the same way.
const openedDatabases: NodeSqliteDatabase[] = [];
function reservationRepositories(): { name: string; repository: BookingStateRepository }[] {
  const database = openNodeSqliteDatabase(":memory:");
  openedDatabases.push(database);
  return [
    { name: "in-memory", repository: new InMemoryBookingStateRepository() },
    { name: "sqlite", repository: new SqliteBookingStateRepository(database) },
  ];
}

function confirmedReservation(reservationId: string): Reservation {
  return {
    reservationId,
    contractId: `contract-${reservationId}`,
    unitId: "unit-1",
    primaryGuestId: "guest-101",
    dates: { checkIn: "2026-09-01", checkOut: "2026-09-03" },
    status: "confirmed",
    confirmedAt: "2026-08-01T00:00:00.000Z",
    inventoryCommitmentId: `commit-${reservationId}`,
  };
}

test("AC2: cancelling or no-showing a confirmed Reservation works", () => {
  for (const { name, repository } of reservationRepositories()) {
    repository.saveReservation(confirmedReservation("cancel-me"));
    repository.saveReservation(confirmedReservation("no-show-me"));

    const cancelled = repository.transitionReservationStatus("cancel-me", "confirmed", "cancelled");
    assert.equal(cancelled.status, "cancelled", name);
    assert.equal(repository.findReservationById("cancel-me")?.status, "cancelled", name);

    const noShow = repository.transitionReservationStatus("no-show-me", "confirmed", "no_show");
    assert.equal(noShow.status, "no_show", name);
    assert.equal(repository.findReservationById("no-show-me")?.status, "no_show", name);
  }
});

test("AC2: doing either from cancelled or no_show throws STALE_ACTION", () => {
  for (const { name, repository } of reservationRepositories()) {
    repository.saveReservation(confirmedReservation("r-cancelled"));
    repository.saveReservation(confirmedReservation("r-no-show"));
    repository.transitionReservationStatus("r-cancelled", "confirmed", "cancelled");
    repository.transitionReservationStatus("r-no-show", "confirmed", "no_show");

    assert.throws(() => repository.transitionReservationStatus("r-cancelled", "confirmed", "cancelled"), { message: "STALE_ACTION" }, name);
    assert.throws(() => repository.transitionReservationStatus("r-cancelled", "confirmed", "no_show"), { message: "STALE_ACTION" }, name);
    assert.throws(() => repository.transitionReservationStatus("r-no-show", "confirmed", "cancelled"), { message: "STALE_ACTION" }, name);
    assert.throws(() => repository.transitionReservationStatus("r-no-show", "confirmed", "no_show"), { message: "STALE_ACTION" }, name);
    assert.equal(repository.findReservationById("r-cancelled")?.status, "cancelled", name);
    assert.equal(repository.findReservationById("r-no-show")?.status, "no_show", name);
  }
});

test("AC3: every move the code makes is in the matching table, asserted with canTransition", () => {
  // ConditionalOffer: the statuses the accept path actually leaves an issued offer in are all listed moves.
  const accepted = setup();
  const acceptedOffer = issuedOffer(accepted);
  const acceptedStatus = accepted.offerManager.acceptOffer(acceptEnvelopeFor(acceptedOffer), { clock: ACCEPT_WITHIN_WINDOW }).status;
  assert.equal(canTransition(CONDITIONAL_OFFER_TRANSITIONS, "issued", acceptedStatus), true);

  const late = setup();
  const expiredOffer = issuedOffer(late, "guest-102", "2026-08-10", "2026-08-12");
  assert.throws(() => late.offerManager.acceptOffer(acceptEnvelopeFor(expiredOffer, "guest-102"), { clock: ACCEPT_AFTER_WINDOW }));
  assert.equal(canTransition(CONDITIONAL_OFFER_TRANSITIONS, "issued", late.offerManager.getOffer(expiredOffer.offerId).status), true);

  const changed = setup();
  const staleOffer = issuedOffer(changed, "guest-103", "2026-08-20", "2026-08-22");
  flagMaterialUnitChange(changed.repository, changed.unit.id);
  assert.throws(() => changed.offerManager.acceptOffer(acceptEnvelopeFor(staleOffer, "guest-103"), { clock: ACCEPT_WITHIN_WINDOW }));
  assert.equal(canTransition(CONDITIONAL_OFFER_TRANSITIONS, "issued", changed.offerManager.getOffer(staleOffer.offerId).status), true);

  // Terminal ConditionalOffer states list no moves, and `revoked` is never written.
  for (const from of ["accepted", "expired", "stale", "revoked"] as const) {
    for (const to of CONDITIONAL_OFFER_STATUSES) assert.equal(canTransition(CONDITIONAL_OFFER_TRANSITIONS, from, to), false, `${from} to ${to}`);
  }

  // Reservation: cancellation and no-show are the only moves from confirmed; both terminal states list none.
  assert.equal(canTransition(RESERVATION_TRANSITIONS, "confirmed", "cancelled"), true);
  assert.equal(canTransition(RESERVATION_TRANSITIONS, "confirmed", "no_show"), true);
  for (const from of ["cancelled", "no_show"] as const) {
    for (const to of RESERVATION_STATUSES) assert.equal(canTransition(RESERVATION_TRANSITIONS, from, to), false, `${from} to ${to}`);
  }
});

after(() => {
  for (const database of openedDatabases.splice(0)) database.close();
});
