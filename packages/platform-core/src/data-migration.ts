import type { SqlDatabase, SqlRow, SqlValue } from "./sql-database.js";

/**
 * Slice 16: the one canonical format shared by the Node exporter and the Durable Object import/verify routes, so a
 * checksum computed on either side is comparable byte for byte.
 *
 * Format: each row is one JSON object line with its keys sorted and its values encoded (BLOBs as `{"$bytes": base64}`).
 * A table's lines are sorted, so the content does not depend on storage order. A table checksum is the SHA-256 of
 * that content, and a row count is the number of lines.
 */
export const MIGRATION_FORMAT_VERSION = 1;

/**
 * Durable Object SQL binds at most this many parameters per statement. The figure of 100 is the one given by the
 * Cloudflare Durable Object limits page (https://developers.cloudflare.com/durable-objects/platform/limits/). It was
 * taken from a search summary in issue 16's agent pass and has NOT been re-read against the live page. Checklist item
 * before cutover, in docs/runbooks/cloudflare-cutover.md: verify this value against the live page. Also used by
 * apps/cloudflare/src/do-sql-database.ts. A platform limit, not a booking policy.
 */
export const MAX_STATEMENT_PARAMETERS = 100;

/**
 * The largest request body the client sends to `POST /_ops/import`. This is a transport chunk size, not a policy:
 * it reuses the 5 MiB inventory CSV bound the user approved in 11b, and the Worker enforces the same value before
 * reading the body (ops-routes.ts). It bounds bytes per request; row count is bounded separately by the parameter
 * limit above. Issue 16, "Values to ask the user", item 1, records the decision.
 */
export const MAX_IMPORT_REQUEST_BYTES = 5 * 1024 * 1024;

/**
 * Rows per import request for a table with `columnCount` columns: as many as fit under the parameter limit, so no
 * statement the Worker builds from one request binds more than MAX_STATEMENT_PARAMETERS (D2). Derived per table,
 * never a fixed row count. The Worker splits its own statements by the same rule (ops-import.ts).
 */
export function migrationBatchRows(columnCount: number): number {
  if (!Number.isInteger(columnCount) || columnCount < 1) throw new RangeError("A table must have at least one column to be batched");
  return Math.floor(MAX_STATEMENT_PARAMETERS / columnCount);
}

/**
 * Splits one table's rows into import requests (D2). A request holds at most migrationBatchRows(columns) rows and its
 * body stays within MAX_IMPORT_REQUEST_BYTES. The byte count is conservative: the envelope and every row count a comma.
 * A single row that cannot fit is refused by its position, never by its content (ADR 0075).
 */
