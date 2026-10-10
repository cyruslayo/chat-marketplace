import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { checksumTables, compareMigration } from "../packages/platform-core/src/data-migration.js";
import { populateSource, targetSchemaStatements } from "../apps/cloudflare/test/data-migration-fixtures.js";
import { exportNodeSqliteFile, importMigrationDirectory, pullObject, pushMigrationDirectory } from "../scripts/export-node-sqlite.js";
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
    const schema = targetSchemaStatements(source);
    source.close();

    const manifest = await exportNodeSqliteFile(sourcePath, outDir);
    assert.ok((manifest.tables.operators?.rowCount ?? 0) > 0);

    const target = new NodeSqliteDatabase(targetPath);
    for (const statement of schema) target.exec(statement);
    target.close();

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
      assert.equal(payloads.every((payload) => payload.rows.length <= 100), true);
      assert.equal(payloads.filter((payload) => payload.table === "operators").length >= 2, true);
    });
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
    const schema = targetSchemaStatements(source);
    source.close();
    await exportNodeSqliteFile(sourcePath, outDir);

    // An unquoted value makes V8's JSON.parse echo the whole line in its message.
    await writeFile(join(outDir, "operators.jsonl"), `{"id":"op-1","operator_json":${ROW_SENTINEL}}\n`, "utf8");
    const target = new NodeSqliteDatabase(targetPath);
    for (const statement of schema) target.exec(statement);
    target.close();

    await assert.rejects(importMigrationDirectory(targetPath, outDir), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /operators/);
      assert.match(error.message, /line 1/);
      assert.equal(error.message.includes(ROW_SENTINEL), false);
      return true;
    });
  });
});
