import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import {
  applicationTableNames,
  buildExport,
  canonicalTableContent,
  checksumTables,
  compareMigration,
  contentSha256,
  cutoverCompletedAt,
  importOrder,
  MAX_IMPORT_REQUEST_BYTES,
  RECEIPT_BLOB_TABLE,
  migrationBatchRows,
  type MigrationExport,
  type MigrationManifest,
} from "../../../packages/platform-core/src/data-migration.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../src/schema.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { DAILY_EXPORT_EXCLUDED, deleteExpiredExports, exportObjectKey, exportTable as exportDailyTable, PLATFORM_EXPORT_TABLES } from "../src/do-export.js";
import { completeCutoverWithMarker, createCutoverMarkerStore, cutoverMarkerKey } from "../src/cutover-marker.js";
import { importBatch } from "../src/ops-import.js";
import { populateSource } from "./data-migration-fixtures.js";
import nodeExportFixture from "./fixtures/node-export.json?raw";
import { ORIGIN, accessToken, opsHeaders } from "./ops-test-helpers.js";

/**
 * Slice 16: the import, verify and reverse-export routes, exercised through the Durable Object's own fetch.
 * Every target object is empty: its constructor applies the schema migrations, as it does in production (D3).
 */

const uniqueStub = (label: string) => env.ISOLATED_SHORTLET.get(env.ISOLATED_SHORTLET.idFromName(`test-${label}-${crypto.randomUUID()}`));

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
  readonly excludedTables: Record<string, { rowCount: number }>;
  readonly platform?: {
    readonly excludedTables?: Record<string, { rowCount: number }>;
    readonly tables?: Record<string, { rowCount: number; sha256: string }>;
  };
}

function excludedCredentialCounts(verified: VerifyBody): Record<string, { rowCount: number }> {
  return { ...(verified.platform?.excludedTables ?? {}), ...verified.excludedTables };
}

async function verifyBody(stub: Stub): Promise<VerifyBody> {
  const response = await call(stub, "GET", "/_ops/import/verify");
  expect(response.status).toBe(200);
  return (await response.json()) as VerifyBody;
}

