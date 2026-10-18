import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, expect, test } from "vitest";
import { importOrder, importRequestChunks } from "../../../packages/platform-core/src/data-migration.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { COMMERCE_EXPORT_TABLES, EXPORT_TABLES, PLATFORM_EXPORT_TABLES, SHORTLET_EXPORT_TABLES, exportObjectKey, exportTable, type DailyExportDependencies } from "../src/do-export.js";
import { currentAssuranceForAccount, SqliteGuestIdentityAssurance } from "../../../domains/shortlet/src/guest-identity-assurance.js";
import { ORIGIN, accessToken, opsHeaders, provisionTenant } from "./ops-test-helpers.js";

/**
 * Issue 12b / 16 restore procedure (docs/runbooks/cloudflare-restore.md, section 2), checked against workerd. Each day's
 * objects are per-table snapshots (not one point-in-time snapshot across tables), so a rebuild loads ONE day's files through
 * the same `POST /_ops/import` route the runbook names, parents before children (`importOrder`), into a new object. The
 * rebuilt object must export the same bytes for that day. Synthetic dates far in the future keep these objects apart
 * from the alarm's own daily export.
 */

const EXPORT_YEAR = String(3000 + Math.floor(Math.random() * 6999));
const DAY_ONE = `${EXPORT_YEAR}-03-01`;
const DAY_TWO = `${EXPORT_YEAR}-03-02`;

const freshStub = (name: string) => env.SHORTLET.get(env.SHORTLET.idFromName(`${name}-${crypto.randomUUID()}`));
const freshPlatformStub = (name: string) => env.PLATFORM.get(env.PLATFORM.idFromName(`${name}-${crypto.randomUUID()}`));
const freshCommerceStub = (name: string) => env.COMMERCE.get(env.COMMERCE.idFromName(`${name}-${crypto.randomUUID()}`));

afterEach(async () => {
  for (const day of [DAY_ONE, DAY_TWO]) {
    for (const table of EXPORT_TABLES) await env.EXPORTS.delete(exportObjectKey(day, table));
  }
});

async function exportTables(stub: ReturnType<typeof freshStub> | ReturnType<typeof freshPlatformStub> | ReturnType<typeof freshCommerceStub>, date: string, tables: readonly string[], tableOwner: "shortlet" | "platform" | "commerce"): Promise<void> {
  await runInDurableObject(stub, async (_instance, ctx) => {
    const dependencies: DailyExportDependencies = {
      database: new DurableObjectSqlDatabase(ctx.storage),
      receipts: env.RECEIPTS,
      exports: env.EXPORTS,
      clock: () => new Date("2031-03-01T10:00:00Z"),
      retentionDays: 400,
      orphanGraceHours: 24,
      tableOwner,
    };
    for (const table of tables) await exportTable(dependencies, date, table);
  });
}

async function exportEveryTable(shortlet: ReturnType<typeof freshStub>, platform: ReturnType<typeof freshPlatformStub>, commerce: ReturnType<typeof freshCommerceStub>, date: string): Promise<void> {
  await exportTables(shortlet, date, SHORTLET_EXPORT_TABLES, "shortlet");
  await exportTables(platform, date, PLATFORM_EXPORT_TABLES, "platform");
  await exportTables(commerce, date, COMMERCE_EXPORT_TABLES, "commerce");
}

async function dayLines(date: string, table: string): Promise<string[]> {
  const object = await env.EXPORTS.get(exportObjectKey(date, table));
  if (object === null) throw new Error(`missing export ${date}/${table}`);
  return (await object.text()).split("\n").filter((line) => line !== "");
}

