import type { SqlDatabase, SqlValue } from "../../../packages/platform-core/src/sql-database.js";
import { assertBalanced, sameAdjustment, type RevenueAccountingRepository, type LedgerJournal, type EarnedCommissionRecord, type RevenueAdjustmentRecord } from "./revenue-accounting.js";
import type { RevenueReleaseRecord, LedgerAdjustment, RevenueReleaseStateStore } from "./revenue-release.js";

function snapshot<T extends object>(value: SqlValue | undefined): T {
  if (typeof value !== "string") throw new Error("Invalid revenue snapshot");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid revenue snapshot");
  return parsed as T;
}

function integer(value: unknown, signed = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error("Revenue amount must be a safe integer in kobo");
  return value;
}

function releaseIdentity(value: unknown): Record<string, unknown> & { releaseId: string; reservationId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("releaseId" in value) || !("reservationId" in value)
    || typeof value.releaseId !== "string" || !value.releaseId || typeof value.reservationId !== "string" || !value.reservationId) throw new Error("Invalid revenue release identity");
  return value as Record<string, unknown> & { releaseId: string; reservationId: string };
}

// Snapshot fields are preserved; money also has exact INTEGER columns (ADR 0078).
const moneyFields = ["commissionBaseKobo", "commissionKobo", "operatorNetKobo", "payableNowKobo", "routineReserveTrancheKobo", "deferredPostStayKobo", "riskHoldKobo"] as const;
const moneyColumns = ["commission_base_kobo", "commission_kobo", "operator_net_kobo", "payable_now_kobo", "routine_reserve_tranche_kobo", "deferred_post_stay_kobo", "risk_hold_kobo"] as const;

/** Revenue release, journal, ledger and adjustment tables, applied by the schema migrations and by this repository. */
export const REVENUE_ACCOUNTING_SCHEMA = `
      CREATE TABLE IF NOT EXISTS revenue_releases (
        reservation_id TEXT PRIMARY KEY, release_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
        ${moneyColumns.map((column) => `${column} INTEGER CHECK (${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} >= 0))`).join(",")}
      );
      CREATE TABLE IF NOT EXISTS revenue_journals (journal_id TEXT PRIMARY KEY, release_id TEXT NOT NULL, payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revenue_journals_release ON revenue_journals (release_id);
      CREATE TABLE IF NOT EXISTS revenue_ledger_lines (
        journal_id TEXT NOT NULL, ordinal INTEGER NOT NULL, amount_kobo INTEGER NOT NULL CHECK (typeof(amount_kobo) = 'integer' AND amount_kobo >= 0),
        payload_json TEXT NOT NULL, PRIMARY KEY (journal_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS revenue_earned_commission (
        release_id TEXT PRIMARY KEY, earned_commission_kobo INTEGER NOT NULL CHECK (typeof(earned_commission_kobo) = 'integer' AND earned_commission_kobo >= 0), payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revenue_adjustments (
        adjustment_id TEXT NOT NULL, adjustment_version INTEGER NOT NULL, release_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY (adjustment_id, adjustment_version)
      );
      CREATE INDEX IF NOT EXISTS revenue_adjustments_release ON revenue_adjustments (release_id);
    `;

export class SqliteRevenueAccountingRepository implements RevenueAccountingRepository {
  constructor(private readonly database: SqlDatabase) {
    database.exec(REVENUE_ACCOUNTING_SCHEMA);
  }

  findReleaseByReservationId(id: string): unknown {
    const row = this.database.prepare("SELECT payload_json FROM revenue_releases WHERE reservation_id = ?").get([id]);
    return row ? snapshot(row.payload_json) : null;
  }

  findReleaseById(id: string): unknown {
    const row = this.database.prepare("SELECT payload_json FROM revenue_releases WHERE release_id = ?").get([id]);
    return row ? snapshot(row.payload_json) : null;
  }

  commitRelease(input: Parameters<RevenueAccountingRepository["commitRelease"]>[0]): unknown {
    // ADR 0095: release, journal lines and earned evidence share one synchronous transaction.
    return this.database.transaction(() => {
      const release = releaseIdentity(input.release);
      const existing = this.findReleaseByReservationId(release.reservationId);
      if (existing) return existing;
      assertBalanced(input.journal.lines);
      if (input.journal.correlationId !== release.releaseId || input.earnedCommission.releaseId !== release.releaseId) throw new Error("Release accounting correlation is invalid");
      const amounts = moneyFields.map((field) => release[field] === undefined ? null : integer(release[field]));
      this.database.prepare(`INSERT INTO revenue_releases (reservation_id, release_id, payload_json, ${moneyColumns.join(",")}) VALUES (${Array(3 + amounts.length).fill("?").join(",")})`)
        .run([release.reservationId, release.releaseId, JSON.stringify(release), ...amounts]);
      this.#postJournal(input.journal);
      this.database.prepare("INSERT INTO revenue_earned_commission (release_id, earned_commission_kobo, payload_json) VALUES (?, ?, ?)")
        .run([release.releaseId, integer(input.earnedCommission.earnedCommissionKobo), JSON.stringify(input.earnedCommission)]);
      return input.release;
    });
  }

