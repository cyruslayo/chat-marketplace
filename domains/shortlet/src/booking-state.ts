import type { BookingContract, Reservation } from "./card-payment.js";

/** Small in-memory authoritative aggregate store; adapters can replace it with a transactional repository. */
export interface BookingStateRepository {
  findContractById(contractId: string): BookingContract | null;
  saveContract(contract: BookingContract): void;
  /** Commits the two halves of a Booking together. */
  saveBookingAtomically(input: { contract: BookingContract; reservation: Reservation }): void;
  removeBookingAtomically(input: { contractId: string; reservationId: string }): void;
  findReservationById(reservationId: string): Reservation | null;
  saveReservation(reservation: Reservation): void;
  mutateContract(contractId: string, expectedVersion: number, mutation: (current: BookingContract) => BookingContract): BookingContract;
  transitionReservationStatus(reservationId: string, expectedStatus: "confirmed", nextStatus: "cancelled" | "no_show"): Reservation;
}

export class InMemoryBookingStateRepository implements BookingStateRepository {
  readonly #contracts = new Map<string, BookingContract>();
  readonly #reservations = new Map<string, Reservation>();
  constructor(seed: { contracts?: readonly BookingContract[]; reservations?: readonly Reservation[] } = {}) {
    seed.contracts?.forEach((contract) => this.#contracts.set(contract.contractId, contract));
    seed.reservations?.forEach((reservation) => this.#reservations.set(reservation.reservationId, reservation));
  }
  findContractById(id: string): BookingContract | null { return this.#contracts.get(id) ?? null; }
  saveContract(contract: BookingContract): void { this.#contracts.set(contract.contractId, contract); }
  saveBookingAtomically(input: { contract: BookingContract; reservation: Reservation }): void {
    if (input.contract.reservationId !== input.reservation.reservationId || input.contract.contractId !== input.reservation.contractId) throw new Error("Booking identity mismatch");
    const existingContract = this.#contracts.get(input.contract.contractId);
    const existingReservation = this.#reservations.get(input.reservation.reservationId);
    if ((existingContract && (existingContract.reservationId !== input.reservation.reservationId || existingContract.contractId !== input.contract.contractId)) || (existingReservation && (existingReservation.contractId !== input.contract.contractId || existingReservation.reservationId !== input.reservation.reservationId))) throw new Error("Booking identity conflict");
    this.#contracts.set(input.contract.contractId, input.contract);
    this.#reservations.set(input.reservation.reservationId, input.reservation);
  }
  removeBookingAtomically(input: { contractId: string; reservationId: string }): void { this.#contracts.delete(input.contractId); this.#reservations.delete(input.reservationId); }
  findReservationById(id: string): Reservation | null { return this.#reservations.get(id) ?? null; }
  saveReservation(reservation: Reservation): void { this.#reservations.set(reservation.reservationId, reservation); }
  mutateContract(id: string, expectedVersion: number, mutation: (current: BookingContract) => BookingContract): BookingContract {
    const current = this.#contracts.get(id);
    if (!current || current.contractVersion !== expectedVersion) throw new Error("STALE_ACTION");
    const next = mutation(current);
    if (next.contractVersion !== expectedVersion + 1) throw new Error("Invalid atomic contract version");
    this.#contracts.set(id, next);
    return next;
  }
  transitionReservationStatus(id: string, expectedStatus: "confirmed", nextStatus: "cancelled" | "no_show"): Reservation {
    const current = this.#reservations.get(id);
    if (!current || current.status !== expectedStatus) throw new Error("STALE_ACTION");
    const next = { ...current, status: nextStatus };
    this.#reservations.set(id, next);
    return next;
  }
}
