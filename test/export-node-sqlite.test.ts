import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { MAX_IMPORT_REQUEST_BYTES, checksumTables, compareMigration, contentSha256, importRequestChunks, migrationBatchRows, type MigrationManifest } from "../packages/platform-core/src/data-migration.js";
import { populateSource } from "../apps/cloudflare/test/data-migration-fixtures.js";
import { DAILY_EXPORT_EXCLUDED, PLATFORM_CREDENTIAL_TABLES, PLATFORM_OWNED_TABLES } from "../apps/cloudflare/src/do-export.js";
import { PLATFORM_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_MIGRATIONS } from "../apps/cloudflare/src/schema.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { compareMigrationFiles, exportNodeSqliteFile, importMigrationDirectory, migrateNodeSqliteFile, platformDatabasePath, prepareLegacySplitExport, pullObject, pushMigrationDirectory } from "../scripts/export-node-sqlite.js";
import type { OpsRemoteConfiguration } from "../apps/shortlet-ops/src/ops-client.js";

/** Slice 16: the Node exporter and the Node side of the import share one canonical format with the Worker. */

/** Checksums of a Node file, with the handle closed so the temp directory can be removed on Windows. */
async function checksumsOf(path: string, tables: readonly string[]): Promise<Record<string, { rowCount: number; sha256: string }>> {
  const shortletTables = tables.filter((table) => !PLATFORM_OWNED_TABLES.has(table));
  const platformTables = tables.filter((table) => PLATFORM_OWNED_TABLES.has(table));
  const database = new NodeSqliteDatabase(path);
  const platform = new NodeSqliteDatabase(platformDatabasePath(path));
  try {
    return {
      ...await checksumTables(database, shortletTables),
      ...await checksumTables(platform, platformTables),
    };
  } finally {
    database.close();
    platform.close();
  }
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "shortlet-migration-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("16 AC1: exporting a populated Node database and importing it gives identical row counts and checksums for every table", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const targetPath = join(dir, "target.sqlite");
    const outDir = join(dir, "export");

    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();

    const manifest = await exportNodeSqliteFile(sourcePath, outDir);
    assert.ok((manifest.tables.operators?.rowCount ?? 0) > 0);

    // The target gets its schema from the migrations, never from the source's DDL (D3).
    await migrateNodeSqliteFile(targetPath);
    await importMigrationDirectory(targetPath, outDir);

    const verified = await checksumsOf(targetPath, Object.keys(manifest.tables));
    assert.deepEqual(compareMigration(manifest, verified), []);
    assert.deepEqual(Object.keys(verified).sort(), Object.keys(manifest.tables).sort());
    for (const [table, expected] of Object.entries(manifest.tables)) assert.deepEqual(verified[table], expected);
  });
});

test("16 AC1 (Node): receipt bytes leave the rows and each receipt is written to its own file", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();

    const manifest = await exportNodeSqliteFile(sourcePath, outDir);

    const receiptRows = await readFile(join(outDir, "manual_transfer_receipts.jsonl"), "utf8");
    assert.equal(receiptRows.includes('"bytes":null'), true);
    assert.equal(receiptRows.includes("AAAA"), false);
    assert.equal(manifest.receipts.length, 2);
    const files = await readdir(join(outDir, "receipts"));
    assert.equal(files.length, 2);
    assert.equal(manifest.movedTables.includes("receipt_blobs"), true);
    assert.equal(manifest.tables.receipt_blobs, undefined);
  });
});

test("16 AC1 (Node): a checksum that differs from the export is reported by name, not hidden", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    const manifest = await exportNodeSqliteFile(sourcePath, outDir);

    const tampered = { ...manifest.tables, operators: { rowCount: manifest.tables.operators!.rowCount + 1, sha256: "0".repeat(64) } };
    const mismatches = compareMigration({ ...manifest, tables: tampered }, manifest.tables);
    assert.deepEqual(mismatches, ["operators"]);
  });
});

const configuration: OpsRemoteConfiguration = {
  url: "https://ops.example.test",
  sharedSecret: "synthetic-ops-secret",
  accessClientId: "synthetic-client-id",
  accessClientSecret: "synthetic-client-secret",
};

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

interface RecordedCall {
  readonly url: URL;
  readonly init: RequestInit;
}

