/**
 * Slice 16: exports a Node SQLite file to per-table JSONL with a row count and SHA-256 per table, and writes receipt
 * bytes as separate files. The canonical format is shared with the Durable Object import (packages/platform-core,
 * apps/cloudflare/src/ops-import.ts), so a checksum taken on either side can be compared directly.
 *
 *   tsx scripts/export-node-sqlite.ts --export <db.sqlite> <out-dir>
 *   tsx scripts/export-node-sqlite.ts --migrate <db.sqlite>                (applies the schema migrations to a Node file)
 *   tsx scripts/export-node-sqlite.ts --import <db.sqlite> <in-dir>        (a Node target, migrated first; never creates tables)
 *   tsx scripts/export-node-sqlite.ts --push <in-dir>                      (remote: SHORTLET_OPS_URL and secrets from env)
 *   tsx scripts/export-node-sqlite.ts --pull <out-dir>                     (remote, read-only reverse export)
 *   tsx scripts/export-node-sqlite.ts --cutover-complete                   (remote: sets the one-way cutover flag; refuses further imports)
 *   tsx scripts/export-node-sqlite.ts --compare <manifest.json> <verify.json>
 *
 * Output is files and counts only. No row content reaches the console (ADR 0075). The source file is opened read-only.
 * Uploading receipt files to R2 by key is a separate, described step in docs/runbooks/cloudflare-cutover.md.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { SqliteReceiptBlobStore } from "../domains/shortlet/src/receipt-blob-store.js";
import { assertImportAllowed, importBatch } from "../apps/cloudflare/src/ops-import.js";
import { DAILY_EXPORT_EXCLUDED } from "../apps/cloudflare/src/do-export.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration, type OpsRemoteConfiguration } from "../apps/shortlet-ops/src/ops-client.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import {
  buildExport,
  checksumTables,
  compareExcludedTables,
  compareMigration,
  importRequestChunks,
  sha256OfBytes,
  type MigrationManifest,
  type TableChecksum,
} from "../packages/platform-core/src/data-migration.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";

const RECEIPT_DIRECTORY = "receipts";
const MANIFEST_FILE = "manifest.json";
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9-]+$/;

/** Writes the export to `outDir` and returns its manifest. Receipt keys are opaque UUIDs, checked before use as file names. */
export async function exportNodeSqliteFile(dbPath: string, outDir: string): Promise<MigrationManifest> {
  const handle = new DatabaseSync(dbPath, { readOnly: true });
  let bundle: Awaited<ReturnType<typeof buildExport>>;
  try {
    bundle = await buildExport(new NodeSqliteDatabase(handle));
  } finally {
    handle.close();
  }

  await mkdir(join(outDir, RECEIPT_DIRECTORY), { recursive: true });
  for (const [table, content] of Object.entries(bundle.contents)) {
    await writeFile(join(outDir, `${table}.jsonl`), content, "utf8");
  }
  for (const receipt of bundle.receiptBytes) {
    if (!OBJECT_KEY_PATTERN.test(receipt.objectKey)) throw new Error("A receipt object key is not in the expected opaque form");
    await writeFile(join(outDir, RECEIPT_DIRECTORY, receipt.objectKey), receipt.bytes);
  }
  await writeFile(join(outDir, MANIFEST_FILE), `${JSON.stringify(bundle.manifest, null, 2)}\n`, "utf8");
  return bundle.manifest;
}

async function readManifest(inDir: string): Promise<MigrationManifest> {
  return JSON.parse(await readFile(join(inDir, MANIFEST_FILE), "utf8")) as MigrationManifest;
}

/**
 * Parses one table's JSONL. A parse error is rethrown with the table and line only: V8's JSON.parse message quotes part
 * of the input, which is row data (ADR 0075).
 */
async function readRows(inDir: string, table: string): Promise<unknown[]> {
  const lines = (await readFile(join(inDir, `${table}.jsonl`), "utf8")).split("\n");
  const rows: unknown[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "") continue;
    try {
      rows.push(JSON.parse(lines[index]!) as unknown);
    } catch {
      throw new Error(`Table ${table} line ${index + 1} is not valid JSON`);
    }
  }
  return rows;
}

/**
 * D3: applies the schema migrations to a Node SQLite file, the same path the Durable Object takes on startup. Idempotent.
 * Used to prepare the restored file for the rollback import (runbook R5). Returns the version the file is at.
 */
export async function migrateNodeSqliteFile(dbPath: string): Promise<number> {
  const database = new NodeSqliteDatabase(dbPath);
  try {
    return applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString()).version;
  } finally {
    database.close();
  }
}

