import type { R2Bucket, R2MultipartUpload, R2Object, R2UploadedPart } from "@cloudflare/workers-types";
import { CREDENTIAL_TABLES, encodeValue } from "../../../packages/platform-core/src/data-migration.js";
import type { SqlDatabase, SqlRow, SqlValue } from "../../../packages/platform-core/src/sql-database.js";

/**
 * Slice 12a, widened by issue 16 (delegated decision, 10 Oct 2026): the daily evidence export and the orphaned-receipt
 * sweep.
 *
 * Durable Object point-in-time recovery covers 30 days, so a daily off-object copy gives a second, replayable record
 * (ADR 0079). Every application table is exported unless it is listed in DAILY_EXPORT_EXCLUDED with the ADR that requires
 * the exclusion. One JSONL object per table per day holds that table's rows as read during the day's first alarm (F6). The
 * tables are read one after another, across awaits, so a day's objects are per-table snapshots, not one point-in-time
 * snapshot across tables. Rows are written in rowid order,
 * in the transport encoding the import route reads (ops-import.ts), so a day's objects can be loaded back.
 *
 * Table names come from the stores themselves, not invented. `manual_transfer_receipts` exports its metadata only:
 * the receipt bytes live in R2 (ADR 0090) and a legacy BLOB column is not inlined into a JSON object.
 */
export const SHORTLET_EXPORT_TABLES = [
  "availability_commitments",
  "booking_contracts",
  "booking_reservations",
  "bank_transfer_sessions",
  "checkin_support_state",
  "guest_booking_request_contacts",
  "guest_booking_requests",
  "guest_booking_snapshots",
  "guest_checkout_sessions",
  "guest_conditional_offers",
  "guest_identity_assurance",
  "guest_live_payment_attempts",
  "guest_payment_journey_snapshots",
  "guest_processed_psp_references",
  "guest_refunds",
  "guest_request_drafts",
  "booking_payment_journeys",
  "local_booking_contracts",
  "local_booking_reservations",
  "manual_transfers",
  "manual_transfer_receipts",
  "operator_enforcement_records",
  "operator_enforcement_sequence",
  "operator_representative_audit",
  "operator_representative_commands",
  "operator_representative_grants",
  "operators",
  "owner_payable_cancellations",
  "owner_payouts",
  "owner_payout_recoveries",
  "pilot_notifications",
  "reserve_payout_records",
  "revenue_adjustments",
  "revenue_compatibility_adjustments",
  "revenue_compatibility_releases",
  "revenue_earned_commission",
  "revenue_journals",
  "revenue_ledger_lines",
  "revenue_releases",
  "units",
] as const;

/** ADR 0101 platform-owned records. Credential exclusions remain excluded from both per-object exports. */
export const PLATFORM_EXPORT_TABLES = [
  "audit_log",
  "guest_account_rate_events",
  "guest_accounts",
  "guest_account_principals",
  "guest_account_request_claims",
  "guest_contacts",
  "guest_threads",
  "telemetry_events",
] as const;
export const PLATFORM_OWNED_TABLES: ReadonlySet<string> = new Set(PLATFORM_EXPORT_TABLES);

/** Full legacy/local export manifest for fixture and migration compatibility; production alarms use per-DO ownership lists. */
export const EXPORT_TABLES = [...SHORTLET_EXPORT_TABLES, ...PLATFORM_EXPORT_TABLES].sort() as readonly string[];

/**
 * Tables the daily export does not write: the bearer-credential tables, which are the one shared list in
 * packages/platform-core/src/data-migration.ts (CREDENTIAL_TABLES, issue 16 B). Each entry cites the ADR that requires the
 * exclusion. A restore must not revive a session or a sign-in or access challenge that was live on the export day, so every
 * guest and operator signs in again after a rebuild (docs/runbooks/cloudflare-restore.md, section 2).
 */
export const DAILY_EXPORT_EXCLUDED: Readonly<Record<string, string>> = CREDENTIAL_TABLES;

const PROJECTIONS: Readonly<Record<string, string>> = {
  manual_transfer_receipts: "receipt_id, transfer_id, content_type, object_key, size_bytes",
};

/** A page keeps each read well inside the Durable Object limits. Pages are keyed on rowid, so no read rescans earlier rows. */
const PAGE_SIZE = 500;
/**
 * R2 multipart uploads need every part except the last to be at least 5 MiB (the R2 service limit, not a policy). The
 * exporter flushes a part at this size, so memory holds one part and one page at a time, however large a table grows.
 */
const R2_MIN_PART_BYTES = 5 * 1024 * 1024;
const EXPORT_CONTENT_TYPE = "application/x-ndjson";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ENCODER = new TextEncoder();

