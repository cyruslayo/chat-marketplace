import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { MAX_IMPORT_REQUEST_BYTES, checksumTables, compareMigration, importRequestChunks, migrationBatchRows } from "../packages/platform-core/src/data-migration.js";
import { populateSource } from "../apps/cloudflare/test/data-migration-fixtures.js";
import { exportNodeSqliteFile, importMigrationDirectory, migrateNodeSqliteFile, pullObject, pushMigrationDirectory } from "../scripts/export-node-sqlite.js";
import type { OpsRemoteConfiguration } from "../apps/shortlet-ops/src/ops-client.js";

/** Slice 16: the Node exporter and the Node side of the import share one canonical format with the Worker. */

/** Checksums of a Node file, with the handle closed so the temp directory can be removed on Windows. */
async function checksumsOf(path: string, tables: readonly string[]): Promise<Record<string, { rowCount: number; sha256: string }>> {
  const database = new NodeSqliteDatabase(path);
  try {
    return await checksumTables(database, tables);
  } finally {
    database.close();
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
    assert.equal(readFileSync(NODE_EXPORT_FIXTURE, "utf8"), produced, "The Node export fixture is stale: regenerate it with UPDATE_NODE_EXPORT_FIXTURE=1");
  });
});

test("16 D1 cutover: the manifest lists each parent table before the tables that reference it, so the push loads in an order the object accepts", async () => {
  await withTempDir(async (dir) => {
    const sourcePath = join(dir, "source.sqlite");
    await migrateNodeSqliteFile(sourcePath);
    const source = new NodeSqliteDatabase(sourcePath);
    try {
      // The object enforces foreign keys: a child row whose parent is not loaded yet is refused (import, 422).
      source.prepare("INSERT INTO guest_accounts (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision) VALUES ($id, $tenant, $email, 'active', $at, $at, 0)")
        .run({ $id: "gacct-cutoverprobe", $tenant: "tenant-synthetic", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
      source.prepare("INSERT INTO guest_account_email_commands (tenant_id, account_guest_id, idempotency_key_hash, fingerprint, email_normalized, status, created_at, updated_at, revision) VALUES ($tenant, $id, $key, $fp, $email, 'done', $at, $at, 0)")
        .run({ $tenant: "tenant-synthetic", $id: "gacct-cutoverprobe", $key: "key-hash-probe", $fp: "fp-probe", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
    } finally {
      source.close();
    }
    const manifest = await exportNodeSqliteFile(sourcePath, join(dir, "export"));
    const order = Object.keys(manifest.tables);
    assert.ok(order.indexOf("guest_accounts") >= 0 && order.indexOf("guest_account_email_commands") >= 0, "both tables are in the manifest");
    assert.ok(order.indexOf("guest_accounts") < order.indexOf("guest_account_email_commands"), "the parent comes first");
  });
});

test("16 D2: importRequestChunks throws a clear error for a table with more than 100 columns, and never emits an empty chunk", () => {
  const wide = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`column_${index}`, 1]));
  assert.throws(() => importRequestChunks("wide_table", [wide]), (error: unknown) => error instanceof RangeError && /wide_table/.test(error.message) && /100/.test(error.message));
  assert.throws(() => migrationBatchRows(101), RangeError);
});