/** Replaces global fetch for one test. Every call is recorded so the request shape can be checked. */
async function withFakeOps(respond: (url: URL) => Reply, run: (calls: RecordedCall[]) => Promise<void>): Promise<void> {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init: init ?? {} });
    const reply = respond(url);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("16 push sends every table to /_ops/import in batches of at most 100 rows with both authentication layers", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    const insert = source.prepare("INSERT INTO operators (id, operator_json) VALUES ($id, $json)");
    for (let index = 0; index < 150; index += 1) insert.run({ $id: `op-push-${index}`, $json: "{}" });
    source.close();
    const manifest = await exportNodeSqliteFile(sourcePath, outDir);

    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async (calls) => {
      const counts = await pushMigrationDirectory(outDir, configuration);
      assert.equal(counts.operators, manifest.tables.operators?.rowCount);
      const batches = calls.filter((call) => call.url.pathname === "/_ops/import");
      assert.equal(batches.every((call) => call.init.method === "POST"), true);
      const headers = batches[0]!.init.headers as Record<string, string>;
      assert.equal(headers["x-shortlet-ops-secret"], configuration.sharedSecret);
      assert.equal(headers["cf-access-client-id"], configuration.accessClientId);
      const payloads = batches.map((call) => JSON.parse(String(call.init.body)) as { table: string; rows: unknown[] });
      assert.equal(payloads.filter((payload) => payload.table === "operators").length >= 2, true);
    });
  });
});

test("16 D2: push sends each table in requests of floor(100 / column count) rows, not a fixed 100", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    const insert = source.prepare("INSERT INTO operators (id, operator_json) VALUES ($id, $json)");
    for (let index = 0; index < 150; index += 1) insert.run({ $id: `op-chunk-${index}`, $json: "{}" });
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);

    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async (calls) => {
      await pushMigrationDirectory(outDir, configuration);
      const payloads = calls
        .filter((call) => call.url.pathname === "/_ops/import")
        .map((call) => JSON.parse(String(call.init.body)) as { table: string; rows: Array<Record<string, unknown>> });
      // operators has two columns, so each request carries at most 50 rows: 50 rows bind 100 parameters at most.
      const operators = payloads.filter((payload) => payload.table === "operators");
      assert.equal(Math.max(...operators.map((payload) => payload.rows.length)), migrationBatchRows(2));
      assert.equal(migrationBatchRows(2), 50);
      for (const payload of payloads) {
        const columns = Object.keys(payload.rows[0] ?? {}).length;
        assert.ok(payload.rows.length * columns <= 100, `request for ${payload.table} binds more than 100 parameters`);
        assert.ok(payload.rows.length <= migrationBatchRows(Math.max(columns, 1)));
      }
    });
  });
});

test("16 D2: push keeps each request body within the 5 MiB chunk bound and refuses one row that cannot fit, naming only its position", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);

    // Two rows of about 3 MiB each cannot share one request, so the client sends them separately.
    const large = "x".repeat(3 * 1024 * 1024);
    const extra = [{ id: "op-big-1", operator_json: large }, { id: "op-big-2", operator_json: large }];
    const existing = await readFile(join(outDir, "operators.jsonl"), "utf8");
    await writeFile(join(outDir, "operators.jsonl"), existing + extra.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");

    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async (calls) => {
      await pushMigrationDirectory(outDir, configuration);
      const bodies = calls.filter((call) => call.url.pathname === "/_ops/import").map((call) => String(call.init.body));
      for (const body of bodies) assert.ok(new TextEncoder().encode(body).byteLength <= MAX_IMPORT_REQUEST_BYTES);
      assert.ok(bodies.filter((body) => body.includes("op-big-")).length >= 2);
    });

    // A single row over the bound is refused before any request, and the message names the table and row only.
    const oversized = "y".repeat(MAX_IMPORT_REQUEST_BYTES);
    await writeFile(join(outDir, "operators.jsonl"), `${JSON.stringify({ id: "op-huge", operator_json: oversized })}\n`, "utf8");
    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async () => {
      await assert.rejects(pushMigrationDirectory(outDir, configuration), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /operators/);
        assert.equal(error.message.includes("yyyy"), false);
        assert.equal(error.message.includes("op-huge"), false);
        return true;
      });
    });
  });
});

