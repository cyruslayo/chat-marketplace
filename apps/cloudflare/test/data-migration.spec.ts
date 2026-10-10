import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import {
  applicationTableNames,
  buildExport,
  checksumTables,
  compareMigration,
  MAX_IMPORT_REQUEST_BYTES,
  RECEIPT_BLOB_TABLE,
  migrationBatchRows,
  type MigrationExport,
  type MigrationManifest,
} from "../../../packages/platform-core/src/data-migration.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../src/schema.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { DAILY_EXPORT_EXCLUDED } from "../src/do-export.js";
import { importBatch } from "../src/ops-import.js";
import { populateSource } from "./data-migration-fixtures.js";
import nodeExportFixture from "./fixtures/node-export.json?raw";
import { ORIGIN, accessToken, opsHeaders } from "./ops-test-helpers.js";

/**
 * Slice 16: the import, verify and reverse-export routes, exercised through the Durable Object's own fetch.
 * Every target object is empty: its constructor applies the schema migrations, as it does in production (D3).
 */

const uniqueStub = (label: string) => env.SHORTLET.get(env.SHORTLET.idFromName(`${label}-${crypto.randomUUID()}`));

type Stub = ReturnType<typeof uniqueStub>;

async function sourceStub(): Promise<Stub> {
  const stub = uniqueStub("migration-source");
  await runInDurableObject(stub, (_instance, ctx) => populateSource(new DurableObjectSqlDatabase(ctx.storage)));
  return stub;
}

/** An empty Durable Object. Its first request runs the migrations; nothing is copied from the source's DDL. */
function targetStub(): Stub {
  return uniqueStub("migration-target");
}

async function call(stub: Stub, method: string, path: string, body?: unknown, authenticated = true) {
  const headers = authenticated ? opsHeaders(await accessToken({})) : { "content-type": "application/json" };
  return stub.fetch(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

interface VerifyBody {
  readonly ok: boolean;
  readonly tables: Record<string, { rowCount: number; sha256: string }>;
  readonly cutoverCompletedAt: string | null;
}

async function verifyBody(stub: Stub): Promise<VerifyBody> {
  const response = await call(stub, "GET", "/_ops/import/verify");
  expect(response.status).toBe(200);
  return (await response.json()) as VerifyBody;
}

async function verify(stub: Stub): Promise<Record<string, { rowCount: number; sha256: string }>> {
  return (await verifyBody(stub)).tables;
}

function jsonlRows(content: string): unknown[] {
  return content.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as unknown);
}

/** The client chunk for a table: floor(100 / column count) rows, as scripts/export-node-sqlite.ts sends them (D2). */
async function importTable(stub: Stub, table: string, rows: readonly unknown[]): Promise<void> {
  const first = rows[0];
  const perRequest = first !== undefined && typeof first === "object" && first !== null ? migrationBatchRows(Object.keys(first).length) : 1;
  for (let start = 0; start < rows.length; start += perRequest) {
    const response = await call(stub, "POST", "/_ops/import", { table, rows: rows.slice(start, start + perRequest) });
    expect(response.status).toBe(200);
  }
}

function operatorRows(prefix: string, count: number): Array<{ id: string; operator_json: string }> {
  return Array.from({ length: count }, (_value, index) => ({ id: `${prefix}-${String(index).padStart(3, "0")}`, operator_json: "{}" }));
}

/** Every table name in sqlite_master, control tables included. */
async function allTableNames(stub: Stub): Promise<string[]> {
  return runInDurableObject(stub, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name)),
  );
}

test("16 AC1: exporting a populated database and importing it into a Durable Object gives identical row counts and checksums for every table", async () => {
  const source = await sourceStub();
  const exported: MigrationExport = await runInDurableObject(source, (_instance, ctx) => buildExport(new DurableObjectSqlDatabase(ctx.storage)));
  const sourceCounts = await runInDurableObject(source, async (_instance, ctx) => checksumTables(new DurableObjectSqlDatabase(ctx.storage), ["audit_log", "units", "operators"]));
  expect(sourceCounts.operators?.rowCount).toBeGreaterThan(0);
  expect(exported.manifest.tables.operators?.rowCount).toBe(sourceCounts.operators?.rowCount);

  const target = targetStub();
  for (const [table, content] of Object.entries(exported.contents)) await importTable(target, table, jsonlRows(content));

  // The object's own empty grant and session tables come from the migrations; they are not in the source.
  const verified = await verify(target);
  expect(compareMigration(exported.manifest, verified)).toEqual([]);
  for (const [table, expected] of Object.entries(exported.manifest.tables)) {
    expect(verified[table]).toEqual(expected);
  }
  for (const table of Object.keys(verified).filter((name) => !Object.hasOwn(exported.manifest.tables, name))) {
    expect(verified[table]?.rowCount).toBe(0);
  }
});

