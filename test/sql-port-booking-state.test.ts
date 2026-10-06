import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import { SqliteBookingPaymentJourneyRepository } from "../domains/shortlet/src/booking-payment-journey.js";
import { SqliteManualTransferStore } from "../domains/shortlet/src/manual-transfer.js";
import { SqliteOwnerPayableLedger } from "../domains/shortlet/src/owner-payable.js";
import { SqliteBankTransferSessionStore } from "../domains/shortlet/src/bank-transfer.js";
import { SqliteCheckInSupportStore } from "../domains/shortlet/src/checkin-support.js";
import { SqliteGuestContactRepository } from "../domains/shortlet/src/guest-contact.js";
import type { Reservation } from "../domains/shortlet/src/card-payment.js";

const reservation: Reservation = {
  reservationId: "reservation-port",
  contractId: "contract-port",
  unitId: "unit-port",
  primaryGuestId: "guest-port",
  dates: { checkIn: "2026-09-10", checkOut: "2026-09-12" },
  status: "confirmed",
  confirmedAt: "2026-09-01T10:00:00Z",
};

test("AC2: The booking-state transition still rolls back atomically", () => {
  const raw = new DatabaseSync(":memory:");
  const database = new NodeSqliteDatabase(raw);
  try {
    const repository = new SqliteBookingStateRepository(database);
    // Only persisted identity/version fields are needed for this storage fault test.
    database.prepare("INSERT INTO booking_contracts VALUES ($id, $json)").run({
      $id: reservation.contractId,
      $json: JSON.stringify({
        contractId: reservation.contractId,
        reservationId: reservation.reservationId,
        contractVersion: 1,
      }),
    });
    const previous = repository.findContractById(reservation.contractId);
    assert.ok(previous);
    const next = { ...previous, contractVersion: 2 };
    database.exec(
      "CREATE TRIGGER fail_reservation BEFORE INSERT ON booking_reservations BEGIN SELECT RAISE(ABORT, 'forced reservation failure'); END",
    );
    assert.throws(
      () => repository.saveBookingAtomically({ contract: next, reservation }),
      /forced reservation failure/,
    );
    assert.equal(
      repository.findContractById(reservation.contractId)?.contractVersion,
      1,
    );
    assert.equal(
      repository.findReservationById(reservation.reservationId),
      null,
    );
    assert.equal(raw.isTransaction, false);

    // Existing Node stores still start raw transactions until 02c/02e.
    raw.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => repository.saveBookingAtomically({ contract: next, reservation }),
      /forced reservation failure/,
    );
    assert.equal(
      repository.findContractById(reservation.contractId)?.contractVersion,
      1,
    );
    assert.equal(raw.isTransaction, true);
    database.exec("DROP TRIGGER fail_reservation");
    repository.saveBookingAtomically({ contract: next, reservation });
    assert.equal(
      repository.findContractById(reservation.contractId)?.contractVersion,
      2,
    );
    assert.equal(
      repository.findReservationById(reservation.reservationId)?.status,
      "confirmed",
    );
    assert.equal(raw.isTransaction, true);
    raw.exec("ROLLBACK");
    assert.equal(
      repository.findContractById(reservation.contractId)?.contractVersion,
      1,
    );
    assert.equal(
      repository.findReservationById(reservation.reservationId),
      null,
    );
    database.exec("DROP TRIGGER fail_reservation"); // The outer rollback also restored the trigger.
    repository.saveBookingAtomically({ contract: next, reservation });
    assert.equal(
      repository.findContractById(reservation.contractId)?.contractVersion,
      2,
    );
    assert.equal(raw.isTransaction, false);
  } finally {
    database.close();
    raw.close();
  }
});

test("AC3: The full existing suite passes unchanged (npm test), and npm run check is clean", () => {
  // Smoke-test all seven constructors through the same borrowed port. Full-suite
  // and compiler command evidence is recorded in issue 02b, not run recursively.
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 17");
  const database = new NodeSqliteDatabase(raw);
  try {
    new SqliteBookingStateRepository(database);
    new SqliteBookingPaymentJourneyRepository(database);
    const receipts = new SqliteManualTransferStore(database);
    new SqliteOwnerPayableLedger(database);
    new SqliteBankTransferSessionStore(database);
    new SqliteCheckInSupportStore(database);
    const contacts = new SqliteGuestContactRepository(database);
    contacts.savePhone({
      guestId: "guest",
      tenantId: "tenant",
      phoneNumber: "08012345678",
    });
    assert.equal(
      contacts.find("guest", "tenant")?.phoneNumber,
      "+2348012345678",
    );
    receipts.saveReceipt(
      "receipt",
      "transfer",
      "application/pdf",
      Buffer.from("%PDF-proof"),
    );
    assert.deepEqual(
      receipts.readReceipt("receipt")?.bytes,
      Buffer.from("%PDF-proof"),
    );
    assert.equal(
      database.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      0,
    );
    assert.equal(database.prepare("PRAGMA busy_timeout").get()?.timeout, 17);
    database.close();
    assert.equal(raw.isOpen, true);
    assert.equal(raw.prepare("SELECT 1 AS value").get()?.value, 1);
  } finally {
    raw.close();
  }
});