test("16 D3: importing into a Node file whose schema has not been migrated is refused and creates no table", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const targetPath = join(dir, "target.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);
    // An empty file: no migrations have been applied to it.
    new NodeSqliteDatabase(targetPath).close();

    await assert.rejects(importMigrationDirectory(targetPath, outDir), /schema/i);
    const check = new NodeSqliteDatabase(targetPath);
    try {
      assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(), []);
    } finally {
      check.close();
    }
  });
});

test("16 push stops at the first refused batch and reports the route's message", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);

    const refusal = { ok: false, code: "BATCH_REJECTED", message: "The batch was rejected and nothing from it was written" };
    await withFakeOps(() => ({ status: 422, body: refusal }), async (calls) => {
      await assert.rejects(pushMigrationDirectory(outDir, configuration), /nothing from it was written/);
      assert.equal(calls.length, 1);
    });
  });
});

test("16 pull writes each table's reverse export and the object's verify result, which compare as a match", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const exportDir = join(dir, "export");
    const pullDir = join(dir, "pull");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    const manifest = await exportNodeSqliteFile(sourcePath, exportDir);

    // The fake object serves the exported files exactly as the reverse-export route does.
    await withFakeOps((url) => {
      if (url.pathname === "/_ops/import/verify") return { status: 200, body: { ok: true, tables: manifest.tables } };
      const table = url.searchParams.get("table") ?? "";
      const entry = manifest.tables[table];
      if (url.pathname !== "/_ops/export" || entry === undefined) return { status: 400, body: { ok: false } };
      const content = readFileSync(join(exportDir, `${table}.jsonl`), "utf8");
      return { status: 200, body: { ok: true, table, rowCount: entry.rowCount, sha256: entry.sha256, content } };
    }, async () => {
      await pullObject(pullDir, configuration);
    });

    for (const table of Object.keys(manifest.tables)) {
      assert.equal(await readFile(join(pullDir, `${table}.jsonl`), "utf8"), await readFile(join(exportDir, `${table}.jsonl`), "utf8"));
    }
    const verify = JSON.parse(await readFile(join(pullDir, "verify.json"), "utf8")) as { tables: Record<string, { rowCount: number; sha256: string }> };
    assert.deepEqual(compareMigration(manifest, verify.tables), []);
  });
});

/** ADR 0075: a parse error in an export file must name the table and line, never echo the row. */
const ROW_SENTINEL = "SENTINEL-ROW-VALUE-7731";

test("16 ADR 0075: a malformed line in an export file is reported by table and line, never with its row content", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const targetPath = join(dir, "target.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);

    // An unquoted value makes V8's JSON.parse echo the whole line in its message.
    await writeFile(join(outDir, "operators.jsonl"), `{"id":"op-1","operator_json":${ROW_SENTINEL}}\n`, "utf8");
    await migrateNodeSqliteFile(targetPath);

    await assert.rejects(importMigrationDirectory(targetPath, outDir), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /operators/);
      assert.match(error.message, /line 1/);
      assert.equal(error.message.includes(ROW_SENTINEL), false);
      return true;
    });
  });
});

/**
 * The committed Node export that the Workers test imports (apps/cloudflare/test/fixtures/node-export.json). It is the
 * exporter's own output for the synthetic source, so the Workers side imports exactly what the Node exporter writes.
 */
const NODE_EXPORT_FIXTURE = new URL("../apps/cloudflare/test/fixtures/node-export.json", import.meta.url);
/** The one random key the exporter draws: a legacy receipt without an object key. Pinned so the fixture is stable. */
const FIXTURE_RANDOM_KEY = "00000000-0000-4000-8000-00000000fe16";

async function withPinnedRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => FIXTURE_RANDOM_KEY, configurable: true, writable: true });
  try {
    return await run();
  } finally {
    if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original);
    else delete (globalThis.crypto as unknown as Record<string, unknown>).randomUUID;
  }
}

