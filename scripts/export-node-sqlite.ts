/**
 * Slice 16: exports a Node SQLite file to per-table JSONL with a row count and SHA-256 per table, and writes receipt
 * bytes as separate files. The canonical format is shared with the Durable Object import (packages/platform-core,
 * apps/cloudflare/src/ops-import.ts), so a checksum taken on either side can be compared directly.
 *
 *   tsx scripts/export-node-sqlite.ts --export <db.sqlite> <out-dir>
 *   tsx scripts/export-node-sqlite.ts --migrate <db.sqlite>                (migrates SHORTLET and adjacent <db>.platform.sqlite)
 *   tsx scripts/export-node-sqlite.ts --import <db.sqlite> <in-dir>        (paired Node target, migrated first; never creates tables)
 *   tsx scripts/export-node-sqlite.ts --push <in-dir>                      (remote: SHORTLET_OPS_URL and secrets from env)
 *   tsx scripts/export-node-sqlite.ts --pull <out-dir>                     (remote, read-only reverse export)
 *   tsx scripts/export-node-sqlite.ts --cutover-complete                   (remote: sets the one-way cutover flag; refuses further imports)
 *   tsx scripts/export-node-sqlite.ts --compare <manifest.json> <verify.json>
 *
 * Output is files and counts only. No row content reaches the console (ADR 0075). The source file is opened read-only.
 * Uploading receipt files to R2 by key is a separate, described step in docs/runbooks/cloudflare-cutover.md.
 */
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { SqliteReceiptBlobStore } from "../packages/platform-core/src/payments/receipt-blob-store.js";
import { assertImportAllowed, importBatch } from "../apps/cloudflare/src/ops-import.js";
import { DAILY_EXPORT_EXCLUDED } from "../apps/cloudflare/src/do-export.js";
import { PLATFORM_SCHEMA_MIGRATIONS, PLATFORM_SCHEMA_VERSION, SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { PLATFORM_OWNED_TABLES } from "../apps/cloudflare/src/do-export.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration, type OpsRemoteConfiguration } from "../apps/shortlet-ops/src/ops-client.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import {
  buildExport,
  checksumTables,
  compareExcludedTables,
  compareMigration,
  contentSha256,
  importRequestChunks,
  importOrder,
  sha256OfBytes,
  type MigrationManifest,
  type TableChecksum,
} from "../packages/platform-core/src/data-migration.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";

const RECEIPT_DIRECTORY = "receipts";
const MANIFEST_FILE = "manifest.json";
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9-]+$/;

/** Local rollback target keeps the two production authorities in distinct SQLite files. */
export function platformDatabasePath(shortletDatabasePath: string): string {
  return `${shortletDatabasePath}.platform.sqlite`;
}