export function importRequestChunks(table: string, rows: readonly unknown[]): unknown[][] {
  if (rows.length === 0) return [];
  const first = rows[0];
  const columns = first !== null && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).length : 0;
  const perRequest = migrationBatchRows(columns);
  const encoder = new TextEncoder();
  const envelope = encoder.encode(JSON.stringify({ table, rows: [] })).byteLength;
  const chunks: unknown[][] = [];
  let current: unknown[] = [];
  let bytes = envelope;
  rows.forEach((row, index) => {
    const rowBytes = encoder.encode(JSON.stringify(row) ?? "null").byteLength + 1;
    if (envelope + rowBytes > MAX_IMPORT_REQUEST_BYTES) {
      throw new Error(`Table ${table} row ${index + 1} is larger than one import request allows`);
    }
    if (current.length >= perRequest || bytes + rowBytes > MAX_IMPORT_REQUEST_BYTES) {
      chunks.push(current);
      current = [];
      bytes = envelope;
    }
    current.push(row);
    bytes += rowBytes;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The table that holds receipt bytes in the Node composition (07a). Its bytes move to R2, not to the table. */
export const RECEIPT_BLOB_TABLE = "receipt_blobs";
const RECEIPT_TABLE = "manual_transfer_receipts";
const BYTES_TAG = "$bytes";

/**
 * Control tables hold migration and cutover state. They are not application data: they are never exported, verified,
 * or imported, so an import cannot write them (D1). Created by the migrations in schema_migrations order.
 */
export const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
export const CUTOVER_STATE_TABLE = "migration_state";
export const CONTROL_TABLES: readonly string[] = [SCHEMA_MIGRATIONS_TABLE, CUTOVER_STATE_TABLE];
const CUTOVER_COMPLETED_KEY = "cutover_completed_at";

/** The DDL of the cutover flag, applied by the migrations (D1). The flag is one-way: nothing here or in import deletes it. */
export const CUTOVER_STATE_DDL = `CREATE TABLE IF NOT EXISTS ${CUTOVER_STATE_TABLE} (state_key TEXT PRIMARY KEY, state_value TEXT NOT NULL)`;

/** Reads the one-way cutover flag. Null when the table is absent (a Node file that never ran the migrations) or unset. */
export function cutoverCompletedAt(database: SqlDatabase): string | null {
  if (!tableExists(database, CUTOVER_STATE_TABLE)) return null;
  const row = database
    .prepare(`SELECT state_value FROM ${CUTOVER_STATE_TABLE} WHERE state_key = $key`)
    .get({ $key: CUTOVER_COMPLETED_KEY });
  return row === undefined ? null : String(row.state_value);
}

/**
 * Sets the cutover flag once. A second call keeps the first timestamp and returns it. The flag has no unset path.
 * Called only by the authenticated `POST /_ops/cutover/complete` route.
 */
export function completeCutover(database: SqlDatabase, at: string): string {
  database
    .prepare(`INSERT INTO ${CUTOVER_STATE_TABLE} (state_key, state_value) VALUES ($key, $value) ON CONFLICT (state_key) DO NOTHING`)
    .run({ $key: CUTOVER_COMPLETED_KEY, $value: at });
  const stored = cutoverCompletedAt(database);
  if (stored === null) throw new Error("The cutover flag could not be recorded");
  return stored;
}

function tableExists(database: SqlDatabase, table: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $name").get({ $name: table }) !== undefined;
}

export interface TableChecksum {
  readonly rowCount: number;
  readonly sha256: string;
}

export interface ReceiptManifestEntry {
  readonly objectKey: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
}

export interface MigrationManifest {
  readonly formatVersion: number;
  readonly tables: Readonly<Record<string, TableChecksum>>;
  readonly movedTables: readonly string[];
  readonly receipts: readonly ReceiptManifestEntry[];
}

export interface ReceiptBytes {
  readonly objectKey: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface MigrationExport {
  readonly manifest: MigrationManifest;
  /** Canonical JSONL per table, keyed by table name. The same text the manifest checksums. */
  readonly contents: Readonly<Record<string, string>>;
  readonly receiptBytes: readonly ReceiptBytes[];
}

type TransportValue = string | number | null | { readonly $bytes: string };

export function isApplicationTable(name: string): boolean {
  return !name.startsWith("sqlite_") && !name.startsWith("_cf_") && !CONTROL_TABLES.includes(name);
}

export function applicationTableNames(database: SqlDatabase): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter(isApplicationTable);
}

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeValue(value: SqlValue): TransportValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("A non-finite number cannot be migrated");
    return value;
  }
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError("An integer outside the safe range cannot be migrated");
    return number;
  }
  if (value instanceof Uint8Array) return { [BYTES_TAG]: base64Encode(value) };
  throw new TypeError("An unsupported SQL value cannot be migrated");
}

/** Inverse of `encodeValue`. Anything else is refused, so a malformed transport value is never guessed at. */
export function decodeValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("A non-finite number cannot be imported");
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const tagged = (value as Record<string, unknown>)[BYTES_TAG];
    if (keys.length === 1 && typeof tagged === "string") return base64Decode(tagged);
  }
  throw new TypeError("An unsupported value cannot be imported");
}

/** One canonical line for a row: sorted keys, encoded values, no trailing newline. */
export function canonicalLine(row: SqlRow): string {
  const encoded: Record<string, TransportValue> = {};
  for (const key of Object.keys(row).sort()) encoded[key] = encodeValue(row[key] as SqlValue);
  return JSON.stringify(encoded);
}

/** The canonical JSONL content for a table's rows: sorted lines, each newline-terminated. */
export function canonicalTableContent(rows: readonly SqlRow[]): { readonly content: string; readonly rowCount: number } {
  const lines = rows.map(canonicalLine).sort();
  return { content: lines.map((line) => `${line}\n`).join(""), rowCount: lines.length };
}

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contentSha256(content: string): Promise<string> {
  return sha256OfBytes(new TextEncoder().encode(content));
}

/** Checksums of each table as the canonical format defines them. Defaults to every application table. */
export async function checksumTables(
  database: SqlDatabase,
  tables: readonly string[] = applicationTableNames(database),
): Promise<Record<string, TableChecksum>> {
  const checksums: Record<string, TableChecksum> = {};
  for (const table of tables) {
    const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
    const { content, rowCount } = canonicalTableContent(rows);
    checksums[table] = { rowCount, sha256: await contentSha256(content) };
  }
  return checksums;
}

/**
 * Receipt rows leave their bytes behind (ADR 0090, 07a). A legacy row keeps its bytes inline and gets an opaque key
 * here. A current row already has a key, and its bytes come from the blob store. Either way the row keeps no bytes.
 */