test("16 AC1 (fixture): the committed Node export is what scripts/export-node-sqlite.ts writes for the synthetic source", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const outDir = join(dir, "export");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();

    const manifest = await withPinnedRandomUuid(() => exportNodeSqliteFile(sourcePath, outDir));
    const contents: Record<string, string> = {};
    for (const table of Object.keys(manifest.tables)) contents[table] = await readFile(join(outDir, `${table}.jsonl`), "utf8");
    const produced = `${JSON.stringify({ manifest, contents }, null, 2)}\n`;

    if (process.env.UPDATE_NODE_EXPORT_FIXTURE === "1") {
      await writeFile(NODE_EXPORT_FIXTURE, produced, "utf8");
      return;
    }
    const committed = readFileSync(NODE_EXPORT_FIXTURE, "utf8").replace(/\r\n?/g, "\n");
    assert.equal(committed, produced, "The Node export fixture is stale: regenerate it with UPDATE_NODE_EXPORT_FIXTURE=1");
  });
});

test("Slice 17 ADR 0093: exports retain accounts but exclude email-change replay material", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    await migrateNodeSqliteFile(sourcePath);
    const source = new NodeSqliteDatabase(platformDatabasePath(sourcePath));
    try {
      source.prepare("INSERT INTO guest_accounts (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision) VALUES ($id, $tenant, $email, 'active', $at, $at, 0)")
        .run({ $id: "gacct-cutoverprobe", $tenant: "tenant-synthetic", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
      source.prepare("INSERT INTO guest_account_email_commands (tenant_id, account_guest_id, idempotency_key_hash, fingerprint, email_normalized, status, created_at, updated_at, revision) VALUES ($tenant, $id, $key, $fp, $email, 'done', $at, $at, 0)")
        .run({ $tenant: "tenant-synthetic", $id: "gacct-cutoverprobe", $key: "key-hash-probe", $fp: "fp-probe", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
    } finally {
      source.close();
    }
    const manifest = await exportNodeSqliteFile(sourcePath, join(dir, "export"));
    const order = Object.keys(manifest.tables);
    assert.ok(order.includes("guest_accounts"), "account records remain in the migration manifest");
    assert.ok(!order.includes("guest_account_email_commands"), "email-change replay material is not exported");
    assert.equal(manifest.excludedTables.guest_account_email_commands?.sourceRowCount, 1, "platform credential counts remain owner-aware");
    const targetPath = join(dir, "restored.sqlite");
    await migrateNodeSqliteFile(targetPath);
    await importMigrationDirectory(targetPath, join(dir, "export"));
    const restoredPlatform = new NodeSqliteDatabase(platformDatabasePath(targetPath));
    try {
      assert.deepEqual(restoredPlatform.prepare("SELECT account_guest_id, email_normalized FROM guest_accounts").all(), [
        { account_guest_id: "gacct-cutoverprobe", email_normalized: "probe@example.test" },
      ]);
      assert.equal(Number(restoredPlatform.prepare("SELECT COUNT(*) AS n FROM guest_account_email_commands").get()?.n), 0,
        "credential/replay material is not restored");
    } finally {
      restoredPlatform.close();
    }
  });
});

test("Slice 17 legacy transform preserves frozen export and explicitly defaults accounts while omitting unbound assurance", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = join(dir, "frozen-export");
    const derivedDir = join(dir, "derived-import");
    const legacyAccount = `${JSON.stringify({ account_guest_id: "gacct-legacy", email_normalized: "legacy@example.test" })}\n`;
    const legacyAssurance = `${JSON.stringify({ tenant_id: "tenant-synthetic", account_guest_id: "gacct-legacy", level: "government-ID-verified" })}\n`;
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "guest_accounts.jsonl"), legacyAccount, "utf8");
    await writeFile(join(sourceDir, "guest_identity_assurance.jsonl"), legacyAssurance, "utf8");
    const original: MigrationManifest = {
      formatVersion: 1,
      tables: {
        guest_accounts: { rowCount: 1, sha256: await contentSha256(legacyAccount) },
        guest_identity_assurance: { rowCount: 1, sha256: await contentSha256(legacyAssurance) },
      },
      excludedTables: {},
      movedTables: [],
      receipts: [],
    };
    await writeFile(join(sourceDir, "manifest.json"), `${JSON.stringify(original, null, 2)}\n`, "utf8");

    const transformed = await prepareLegacySplitExport(sourceDir, derivedDir);
    const accountText = await readFile(join(derivedDir, "guest_accounts.jsonl"), "utf8");
    const assuranceText = await readFile(join(derivedDir, "guest_identity_assurance.jsonl"), "utf8");
    assert.deepEqual(JSON.parse(accountText), { account_guest_id: "gacct-legacy", email_normalized: "legacy@example.test", email_revision: 0 });
    assert.equal(assuranceText, "");
    assert.deepEqual(transformed.tables.guest_identity_assurance, { rowCount: 0, sha256: await contentSha256("") });
    assert.equal(await readFile(join(sourceDir, "guest_accounts.jsonl"), "utf8"), legacyAccount);
    assert.equal(await readFile(join(sourceDir, "guest_identity_assurance.jsonl"), "utf8"), legacyAssurance);
    const ledger = await readFile(join(derivedDir, "transform-ledger.json"), "utf8");
    assert.match(ledger, /default-email_revision-to-zero/);
    assert.match(ledger, /omit-unbound-legacy-assurance-reverify-required/);
    assert.equal(ledger.includes("legacy@example.test"), false);
  });
});

