import type { R2Bucket } from "@cloudflare/workers-types";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/**
 * Slice 12a: the daily evidence export and the orphaned-receipt sweep.
 *
 * Durable Object point-in-time recovery covers 30 days, so a daily off-object copy gives a second, replayable
 * record (ADR 0079). One JSONL object per table per day keeps every write small: no single query or object can
 * approach the Durable Object limits. The task is idempotent — the same day writes the same keys again.
 *
 * Table names come from the stores themselves, not invented. `manual_transfer_receipts` exports its metadata only:
 * the receipt bytes live in R2 (ADR 0090) and a legacy BLOB row must not be inlined into a JSON object.
 */
export const EXPORT_TABLES = [
  "audit_log",
  "booking_contracts",
  "booking_reservations",
  "guest_booking_requests",
  "guest_conditional_offers",
  "guest_booking_snapshots",
  "booking_payment_journeys",
  "guest_checkout_sessions",
  "guest_live_payment_attempts",
  "guest_processed_psp_references",
  "bank_transfer_sessions",
  "manual_transfers",
  "manual_transfer_receipts",
  "owner_payable_cancellations",
  "owner_payouts",
  "guest_refunds",
  "owner_payout_recoveries",
  "reserve_payout_records",
] as const;

const PROJECTIONS: Readonly<Record<string, string>> = {
  manual_transfer_receipts: "receipt_id, transfer_id, content_type, object_key, size_bytes",
};

/** A page keeps each read and each object well inside the Durable Object limits. */
const PAGE_SIZE = 500;
const EXPORT_CONTENT_TYPE = "application/x-ndjson";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Today in WAT (ADR 0078), `YYYY-MM-DD`. */
export function lagosDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function exportObjectKey(date: string, table: string): string {
  return `${date}/${table}.jsonl`;
}

export interface DailyExportDependencies {
  readonly database: SqlDatabase;
  readonly receipts: R2Bucket;
  readonly exports: R2Bucket;
  readonly clock: () => Date;
  readonly retentionDays: number;
  readonly orphanGraceHours: number;
}

export interface DailyExportReport {
  readonly date: string;
  readonly rowsByTable: Readonly<Record<string, number>>;
  readonly expiredExportsDeleted: number;
  readonly orphanReceiptsDeleted: number;
}

function tableExists(database: SqlDatabase, table: string): boolean {
  return database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = $name").get({ $name: table }) !== undefined;
}

/**
 * Writes one JSONL object for the table, paged so no read or object grows without bound. Returns the row count.
 * A table that does not exist in this deployment still gets its (empty) object, so each day's export has one key
 * per listed table and a restore reads a uniform set.
 */
export async function exportTable(dependencies: DailyExportDependencies, date: string, table: string): Promise<number> {
  const projection = PROJECTIONS[table] ?? "*";
  const lines: string[] = [];
  if (tableExists(dependencies.database, table)) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = dependencies.database
        .prepare(`SELECT ${projection} FROM ${table} ORDER BY rowid LIMIT ${PAGE_SIZE} OFFSET ${offset}`)
        .all();
      for (const row of rows) lines.push(JSON.stringify(row));
      if (rows.length < PAGE_SIZE) break;
    }
  }
  await dependencies.exports.put(exportObjectKey(date, table), lines.join("\n"), {
    httpMetadata: { contentType: EXPORT_CONTENT_TYPE },
  });
  return lines.length;
}

/** Deletes export objects older than the configured retention (ADR 0075, provisional; value from configuration). */
export async function deleteExpiredExports(dependencies: DailyExportDependencies, today: string): Promise<number> {
  const cutoff = lagosDate(new Date(dependencies.clock().getTime() - dependencies.retentionDays * DAY_MS));
  const listed = await dependencies.exports.list();
  let deleted = 0;
  for (const object of listed.objects) {
    const date = object.key.split("/")[0] ?? "";
    if (DATE_PATTERN.test(date) && date < cutoff && date !== today) {
      await dependencies.exports.delete(object.key);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * Deletes receipt objects with no metadata row that are older than the grace period (07a's put-then-row order).
 * A receipt whose row exists, and a newer object, are kept. If the metadata table is absent the sweep fails
 * closed and deletes nothing.
 */
export async function sweepOrphanReceipts(dependencies: DailyExportDependencies): Promise<number> {
  if (!tableExists(dependencies.database, "manual_transfer_receipts")) return 0;
  const cutoff = dependencies.clock().getTime() - dependencies.orphanGraceHours * HOUR_MS;
  const listed = await dependencies.receipts.list();
  let deleted = 0;
  for (const object of listed.objects) {
    if (object.uploaded.getTime() > cutoff) continue;
    const row = dependencies.database
      .prepare("SELECT 1 AS present FROM manual_transfer_receipts WHERE object_key = $key")
      .get({ $key: object.key });
    if (row !== undefined) continue;
    await dependencies.receipts.delete(object.key);
    deleted += 1;
  }
  return deleted;
}

export async function runDailyExport(dependencies: DailyExportDependencies): Promise<DailyExportReport> {
  const date = lagosDate(dependencies.clock());
  const rowsByTable: Record<string, number> = {};
  for (const table of EXPORT_TABLES) rowsByTable[table] = await exportTable(dependencies, date, table);
  const expiredExportsDeleted = await deleteExpiredExports(dependencies, date);
  const orphanReceiptsDeleted = await sweepOrphanReceipts(dependencies);
  return { date, rowsByTable, expiredExportsDeleted, orphanReceiptsDeleted };
}
