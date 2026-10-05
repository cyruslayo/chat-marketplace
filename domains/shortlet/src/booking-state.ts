import type { BookingContract, Reservation } from "./card-payment.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/** Small in-memory authoritative aggregate store; adapters can replace it with a transactional repository. */
export interface BookingStateRepository {
  findContractById(contractId: string): BookingContract | null;
  saveContract(contract: BookingContract): void;
  /** Commits the two halves of a Booking together. */
  saveBookingAtomically(input: {
    contract: BookingContract;
    reservation: Reservation;
  }): void;
  removeBookingAtomically(input: {
    contractId: string;
    reservationId: string;
  }): void;
  findReservationById(reservationId: string): Reservation | null;
  saveReservation(reservation: Reservation): void;
  mutateContract(
    contractId: string,
    expectedVersion: number,
    mutation: (current: BookingContract) => BookingContract,
  ): BookingContract;
  transitionReservationStatus(
    reservationId: string,
    expectedStatus: "confirmed",
    nextStatus: "cancelled" | "no_show",
  ): Reservation;
}

export class InMemoryBookingStateRepository implements BookingStateRepository {
  readonly #contracts = new Map<string, BookingContract>();
  readonly #reservations = new Map<string, Reservation>();
  constructor(
    seed: {
      contracts?: readonly BookingContract[];
      reservations?: readonly Reservation[];
    } = {},
  ) {
    seed.contracts?.forEach((contract) =>
      this.#contracts.set(contract.contractId, contract),
    );
    seed.reservations?.forEach((reservation) =>
      this.#reservations.set(reservation.reservationId, reservation),
    );
  }
  findContractById(id: string): BookingContract | null {
    return this.#contracts.get(id) ?? null;
  }
  saveContract(contract: BookingContract): void {
    this.#contracts.set(contract.contractId, contract);
  }
  saveBookingAtomically(input: {
    contract: BookingContract;
    reservation: Reservation;
  }): void {
    if (
      input.contract.reservationId !== input.reservation.reservationId ||
      input.contract.contractId !== input.reservation.contractId
    )
      throw new Error("Booking identity mismatch");
    const existingContract = this.#contracts.get(input.contract.contractId);
    const existingReservation = this.#reservations.get(
      input.reservation.reservationId,
    );
    if (
      (existingContract &&
        (existingContract.reservationId !== input.reservation.reservationId ||
          existingContract.contractId !== input.contract.contractId)) ||
      (existingReservation &&
        (existingReservation.contractId !== input.contract.contractId ||
          existingReservation.reservationId !==
            input.reservation.reservationId))
    )
      throw new Error("Booking identity conflict");
    this.#contracts.set(input.contract.contractId, input.contract);
    this.#reservations.set(input.reservation.reservationId, input.reservation);
  }
  removeBookingAtomically(input: {
    contractId: string;
    reservationId: string;
  }): void {
    this.#contracts.delete(input.contractId);
    this.#reservations.delete(input.reservationId);
  }
  findReservationById(id: string): Reservation | null {
    return this.#reservations.get(id) ?? null;
  }
  saveReservation(reservation: Reservation): void {
    this.#reservations.set(reservation.reservationId, reservation);
  }
  mutateContract(
    id: string,
    expectedVersion: number,
    mutation: (current: BookingContract) => BookingContract,
  ): BookingContract {
    const current = this.#contracts.get(id);
    if (!current || current.contractVersion !== expectedVersion)
      throw new Error("STALE_ACTION");
    const next = mutation(current);
    if (next.contractVersion !== expectedVersion + 1)
      throw new Error("Invalid atomic contract version");
    this.#contracts.set(id, next);
    return next;
  }
  transitionReservationStatus(
    id: string,
    expectedStatus: "confirmed",
    nextStatus: "cancelled" | "no_show",
  ): Reservation {
    const current = this.#reservations.get(id);
    if (!current || current.status !== expectedStatus)
      throw new Error("STALE_ACTION");
    const next = { ...current, status: nextStatus };
    this.#reservations.set(id, next);
    return next;
  }
}

/**
 * Durable SQLite implementation of BookingStateRepository for the Guest
 * composition. Authoritative contracts/reservations committed by the payment
 * confirmation path survive application restart in this repository.
 */