async function writeMinimalExport(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify({
    formatVersion: 1,
    tables: {},
    excludedTables: {},
    movedTables: [],
    receipts: [],
  } satisfies MigrationManifest)}\n`, "utf8");
  await writeFile(join(directory, "frozen-sentinel.bin"), Buffer.from([0, 4, 255, 7]));
}

async function directorySnapshot(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshot: Array<{ path: string; bytes: string }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      snapshot.push({ path: entry.name, bytes: await directorySnapshot(path) });
    } else if (entry.isFile()) {
      snapshot.push({ path: entry.name, bytes: (await readFile(path)).toString("base64") });
    }
  }
  return JSON.stringify(snapshot);
}

test("Slice 17: prepare split export rejects identical, aliased and nested paths before writing, preserving source bytes", async () => {
  await withTempDir(async (root) => {
    const source = join(root, "foo");
    await writeMinimalExport(source);
    const aliases = [
      source,
      resolve(relative(process.cwd(), source), ".", "child", ".."),
    ];
    if (process.platform === "win32") aliases.push(source.toUpperCase());

    for (const [index, derived] of aliases.entries()) {
      const before = await directorySnapshot(source);
      await assert.rejects(prepareLegacySplitExport(source, derived), /must not be the source directory or overlap it/);
      assert.equal(await directorySnapshot(source), before, `identical/alias case ${index} leaves source bytes unchanged`);
      assert.equal(existsSync(join(source, "transform-ledger.json")), false, "rejection writes no ledger into source");
    }

    const nestedOutput = join(source, "nested", "derived");
    const beforeNested = await directorySnapshot(source);
    await assert.rejects(prepareLegacySplitExport(source, nestedOutput), /must not be the source directory or overlap it/);
    assert.equal(await directorySnapshot(source), beforeNested, "nested destination rejection leaves source bytes unchanged");
    assert.equal(existsSync(join(source, "nested")), false, "rejection does not create nested output directories");

    const container = join(root, "container");
    const nestedSource = join(container, "frozen");
    await writeMinimalExport(nestedSource);
    const beforeAncestor = await directorySnapshot(container);
    await assert.rejects(prepareLegacySplitExport(nestedSource, container), /must not be the source directory or overlap it/);
    assert.equal(await directorySnapshot(container), beforeAncestor, "ancestor destination rejection leaves all source bytes unchanged");
    assert.equal(existsSync(join(container, "transform-ledger.json")), false, "rejection writes no ledger in ancestor output");
  });
});

test("Slice 17: prepare split export resolves symlink aliases and still accepts sibling-prefix directories", async (t) => {
  await withTempDir(async (root) => {
    const source = join(root, "foo");
    await writeMinimalExport(source);
    const alias = join(root, "source-alias");
    try {
      await symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error: unknown) {
      if (error !== null && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "UNKNOWN"].includes(String(error.code))) {
        t.skip(`directory symlinks unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    const before = await directorySnapshot(source);
    await assert.rejects(prepareLegacySplitExport(source, alias), /must not be the source directory or overlap it/);
    assert.equal(await directorySnapshot(source), before, "symlink alias rejection preserves the source bytes");

    const siblingPrefix = join(root, "foobar");
    await prepareLegacySplitExport(source, siblingPrefix);
    assert.equal(existsSync(join(siblingPrefix, "manifest.json")), true, "a sibling whose name shares a prefix is a valid destination");
    assert.equal(await directorySnapshot(source), before, "valid sibling derivation also preserves the source bytes");
  });
});