async function verify(stub: Stub): Promise<Record<string, { rowCount: number; sha256: string }>> {
  const verified = await verifyBody(stub);
  return { ...verified.tables, ...(verified.platform?.tables as Record<string, { rowCount: number; sha256: string }> | undefined) };
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
    expect(response.status, `${table}: ${JSON.stringify(await response.json())}`).toBe(200);
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
  const result = await runInDurableObject(target, (_instance, ctx) => importBatch(new DurableObjectSqlDatabase(ctx.storage), "operators", rows, SHORTLET_SCHEMA_VERSION, new Date()));
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
  // Simulate an object that has applied only migration 1: remove every later migration record and the cutover table.
  // (A gap in the record is refused as damaged, so the later versions must go together.)
  await runInDurableObject(target, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    database.exec("DELETE FROM schema_migrations WHERE version >= 2");
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
    ok: boolean; schemaVersion: number; expectedSchemaVersion: number; cutoverCompletedAt: string | null; cutoverMarker: string; platform: Record<string, unknown> | null;
  };
  expect(before).toMatchObject({ ok: true, schemaVersion: SHORTLET_SCHEMA_VERSION, expectedSchemaVersion: SHORTLET_SCHEMA_VERSION, cutoverCompletedAt: null, cutoverMarker: "absent" });
  expect(before.platform).toMatchObject({ ok: true, schemaVersion: expect.any(Number), cutoverMarker: expect.any(String) });

  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  const at = ((await completed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;
  const after = (await (await call(target, "GET", "/_ops/status")).json()) as { cutoverCompletedAt: string | null };
  expect(after.cutoverCompletedAt).toBe(at);
});

test("16 A: a rewound object (its flag row deleted, as a point-in-time restore leaves it) still refuses import, because the R2 marker survives", async () => {
  const target = targetStub();
  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  const at = ((await completed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;
  // A point-in-time restore rewinds the flag row with the rest of the object's storage. Simulated here by removing it.
  await runInDurableObject(target, (_instance, ctx) => { new DurableObjectSqlDatabase(ctx.storage).exec("DELETE FROM migration_state"); });

  const refused = await call(target, "POST", "/_ops/import", { table: "operators", rows: operatorRows("op-rewound", 1) });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe("CUTOVER_COMPLETE");
  expect((await verify(target)).operators?.rowCount).toBe(0);
  // The import path re-asserted the flag from the marker, so the status reads the same timestamp again.
  expect((await verifyBody(target)).cutoverCompletedAt).toBe(at);
});

test("16 A: the cutover marker is written to the EXPORTS bucket under the object's reserved key, and the status reports it", async () => {
  const target = targetStub();
  const before = (await (await call(target, "GET", "/_ops/status")).json()) as { cutoverMarker: string };
  expect(before.cutoverMarker).toBe("absent");
  expect(await env.EXPORTS.get(cutoverMarkerKey(target.id.toString(), "shortlet"))).toBeNull();

  await call(target, "POST", "/_ops/cutover/complete", {});
  const marker = await env.EXPORTS.get(cutoverMarkerKey(target.id.toString(), "shortlet"));
  expect(marker).not.toBeNull();
  const after = (await (await call(target, "GET", "/_ops/status")).json()) as { cutoverMarker: string };
  expect(after.cutoverMarker).toBe("present");
});

test("16 A: an unauthenticated POST /_ops/cutover/complete writes neither the flag nor the marker", async () => {
  const target = targetStub();
  await call(target, "POST", "/_ops/cutover/complete", {}, false);
  expect(await env.EXPORTS.get(cutoverMarkerKey(target.id.toString(), "shortlet"))).toBeNull();
  expect((await verifyBody(target)).cutoverCompletedAt).toBeNull();
});

test("16 A: the cutover marker survives the daily retention sweep, which deletes only dated export objects", async () => {
  const target = targetStub();
  await call(target, "POST", "/_ops/cutover/complete", {});
  const key = cutoverMarkerKey(target.id.toString(), "shortlet");
  // A dated export from long before the cutoff: the sweep must delete it, which proves the sweep ran over this bucket.
  await env.EXPORTS.put("2020-01-01/operators.jsonl", "{}\n", { httpMetadata: { contentType: "application/x-ndjson" } });
  const farFuture = new Date("2040-01-01T00:00:00.000Z");
  const deleted = await runInDurableObject(target, async (_instance, ctx) =>
    deleteExpiredExports(
      {
        database: new DurableObjectSqlDatabase(ctx.storage),
        receipts: env.RECEIPTS,
        exports: env.EXPORTS,
        clock: () => farFuture,
        retentionDays: 1,
        orphanGraceHours: 24,
      },
      "2040-01-01",
    ),
  );
  expect(deleted).toBeGreaterThanOrEqual(1);
  expect(await env.EXPORTS.get("2020-01-01/operators.jsonl")).toBeNull();
  expect(await env.EXPORTS.get(key)).not.toBeNull();
});

test("16 B: an import naming a credential table is refused with EXCLUDED_TABLE, cites ADRs 0093, 0086 and 0075, and writes nothing", async () => {
  const target = targetStub();
  for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) {
    const refused = await call(target, "POST", "/_ops/import", { table, rows: [{ id: "synthetic-credential-row" }] });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { code: string; message: string };
    expect(body.code).toBe("EXCLUDED_TABLE");
    expect(body.message).toMatch(/ADR 0093/);
    expect(body.message).toMatch(/ADR 0086/);
    expect(body.message).toMatch(/ADR 0075/);
  }
  const verified = await verifyBody(target);
  const counts = excludedCredentialCounts(verified);
  for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) expect(counts[table]?.rowCount).toBe(0);
});

test("16 B: verify reports the credential tables' counts apart from the application tables, and lists none of them as an application table", async () => {
  const target = targetStub();
  const verified = await verifyBody(target);
  expect(Object.keys(excludedCredentialCounts(verified)).sort()).toEqual(Object.keys(DAILY_EXPORT_EXCLUDED).sort());
  for (const table of Object.keys(DAILY_EXPORT_EXCLUDED)) expect(Object.hasOwn(verified.tables, table)).toBe(false);
});

/** The break-glass in docs/runbooks/cloudflare-restore.md, section 2 (B0 to B7), driven through the object and the EXPORTS binding. */
interface CutoverStatusBody {
  readonly ok: boolean;
  readonly cutoverCompletedAt: string | null;
  readonly cutoverMarker: string;
}

async function cutoverStatusBody(stub: Stub): Promise<CutoverStatusBody> {
  const response = await call(stub, "GET", "/_ops/status");
  expect(response.status).toBe(200);
  const body = (await response.json()) as CutoverStatusBody;
  return { ok: body.ok, cutoverCompletedAt: body.cutoverCompletedAt, cutoverMarker: body.cutoverMarker };
}

function loseFlag(stub: Stub): Promise<void> {
  // A storage reset or restore that clears the one-way flag row, with the R2 marker untouched (issue 16 A).
  return runInDurableObject(stub, (_instance, ctx) => { new DurableObjectSqlDatabase(ctx.storage).exec("DELETE FROM migration_state"); });
}

test("16 A break-glass (positive path): with the flag lost, the marker delete through R2 clears status, the import succeeds, and re-closing refuses imports again", async () => {
  const target = targetStub();
  const key = cutoverMarkerKey(target.id.toString());
  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  const at = ((await completed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;
  await loseFlag(target);

  // B0: the marker is present and the status reads its timestamp. A status read does not re-assert the flag.
  expect(await cutoverStatusBody(target)).toEqual({ ok: true, cutoverCompletedAt: at, cutoverMarker: "present" });

  // B2: delete the marker through the binding, as `cf r2 objects delete` does. No import is attempted before this, because
  // an import re-asserts the flag from the marker (the stop path below covers that).
  await env.EXPORTS.delete(key);
  expect(await env.EXPORTS.get(key)).toBeNull();

  // B3: the flag is clear, so the status reads absent and unset.
  expect(await cutoverStatusBody(target)).toEqual({ ok: true, cutoverCompletedAt: null, cutoverMarker: "absent" });

  // B4: the rebuild's import is accepted.
  const imported = await call(target, "POST", "/_ops/import", { table: "operators", rows: operatorRows("op-breakglass-rebuilt", 1) });
  expect(imported.status).toBe(200);
  expect((await verify(target)).operators?.rowCount).toBe(1);

  // B5 and B6: re-close writes the marker, then the flag. The new timestamp is returned and the status reads both.
  const reclosed = await call(target, "POST", "/_ops/cutover/complete", {});
  expect(reclosed.status).toBe(200);
  const reclosedAt = ((await reclosed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;
  expect(await cutoverStatusBody(target)).toEqual({ ok: true, cutoverCompletedAt: reclosedAt, cutoverMarker: "present" });
  expect(await env.EXPORTS.get(key)).not.toBeNull();

  const refusedAgain = await call(target, "POST", "/_ops/import", { table: "operators", rows: operatorRows("op-breakglass-after", 1) });
  expect(refusedAgain.status).toBe(409);
  expect(((await refusedAgain.json()) as { code: string }).code).toBe("CUTOVER_COMPLETE");
  expect((await verify(target)).operators?.rowCount).toBe(1);
});

test("16 A break-glass (stop path): when the flag survived in storage, the marker delete does not hold, status shows the completed cutover, and the next import re-creates the marker and refuses", async () => {
  const target = targetStub();
  const key = cutoverMarkerKey(target.id.toString());
  const completed = await call(target, "POST", "/_ops/cutover/complete", {});
  const at = ((await completed.json()) as { cutoverCompletedAt: string }).cutoverCompletedAt;

  // B2 with the flag still in storage (no loseFlag): the marker goes, but the flag row is intact.
  await env.EXPORTS.delete(key);

  // B3 stop signal: cutoverCompletedAt is set even though the marker reads absent. A status read does not re-create the marker.
  expect(await cutoverStatusBody(target)).toEqual({ ok: true, cutoverCompletedAt: at, cutoverMarker: "absent" });
  expect(await env.EXPORTS.get(key)).toBeNull();

  // The next import reconciles: the flag with no marker repairs the marker, and the import is refused.
  const refused = await call(target, "POST", "/_ops/import", { table: "operators", rows: operatorRows("op-stopped", 1) });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe("CUTOVER_COMPLETE");
  expect(await env.EXPORTS.get(key)).not.toBeNull();
  expect(await cutoverStatusBody(target)).toEqual({ ok: true, cutoverCompletedAt: at, cutoverMarker: "present" });
  expect((await verify(target)).operators?.rowCount).toBe(0);
});
test("Slice 17: PLATFORM and SHORTLET cutover markers for one tenant have distinct object-kind keys", () => {
  const tenantObjectId = "tenant-derived-object-id";
  expect(cutoverMarkerKey(tenantObjectId, "platform")).not.toBe(cutoverMarkerKey(tenantObjectId, "shortlet"));
});

test.each(["first invocation", "repeat invocation"])("Slice 17 AC3: same-tenant %s keeps per-DO cutover isolated", async () => {
  // The test harness fixes SHORTLET_TENANT_ID for the public gateway. Use a fresh tenant-derived name for both DO classes
  // in this focused cutover test; the SQL flags live only on these unique test-owned objects.
  const tenantName = `test-migration-two-do-cutover-${crypto.randomUUID()}`;
  const shortlet = env.ISOLATED_SHORTLET.get(env.ISOLATED_SHORTLET.idFromName(tenantName));
  const platform = env.ISOLATED_PLATFORM.get(env.ISOLATED_PLATFORM.idFromName(tenantName));
  const timestamp = new Date().toISOString();
  const shortletMarkerKey = cutoverMarkerKey(shortlet.id.toString(), "shortlet");
  const platformMarkerKey = cutoverMarkerKey(platform.id.toString(), "platform");
  try {
    const shortletTime = await runInDurableObject(shortlet, async (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      const marker = createCutoverMarkerStore(env.EXPORTS, shortlet.id.toString(), "shortlet");
      const first = await completeCutoverWithMarker(database, marker, timestamp);
      return completeCutoverWithMarker(database, marker, "2038-01-17T00:00:00.000Z").then((second) => ({ first, second, stored: cutoverCompletedAt(database) }));
    });
    const platformTime = await runInDurableObject(platform, async (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      const marker = createCutoverMarkerStore(env.EXPORTS, platform.id.toString(), "platform");
      const first = await completeCutoverWithMarker(database, marker, timestamp);
      const second = await completeCutoverWithMarker(database, marker, "2038-01-17T00:00:00.000Z");
      return { first, second, stored: cutoverCompletedAt(database) };
    });
    expect(shortletTime).toEqual({ first: timestamp, second: timestamp, stored: timestamp });
    expect(platformTime).toEqual({ first: timestamp, second: timestamp, stored: timestamp });
    expect(shortletMarkerKey).not.toBe(platformMarkerKey);
    expect(await env.EXPORTS.get(shortletMarkerKey)).not.toBeNull();
    expect(await env.EXPORTS.get(platformMarkerKey)).not.toBeNull();
  } finally {
    await env.EXPORTS.delete(shortletMarkerKey);
    await env.EXPORTS.delete(platformMarkerKey);
  }
});