  #postJournal(journal: LedgerJournal): void {
    assertBalanced(journal.lines);
    for (const line of journal.lines) integer(line.amountKobo);
    // Matches the in-memory journal map's replacement semantics for the same journal ID.
    this.database.prepare("INSERT INTO revenue_journals (journal_id, release_id, payload_json) VALUES (?, ?, ?) ON CONFLICT(journal_id) DO UPDATE SET release_id = excluded.release_id, payload_json = excluded.payload_json")
      .run([journal.journalId, journal.correlationId, JSON.stringify(journal)]);
    this.database.prepare("DELETE FROM revenue_ledger_lines WHERE journal_id = ?").run([journal.journalId]);
    journal.lines.forEach((line, ordinal) => this.database.prepare("INSERT INTO revenue_ledger_lines (journal_id, ordinal, amount_kobo, payload_json) VALUES (?, ?, ?, ?)")
      .run([journal.journalId, ordinal, line.amountKobo, JSON.stringify(line)]));
  }

  findLedgerEntriesForRelease(id: string): readonly LedgerJournal[] {
    return this.database.prepare("SELECT payload_json FROM revenue_journals WHERE release_id = ? ORDER BY rowid").all([id])
      .map((row) => snapshot<LedgerJournal>(row.payload_json));
  }

  findAdjustmentsForRelease(id: string): readonly RevenueAdjustmentRecord[] {
    return this.database.prepare("SELECT payload_json FROM revenue_adjustments WHERE release_id = ? ORDER BY rowid").all([id])
      .map((row) => snapshot<RevenueAdjustmentRecord>(row.payload_json));
  }

  postAdjustment({ adjustment }: Parameters<RevenueAccountingRepository["postAdjustment"]>[0]): RevenueAdjustmentRecord {
    return this.database.transaction(() => {
      assertBalanced(adjustment.journal.lines);
      if (adjustment.journal.correlationId !== adjustment.releaseId) throw new Error("Adjustment journal correlation is invalid");
      const existing = this.findAdjustment(adjustment.adjustmentId, adjustment.adjustmentVersion);
      if (existing) {
        if (!sameAdjustment(existing, adjustment)) throw new Error("Adjustment identity conflict");
        return existing;
      }
      if (!this.findReleaseById(adjustment.releaseId)) throw new Error("Adjustment release does not exist");
      this.database.prepare("INSERT INTO revenue_adjustments (adjustment_id, adjustment_version, release_id, payload_json) VALUES (?, ?, ?, ?)")
        .run([adjustment.adjustmentId, adjustment.adjustmentVersion, adjustment.releaseId, JSON.stringify(adjustment)]);
      this.#postJournal(adjustment.journal);
      return adjustment;
    });
  }

  findAdjustment(id: string, version: number): RevenueAdjustmentRecord | null {
    const row = this.database.prepare("SELECT payload_json FROM revenue_adjustments WHERE adjustment_id = ? AND adjustment_version = ?").get([id, version]);
    return row ? snapshot<RevenueAdjustmentRecord>(row.payload_json) : null;
  }

  getEarnedCommissionRecord(id: string): EarnedCommissionRecord | null {
    const row = this.database.prepare("SELECT payload_json FROM revenue_earned_commission WHERE release_id = ?").get([id]);
    return row ? snapshot<EarnedCommissionRecord>(row.payload_json) : null;
  }
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const REVENUE_COMPATIBILITY_SCHEMA = `CREATE TABLE IF NOT EXISTS revenue_compatibility_releases (
      reservation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL,
      commission_base_kobo INTEGER NOT NULL, commission_kobo INTEGER NOT NULL, operator_net_kobo INTEGER NOT NULL,
      payable_net_kobo INTEGER NOT NULL, reserve_tranche_kobo INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_compatibility_adjustments (
      adjustment_id TEXT PRIMARY KEY, adjustment_kobo INTEGER NOT NULL, payload_json TEXT NOT NULL
    )`;

/** Compatibility-only state; production releases use the accounting repository above. */
export class SqliteRevenueReleaseStateStore implements RevenueReleaseStateStore {
  constructor(private readonly database: SqlDatabase) {
    database.exec(REVENUE_COMPATIBILITY_SCHEMA);
  }

  findRelease(id: string): RevenueReleaseRecord | null {
    const row = this.database.prepare("SELECT payload_json FROM revenue_compatibility_releases WHERE reservation_id = ?").get([id]);
    return row ? snapshot<RevenueReleaseRecord>(row.payload_json) : null;
  }

  recordRelease(release: RevenueReleaseRecord): void {
    const amounts = [release.commissionBaseKobo, release.commissionKobo, release.operatorNetKobo, release.payableNetKobo, release.reserveTrancheKobo].map((value) => integer(value));
    this.database.prepare("INSERT INTO revenue_compatibility_releases (reservation_id, payload_json, commission_base_kobo, commission_kobo, operator_net_kobo, payable_net_kobo, reserve_tranche_kobo) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run([release.reservationId, JSON.stringify(release), ...amounts]);
  }

  recordAdjustment(adjustment: LedgerAdjustment): void {
    this.database.prepare("INSERT INTO revenue_compatibility_adjustments (adjustment_id, adjustment_kobo, payload_json) VALUES (?, ?, ?)")
      .run([adjustment.adjustmentId, integer(adjustment.adjustmentKobo, true), JSON.stringify(adjustment)]);
  }
}