/**
 * Imports an export into a Node SQLite file (the rollback path, and the Node side of the parity test). Each table is
 * imported in requests through the same `importBatch` the Worker uses. The schema is checked before any row is read, and
 * an unmigrated file is refused, never created (D3). Receipt files are restored to the blob table, and each one is
 * checked against its manifest SHA-256 first.
 */
export async function importMigrationDirectory(dbPath: string, inDir: string): Promise<Record<string, number>> {
  const manifest = await readManifest(inDir);
  const database = new NodeSqliteDatabase(dbPath);
  const counts: Record<string, number> = {};
  try {
    assertImportAllowed(database, SHORTLET_SCHEMA_VERSION);
    for (const table of Object.keys(manifest.tables)) {
      // F4: the bearer-credential tables are not written back to Node. Sessions and challenges are re-established after a rollback.
      if (Object.hasOwn(DAILY_EXPORT_EXCLUDED, table)) continue;
      const rows = await readRows(inDir, table);
      for (const chunk of importRequestChunks(table, rows)) {
        importBatch(database, table, chunk, SHORTLET_SCHEMA_VERSION);
      }
      counts[table] = rows.length;
    }
    const blobs = new SqliteReceiptBlobStore(database);
    for (const receipt of manifest.receipts) {
      if (!OBJECT_KEY_PATTERN.test(receipt.objectKey)) throw new Error("A receipt object key is not in the expected opaque form");
      const bytes = new Uint8Array(await readFile(join(inDir, RECEIPT_DIRECTORY, receipt.objectKey)));
      if ((await sha256OfBytes(bytes)) !== receipt.sha256) throw new Error("A receipt file does not match its manifest checksum");
      await blobs.put(receipt.objectKey, bytes, receipt.contentType);
    }
  } finally {
    database.close();
  }
  return counts;
}

/**
 * Sends an export's rows to the object: one `POST /_ops/import` per chunk (D2: floor(100 / columns) rows, and a body
 * within the documented 5 MiB bound), each chunk one transaction on the object. Stops at the first refused chunk and
 * throws the route's message. Receipts are not sent here (R2, by key).
 */
export async function pushMigrationDirectory(inDir: string, configuration: OpsRemoteConfiguration): Promise<Record<string, number>> {
  const manifest = await readManifest(inDir);
  const counts: Record<string, number> = {};
  for (const table of Object.keys(manifest.tables)) {
    const rows = await readRows(inDir, table);
    for (const chunk of importRequestChunks(table, rows)) {
      assertOpsOk(
        await opsRequest(configuration, "/_ops/import", {
          method: "POST",
          contentType: "application/json",
          body: JSON.stringify({ table, rows: chunk }),
        }),
      );
    }
    counts[table] = rows.length;
  }
  return counts;
}

/**
 * Reads every table back from the object through the read-only reverse export, writing one JSONL file per table and
 * `verify.json` (the object's checksums). Nothing on the object is changed.
 */
export async function pullObject(outDir: string, configuration: OpsRemoteConfiguration): Promise<Record<string, number>> {
  await mkdir(outDir, { recursive: true });
  const verify = assertOpsOk(await opsRequest(configuration, "/_ops/import/verify", { method: "GET" }));
  const tables = verify.tables as Record<string, TableChecksum>;
  // Issue 16 B: the credential tables' object counts travel with the checksums, so the compare can check them on both sides.
  await writeFile(join(outDir, "verify.json"), `${JSON.stringify({ ok: true, tables, excludedTables: verify.excludedTables ?? {} }, null, 2)}\n`, "utf8");
  const counts: Record<string, number> = {};
  for (const table of Object.keys(tables)) {
    // F4: the verify response still lists every table, so the manifest comparison holds. The credential tables have no file.
    if (Object.hasOwn(DAILY_EXPORT_EXCLUDED, table)) continue;
    const exported = assertOpsOk(await opsRequest(configuration, `/_ops/export?table=${encodeURIComponent(table)}`, { method: "GET" }));
    if (typeof exported.content !== "string" || typeof exported.rowCount !== "number") throw new Error("The export response is malformed");
    await writeFile(join(outDir, `${table}.jsonl`), exported.content, "utf8");
    counts[table] = exported.rowCount;
  }
  return counts;
}