export class SqliteBookingStateRepository implements BookingStateRepository {
  readonly databasePath: string;
  readonly #database: SqlDatabase;
  #closed = false;

  constructor(database: SqlDatabase, databasePath: string) {
    this.databasePath = databasePath;
    this.#database = database;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS booking_contracts (
        contract_id TEXT PRIMARY KEY,
        contract_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS booking_reservations (
        reservation_id TEXT PRIMARY KEY,
        reservation_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_booking_contracts_offer
        ON booking_contracts (contract_json);
    `);
  }

  findContractById(id: string): BookingContract | null {
    const row = this.#database
      .prepare(
        "SELECT contract_json FROM booking_contracts WHERE contract_id = $id",
      )
      .get({ $id: id });
    if (!row || typeof row.contract_json !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(row.contract_json);
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as BookingContract)
        : null;
    } catch {
      return null;
    }
  }

  saveContract(contract: BookingContract): void {
    this.#database
      .prepare(
        "INSERT INTO booking_contracts (contract_id, contract_json) VALUES ($id, $json) ON CONFLICT(contract_id) DO UPDATE SET contract_json = excluded.contract_json",
      )
      .run({ $id: contract.contractId, $json: JSON.stringify(contract) });
  }

  saveBookingAtomically(input: {
    contract: BookingContract;
    reservation: Reservation;
  }): void {
    if (
      input.contract.reservationId !== input.reservation.reservationId ||
      input.contract.contractId !== input.reservation.contractId
    )
      throw new Error("Booking identity mismatch");
    const existingContract = this.findContractById(input.contract.contractId);
    const existingReservation = this.findReservationById(
      input.reservation.reservationId,
    );
    if (
      (existingContract &&
        (existingContract.reservationId !== input.reservation.reservationId ||
          existingContract.contractId !== input.contract.contractId)) ||
      (existingReservation &&
        (existingReservation.contractId !== input.contract.contractId ||
          existingReservation.reservationId !==
            input.reservation.reservationId))
    )
      throw new Error("Booking identity conflict");
    // ADR 0044/0046/0095: synchronous atomic write; nested callers retain their transaction boundary.
    this.#database.transaction(() => {
      this.saveContract(input.contract);
      this.saveReservation(input.reservation);
    });
  }

  removeBookingAtomically(input: {
    contractId: string;
    reservationId: string;
  }): void {
    this.#database
      .prepare("DELETE FROM booking_contracts WHERE contract_id = $id")
      .run({ $id: input.contractId });
    this.#database
      .prepare("DELETE FROM booking_reservations WHERE reservation_id = $id")
      .run({ $id: input.reservationId });
  }

  findReservationById(id: string): Reservation | null {
    const row = this.#database
      .prepare(
        "SELECT reservation_json FROM booking_reservations WHERE reservation_id = $id",
      )
      .get({ $id: id });
    if (!row || typeof row.reservation_json !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(row.reservation_json);
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as Reservation)
        : null;
    } catch {
      return null;
    }
  }

  saveReservation(reservation: Reservation): void {
    this.#database
      .prepare(
        "INSERT INTO booking_reservations (reservation_id, reservation_json) VALUES ($id, $json) ON CONFLICT(reservation_id) DO UPDATE SET reservation_json = excluded.reservation_json",
      )
      .run({
        $id: reservation.reservationId,
        $json: JSON.stringify(reservation),
      });
  }

  mutateContract(
    id: string,
    expectedVersion: number,
    mutation: (current: BookingContract) => BookingContract,
  ): BookingContract {
    const current = this.findContractById(id);
    if (!current || current.contractVersion !== expectedVersion)
      throw new Error("STALE_ACTION");
    const next = mutation(current);
    if (next.contractVersion !== expectedVersion + 1)
      throw new Error("Invalid atomic contract version");
    this.saveContract(next);
    return next;
  }

  transitionReservationStatus(
    id: string,
    expectedStatus: "confirmed",
    nextStatus: "cancelled" | "no_show",
  ): Reservation {
    const current = this.findReservationById(id);
    if (!current || current.status !== expectedStatus)
      throw new Error("STALE_ACTION");
    const next = { ...current, status: nextStatus };
    this.saveReservation(next);
    return next;
  }

  close(): void {
    if (!this.#closed) this.#closed = true;
  }
}