test("16 D2: importRequestChunks throws a clear error for a table with more than 100 columns, and never emits an empty chunk", () => {
  const wide = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`column_${index}`, 1]));
  assert.throws(() => importRequestChunks("wide_table", [wide]), (error: unknown) => error instanceof RangeError && /wide_table/.test(error.message) && /100/.test(error.message));
  assert.throws(() => migrationBatchRows(101), RangeError);
});

test("16 F4: pull requests no credential table and writes no file for one, and the rollback import leaves the credential tables empty", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const exportDir = join(dir, "export");
    const pullDir = join(dir, "pull");
    const targetPath = join(dir, "target.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await migrateNodeSqliteFile(sourcePath);
    const manifest = await exportNodeSqliteFile(sourcePath, exportDir);
    const excluded = Object.keys(DAILY_EXPORT_EXCLUDED);

    // Pull: the object's export route is asked only for tables the daily export keeps (ADR 0093, 0086, 0075).
    // The object's verify lists every application table, the credential tables included, as the real object does.
    const objectTables: Record<string, { rowCount: number; sha256: string }> = { ...manifest.tables };
    for (const table of excluded) objectTables[table] = { rowCount: 0, sha256: "synthetic-f4-checksum" };
    let requested: string[] = [];
    await withFakeOps((url) => {
      if (url.pathname === "/_ops/import/verify") return { status: 200, body: { ok: true, tables: objectTables } };
      const table = url.searchParams.get("table") ?? "";
      const entry = objectTables[table];
      if (url.pathname !== "/_ops/export" || entry === undefined) return { status: 400, body: { ok: false, code: "EXCLUDED_TABLE" } };
      const path = join(exportDir, `${table}.jsonl`);
      const content = existsSync(path) ? readFileSync(path, "utf8") : "";
      return { status: 200, body: { ok: true, table, rowCount: entry.rowCount, sha256: entry.sha256, content } };
    }, async (calls) => {
      await pullObject(pullDir, configuration);
      requested = calls.map((call) => call.url.searchParams.get("table") ?? "").filter((table) => table !== "");
    });
    for (const table of excluded) {
      assert.equal(requested.includes(table), false, `${table} must not be requested by pull`);
      assert.equal(existsSync(join(pullDir, `${table}.jsonl`)), false, `${table} must not be written by pull`);
    }

    // Rollback import: a credential row in the export file is skipped, so no session or challenge is written back to Node.
    const credentialTable = excluded[0]!;
    await writeFile(join(exportDir, `${credentialTable}.jsonl`), `${JSON.stringify({ session_secret_hash: "synthetic-f4-row" })}\n`, "utf8");
    await writeFile(join(exportDir, "manifest.json"), `${JSON.stringify({ ...manifest, tables: { ...manifest.tables, [credentialTable]: { rowCount: 1, sha256: "synthetic" } } })}\n`, "utf8");
    const pushed: string[] = [];
    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async (calls) => {
      await pushMigrationDirectory(exportDir, configuration);
      pushed.push(...calls.map((call) => (JSON.parse(String(call.init.body)) as { table: string }).table));
    });
    assert.equal(pushed.includes(credentialTable), false, "a hand-edited manifest still cannot upload credential material");
    await migrateNodeSqliteFile(targetPath);
    await importMigrationDirectory(targetPath, exportDir);
    const target = new NodeSqliteDatabase(platformDatabasePath(targetPath));
    try {
      const rows = target.prepare(`SELECT COUNT(*) AS count FROM ${credentialTable}`).get();
      assert.equal(Number(rows?.count), 0);
    } finally {
      target.close();
    }
  });
});

/** Issue 16 B: one operator access token row in the source, so a credential table has rows to exclude (synthetic values). */
function addCredentialRow(source: NodeSqliteDatabase, sourcePath: string): void {
  applySchemaMigrations(source, SHORTLET_SCHEMA_MIGRATIONS, "2031-02-01T00:00:00Z");
  const platform = new NodeSqliteDatabase(platformDatabasePath(sourcePath));
  try {
    applySchemaMigrations(platform, PLATFORM_SCHEMA_MIGRATIONS, "2031-02-01T00:00:00Z");
  } finally {
    platform.close();
  }
  source
    .prepare("INSERT INTO operator_access_tokens (token_hash, actor_id, tenant_id, created_at, expires_at) VALUES ($hash, $actor, $tenant, $created, $expires)")
    .run({ $hash: "synthetic-token-hash-b", $actor: "actor-synthetic", $tenant: "tenant-synthetic", $created: "2031-02-01T00:00:00Z", $expires: "2031-02-01T00:30:00Z" });
}