/** The runbook's load step: one table's rows through `POST /_ops/import`, in the request chunks the client uses. */
async function loadTable(stub: ReturnType<typeof freshStub>, table: string, lines: readonly string[], headers: Record<string, string>, platform?: ReturnType<typeof freshPlatformStub>, commerce?: ReturnType<typeof freshCommerceStub>): Promise<void> {
  const rows = lines.map((line) => JSON.parse(line) as unknown);
  for (const chunk of importRequestChunks(table, rows)) {
    const response = PLATFORM_EXPORT_TABLES.includes(table as typeof PLATFORM_EXPORT_TABLES[number])
      ? await (platform ?? (() => { throw new Error(`PLATFORM stub required for ${table}`); })()).fetch("https://do.internal/_internal/ops/import", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "tenant-synthetic", table, rows: chunk }),
        })
      : COMMERCE_EXPORT_TABLES.includes(table as typeof COMMERCE_EXPORT_TABLES[number])
        ? await (commerce ?? (() => { throw new Error(`COMMERCE stub required for ${table}`); })()).fetch("https://do.internal/_internal/ops/import", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "tenant-synthetic", table, rows: chunk }),
          })
        : await stub.fetch(`${ORIGIN}/_ops/import`, { method: "POST", headers, body: JSON.stringify({ table, rows: chunk }) });
    expect(response.status, `${table} import`).toBe(200);
  }
}

async function countRows(stub: ReturnType<typeof freshStub> | ReturnType<typeof freshPlatformStub> | ReturnType<typeof freshCommerceStub>, table: string): Promise<number> {
  return runInDurableObject(stub, (_instance, ctx) => Number(new DurableObjectSqlDatabase(ctx.storage).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n));
}

test("16 restore: a day's export loaded parent-first into a new object exports the same bytes for every exported table", async () => {
  const source = freshStub("restore-source");
  const sourcePlatform = freshPlatformStub("restore-source-platform");
  const sourceCommerce = freshCommerceStub("restore-source-commerce");
  await provisionTenant(source);
  await runInDurableObject(sourcePlatform, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    new SqliteAuditLog(database).record({ action: "restore-probe", operatorId: "op-restore" });
    // A child row that references its parent: the import must write the parent first (guest_accounts is an FK target).
    database.prepare("INSERT INTO guest_accounts (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision) VALUES ($id, $tenant, $email, 'active', $at, $at, 0)")
      .run({ $id: "gacct-restoreprobe", $tenant: "tenant-synthetic", $email: "probe@example.test", $at: "2031-02-01T00:00:00Z" });
    // A restorable child row: credential/replay tables are deliberately excluded from every export (ADR 0096).
    database.prepare("INSERT INTO guest_account_principals (principal_id, tenant_id, account_guest_id, linked_at) VALUES ($principal, $tenant, $id, $at)")
      .run({ $principal: "principal-restoreprobe", $tenant: "tenant-synthetic", $id: "gacct-restoreprobe", $at: "2031-02-01T00:00:00Z" });
  });
  await exportEveryTable(source, sourcePlatform, sourceCommerce, DAY_ONE);

  const target = freshStub("restore-target");
  const targetPlatform = freshPlatformStub("restore-target-platform");
  const targetCommerce = freshCommerceStub("restore-target-commerce");
  const headers = opsHeaders(await accessToken({}));
  const platformOrder = await runInDurableObject(sourcePlatform, (_instance, ctx) => importOrder(new DurableObjectSqlDatabase(ctx.storage), PLATFORM_EXPORT_TABLES));
  const shortletOrder = await runInDurableObject(source, (_instance, ctx) => importOrder(new DurableObjectSqlDatabase(ctx.storage), SHORTLET_EXPORT_TABLES));
  const commerceOrder = await runInDurableObject(sourceCommerce, (_instance, ctx) => importOrder(new DurableObjectSqlDatabase(ctx.storage), COMMERCE_EXPORT_TABLES));
  expect([...platformOrder].sort()).toEqual([...PLATFORM_EXPORT_TABLES].sort());
  expect([...shortletOrder].sort()).toEqual([...SHORTLET_EXPORT_TABLES].sort());
  expect([...commerceOrder].sort()).toEqual([...COMMERCE_EXPORT_TABLES].sort());
  expect(platformOrder.indexOf("guest_accounts")).toBeLessThan(platformOrder.indexOf("guest_account_principals"));

  // Restore parent ownership first: PLATFORM account row, then its PLATFORM child, then SHORTLET assurance/transactions.
  for (const table of platformOrder) await loadTable(target, table, await dayLines(DAY_ONE, table), headers, targetPlatform, targetCommerce);
  for (const table of commerceOrder) await loadTable(target, table, await dayLines(DAY_ONE, table), headers, targetPlatform, targetCommerce);
  for (const table of shortletOrder) await loadTable(target, table, await dayLines(DAY_ONE, table), headers);
  await exportEveryTable(target, targetPlatform, targetCommerce, DAY_TWO);

  for (const table of EXPORT_TABLES) {
    expect(await dayLines(DAY_TWO, table), `${table} after restore`).toEqual(await dayLines(DAY_ONE, table));
  }
  expect(await countRows(targetPlatform, "guest_account_principals")).toBe(1);
}, 30_000);