function requireRemote(): OpsRemoteConfiguration {
  const configuration = remoteOpsConfiguration();
  if (configuration === null) throw new Error("SHORTLET_OPS_URL is required for --push and --pull");
  if (configuration.sharedSecret === "" || configuration.accessClientId === "" || configuration.accessClientSecret === "") {
    throw new Error("SHORTLET_OPS_SECRET, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required");
  }
  return configuration;
}

/**
 * Compares a manifest with a verify response (`{ tables, excludedTables }`) or a bare table map. Returns the differing table names:
 * application tables by checksum, and credential tables whose object count is not zero or is not reported (issue 16 B).
 */
export function compareMigrationFiles(manifest: MigrationManifest, verify: unknown): string[] {
  const record = typeof verify === "object" && verify !== null ? (verify as { tables?: unknown; excludedTables?: unknown }) : {};
  const actual = (verify !== null && typeof verify === "object" && "tables" in verify ? record.tables : verify) as Record<string, TableChecksum>;
  const excluded = record.excludedTables as Record<string, { rowCount: number }> | undefined;
  return [...new Set([...compareMigration(manifest, actual), ...compareExcludedTables(manifest, excluded)])].sort();
}

/** The counts the compare prints for the credential tables on both sides: totals only, never a row (ADR 0075). */
export function excludedCountTotals(manifest: MigrationManifest, verify: unknown): { excluded: number; sourceRows: number; targetRows: number } {
  const excludedSource = Object.values(manifest.excludedTables ?? {});
  const reported = (typeof verify === "object" && verify !== null && "excludedTables" in verify ? (verify as { excludedTables: unknown }).excludedTables : {}) as Record<string, { rowCount?: unknown }>;
  const targetRows = Object.values(reported).reduce((total, entry) => total + (typeof entry?.rowCount === "number" ? entry.rowCount : 0), 0);
  return { excluded: excludedSource.length, sourceRows: excludedSource.reduce((total, entry) => total + entry.sourceRowCount, 0), targetRows };
}

async function main(argv: readonly string[]): Promise<number> {
  const [flag, first, second] = argv;
  if (flag === "--export" && first && second) {
    const manifest = await exportNodeSqliteFile(first, second);
    for (const [table, checksum] of Object.entries(manifest.tables)) console.log(`${table} rows=${checksum.rowCount}`);
    console.log(`receipts=${manifest.receipts.length} moved=${manifest.movedTables.join(",") || "none"}`);
    return 0;
  }
  if (flag === "--migrate" && first && !second) {
    console.log(`schema version=${await migrateNodeSqliteFile(first)}`);
    return 0;
  }
  if (flag === "--import" && first && second) {
    const counts = await importMigrationDirectory(first, second);
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} rows=${rows}`);
    return 0;
  }
  if (flag === "--compare" && first && second) {
    const manifest = JSON.parse(await readFile(first, "utf8")) as MigrationManifest;
    const verify = JSON.parse(await readFile(second, "utf8")) as unknown;
    const mismatches = compareMigrationFiles(manifest, verify);
    const totals = excludedCountTotals(manifest, verify);
    const excludedLine = `excluded=${totals.excluded} excludedSourceRows=${totals.sourceRows} excludedTargetRows=${totals.targetRows}`;
    console.log(mismatches.length === 0 ? `match tables=${Object.keys(manifest.tables).length} ${excludedLine}` : `mismatch tables=${mismatches.join(",")} ${excludedLine}`);
    return mismatches.length === 0 ? 0 : 1;
  }
  // Remote modes read SHORTLET_OPS_URL and the secrets from the environment only, never from arguments.
  if (flag === "--push" && first && !second) {
    const counts = await pushMigrationDirectory(first, requireRemote());
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} sent=${rows}`);
    return 0;
  }
  if (flag === "--cutover-complete" && !first) {
    // D1: sets the one-way flag on the object. Refused by nothing, but nothing un-sets it. Run after verify, before DNS.
    const response = assertOpsOk(await opsRequest(requireRemote(), "/_ops/cutover/complete", { method: "POST", contentType: "application/json", body: "{}" }));
    console.log(`cutover completed at=${String(response.cutoverCompletedAt)}`);
    return 0;
  }
  if (flag === "--pull" && first && !second) {
    const counts = await pullObject(first, requireRemote());
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} read=${rows}`);
    return 0;
  }
  console.error("usage: export-node-sqlite.ts --export <db> <out-dir> | --migrate <db> | --import <db> <in-dir> | --push <in-dir> | --pull <out-dir> | --compare <manifest.json> <verify.json>");
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // Messages from the migration name tables and counts only; no row content is ever included.
      console.error(`migration failed: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    },
  );
}