/** Today in WAT (ADR 0078), `YYYY-MM-DD`. */
export function lagosDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function exportObjectKey(date: string, table: string): string {
  return `${date}/${table}.jsonl`;
}

export interface DailyExportDependencies {
  readonly database: SqlDatabase;
  readonly receipts?: R2Bucket;
  readonly exports: R2Bucket;
  readonly clock: () => Date;
  readonly retentionDays: number;
  readonly orphanGraceHours: number;
  readonly tableOwner?: "shortlet" | "platform";
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

/** Every object in the bucket, following the listing cursor. A single list call returns at most one page. */
async function listEveryObject(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return objects;
}

function encodedLine(row: SqlRow): string {
  const encoded: Record<string, ReturnType<typeof encodeValue>> = {};
  for (const [column, value] of Object.entries(row)) encoded[column] = encodeValue(value as SqlValue);
  return `${JSON.stringify(encoded)}\n`;
}

/**
 * Writes one JSONL object for the table: the table's rows as read in pages, in rowid order, one line per row (F6: a per-table
 * snapshot, not a point-in-time snapshot across tables). Pages are keyed on rowid. The
 * object is streamed to R2 in parts of at least R2_MIN_PART_BYTES, so memory holds one part and one page, not the table.
 * A table that does not exist in this deployment still gets its (empty) object, so each day's export has one key per
 * listed table and a restore reads a uniform set. Returns the row count.
 */
export async function exportTable(dependencies: DailyExportDependencies, date: string, table: string): Promise<number> {
  const key = exportObjectKey(date, table);
  const httpMetadata = { contentType: EXPORT_CONTENT_TYPE };
  const projection = PROJECTIONS[table] ?? "*";
  const multipart: { upload: R2MultipartUpload | null; parts: R2UploadedPart[] } = { upload: null, parts: [] };
  let buffered: string[] = [];
  let bufferedBytes = 0;
  let rowCount = 0;

  const uploadBuffered = async (): Promise<void> => {
    const body = buffered.join("");
    buffered = [];
    bufferedBytes = 0;
    multipart.upload ??= await dependencies.exports.createMultipartUpload(key, { httpMetadata });
    multipart.parts.push(await multipart.upload.uploadPart(multipart.parts.length + 1, body));
  };

  try {
    if (tableExists(dependencies.database, table)) {
      let after = Number.MIN_SAFE_INTEGER;
      for (;;) {
        const rows = dependencies.database
          .prepare(`SELECT rowid AS __rowid, ${projection} FROM ${table} WHERE rowid > $after ORDER BY rowid LIMIT ${PAGE_SIZE}`)
          .all({ $after: after });
        for (const row of rows) {
          after = Number(row.__rowid);
          const { __rowid: _rowid, ...columns } = row;
          const line = encodedLine(columns);
          buffered.push(line);
          bufferedBytes += ENCODER.encode(line).byteLength;
          rowCount += 1;
        }
        if (bufferedBytes >= R2_MIN_PART_BYTES) await uploadBuffered();
        if (rows.length < PAGE_SIZE) break;
      }
    }
    if (multipart.upload === null) {
      // The whole table fits in one part: a single put, as before streaming.
      await dependencies.exports.put(key, buffered.join(""), { httpMetadata });
      return rowCount;
    }
    if (buffered.length > 0) await uploadBuffered();
    await multipart.upload.complete(multipart.parts);
    return rowCount;
  } catch (error) {
    await multipart.upload?.abort().catch(() => undefined);
    throw error;
  }
}

/** Deletes export objects older than the configured retention (ADR 0075, provisional; value from configuration). */
export async function deleteExpiredExports(dependencies: DailyExportDependencies, today: string): Promise<number> {
  const cutoff = lagosDate(new Date(dependencies.clock().getTime() - dependencies.retentionDays * DAY_MS));
  const listed = await listEveryObject(dependencies.exports);
  let deleted = 0;
  for (const object of listed) {
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
  if (!dependencies.receipts) return 0;
  if (!tableExists(dependencies.database, "manual_transfer_receipts")) return 0;
  const cutoff = dependencies.clock().getTime() - dependencies.orphanGraceHours * HOUR_MS;
  const listed = await listEveryObject(dependencies.receipts);
  let deleted = 0;
  for (const object of listed) {
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
  const tables = dependencies.tableOwner === "platform" ? PLATFORM_EXPORT_TABLES : dependencies.tableOwner === "shortlet" ? SHORTLET_EXPORT_TABLES : EXPORT_TABLES;
  for (const table of tables) rowsByTable[table] = await exportTable(dependencies, date, table);
  const expiredExportsDeleted = await deleteExpiredExports(dependencies, date);
  const orphanReceiptsDeleted = await sweepOrphanReceipts(dependencies);
  return { date, rowsByTable, expiredExportsDeleted, orphanReceiptsDeleted };
}
