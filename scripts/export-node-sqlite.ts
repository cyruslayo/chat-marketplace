/**
 * Slice 16: exports a Node SQLite file to per-table JSONL with a row count and SHA-256 per table, and writes receipt
 * bytes as separate files. The canonical format is shared with the Durable Object import (packages/platform-core,
 * apps/cloudflare/src/ops-import.ts), so a checksum taken on either side can be compared directly.
 *
 *   tsx scripts/export-node-sqlite.ts --export <db.sqlite> <out-dir>
 *   tsx scripts/export-node-sqlite.ts --import <db.sqlite> <in-dir>        (a Node target whose schema exists)
 *   tsx scripts/export-node-sqlite.ts --push <in-dir>                      (remote: SHORTLET_OPS_URL and secrets from env)
 *   tsx scripts/export-node-sqlite.ts --pull <out-dir>                     (remote, read-only reverse export)
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
import { importBatch } from "../apps/cloudflare/src/ops-import.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration, type OpsRemoteConfiguration } from "../apps/shortlet-ops/src/ops-client.js";
import {
  MIGRATION_BATCH_ROWS,
  buildExport,
  checksumTables,
  compareMigration,
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
 * Imports an export into a Node SQLite file (the rollback path, and the Node side of the parity test). Each table is
 * imported in batches through the same `importBatch` the Worker uses. Receipt files are restored to the blob table,
 * and each one is checked against its manifest SHA-256 first.
 */
export async function importMigrationDirectory(dbPath: string, inDir: string): Promise<Record<string, number>> {
  const manifest = await readManifest(inDir);
  const database = new NodeSqliteDatabase(dbPath);
  const counts: Record<string, number> = {};
  try {
    for (const table of Object.keys(manifest.tables)) {
      const rows = await readRows(inDir, table);
      for (let start = 0; start < rows.length; start += MIGRATION_BATCH_ROWS) {
        importBatch(database, table, rows.slice(start, start + MIGRATION_BATCH_ROWS));
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
 * Sends an export's rows to the object: one `POST /_ops/import` per 100-row batch, each batch one transaction on the
 * object. Stops at the first refused batch and throws the route's message. Receipts are not sent here (R2, by key).
 */
export async function pushMigrationDirectory(inDir: string, configuration: OpsRemoteConfiguration): Promise<Record<string, number>> {
  const manifest = await readManifest(inDir);
  const counts: Record<string, number> = {};
  for (const table of Object.keys(manifest.tables)) {
    const rows = await readRows(inDir, table);
    for (let start = 0; start < rows.length; start += MIGRATION_BATCH_ROWS) {
      assertOpsOk(
        await opsRequest(configuration, "/_ops/import", {
          method: "POST",
          contentType: "application/json",
          body: JSON.stringify({ table, rows: rows.slice(start, start + MIGRATION_BATCH_ROWS) }),
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
  await writeFile(join(outDir, "verify.json"), `${JSON.stringify({ ok: true, tables }, null, 2)}\n`, "utf8");
  const counts: Record<string, number> = {};
  for (const table of Object.keys(tables)) {
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

/** Compares a manifest with a verify response (`{ tables }`) or a bare table map. Returns the differing table names. */
export function compareMigrationFiles(manifest: MigrationManifest, verify: unknown): string[] {
  const actual = (typeof verify === "object" && verify !== null && "tables" in verify ? (verify as { tables: unknown }).tables : verify) as Record<string, TableChecksum>;
  return compareMigration(manifest, actual);
}

async function main(argv: readonly string[]): Promise<number> {
  const [flag, first, second] = argv;
  if (flag === "--export" && first && second) {
    const manifest = await exportNodeSqliteFile(first, second);
    for (const [table, checksum] of Object.entries(manifest.tables)) console.log(`${table} rows=${checksum.rowCount}`);
    console.log(`receipts=${manifest.receipts.length} moved=${manifest.movedTables.join(",") || "none"}`);
    return 0;
  }
  if (flag === "--import" && first && second) {
    const counts = await importMigrationDirectory(first, second);
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} rows=${rows}`);
    return 0;
  }
  if (flag === "--compare" && first && second) {
    const manifest = JSON.parse(await readFile(first, "utf8")) as MigrationManifest;
    const mismatches = compareMigrationFiles(manifest, JSON.parse(await readFile(second, "utf8")) as unknown);
    console.log(mismatches.length === 0 ? `match tables=${Object.keys(manifest.tables).length}` : `mismatch tables=${mismatches.join(",")}`);
    return mismatches.length === 0 ? 0 : 1;
  }
  // Remote modes read SHORTLET_OPS_URL and the secrets from the environment only, never from arguments.
  if (flag === "--push" && first && !second) {
    const counts = await pushMigrationDirectory(first, requireRemote());
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} sent=${rows}`);
    return 0;
  }
  if (flag === "--pull" && first && !second) {
    const counts = await pullObject(first, requireRemote());
    for (const [table, rows] of Object.entries(counts)) console.log(`${table} read=${rows}`);
    return 0;
  }
  console.error("usage: export-node-sqlite.ts --export <db> <out-dir> | --import <db> <in-dir> | --push <in-dir> | --pull <out-dir> | --compare <manifest.json> <verify.json>");
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