function receiptRow(
  row: SqlRow,
  blobs: ReadonlyMap<string, { readonly contentType: string; readonly bytes: Uint8Array }>,
  claimed: Set<string>,
  receipts: ReceiptBytes[],
): SqlRow {
  const inline = row.bytes;
  if (inline instanceof Uint8Array) {
    const objectKey = typeof row.object_key === "string" && row.object_key !== "" ? row.object_key : crypto.randomUUID();
    claimed.add(objectKey);
    receipts.push({ objectKey, contentType: String(row.content_type), bytes: inline });
    return { ...row, object_key: objectKey, bytes: null, size_bytes: inline.byteLength };
  }
  if (typeof row.object_key === "string" && row.object_key !== "") {
    const blob = blobs.get(row.object_key);
    // Fail closed: a receipt row whose bytes are missing is evidence loss, so the export stops.
    if (!blob) throw new Error("A receipt row refers to bytes that are not present in the source");
    claimed.add(row.object_key);
    receipts.push({ objectKey: row.object_key, contentType: blob.contentType, bytes: blob.bytes });
    return { ...row, bytes: null, size_bytes: row.size_bytes ?? blob.bytes.byteLength };
  }
  throw new Error("A receipt row has neither inline bytes nor an object key");
}

/**
 * Reads a database into the canonical export. Receipt bytes are returned separately for R2 upload by key; the
 * receipt blob table is not exported as rows.
 */
export async function buildExport(database: SqlDatabase): Promise<MigrationExport> {
  const names = applicationTableNames(database);
  const blobs = new Map<string, { contentType: string; bytes: Uint8Array }>();
  if (names.includes(RECEIPT_BLOB_TABLE)) {
    for (const row of database.prepare(`SELECT object_key, content_type, bytes FROM ${quoteIdentifier(RECEIPT_BLOB_TABLE)}`).all()) {
      if (typeof row.object_key !== "string" || typeof row.content_type !== "string" || !(row.bytes instanceof Uint8Array)) {
        throw new Error("A receipt blob row is malformed");
      }
      blobs.set(row.object_key, { contentType: row.content_type, bytes: row.bytes });
    }
  }

  const receipts: ReceiptBytes[] = [];
  const claimed = new Set<string>();
  const contents: Record<string, string> = {};
  const tables: Record<string, TableChecksum> = {};
  for (const table of names) {
    if (table === RECEIPT_BLOB_TABLE) continue;
    let rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
    if (table === RECEIPT_TABLE) rows = rows.map((row) => receiptRow(row, blobs, claimed, receipts));
    const canonical = canonicalTableContent(rows);
    contents[table] = canonical.content;
    tables[table] = { rowCount: canonical.rowCount, sha256: await contentSha256(canonical.content) };
  }
  // Blobs no receipt row references are still evidence bytes, so they go to R2 too.
  for (const [objectKey, blob] of blobs) {
    if (!claimed.has(objectKey)) receipts.push({ objectKey, contentType: blob.contentType, bytes: blob.bytes });
  }

  const receiptEntries: ReceiptManifestEntry[] = [];
  for (const receipt of receipts.sort((a, b) => (a.objectKey < b.objectKey ? -1 : a.objectKey > b.objectKey ? 1 : 0))) {
    receiptEntries.push({
      objectKey: receipt.objectKey,
      contentType: receipt.contentType,
      size: receipt.bytes.byteLength,
      sha256: await sha256OfBytes(receipt.bytes),
    });
  }

  const manifest: MigrationManifest = {
    formatVersion: MIGRATION_FORMAT_VERSION,
    tables,
    movedTables: names.includes(RECEIPT_BLOB_TABLE) ? [RECEIPT_BLOB_TABLE] : [],
    receipts: receiptEntries,
  };
  return { manifest, contents, receiptBytes: receipts };
}

/**
 * Compares a manifest with checksums read from a target. Returns the names of tables that differ, are missing, or
 * hold rows the manifest does not list. Sorted, so the output is stable.
 */
export function compareMigration(
  manifest: { readonly tables: Readonly<Record<string, TableChecksum>> },
  actual: Readonly<Record<string, TableChecksum>>,
): string[] {
  const mismatches = new Set<string>();
  for (const [table, expected] of Object.entries(manifest.tables)) {
    const found = Object.hasOwn(actual, table) ? actual[table] : undefined;
    if (!found || found.rowCount !== expected.rowCount || found.sha256 !== expected.sha256) mismatches.add(table);
  }
  for (const [table, found] of Object.entries(actual)) {
    if (!Object.hasOwn(manifest.tables, table) && found.rowCount > 0) mismatches.add(table);
  }
  return [...mismatches].sort();
}
