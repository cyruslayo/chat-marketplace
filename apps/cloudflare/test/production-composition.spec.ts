import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { RECEIPT_BLOB_TABLE, isApplicationTable } from "../../../packages/platform-core/src/data-migration.js";
import { DAILY_EXPORT_EXCLUDED, PLATFORM_EXPORT_TABLES, SHORTLET_EXPORT_TABLES } from "../src/do-export.js";
import { CREDENTIAL_TABLES } from "../../../packages/platform-core/src/data-migration.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { ORIGIN, TENANT, accessToken, opsHeaders, provisionTenant } from "./ops-test-helpers.js";

/**
 * Slice 16 / D3, full-composition table coverage. The Node-side checks only see the tables that a synthetic fixture's
 * stores create. This spec builds the production composition in a fresh Durable Object and reads the tables it creates
 * from live SQLite, then checks each one:
 *
 *  1. it is created by the schema migrations (src/schema.ts), so a fresh object has it before any store is built;
 *  2. it is on the import/export allowlist (`applicationTableNames`, served by POST /_ops/import and GET /_ops/import/verify),
 *     or it is listed in IMPORT_EXPORT_EXCLUDED with a reason;
 *  3. it is in the daily export set (EXPORT_TABLES, issue 12a), or it is listed in DAILY_EXPORT_EXCLUDED with a reason.
 *
 * A store that creates a table the migrations lack fails check 1 by name. Control tables (schema_migrations and
 * migration_state) and SQLite's internal tables are not application tables and are not listed here.
 */

/**
 * Tables the migration import and export allowlist deliberately leaves out, with the reason: the receipt blob table, and the
 * bearer-credential tables (issue 16 B), which are the one shared CREDENTIAL_TABLES list.
 */
const IMPORT_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  [RECEIPT_BLOB_TABLE]: "receipt bytes move to the private RECEIPTS bucket by key (07a, ADR 0090), so they are never rows",
  ...CREDENTIAL_TABLES,
};

/**
 * The only tables the daily export may leave out (issue 16 "Daily export coverage", Needs user item 6). Each one is
 * bearer credential material that must not be copied into an evidence record (ADR 0075, 0086, 0093). Every other
 * application table is exported, so a new store is exported unless someone adds it here with a reason and an ADR.
 */

/** Every table in the object's SQLite, minus SQLite's and Cloudflare's internal tables. Control tables are included. */
function userTables(database: DurableObjectSqlDatabase): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("sqlite_") && !name.startsWith("_cf_"));
}

test("16 D3 composition: every table the production composition creates is created by the schema migrations", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`composition-${crypto.randomUUID()}`));
  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  const [shortletMigrated, platformMigrated] = await Promise.all([
    runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
  ]);

  // Build the production composition: provisioning seeds inventory (store constructors run), a served request builds
  // the guest and owner runtime, and an authenticated ops request builds the ops handler.
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.20" } });
  expect(served.status).toBe(200);
  const ops = await stub.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(await accessToken({})) });
  expect(ops.status).toBe(200);

  const [shortletComposed, platformComposed] = await Promise.all([
    runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
  ]);
  expect(shortletComposed.length + platformComposed.length).toBeGreaterThan(0);
  const coveredByMigrations = new Set([...shortletMigrated, ...platformMigrated]);
  expect([...shortletComposed, ...platformComposed].filter((table) => !coveredByMigrations.has(table))).toEqual([]);
  // Guest server compatibility stores may lazily materialize a local mirror; the owning schema and export remain PLATFORM.
  const platformOwned = new Set<string>(PLATFORM_EXPORT_TABLES);
  const platformMigration = new Set(platformMigrated);
  for (const table of shortletComposed.filter((name) => platformOwned.has(name))) {
    expect(platformMigration.has(table), `${table} must be migrated by PLATFORM`).toBe(true);
  }
});

test("16 D3 composition: every table the production composition creates is on the import/export allowlist or excluded with a reason", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`composition-allowlist-${crypto.randomUUID()}`));
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.21" } });
  expect(served.status).toBe(200);

  const ops = await stub.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(await accessToken({})) });
  expect(ops.status).toBe(200);
  const verifyBody = (await ops.json()) as { tables: Record<string, unknown>; platform?: { tables?: Record<string, unknown> } };
  const allowlisted = [...Object.keys(verifyBody.tables), ...Object.keys(verifyBody.platform?.tables ?? {})].sort();

  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  const composed = await Promise.all([
    runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
  ]).then((sets) => sets.flat());
  const expected = composed.filter(isApplicationTable).filter((table) => !Object.hasOwn(IMPORT_EXPORT_EXCLUDED, table)).sort();
  expect(allowlisted).toEqual(expected);
});

test("16 D3 composition: every table the production composition creates is in the daily export set or excluded from it with a reason", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`composition-daily-${crypto.randomUUID()}`));
  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  const [shortletMigrated, platformMigrated] = await Promise.all([
    runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
  ]);
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.22" } });
  expect(served.status).toBe(200);
  const [shortletComposed, platformComposed] = await Promise.all([
    runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
    runInDurableObject(platform, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage))),
  ]);

  // Every name on the 12a list is a table the migrations create, so a typo or a renamed store is caught here.
  expect(SHORTLET_EXPORT_TABLES.filter((table) => !shortletMigrated.includes(table))).toEqual([]);
  expect(PLATFORM_EXPORT_TABLES.filter((table) => !platformMigrated.includes(table))).toEqual([]);
  const platformOwned = new Set<string>(PLATFORM_EXPORT_TABLES);
  const notExported = [...new Set([...shortletComposed.filter(isApplicationTable).filter((table) => !(SHORTLET_EXPORT_TABLES as readonly string[]).includes(table) && !platformOwned.has(table)),
    ...platformComposed.filter(isApplicationTable).filter((table) => !(PLATFORM_EXPORT_TABLES as readonly string[]).includes(table))])].sort();
  expect(notExported).toEqual(Object.keys(DAILY_EXPORT_EXCLUDED).sort());
  // Delegated decision (10 Oct 2026, issue 16): exclusion is for a small named set only, never for any table with a reason.
  expect(Object.keys(DAILY_EXPORT_EXCLUDED).sort()).toEqual(Object.keys(CREDENTIAL_TABLES).sort());
  for (const [table, reason] of Object.entries(DAILY_EXPORT_EXCLUDED)) {
    expect(reason.trim(), `${table} needs a reason`).not.toBe("");
    expect(reason, `${table} must cite the ADR that requires its exclusion`).toMatch(/\bADR \d{4}\b/);
  }
});
