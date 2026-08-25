import { DatabaseSync } from "node:sqlite";

export type AvailabilityCommitmentKind = "operator_hold" | "operator_block" | "booking_request_block" | "payment_pending" | "confirmed_booking";
export type CreatableAvailabilityCommitmentKind = Exclude<AvailabilityCommitmentKind, "confirmed_booking">;
export type AvailabilityCommitmentState = "active" | "released" | "expired";

export interface AvailabilityCommitment {
  commitmentId: string;
  unitId: string;
  kind: AvailabilityCommitmentKind;
  start: string;
  end: string;
  state: AvailabilityCommitmentState;
  createdAt: string;
  expiresAt: string | null;
  extensionCount: number;
  operatorId: string | null;
  holderId: string | null;
  reason: string | null;
}

export interface CreateAvailabilityCommitment {
  commitmentId: string;
  unitId: string;
  kind: CreatableAvailabilityCommitmentKind;
  start: string;
  end: string;
  createdAt: string;
  expiresAt?: string | null;
  extensionCount?: number;
  operatorId?: string | null;
  holderId?: string | null;
  reason?: string | null;
}

export class AvailabilityConflictError extends Error {
  constructor(message = "Availability conflict: dates overlap an active commitment") {
    super(message);
    this.name = "AvailabilityConflictError";
  }
}

interface CommitmentRow {
  commitment_id: string;
  unit_id: string;
  kind: AvailabilityCommitmentKind;
  start_date: string;
  end_date: string;
  state: AvailabilityCommitmentState;
  created_at: string;
  expires_at: string | null;
  extension_count: number;
  operator_id: string | null;
  holder_id: string | null;
  reason: string | null;
}

function project(row: CommitmentRow): AvailabilityCommitment {
  return {
    commitmentId: row.commitment_id,
    unitId: row.unit_id,
    kind: row.kind,
    start: row.start_date,
    end: row.end_date,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    extensionCount: row.extension_count,
    operatorId: row.operator_id,
    holderId: row.holder_id,
    reason: row.reason
  };
}

