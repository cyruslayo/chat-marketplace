import type { AdminHoldRecord, ReserveTranche } from "./reserve-payout-trust.js";

/** A command result kept so a replayed idempotency key returns the original outcome. */
export interface ExecutedReserveCommand {
  readonly commandName: string;
  readonly fingerprint: string;
  readonly result: AdminHoldRecord | ReserveTranche;
}

/** Keyed records in insertion order. Reads return copies, so a caller can never change stored state in place. */
export interface ReservePayoutRecordCollection<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

/**
 * Everything `ReservePayoutManager` must not lose across a restart (ADR 0004, ADR 0095). All collections share one
 * transaction scope, so a multi-step command commits whole or not at all.
 */
export interface ReservePayoutStateStore {
  readonly tranches: ReservePayoutRecordCollection<ReserveTranche>;
  /** Keyed by operatorId. */
  readonly adminHolds: ReservePayoutRecordCollection<AdminHoldRecord>;
  /** Keyed by idempotency key. */
  readonly executedCommands: ReservePayoutRecordCollection<ExecutedReserveCommand>;
  transaction<T>(fn: () => T): T;
}

class InMemoryCollection<T> implements ReservePayoutRecordCollection<T> {
  readonly #records = new Map<string, T>();
  get(key: string): T | undefined {
    const value = this.#records.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  set(key: string, value: T): void {
    this.#records.set(key, structuredClone(value));
  }
}

/** The default for unit tests and demos: same behaviour, nothing survives the instance. */
export class InMemoryReservePayoutStateStore implements ReservePayoutStateStore {
  readonly tranches = new InMemoryCollection<ReserveTranche>();
  readonly adminHolds = new InMemoryCollection<AdminHoldRecord>();
  readonly executedCommands = new InMemoryCollection<ExecutedReserveCommand>();
  transaction<T>(fn: () => T): T {
    return fn();
  }
}
