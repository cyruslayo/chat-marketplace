import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { importOrder, importRequestChunks } from "../../../packages/platform-core/src/data-migration.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { EXPORT_TABLES, exportObjectKey, exportTable, type DailyExportDependencies } from "../src/do-export.js";
import { ORIGIN, accessToken, opsHeaders, provisionTenant } from "./ops-test-helpers.js";

/**
 * Issue 12b / 16 restore procedure (docs/runbooks/cloudflare-restore.md, section 2), checked against workerd. Each day's
 * objects are per-table snapshots (not one point-in-time snapshot across tables), so a rebuild loads ONE day's files through
 * the same `POST /_ops/import` route the runbook names, parents before children (`importOrder`), into a new object. The
 * rebuilt object must export the same bytes for that day. Synthetic dates far in the future keep these objects apart
 * from the alarm's own daily export.
 */

const DAY_ONE = "2031-03-01";
const DAY_TWO = "2031-03-02";

const freshStub = (name: string) => env.SHORTLET.get(env.SHORTLET.idFromName(`${name}-${crypto.randomUUID()}`));

async function exportTables(stub: ReturnType<typeof freshStub>, date: string, tables: readonly string[]): Promise<void> {
  await runInDurableObject(stub, async (_instance, ctx) => {
    const dependencies: DailyExportDependencies = {
      database: new DurableObjectSqlDatabase(ctx.storage),
      receipts: env.RECEIPTS,
      exports: env.EXPORTS,
      clock: () => new Date("2031-03-01T10:00:00Z"),
      retentionDays: 400,
      orphanGraceHours: 24,
    };
    for (const table of tables) await exportTable(dependencies, date, table);
  });
}

async function exportEveryTable(stub: ReturnType<typeof freshStub>, date: string): Promise<void> {
  await exportTables(stub, date, EXPORT_TABLES);
}

async function dayLines(date: string, table: string): Promise<string[]> {
  const object = await env.EXPORTS.get(exportObjectKey(date, table));
  if (object === null) throw new Error(`missing export ${date}/${table}`);
  return (await object.text()).split("\n").filter((line) => line !== "");
}

/** The runbook's load step: one table's rows through `POST /_ops/import`, in the request chunks the client uses. */
async function loadTable(stub: ReturnType<typeof freshStub>, table: string, lines: readonly string[], headers: Record<string, string>): Promise<void> {
  const rows = lines.map((line) => JSON.parse(line) as unknown);
  for (const chunk of importRequestChunks(table, rows)) {
    const response = await stub.fetch(`${ORIGIN}/_ops/import`, { method: "POST", headers, body: JSON.stringify({ table, rows: chunk }) });
    expect(response.status, `${table} import`).toBe(200);
  }
}

async function countRows(stub: ReturnType<typeof freshStub>, table: string): Promise<number> {
  return runInDurableObject(stub, (_instance, ctx) => Number(new DurableObjectSqlDatabase(ctx.storage).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n));
}

test("16 restore: a day's export loaded parent-first into a new object exports the same bytes for every exported table", async () => {
  const source = freshStub("restore-source");
  await provisionTenant(source);
  await runInDurableObject(source, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    new SqliteAuditLog(database).record({ action: "restore-probe", operatorId: "op-restore" });
    // A child row that references its parent: the import must write the parent first (guest_accounts is an FK target).
    database.prepare("INSERT INTO guest_accounts (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision) VALUES ($id, $tenant, $email, 'active', $at, $at, 0)")
      .run({ $id: "gacct-restoreprobe", $tenant: "tenant-synthetic", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
    database.prepare("INSERT INTO guest_account_email_commands (tenant_id, account_guest_id, idempotency_key_hash, fingerprint, email_normalized, status, created_at, updated_at, revision) VALUES ($tenant, $id, $key, $fp, $email, 'done', $at, $at, 0)")
      .run({ $tenant: "tenant-synthetic", $id: "gacct-restoreprobe", $key: "key-hash-probe", $fp: "fingerprint-probe", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
  });
  await exportEveryTable(source, DAY_ONE);

  const target = freshStub("restore-target");
  const headers = opsHeaders(await accessToken({}));
  const order = await runInDurableObject(target, (_instance, ctx) => importOrder(new DurableObjectSqlDatabase(ctx.storage), EXPORT_TABLES));
  // Every exported table appears once, and each FK parent comes before its child.
  expect([...order].sort()).toEqual([...EXPORT_TABLES].sort());
  expect(order.indexOf("guest_accounts")).toBeLessThan(order.indexOf("guest_account_email_commands"));

  for (const table of order) await loadTable(target, table, await dayLines(DAY_ONE, table), headers);
  await exportEveryTable(target, DAY_TWO);

  for (const table of EXPORT_TABLES) {
    expect(await dayLines(DAY_TWO, table), `${table} after restore`).toEqual(await dayLines(DAY_ONE, table));
  }
  expect(await countRows(target, "guest_account_email_commands")).toBe(1);
});

test("16 restore: loading every day oldest first keeps a row deleted after the older day, so only the newest day is loaded", async () => {
  const source = freshStub("restore-history");
  await runInDurableObject(source, (_instance, ctx) => {
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "restore-kept" });
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "restore-deleted" });
  });
  await exportTables(source, DAY_ONE, ["audit_log"]);
  await runInDurableObject(source, (_instance, ctx) => {
    new DurableObjectSqlDatabase(ctx.storage).prepare("DELETE FROM audit_log WHERE payload_json LIKE '%restore-deleted%'").run();
  });
  await exportTables(source, DAY_TWO, ["audit_log"]);
  expect((await dayLines(DAY_ONE, "audit_log")).length).toBe(2);
  expect((await dayLines(DAY_TWO, "audit_log")).length).toBe(1);

  const oldestFirst = freshStub("restore-oldest-first");
  const headers = opsHeaders(await accessToken({}));
  await loadTable(oldestFirst, "audit_log", await dayLines(DAY_ONE, "audit_log"), headers);
  await loadTable(oldestFirst, "audit_log", await dayLines(DAY_TWO, "audit_log"), headers);
  expect(await countRows(oldestFirst, "audit_log")).toBe(2);

  const newestOnly = freshStub("restore-newest-only");
  await loadTable(newestOnly, "audit_log", await dayLines(DAY_TWO, "audit_log"), headers);
  expect(await countRows(newestOnly, "audit_log")).toBe(1);
});