export class SqliteAvailabilityStore {
  readonly databasePath: string;
  #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS availability_commitments (
        commitment_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        extension_count INTEGER NOT NULL DEFAULT 0,
        operator_id TEXT,
        holder_id TEXT,
        reason TEXT,
        released_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_availability_active_unit_dates
        ON availability_commitments (unit_id, state, start_date, end_date);
    `);
  }

  #withWriteTransaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.#database.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  #expireStale(now: string): void {
    this.#database.prepare(`
      UPDATE availability_commitments
      SET state = 'expired', released_at = $now
      WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= $now
    `).run({ $now: now });
  }

  #findConflict(unitId: string, start: string, end: string): CommitmentRow | undefined {
    return this.#database.prepare(`
      SELECT commitment_id, unit_id, kind, start_date, end_date, state,
             created_at, expires_at, extension_count, operator_id, holder_id, reason
      FROM availability_commitments
      WHERE unit_id = $unitId AND state = 'active'
        AND start_date < $end AND $start < end_date
      ORDER BY CASE kind WHEN 'operator_block' THEN 0 ELSE 1 END
      LIMIT 1
    `).get({ $unitId: unitId, $start: start, $end: end }) as CommitmentRow | undefined;
  }

  create(commitment: CreateAvailabilityCommitment): AvailabilityCommitment {
    if ((commitment as { kind: AvailabilityCommitmentKind }).kind === "confirmed_booking") {
      throw new Error("confirmed_booking commitments must be created through the payment_pending transition");
    }
    return this.#withWriteTransaction(() => {
      this.#expireStale(commitment.createdAt);
      const conflict = this.#findConflict(commitment.unitId, commitment.start, commitment.end);
      if (conflict) {
        const label = conflict.kind === "operator_block" ? "an operator block" : "an active hold";
        throw new AvailabilityConflictError(`Availability conflict: dates overlap ${label}`);
      }
      this.#database.prepare(`
        INSERT INTO availability_commitments
          (commitment_id, unit_id, kind, start_date, end_date, state, created_at,
           expires_at, extension_count, operator_id, holder_id, reason)
        VALUES ($commitmentId, $unitId, $kind, $start, $end, 'active', $createdAt,
                $expiresAt, $extensionCount, $operatorId, $holderId, $reason)
      `).run({
        $commitmentId: commitment.commitmentId,
        $unitId: commitment.unitId,
        $kind: commitment.kind,
        $start: commitment.start,
        $end: commitment.end,
        $createdAt: commitment.createdAt,
        $expiresAt: commitment.expiresAt ?? null,
        $extensionCount: commitment.extensionCount ?? 0,
        $operatorId: commitment.operatorId ?? null,
        $holderId: commitment.holderId ?? null,
        $reason: commitment.reason ?? null
      });
      return { ...commitment, state: "active", expiresAt: commitment.expiresAt ?? null, extensionCount: commitment.extensionCount ?? 0, operatorId: commitment.operatorId ?? null, holderId: commitment.holderId ?? null, reason: commitment.reason ?? null };
    });
  }

  assertActiveCommitment(commitmentId: string, unitId: string, start: string, end: string, now: string, expectedKind?: AvailabilityCommitmentKind): AvailabilityCommitment {
    return this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT commitment_id, unit_id, kind, start_date, end_date, state,
               created_at, expires_at, extension_count, operator_id, holder_id, reason
        FROM availability_commitments
        WHERE commitment_id = $commitmentId
          AND unit_id = $unitId
          AND state = 'active'
          AND start_date = $start
          AND end_date = $end
          AND ($kind IS NULL OR kind = $kind)
      `).get({ $commitmentId: commitmentId, $unitId: unitId, $start: start, $end: end, $kind: expectedKind ?? null }) as CommitmentRow | undefined;
      if (!row) throw new Error("Availability commitment is no longer valid");
      return project(row);
    });
  }

  findActive(unitId: string, start: string, end: string, now: string): AvailabilityCommitment[] {
    return this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const rows = this.#database.prepare(`
        SELECT commitment_id, unit_id, kind, start_date, end_date, state,
               created_at, expires_at, extension_count, operator_id, holder_id, reason
        FROM availability_commitments
        WHERE unit_id = $unitId AND state = 'active'
          AND start_date < $end AND $start < end_date
        ORDER BY CASE kind WHEN 'operator_block' THEN 0 ELSE 1 END, start_date
      `).all({ $unitId: unitId, $start: start, $end: end }) as unknown as CommitmentRow[];
      return rows.map(project);
    });
  }

  releaseOperatorHold(commitmentId: string, now: string): void {
    this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT kind, state FROM availability_commitments WHERE commitment_id = $commitmentId
      `).get({ $commitmentId: commitmentId }) as { kind: AvailabilityCommitmentKind; state: AvailabilityCommitmentState } | undefined;
      if (!row || row.kind !== "operator_hold") {
        throw new Error("Availability commitment is not an Operator Hold");
      }
      if (row.state !== "active") throw new Error("Operator Hold is no longer active");
      this.#database.prepare(`
        UPDATE availability_commitments
        SET state = 'released', released_at = $now
        WHERE commitment_id = $commitmentId AND kind = 'operator_hold' AND state = 'active'
      `).run({ $commitmentId: commitmentId, $now: now });
    });
  }

  releaseBookingRequestBlock(commitmentId: string, now: string): void {
    this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT kind, state FROM availability_commitments WHERE commitment_id = $commitmentId
      `).get({ $commitmentId: commitmentId }) as { kind: AvailabilityCommitmentKind; state: AvailabilityCommitmentState } | undefined;
      if (row && row.kind !== "booking_request_block") {
        throw new Error("Availability commitment is not a booking request block");
      }
      this.#database.prepare(`
        UPDATE availability_commitments
        SET state = 'released', released_at = $now
        WHERE commitment_id = $commitmentId AND kind = 'booking_request_block' AND state = 'active'
      `).run({ $commitmentId: commitmentId, $now: now });
    });
  }

  releaseConfirmedBooking(commitmentId: string, unitId: string, start: string, end: string, now: string): void {
    this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`SELECT kind, state, unit_id, start_date, end_date FROM availability_commitments WHERE commitment_id = $commitmentId`).get({ $commitmentId: commitmentId }) as { kind: AvailabilityCommitmentKind; state: AvailabilityCommitmentState; unit_id: string; start_date: string; end_date: string } | undefined;
      if (!row || row.kind !== "confirmed_booking" || row.unit_id !== unitId || row.start_date !== start || row.end_date !== end) throw new Error("Confirmed booking commitment does not match the expected inventory");
      if (row.state === "released") return;
      if (row.state !== "active") throw new Error("Confirmed booking commitment is not active");
      this.#database.prepare(`UPDATE availability_commitments SET state = 'released', released_at = $now WHERE commitment_id = $commitmentId AND state = 'active'`).run({ $commitmentId: commitmentId, $now: now });
    });
  }

  releasePaymentPending(commitmentId: string, now: string): void {
    this.#withWriteTransaction(() => {
      this.#expireStale(now);
      this.#database.prepare(`
        UPDATE availability_commitments
        SET state = 'released', released_at = $now
        WHERE commitment_id = $commitmentId AND kind = 'payment_pending' AND state = 'active'
      `).run({ $commitmentId: commitmentId, $now: now });
    });
  }

  extendPaymentPending(commitmentId: string, expiresAt: string, now: string): void {
    this.#withWriteTransaction(() => {
      const result = this.#database.prepare(`UPDATE availability_commitments SET expires_at = $expiresAt WHERE commitment_id = $commitmentId AND kind = 'payment_pending' AND state = 'active' AND expires_at <= $now`).run({ $commitmentId: commitmentId, $expiresAt: expiresAt, $now: now });
      if (result.changes !== 1) throw new Error("Payment Pending commitment is no longer active");
    });
  }

  transitionPaymentPendingToConfirmedBooking({ commitmentId, unitId, start, end, now }: { commitmentId: string; unitId: string; start: string; end: string; now: string }): AvailabilityCommitment {
    return this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT commitment_id, unit_id, kind, start_date, end_date, state,
               created_at, expires_at, extension_count, operator_id, holder_id, reason
        FROM availability_commitments
        WHERE commitment_id = $commitmentId
      `).get({ $commitmentId: commitmentId }) as CommitmentRow | undefined;
      if (!row) throw new Error("Payment Pending commitment not found");
      if (row.state !== "active") throw new Error("Payment Pending commitment is no longer active");
      if (row.kind !== "payment_pending") throw new Error("Availability commitment is not Payment Pending");
      if (row.unit_id !== unitId || row.start_date !== start || row.end_date !== end) {
        throw new Error("Payment Pending commitment does not match the expected inventory");
      }
      this.#database.prepare(`
        UPDATE availability_commitments
        SET kind = 'confirmed_booking', expires_at = NULL
        WHERE commitment_id = $commitmentId AND state = 'active' AND kind = 'payment_pending'
      `).run({ $commitmentId: commitmentId });
      return project({ ...row, kind: "confirmed_booking", expires_at: null });
    });
  }

  transitionBookingRequestBlockToPaymentPending({ commitmentId, unitId, start, end, now }: { commitmentId: string; unitId: string; start: string; end: string; now: string }): AvailabilityCommitment {
    return this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT commitment_id, unit_id, kind, start_date, end_date, state,
               created_at, expires_at, extension_count, operator_id, holder_id, reason
        FROM availability_commitments
        WHERE commitment_id = $commitmentId AND state = 'active'
      `).get({ $commitmentId: commitmentId }) as CommitmentRow | undefined;
      if (!row || row.kind !== "booking_request_block" || row.unit_id !== unitId || row.start_date !== start || row.end_date !== end) {
        throw new Error("Booking request block is no longer valid for payment pending transition");
      }
      const expiresAt = new Date(new Date(now).getTime() + 20 * 60 * 1000).toISOString();
      this.#database.prepare(`
        UPDATE availability_commitments
        SET kind = 'payment_pending', expires_at = $expiresAt
        WHERE commitment_id = $commitmentId AND state = 'active' AND kind = 'booking_request_block'
      `).run({ $commitmentId: commitmentId, $expiresAt: expiresAt });
      return project({ ...row, kind: "payment_pending", expires_at: expiresAt });
    });
  }

  extendOperatorHold(commitmentId: string, now: string): AvailabilityCommitment {
    return this.#withWriteTransaction(() => {
      this.#expireStale(now);
      const row = this.#database.prepare(`
        SELECT commitment_id, unit_id, kind, start_date, end_date, state,
               created_at, expires_at, extension_count, operator_id, holder_id, reason
        FROM availability_commitments
        WHERE commitment_id = $commitmentId
      `).get({ $commitmentId: commitmentId }) as CommitmentRow | undefined;
      if (!row) throw new Error(`Operator Hold not found: ${commitmentId}`);
      if (row.kind !== "operator_hold") throw new Error("Availability commitment is not an Operator Hold");
      if (row.state === "expired") throw new Error("Operator Hold expired automatically");
      if (row.state !== "active") throw new Error("Operator Hold is no longer active");
      if (row.expires_at === null || new Date(now) >= new Date(row.expires_at)) throw new Error("Operator Hold expired automatically");
      if (row.extension_count !== 0) throw new Error("Maximum extension limit reached: at most 1 extension permitted");
      const maxExpiry = new Date(new Date(row.created_at).getTime() + 60 * 60 * 1000);
      const newExpiry = maxExpiry.toISOString();
      this.#database.prepare(`
        UPDATE availability_commitments
        SET expires_at = $expiresAt, extension_count = 1
        WHERE commitment_id = $commitmentId AND kind = 'operator_hold' AND state = 'active'
      `).run({ $commitmentId: commitmentId, $expiresAt: newExpiry });
      return project({ ...row, expires_at: newExpiry, extension_count: 1 });
    });
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }
}