test("16 AC1 (end to end): the Node exporter's output imports into a Durable Object with identical counts and checksums", async () => {
  // The fixture is what scripts/export-node-sqlite.ts writes for the same synthetic source (checked by the Node test).
  const fixture = JSON.parse(nodeExportFixture) as { manifest: MigrationManifest; contents: Record<string, string> };
  expect(fixture.manifest.tables.operators?.rowCount).toBeGreaterThan(0);
  const target = targetStub();
  for (const [table, content] of Object.entries(fixture.contents)) await importTable(target, table, jsonlRows(content));

  const verified = await verify(target);
  expect(compareMigration(fixture.manifest, verified)).toEqual([]);
  expect(Object.keys(fixture.manifest.tables).sort()).toEqual(Object.keys(fixture.contents).sort());
  for (const [table, expected] of Object.entries(fixture.manifest.tables)) {
    expect(verified[table]).toEqual(expected);
  }
});

test("16 AC2: a batch that would exceed 100 parameters is split automatically", async () => {
  const target = targetStub();
  // Two columns per row: 60 rows would bind 120 parameters in one statement.
  const rows = operatorRows("op-split", 60);
  const result = await runInDurableObject(target, (_instance, ctx) => importBatch(new DurableObjectSqlDatabase(ctx.storage), "operators", rows, SHORTLET_SCHEMA_VERSION));
  expect(result.received).toBe(60);
  expect(result.statements).toBeGreaterThan(1);
  expect(result.maxParameters).toBeLessThanOrEqual(100);
  expect((await verify(target)).operators?.rowCount).toBe(60);
});

test("16 AC2: a malformed row fails its whole batch and nothing from that batch is written", async () => {
  const target = targetStub();
  // The third row lacks operator_json, which is NOT NULL, so the statement fails after the first two were staged.
  const rows = [
    { id: "op-batch-a", operator_json: "{}" },
    { id: "op-batch-b", operator_json: "{}" },
    { id: "op-batch-c" },
  ];
  const response = await call(target, "POST", "/_ops/import", { table: "operators", rows });
  expect(response.status).toBe(422);
  expect(((await response.json()) as { code: string }).code).toBe("BATCH_REJECTED");
  expect((await verify(target)).operators?.rowCount).toBe(0);
});

test("16 AC3: importing the same batch twice does not duplicate rows", async () => {
  const target = targetStub();
  const rows = operatorRows("op-repeat", 3);
  await importTable(target, "operators", rows);
  const first = await verify(target);
  await importTable(target, "operators", rows);
  const second = await verify(target);
  expect(second.operators?.rowCount).toBe(3);
  expect(second).toEqual(first);
});

test("16 D1: a re-import overwrites a changed row with the file's values, keyed by primary key", async () => {
  const target = targetStub();
  await importTable(target, "operators", [{ id: "op-upsert", operator_json: '{"v":1}' }]);
  await importTable(target, "operators", [{ id: "op-upsert", operator_json: '{"v":2}' }]);
  const response = await call(target, "GET", "/_ops/export?table=operators");
  const body = (await response.json()) as { rowCount: number; content: string };
  expect(body.rowCount).toBe(1);
  expect(jsonlRows(body.content)).toEqual([{ id: "op-upsert", operator_json: '{"v":2}' }]);
});

test("16 D1: an import is refused with CUTOVER_COMPLETE once the cutover is completed, and writes nothing", async () => {
  const target = targetStub();
  await importTable(target, "operators", operatorRows("op-before", 1));
  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  expect(completed.status).toBe(200);

  const refused = await call(target, "POST", "/_ops/import", { table: "operators", rows: [{ id: "op-after", operator_json: "{}" }] });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe("CUTOVER_COMPLETE");
  expect((await verify(target)).operators?.rowCount).toBe(1);
});

