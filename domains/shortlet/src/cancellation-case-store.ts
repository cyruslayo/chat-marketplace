import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import type { CancellationLiability } from "./cancellation-noshow.js";

export type CancellationOutcome = "guest_cancellation" | "reviewed_cancellation" | "no_show";

/**
 * Durable state for one Reservation's cancellation / no-show workflow (App-Expansion Issue 05, D4, ADR 0058, 0075).
 * Carries ids, dates, kobo amounts, and status codes only — never payment references, contact data, or credentials.
 */
export interface CancellationCase {
  readonly cancellationId: string;
  readonly reservationId: string;
  readonly caseVersion: number;
  readonly outcome: CancellationOutcome;
  readonly liability?: CancellationLiability;
  readonly stayDates?: { readonly checkIn: string; readonly checkOut: string };
  readonly cancelledAt?: string;
  readonly stayRefundAmountKobo?: number;
  readonly depositRefundAmountKobo?: number;
  readonly refundStatus: "not_started" | "pending" | "settled" | "failed";
  readonly depositRefundStatus?: "not_applicable" | "pending" | "settled" | "failed" | "reconciliation_required";
  readonly depositRefundId?: string;
  readonly inventoryReleaseStatus: "pending" | "released" | "reconciliation_required";
  readonly ledgerStatus: "pending" | "posted" | "reconciliation_required";
  readonly ledgerRecordId?: string;
  readonly refundId?: string;
}

export interface CancellationCaseRepository {
  findByReservationId(reservationId: string): CancellationCase | null;
  createIfAbsent(value: CancellationCase): CancellationCase;
  update(reservationId: string, expectedCaseVersion: number, mutation: (current: CancellationCase) => CancellationCase): CancellationCase;
  /** Acquires an exclusive in-flight resume guard for `reservationId`, or returns null if a resume is already active. */
  tryAcquireResumeGuard?(reservationId: string): (() => void) | null;
}

export class InMemoryCancellationCaseRepository implements CancellationCaseRepository {
  readonly #cases = new Map<string, CancellationCase>();
  readonly #activeResumes = new Set<string>();

  findByReservationId(id: string): CancellationCase | null {
    return this.#cases.get(id) ?? null;
  }

  createIfAbsent(value: CancellationCase): CancellationCase {
    const current = this.#cases.get(value.reservationId);
    if (current) return current;
    this.#cases.set(value.reservationId, value);
    return value;
  }

  update(id: string, expected: number, mutation: (current: CancellationCase) => CancellationCase): CancellationCase {
    const current = this.#cases.get(id);
    if (!current || current.caseVersion !== expected) throw new Error("STALE_ACTION");
    const next = mutation(current);
    if (next.caseVersion !== expected + 1) throw new Error("Invalid cancellation case version");
    this.#cases.set(id, next);
    return next;
  }

  tryAcquireResumeGuard(reservationId: string): (() => void) | null {
    if (this.#activeResumes.has(reservationId)) return null;
    this.#activeResumes.add(reservationId);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#activeResumes.delete(reservationId);
      }
    };
  }
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const CANCELLATION_CASES_SCHEMA = `
      CREATE TABLE IF NOT EXISTS cancellation_cases (
        reservation_id TEXT PRIMARY KEY,
        cancellation_id TEXT NOT NULL UNIQUE,
        case_version INTEGER NOT NULL CHECK (case_version >= 1),
        outcome TEXT NOT NULL,
        liability TEXT NOT NULL,
        case_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `;

const ACTIVE_RESUMES_BY_DB = new WeakMap<SqlDatabase, Set<string>>();

function isCancellationCaseRecord(value: unknown): value is CancellationCase {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.cancellationId === "string" &&
    typeof candidate.reservationId === "string" &&
    typeof candidate.caseVersion === "number" &&
    typeof candidate.outcome === "string" &&
    typeof candidate.refundStatus === "string" &&
    typeof candidate.inventoryReleaseStatus === "string" &&
    typeof candidate.ledgerStatus === "string"
  );
}

/**
 * Durable SQLite implementation of `CancellationCaseRepository` (ADR 0095, 0075, Issue 05).
 * Reads fresh from SQLite on every call and uses SQLite transactions + version CAS on updates.
 */
export class SqliteCancellationCaseRepository implements CancellationCaseRepository {
  readonly #database: SqlDatabase;
  readonly #clock: () => Date;

  constructor(database: SqlDatabase, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
    this.#database.exec(CANCELLATION_CASES_SCHEMA);
  }

  findByReservationId(reservationId: string): CancellationCase | null {
    const row = this.#database
      .prepare("SELECT case_json FROM cancellation_cases WHERE reservation_id = $id")
      .get({ $id: reservationId });
    if (!row || typeof row.case_json !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(row.case_json);
      return isCancellationCaseRecord(parsed) ? Object.freeze(parsed) : null;
    } catch {
      return null;
    }
  }

  createIfAbsent(value: CancellationCase): CancellationCase {
    const stored: CancellationCase = Object.freeze({ ...value });
    this.#database
      .prepare(
        "INSERT INTO cancellation_cases (reservation_id, cancellation_id, case_version, outcome, liability, case_json, updated_at) VALUES ($reservationId, $cancellationId, $caseVersion, $outcome, $liability, $caseJson, $updatedAt) ON CONFLICT(reservation_id) DO NOTHING",
      )
      .run({
        $reservationId: stored.reservationId,
        $cancellationId: stored.cancellationId,
        $caseVersion: stored.caseVersion,
        $outcome: stored.outcome,
        $liability: stored.liability ?? "guest",
        $caseJson: JSON.stringify(stored),
        $updatedAt: stored.cancelledAt ?? this.#clock().toISOString(),
      });
    return this.findByReservationId(stored.reservationId)!;
  }

  update(
    reservationId: string,
    expectedCaseVersion: number,
    mutation: (current: CancellationCase) => CancellationCase,
  ): CancellationCase {
    return this.#database.transaction(() => {
      const current = this.findByReservationId(reservationId);
      if (!current || current.caseVersion !== expectedCaseVersion) {
        throw new Error("STALE_ACTION");
      }
      const next = Object.freeze(mutation(current));
      if (next.caseVersion !== expectedCaseVersion + 1) {
        throw new Error("Invalid cancellation case version");
      }
      const result = this.#database
        .prepare(
          "UPDATE cancellation_cases SET case_version = $nextVersion, outcome = $outcome, liability = $liability, case_json = $caseJson, updated_at = $updatedAt WHERE reservation_id = $reservationId AND case_version = $expectedVersion",
        )
        .run({
          $reservationId: reservationId,
          $expectedVersion: expectedCaseVersion,
          $nextVersion: next.caseVersion,
          $outcome: next.outcome,
          $liability: next.liability ?? "guest",
          $caseJson: JSON.stringify(next),
          $updatedAt: this.#clock().toISOString(),
        });
      if (result.changes !== 1) {
        throw new Error("STALE_ACTION");
      }
      return next;
    });
  }

  tryAcquireResumeGuard(reservationId: string): (() => void) | null {
    let active = ACTIVE_RESUMES_BY_DB.get(this.#database);
    if (!active) {
      active = new Set<string>();
      ACTIVE_RESUMES_BY_DB.set(this.#database, active);
    }
    if (active.has(reservationId)) return null;
    active.add(reservationId);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        active.delete(reservationId);
      }
    };
  }
}