/** Issue 16 B: the zero-row verify response for the credential tables, as the object reports them after an import. */
function emptyExcludedCounts(): Record<string, { rowCount: number }> {
  return Object.fromEntries(Object.keys(DAILY_EXPORT_EXCLUDED).map((table) => [table, { rowCount: 0 }]));
}

test("16 B: the cutover manifest excludes the five credential tables, records their source row counts, and writes no file for them", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await migrateNodeSqliteFile(sourcePath);
    const migratedSource = new NodeSqliteDatabase(sourcePath);
    addCredentialRow(migratedSource, sourcePath);
    migratedSource.close();
    const sourceForCounts = new NodeSqliteDatabase(sourcePath);
    const platformSource = new NodeSqliteDatabase(platformDatabasePath(sourcePath));
    const sourceCounts: Record<string, number> = {};
    try {
      for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) {
        const owner = PLATFORM_OWNED_TABLES.has(table) || PLATFORM_CREDENTIAL_TABLES.has(table) ? platformSource : sourceForCounts;
        sourceCounts[table] = Number(owner.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
      }
    } finally {
      platformSource.close();
      sourceForCounts.close();
    }

    const exportDir = join(dir, "export");
    const manifest = await exportNodeSqliteFile(sourcePath, exportDir);
    assert.deepEqual(Object.keys(manifest.excludedTables).sort(), Object.keys(DAILY_EXPORT_EXCLUDED).sort());
    for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) {
      assert.equal(manifest.excludedTables[table]?.sourceRowCount, sourceCounts[table], `${table} source count is recorded`);
      assert.equal(Object.hasOwn(manifest.tables, table), false, `${table} must not be in the cutover manifest`);
      assert.equal(existsSync(join(exportDir, `${table}.jsonl`)), false, `${table} must not be written to the export`);
    }
  });
});

test("16 B: a push sends no credential table to the object, and sends every other table that has rows", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await migrateNodeSqliteFile(sourcePath);
    const migratedSource = new NodeSqliteDatabase(sourcePath);
    addCredentialRow(migratedSource, sourcePath);
    migratedSource.close();
    const exportDir = join(dir, "export");
    const manifest = await exportNodeSqliteFile(sourcePath, exportDir);

    let sent: string[] = [];
    await withFakeOps(() => ({ status: 200, body: { ok: true } }), async (calls) => {
      await pushMigrationDirectory(exportDir, configuration);
      sent = calls.map((call) => (JSON.parse(String(call.init.body)) as { table: string }).table);
    });
    for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) assert.equal(sent.includes(table), false, `${table} must not be pushed`);
    for (const [table, checksum] of Object.entries(manifest.tables)) {
      if (checksum.rowCount > 0) assert.ok(sent.includes(table), `${table} must be pushed`);
    }
  });
});

test("16 B: the compare fails when the object holds rows in a credential table, and fails closed when it reports none", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    const source = new NodeSqliteDatabase(sourcePath);
    await populateSource(source);
    source.close();
    await migrateNodeSqliteFile(sourcePath);
    const migratedSource = new NodeSqliteDatabase(sourcePath);
    addCredentialRow(migratedSource, sourcePath);
    migratedSource.close();
    const manifest = await exportNodeSqliteFile(sourcePath, join(dir, "export"));

    assert.deepEqual(compareMigrationFiles(manifest, { tables: manifest.tables, excludedTables: emptyExcludedCounts() }), []);
    const populated = { ...emptyExcludedCounts(), guest_account_sessions: { rowCount: 1 } };
    assert.deepEqual(compareMigrationFiles(manifest, { tables: manifest.tables, excludedTables: populated }), ["guest_account_sessions"]);
    // A verify response without the excluded counts cannot show the target holds none: it is a mismatch, not a match.
    assert.deepEqual(compareMigrationFiles(manifest, { tables: manifest.tables }), Object.keys(DAILY_EXPORT_EXCLUDED).sort());
  });
});