/** Writes the export to `outDir` and returns its manifest. Receipt keys are opaque UUIDs, checked before use as file names. */
export async function exportNodeSqliteFile(dbPath: string, outDir: string): Promise<MigrationManifest> {
  const handle = new DatabaseSync(dbPath, { readOnly: true });
  let bundle: Awaited<ReturnType<typeof buildExport>>;
  try {
    bundle = await buildExport(new NodeSqliteDatabase(handle));
  } finally {
    handle.close();
  }

  // A split Node rollback copy has one file per production authority. A frozen pre-split source remains a single file;
  // in that case buildExport reads its original rows unchanged and the import below routes them by the accepted owner map.
  const platformPath = platformDatabasePath(dbPath);
  if (existsSync(platformPath)) {
    const platformHandle = new DatabaseSync(platformPath, { readOnly: true });
    try {
      const platformBundle = await buildExport(new NodeSqliteDatabase(platformHandle));
      const tables = { ...bundle.manifest.tables };
      const contents = { ...bundle.contents };
      for (const table of PLATFORM_OWNED_TABLES) {
        const splitRows = platformBundle.manifest.tables[table]?.rowCount ?? 0;
        if (splitRows > 0 || tables[table] === undefined) {
          const checksum = platformBundle.manifest.tables[table];
          if (checksum !== undefined) tables[table] = checksum;
          const content = platformBundle.contents[table];
          if (content !== undefined) contents[table] = content;
        }
      }
      const excludedTables = { ...bundle.manifest.excludedTables };
      for (const [table, count] of Object.entries(platformBundle.manifest.excludedTables)) {
        excludedTables[table] = {
          sourceRowCount: (excludedTables[table]?.sourceRowCount ?? 0) + count.sourceRowCount,
        };
      }
      bundle = {
        manifest: {
          ...bundle.manifest,
          tables,
          excludedTables,
        },
        contents,
        receiptBytes: bundle.receiptBytes,
      };
    } finally {
      platformHandle.close();
    }
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
 * D3: applies each owner's production schema migrations to its paired Node SQLite file. Idempotent; the platform file is
 * `${dbPath}.platform.sqlite`, preserving the separate authorities and migration ledgers used by the Durable Objects.
 */
export async function migrateNodeSqliteFile(dbPath: string): Promise<number> {
  const database = new NodeSqliteDatabase(dbPath);
  const platform = new NodeSqliteDatabase(platformDatabasePath(dbPath));
  try {
    applySchemaMigrations(platform, PLATFORM_SCHEMA_MIGRATIONS, new Date().toISOString());
    return applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString()).version;
  } finally {
    database.close();
    platform.close();
  }
}

/**
 * Creates the runbook's derived pre-split import directory without modifying frozen source evidence. Only transformations
 * accepted by the slice-17 runbook are applied: legacy account email_revision defaults to zero; unverifiable legacy
 * identity assurance is omitted rather than assigned a revision. The ledger contains counts/checksums, never row values.
 */
export async function prepareLegacySplitExport(sourceDir: string, derivedDir: string): Promise<MigrationManifest> {
  await assertDisjointExportDirectories(sourceDir, derivedDir);
  const original = await readManifest(sourceDir);
  const sourceManifestContent = await readFile(join(sourceDir, MANIFEST_FILE), "utf8");
  await mkdir(derivedDir, { recursive: true });
  await cp(join(sourceDir, RECEIPT_DIRECTORY), join(derivedDir, RECEIPT_DIRECTORY), { recursive: true, force: true }).catch((error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  });
  const tables: Record<string, TableChecksum> = { ...original.tables };
  const ledger: Array<Record<string, string | number>> = [];

  for (const table of Object.keys(original.tables)) {
    const sourceRows = await readRows(sourceDir, table);
    if (table === "guest_accounts" && sourceRows.some((row) => isRecord(row) && !Object.hasOwn(row, "email_revision"))) {
      const rows = sourceRows.map((row) => {
        if (!isRecord(row)) throw new Error("The guest_accounts export contains a malformed row");
        return Object.hasOwn(row, "email_revision") ? row : { ...row, email_revision: 0 };
      });
      const content = canonicalJsonl(rows);
      await writeFile(join(derivedDir, `${table}.jsonl`), content, "utf8");
      tables[table] = { rowCount: rows.length, sha256: await contentSha256(content) };
      ledger.push({ table, transform: "default-email_revision-to-zero", sourceRows: sourceRows.length, derivedRows: rows.length, sourceSha256: original.tables[table]!.sha256, derivedSha256: tables[table]!.sha256 });
      continue;
    }
    if (table === "guest_identity_assurance" && sourceRows.some((row) => isRecord(row) && !Object.hasOwn(row, "account_email_revision"))) {
      const content = "";
      await writeFile(join(derivedDir, `${table}.jsonl`), content, "utf8");
      tables[table] = { rowCount: 0, sha256: await contentSha256(content) };
      ledger.push({ table, transform: "omit-unbound-legacy-assurance-reverify-required", sourceRows: sourceRows.length, derivedRows: 0, sourceSha256: original.tables[table]!.sha256, derivedSha256: tables[table]!.sha256 });
      continue;
    }
    await cp(join(sourceDir, `${table}.jsonl`), join(derivedDir, `${table}.jsonl`));
  }

  const manifest: MigrationManifest = { ...original, tables };
  await writeFile(join(derivedDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(derivedDir, "transform-ledger.json"), `${JSON.stringify({ sourceManifestSha256: await contentSha256(sourceManifestContent), transforms: ledger }, null, 2)}\n`, "utf8");
  return manifest;
}

/** Resolve through existing symlinked parents, preserving the not-yet-created suffix for safe destination checks. */
async function canonicalPathWithExistingParents(input: string): Promise<string> {
  let candidate = resolve(input);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existingRealPath = await realpath(candidate);
      return resolve(existingRealPath, ...missingSegments.reverse());
    } catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

async function assertDisjointExportDirectories(sourceDir: string, derivedDir: string): Promise<void> {
  const [sourcePath, derivedPath] = await Promise.all([
    canonicalPathWithExistingParents(sourceDir),
    canonicalPathWithExistingParents(derivedDir),
  ]);
  // Windows paths are case-insensitive even when their spelling differs; realpath resolves symlinks where present.
  const source = process.platform === "win32" ? sourcePath.toLocaleLowerCase("en-US") : sourcePath;
  const derived = process.platform === "win32" ? derivedPath.toLocaleLowerCase("en-US") : derivedPath;
  const isSameOrAncestor = (ancestor: string, descendant: string): boolean => {
    const difference = relative(ancestor, descendant);
    return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
  };
  if (isSameOrAncestor(source, derived) || isSameOrAncestor(derived, source)) {
    throw new Error("The derived export directory must not be the source directory or overlap it");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJsonl(rows: readonly Record<string, unknown>[]): string {
  return rows.map((row) => `${JSON.stringify(Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))))}\n`).join("");
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
  const platform = new NodeSqliteDatabase(platformDatabasePath(dbPath));
  const counts: Record<string, number> = {};
  try {
    assertImportAllowed(database, SHORTLET_SCHEMA_VERSION);
    assertImportAllowed(platform, PLATFORM_SCHEMA_VERSION);
    const tables = Object.keys(manifest.tables);
    const platformTables = importOrder(platform, tables.filter((table) => PLATFORM_OWNED_TABLES.has(table)));
    const shortletTables = importOrder(database, tables.filter((table) => !PLATFORM_OWNED_TABLES.has(table)));
    for (const table of [...platformTables, ...shortletTables]) {
      // F4: the bearer-credential tables are not written back to Node. Sessions and challenges are re-established after a rollback.
      if (Object.hasOwn(DAILY_EXPORT_EXCLUDED, table)) continue;
      const rows = await readRows(inDir, table);
      for (const chunk of importRequestChunks(table, rows)) {
        importBatch(PLATFORM_OWNED_TABLES.has(table) ? platform : database, table, chunk, PLATFORM_OWNED_TABLES.has(table) ? PLATFORM_SCHEMA_VERSION : SHORTLET_SCHEMA_VERSION, new Date());
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
    platform.close();
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
  const names = Object.keys(manifest.tables);
  const order = schemaImportOrder(names);
  for (const table of order) {
    // ADR 0093/0086/0075: a hand-edited manifest cannot revive credentials either.
    if (Object.hasOwn(DAILY_EXPORT_EXCLUDED, table)) continue;
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
  const platform = verify.platform !== null && typeof verify.platform === "object" ? verify.platform as Record<string, unknown> : {};
  const flattened = {
    ...(tables ?? {}),
    ...(platform.tables !== null && typeof platform.tables === "object" ? platform.tables as Record<string, TableChecksum> : {}),
  };
  const excluded = {
    ...((verify.excludedTables !== null && typeof verify.excludedTables === "object") ? verify.excludedTables as Record<string, { rowCount: number }> : {}),
    ...((platform.excludedTables !== null && typeof platform.excludedTables === "object") ? platform.excludedTables as Record<string, { rowCount: number }> : {}),
  };
  await writeFile(join(outDir, "verify.json"), `${JSON.stringify({ ok: true, tables: flattened, excludedTables: excluded, platform }, null, 2)}\n`, "utf8");
  const counts: Record<string, number> = {};
  for (const table of Object.keys(flattened)) {
    // F4: the verify response still lists every table, so the manifest comparison holds. The credential tables have no file.
    if (Object.hasOwn(DAILY_EXPORT_EXCLUDED, table)) continue;
    const exported = assertOpsOk(await opsRequest(configuration, `/_ops/export?table=${encodeURIComponent(table)}`, { method: "GET" }));
    if (typeof exported.content !== "string" || typeof exported.rowCount !== "number") throw new Error("The export response is malformed");
    await writeFile(join(outDir, `${table}.jsonl`), exported.content, "utf8");
    counts[table] = exported.rowCount;
  }
  return counts;
}

/** Owner-local FK order is derived from the exact production migration schemas (ADR 0101). */
function schemaImportOrder(tables: readonly string[]): string[] {
  const shortletTables = tables.filter((table) => !PLATFORM_OWNED_TABLES.has(table));
  const platformTables = tables.filter((table) => PLATFORM_OWNED_TABLES.has(table));
  const shortlet = new NodeSqliteDatabase(":memory:");
  const platform = new NodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(platform, PLATFORM_SCHEMA_MIGRATIONS, new Date().toISOString());
    applySchemaMigrations(shortlet, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString());
    return [...importOrder(platform, platformTables), ...importOrder(shortlet, shortletTables)];
  } finally {
    platform.close();
    shortlet.close();
  }
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
  if (flag === "--prepare-split" && first && second) {
    const manifest = await prepareLegacySplitExport(first, second);
    console.log(`prepared tables=${Object.keys(manifest.tables).length}; transform ledger written`);
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
  console.error("usage: export-node-sqlite.ts --export <db> <out-dir> | --prepare-split <source-dir> <derived-dir> | --migrate <db> | --import <db> <in-dir> | --push <in-dir> | --pull <out-dir> | --compare <manifest.json> <verify.json>");
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
