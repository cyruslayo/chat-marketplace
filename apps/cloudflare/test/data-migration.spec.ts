import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { buildExport, checksumTables, compareMigration, type MigrationExport, type MigrationManifest } from "../../../packages/platform-core/src/data-migration.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { importBatch } from "../src/ops-import.js";
import { populateSource, targetSchemaStatements } from "./data-migration-fixtures.js";
import nodeExportFixture from "./fixtures/node-export.json?raw";
import { ORIGIN, accessToken, opsHeaders } from "./ops-test-helpers.js";

/** Slice 16: the import, verify and reverse-export routes, exercised through the Durable Object's own fetch. */

const uniqueStub = (label: string) => env.SHORTLET.get(env.SHORTLET.idFromName(`${label}-${crypto.randomUUID()}`));

type Stub = ReturnType<typeof uniqueStub>;

async function sourceStub(): Promise<Stub> {
  const stub = uniqueStub("migration-source");
  await runInDurableObject(stub, (_instance, ctx) => populateSource(new DurableObjectSqlDatabase(ctx.storage)));
  return stub;
}

async function schemaOf(source: Stub): Promise<string[]> {
  return runInDurableObject(source, (_instance, ctx) => targetSchemaStatements(new DurableObjectSqlDatabase(ctx.storage)));
}

/** An empty Durable Object that has the same tables the export expects, as cutover prepares it. */
async function targetStub(schema: readonly string[]): Promise<Stub> {
  const stub = uniqueStub("migration-target");
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    for (const statement of schema) database.exec(statement);
  });
  return stub;
}

async function call(stub: Stub, method: string, path: string, body?: unknown, authenticated = true) {
  const headers = authenticated ? opsHeaders(await accessToken({})) : { "content-type": "application/json" };
  return stub.fetch(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function verify(stub: Stub): Promise<Record<string, { rowCount: number; sha256: string }>> {
  const response = await call(stub, "GET", "/_ops/import/verify");
  expect(response.status).toBe(200);
  return ((await response.json()) as { tables: Record<string, { rowCount: number; sha256: string }> }).tables;
}

function jsonlRows(content: string): unknown[] {
  return content.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as unknown);
}

/** The client sends 100 rows per request, the same bound the Node import uses. */
async function importTable(stub: Stub, table: string, rows: readonly unknown[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 100) {
    const response = await call(stub, "POST", "/_ops/import", { table, rows: rows.slice(start, start + 100) });
    expect(response.status).toBe(200);
  }
}

function operatorRows(prefix: string, count: number): Array<{ id: string; operator_json: string }> {
  return Array.from({ length: count }, (_value, index) => ({ id: `${prefix}-${String(index).padStart(3, "0")}`, operator_json: "{}" }));
}

test("16 AC1: exporting a populated database and importing it into a Durable Object gives identical row counts and checksums for every table", async () => {
  const source = await sourceStub();
  const exported: MigrationExport = await runInDurableObject(source, (_instance, ctx) => buildExport(new DurableObjectSqlDatabase(ctx.storage)));
  const sourceCounts = await runInDurableObject(source, async (_instance, ctx) => checksumTables(new DurableObjectSqlDatabase(ctx.storage), ["audit_log", "units", "operators"]));
  expect(sourceCounts.operators?.rowCount).toBeGreaterThan(0);
  expect(exported.manifest.tables.operators?.rowCount).toBe(sourceCounts.operators?.rowCount);

  const target = await targetStub(await schemaOf(source));
  for (const [table, content] of Object.entries(exported.contents)) await importTable(target, table, jsonlRows(content));

  // The object creates its own empty operator grant and session tables on first ops use; those are not in the source.
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
  const target = await targetStub(await schemaOf(await sourceStub()));
  for (const [table, content] of Object.entries(fixture.contents)) await importTable(target, table, jsonlRows(content));

  const verified = await verify(target);
  expect(compareMigration(fixture.manifest, verified)).toEqual([]);
  expect(Object.keys(fixture.manifest.tables).sort()).toEqual(Object.keys(fixture.contents).sort());
  for (const [table, expected] of Object.entries(fixture.manifest.tables)) {
    expect(verified[table]).toEqual(expected);
  }
});

test("16 AC2: a batch that would exceed 100 parameters is split automatically", async () => {
  const target = await targetStub(await schemaOf(await sourceStub()));
  // Two columns per row: 60 rows would bind 120 parameters in one statement.
  const rows = operatorRows("op-split", 60);
  const result = await runInDurableObject(target, (_instance, ctx) => importBatch(new DurableObjectSqlDatabase(ctx.storage), "operators", rows));
  expect(result.received).toBe(60);
  expect(result.statements).toBeGreaterThan(1);
  expect(result.maxParameters).toBeLessThanOrEqual(100);
  expect((await verify(target)).operators?.rowCount).toBe(60);
});

test("16 AC2: a malformed row fails its whole batch and nothing from that batch is written", async () => {
  const target = await targetStub(await schemaOf(await sourceStub()));
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
  const target = await targetStub(await schemaOf(await sourceStub()));
  const rows = operatorRows("op-repeat", 3);
  await importTable(target, "operators", rows);
  const first = await verify(target);
  await importTable(target, "operators", rows);
  const second = await verify(target);
  expect(second.operators?.rowCount).toBe(3);
  expect(second).toEqual(first);
});

test("16 import refuses unknown tables and unknown columns and requires both authentication layers", async () => {
  const target = await targetStub(await schemaOf(await sourceStub()));

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
  const target = await targetStub(await schemaOf(await sourceStub()));
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

test("16 ADR 0075: a malformed JSON import body is refused without echoing any of its row content", async () => {
  const target = await targetStub(await schemaOf(await sourceStub()));
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