test("16 restore: loading every day oldest first keeps a row deleted after the older day, so only the newest day is loaded", async () => {
  const source = freshPlatformStub("restore-history");
  await runInDurableObject(source, (_instance, ctx) => {
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "restore-kept" });
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "restore-deleted" });
  });
  await exportTables(source, DAY_ONE, ["audit_log"], "platform");
  await runInDurableObject(source, (_instance, ctx) => {
    new DurableObjectSqlDatabase(ctx.storage).prepare("DELETE FROM audit_log WHERE payload_json LIKE '%restore-deleted%'").run();
  });
  await exportTables(source, DAY_TWO, ["audit_log"], "platform");
  expect((await dayLines(DAY_ONE, "audit_log")).length).toBe(2);
  expect((await dayLines(DAY_TWO, "audit_log")).length).toBe(1);

  const oldestFirst = freshStub("restore-oldest-first");
  const oldestPlatform = freshPlatformStub("restore-oldest-platform");
  const headers = opsHeaders(await accessToken({}));
  await loadTable(oldestFirst, "audit_log", await dayLines(DAY_ONE, "audit_log"), headers, oldestPlatform);
  await loadTable(oldestFirst, "audit_log", await dayLines(DAY_TWO, "audit_log"), headers, oldestPlatform);
  expect(await countRows(oldestPlatform, "audit_log")).toBe(2);

  const newestOnly = freshStub("restore-newest-only");
  const newestPlatform = freshPlatformStub("restore-newest-platform");
  await loadTable(newestOnly, "audit_log", await dayLines(DAY_TWO, "audit_log"), headers, newestPlatform);
  expect(await countRows(newestPlatform, "audit_log")).toBe(1);
});

/**
 * Issue 09 (review): identity assurance rows survive a daily export and a restore into a new object. The rows are for an active and
 * for a closed Guest Account of the same tenant. After the restore, the active account's result is current and the closed account has
 * none, the same as before the export (ADR 0094: reads never return a closed account's result).
 */