test("16 D1: the cutover flag cannot be unset, overwritten or read back through import", async () => {
  const target = targetStub();
  // Before completion, the control tables are refused by name: they are not application tables.
  const flagWriteBefore = await call(target, "POST", "/_ops/import", { table: "migration_state", rows: [{ state_key: "cutover_completed_at", state_value: "unset" }] });
  expect(flagWriteBefore.status).toBe(400);
  expect(((await flagWriteBefore.json()) as { code: string }).code).toBe("UNKNOWN_TABLE");

  const first = await call(target, "POST", "/_ops/cutover/complete", {});
  const firstAt = ((await first.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;

  // A second completion keeps the first timestamp.
  const second = await call(target, "POST", "/_ops/cutover/complete", {});
  expect(second.status).toBe(200);
  expect(((await second.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt).toBe(firstAt);

  // Once completed, every import is refused as a whole, control tables included.
  const flagWrite = await call(target, "POST", "/_ops/import", { table: "migration_state", rows: [{ state_key: "cutover_completed_at", state_value: "unset" }] });
  expect(flagWrite.status).toBe(409);
  expect(((await flagWrite.json()) as { code: string }).code).toBe("CUTOVER_COMPLETE");
  const versionWrite = await call(target, "POST", "/_ops/import", { table: "schema_migrations", rows: [{ version: 99, name: "x", applied_at: "x" }] });
  expect(versionWrite.status).toBe(409);

  expect((await verifyBody(target)).cutoverCompletedAt).toBe(firstAt);
});

test("16 D3: an import into an object whose schema version is behind is refused and creates no table", async () => {
  const target = targetStub();
  await verify(target);
  // Simulate an object that has applied only migration 1: remove migration 2 and its table.
  await runInDurableObject(target, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    database.exec("DELETE FROM schema_migrations WHERE version = 2");
    database.exec("DROP TABLE migration_state");
  });
  const before = await allTableNames(target);

  const response = await call(target, "POST", "/_ops/import", { table: "operators", rows: [{ id: "op-behind", operator_json: "{}" }] });
  expect(response.status).toBe(409);
  expect(((await response.json()) as { code: string }).code).toBe("SCHEMA_NOT_READY");
  expect(await allTableNames(target)).toEqual(before);
  expect((await verify(target)).operators?.rowCount).toBe(0);
});

test("16 D3: a new object records every migration once, in order, in schema_migrations", async () => {
  const target = targetStub();
  await verify(target);
  const recorded = await runInDurableObject(target, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT version, name FROM schema_migrations ORDER BY version").all(),
  );
  expect(recorded.map((row) => Number(row.version))).toEqual(SHORTLET_SCHEMA_MIGRATIONS.map((migration) => migration.version));
  expect(recorded.every((row) => typeof row.name === "string" && row.name !== "")).toBe(true);
});

test("16 D3: every application table the fixture's stores create is created by the migrations", async () => {
  const source = await sourceStub();
  const target = targetStub();
  await verify(target);
  const sourceTables = await runInDurableObject(source, (_instance, ctx) => applicationTableNames(new DurableObjectSqlDatabase(ctx.storage)));
  const targetTables = await runInDurableObject(target, (_instance, ctx) => applicationTableNames(new DurableObjectSqlDatabase(ctx.storage)));
  expect(sourceTables.length).toBeGreaterThan(0);
  // receipt_blobs is not in the object: its bytes move to R2 by key (07a, ADR 0090), so it is not a migrated table.
  const movedToR2 = [RECEIPT_BLOB_TABLE];
  expect(sourceTables.filter((table) => !targetTables.includes(table) && !movedToR2.includes(table))).toEqual([]);
});

test("16 import refuses unknown tables and unknown columns and requires both authentication layers", async () => {
  const target = targetStub();

  const unknownTable = await call(target, "POST", "/_ops/import", { table: "not_a_table", rows: [{ id: "x" }] });
  expect(unknownTable.status).toBe(400);
  expect(((await unknownTable.json()) as { code: string }).code).toBe("UNKNOWN_TABLE");

  const unknownColumn = await call(target, "POST", "/_ops/import", { table: "operators", rows: [{ id: "op-col", operator_json: "{}", bogus: 1 }] });
  expect(unknownColumn.status).toBe(400);
  expect(((await unknownColumn.json()) as { code: string }).code).toBe("UNKNOWN_COLUMN");

  const unauthenticated = await call(target, "POST", "/_ops/import", { table: "operators", rows: [{ id: "op-anon", operator_json: "{}" }] }, false);
  expect(unauthenticated.status).toBe(401);

  expect((await verify(target)).operators?.rowCount).toBe(0);
});

test("16 reverse export returns the rows the import wrote, so a rollback can replay them into Node", async () => {
  const target = targetStub();
  await importTable(target, "operators", operatorRows("op-reverse", 2));

  const response = await call(target, "GET", "/_ops/export?table=operators");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { rowCount: number; sha256: string; content: string };
  expect(body.rowCount).toBe(2);
  expect(body.sha256).toBe((await verify(target)).operators?.sha256);
  expect(jsonlRows(body.content)).toEqual(operatorRows("op-reverse", 2));

  const unknown = await call(target, "GET", "/_ops/export?table=not_a_table");
  expect(unknown.status).toBe(400);
});

test("16 F4: the ops export refuses each credential table the daily export excludes, and still serves an ordinary table", async () => {
  const target = targetStub();
  for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) {
    const response = await call(target, "GET", `/_ops/export?table=${table}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("EXCLUDED_TABLE");
  }
  const ordinary = await call(target, "GET", "/_ops/export?table=operators");
  expect(ordinary.status).toBe(200);
});

test("16 ADR 0075: a malformed JSON import body is refused without echoing any of its row content", async () => {
  const target = targetStub();
  // Short enough to fall inside the window the JSON parser quotes back, so a leak would show the sentinel.
  const sentinel = "SNT7731";
  // An unquoted value: the JSON parser's message would otherwise quote part of the body back to the caller.
  const body = `{"table":"operators","rows":[{"id":"op-leak-1","operator_json":${sentinel}}]}`;
  const response = await target.fetch(`${ORIGIN}/_ops/import`, {
    method: "POST",
    headers: { ...opsHeaders(await accessToken({})), "content-type": "application/json" },
    body,
  });
  expect(response.status).toBe(400);
  const text = await response.text();
  expect(text.includes(sentinel)).toBe(false);
  expect(text.includes("op-leak-1")).toBe(false);
  expect((await verify(target)).operators?.rowCount).toBe(0);
});

test("16 D2: an import request over the 5 MiB chunk bound is refused before its rows are read", async () => {
  const target = targetStub();
  const oversized = JSON.stringify({ table: "operators", rows: [{ id: "op-oversized", operator_json: "z".repeat(MAX_IMPORT_REQUEST_BYTES) }] });
  const response = await target.fetch(`${ORIGIN}/_ops/import`, {
    method: "POST",
    headers: { ...opsHeaders(await accessToken({})), "content-type": "application/json" },
    body: oversized,
  });
  expect(response.status).toBe(413);
  expect(((await response.json()) as { code: string }).code).toBe("BODY_TOO_LARGE");
  expect((await verify(target)).operators?.rowCount).toBe(0);
});

test("16 F3: an unauthenticated POST /_ops/cutover/complete is refused with 401 and sets no flag", async () => {
  const target = targetStub();
  const refused = await call(target, "POST", "/_ops/cutover/complete", {}, false);
  expect(refused.status).toBe(401);
  expect((await verifyBody(target)).cutoverCompletedAt).toBeNull();
});

test("16 F3: the authenticated status route reports the schema version and the cutover flag, and refuses an unauthenticated read", async () => {
  const target = targetStub();
  const unauthenticated = await call(target, "GET", "/_ops/status", undefined, false);
  expect(unauthenticated.status).toBe(401);

  const before = (await (await call(target, "GET", "/_ops/status")).json()) as {
    ok: boolean; schemaVersion: number; expectedSchemaVersion: number; cutoverCompletedAt: string | null;
  };
  expect(before).toEqual({ ok: true, schemaVersion: SHORTLET_SCHEMA_VERSION, expectedSchemaVersion: SHORTLET_SCHEMA_VERSION, cutoverCompletedAt: null });

  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  const at = ((await completed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;
  const after = (await (await call(target, "GET", "/_ops/status")).json()) as { cutoverCompletedAt: string | null };
  expect(after.cutoverCompletedAt).toBe(at);
});

test("16 F3: a rewound object that reads no cutover flag accepts imports again until the flag is set, which the restore check must catch", async () => {
  const target = targetStub();
  await call(target, "POST", "/_ops/cutover/complete", {});
  // A point-in-time restore rewinds the flag row with the rest of the object's storage. Simulated here by removing it.
  await runInDurableObject(target, (_instance, ctx) => { new DurableObjectSqlDatabase(ctx.storage).exec("DELETE FROM migration_state"); });

  await importTable(target, "operators", operatorRows("op-rewound", 1));
  expect((await verify(target)).operators?.rowCount).toBe(1);
  const status = (await (await call(target, "GET", "/_ops/status")).json()) as { cutoverCompletedAt: string | null };
  expect(status.cutoverCompletedAt).toBeNull();

  // The recovery the restore runbook prescribes sets the flag again; from then on every import is refused.
  await call(target, "POST", "/_ops/cutover/complete", {});
  const refused = await call(target, "POST", "/_ops/import", { table: "operators", rows: operatorRows("op-after-restore", 1) });
  expect(refused.status).toBe(409);
});