test("16 restore (issue 09): identity assurance rows for an active and a closed account survive export and restore, and currentAssurance reads the same after restore", async () => {
  const restoreClock = () => new Date("2026-10-10T09:00:00.000Z");
  const source = freshStub("restore-assurance-source");
  const sourcePlatform = freshPlatformStub("restore-assurance-platform-source");
  await provisionTenant(source);
  await runInDurableObject(sourcePlatform, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const insertAccount = (id: string, email: string) => database.prepare("INSERT INTO guest_accounts (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision) VALUES ($id, $tenant, $email, 'active', $at, $at, 0)")
      .run({ $id: id, $tenant: "tenant-synthetic", $email: email, $at: "2026-10-01T00:00:00Z" });
    insertAccount("gacct-assure-active", "assure-active@example.test");
    insertAccount("gacct-assure-closed", "assure-closed@example.test");
    database.prepare("UPDATE guest_accounts SET status = 'closed' WHERE account_guest_id = $id").run({ $id: "gacct-assure-closed" });
  });
  await runInDurableObject(source, (_instance, ctx) => {
    const store = new SqliteGuestIdentityAssurance(new DurableObjectSqlDatabase(ctx.storage), { clock: restoreClock });
    for (const accountGuestId of ["gacct-assure-active", "gacct-assure-closed"]) {
      store.recordOutcome({
        tenantId: "tenant-synthetic", accountGuestId, level: "government-ID-verified", method: "nigeria_nin_v2_biometric_kyc",
        status: "verified", verifiedAt: "2026-10-10T08:00:00.000Z", expiresAt: "2031-10-10T08:00:00.000Z", providerReference: null, accountEmailRevision: 0,
      });
    }
  });
  await exportTables(sourcePlatform, DAY_ONE, ["guest_accounts"], "platform");
  await exportTables(source, DAY_ONE, ["guest_identity_assurance"], "shortlet");
  expect((await dayLines(DAY_ONE, "guest_identity_assurance")).length).toBe(2);

  const target = freshStub("restore-assurance-target");
  const targetPlatform = freshPlatformStub("restore-assurance-platform-target");
  const headers = opsHeaders(await accessToken({}));
  // The owning parent lives in PLATFORM; import it there before the SHORTLET assurance rows.
  await loadTable(target, "guest_accounts", await dayLines(DAY_ONE, "guest_accounts"), headers, targetPlatform);
  await loadTable(target, "guest_identity_assurance", await dayLines(DAY_ONE, "guest_identity_assurance"), headers);
  expect(await countRows(target, "guest_identity_assurance")).toBe(2);

  const restoredAccountStates = await runInDurableObject(targetPlatform, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const read = (accountGuestId: string) => {
      const row = database.prepare("SELECT status, email_revision FROM guest_accounts WHERE tenant_id = ? AND account_guest_id = ?")
        .get(["tenant-synthetic", accountGuestId]);
      if (!row || (row.status !== "active" && row.status !== "closed")) return { status: "missing" as const };
      return row.status === "closed" ? { status: "closed" as const } : { status: "active" as const, emailRevision: Number(row.email_revision) };
    };
    return { active: read("gacct-assure-active"), closed: read("gacct-assure-closed") };
  });
  const accountState = {
    async readAccountAssuranceState(input: { tenantId: string; accountGuestId: string }) {
      if (input.tenantId !== "tenant-synthetic") return { status: "missing" as const };
      return input.accountGuestId === "gacct-assure-active" ? restoredAccountStates.active : restoredAccountStates.closed;
    },
  };
  const readAfterRestore = await runInDurableObject(target, async (_instance, ctx) => {
    const store = new SqliteGuestIdentityAssurance(new DurableObjectSqlDatabase(ctx.storage), { clock: restoreClock });
    return {
      active: (await currentAssuranceForAccount(store, accountState, "gacct-assure-active", "tenant-synthetic", restoreClock()))?.status ?? null,
      closed: await currentAssuranceForAccount(store, accountState, "gacct-assure-closed", "tenant-synthetic", restoreClock()),
    };
  });
  expect(readAfterRestore).toMatchObject({ active: "verified", closed: null });

  // A second export of the restored object writes the same bytes for both tables (the round trip is exact).
  await exportTables(targetPlatform, DAY_TWO, ["guest_accounts"], "platform");
  await exportTables(target, DAY_TWO, ["guest_identity_assurance"], "shortlet");
  for (const table of ["guest_accounts", "guest_identity_assurance"]) {
    expect(await dayLines(DAY_TWO, table), `${table} after restore`).toEqual(await dayLines(DAY_ONE, table));
  }
});
