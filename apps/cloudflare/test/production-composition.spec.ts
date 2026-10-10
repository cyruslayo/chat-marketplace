import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { RECEIPT_BLOB_TABLE, isApplicationTable } from "../../../packages/platform-core/src/data-migration.js";
import { EXPORT_TABLES } from "../src/do-export.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { ORIGIN, accessToken, opsHeaders, provisionTenant } from "./ops-test-helpers.js";

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

/** Tables the migration import and export allowlist deliberately leaves out, with the reason. */
const IMPORT_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  [RECEIPT_BLOB_TABLE]: "receipt bytes move to the private RECEIPTS bucket by key (07a, ADR 0090), so they are never rows",
};

/** Tables the 12a daily export does not write, with the reason. The export set is the user-approved evidence list. */
const OUTSIDE_EVIDENCE_SET =
  "outside the 12a evidence set (EXPORT_TABLES, user-approved); the migration export (issue 16) still carries it";

/**
 * Tables the 12a daily export does not write. Each is named with its reason, so a new store forces a decision. The
 * daily export is an evidence subset, not a full copy: a post-window reconciliation (cutover runbook, step 10) can
 * only compare the tables listed in EXPORT_TABLES.
 */
const DAILY_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  availability_commitments: OUTSIDE_EVIDENCE_SET,
  checkin_support_state: OUTSIDE_EVIDENCE_SET,
  guest_account_email_commands: OUTSIDE_EVIDENCE_SET,
  guest_account_rate_events: OUTSIDE_EVIDENCE_SET,
  guest_account_sessions: OUTSIDE_EVIDENCE_SET,
  guest_accounts: OUTSIDE_EVIDENCE_SET,
  guest_contacts: "personal contact data, kept out of the daily export by the 12a decision (issue 12a, DPIA note)",
  guest_payment_journey_snapshots: OUTSIDE_EVIDENCE_SET,
  guest_request_drafts: OUTSIDE_EVIDENCE_SET,
  guest_session_bindings: OUTSIDE_EVIDENCE_SET,
  guest_sign_in_codes: OUTSIDE_EVIDENCE_SET,
  guest_threads: OUTSIDE_EVIDENCE_SET,
  local_booking_contracts: OUTSIDE_EVIDENCE_SET,
  local_booking_reservations: OUTSIDE_EVIDENCE_SET,
  operator_access_tokens: OUTSIDE_EVIDENCE_SET,
  operator_enforcement_records: OUTSIDE_EVIDENCE_SET,
  operator_enforcement_sequence: OUTSIDE_EVIDENCE_SET,
  operator_representative_audit: OUTSIDE_EVIDENCE_SET,
  operator_representative_commands: OUTSIDE_EVIDENCE_SET,
  operator_representative_grants: OUTSIDE_EVIDENCE_SET,
  operator_sessions: OUTSIDE_EVIDENCE_SET,
  operators: OUTSIDE_EVIDENCE_SET,
  pilot_notifications: OUTSIDE_EVIDENCE_SET,
  revenue_adjustments: OUTSIDE_EVIDENCE_SET,
  revenue_compatibility_adjustments: OUTSIDE_EVIDENCE_SET,
  revenue_compatibility_releases: OUTSIDE_EVIDENCE_SET,
  revenue_earned_commission: OUTSIDE_EVIDENCE_SET,
  revenue_journals: OUTSIDE_EVIDENCE_SET,
  revenue_ledger_lines: OUTSIDE_EVIDENCE_SET,
  revenue_releases: OUTSIDE_EVIDENCE_SET,
  telemetry_events: OUTSIDE_EVIDENCE_SET,
  units: OUTSIDE_EVIDENCE_SET,
};

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
  // The object's constructor applies the migrations before any store is built, so this is the migrated schema alone.
  const migrated = await runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage)));

  // Build the production composition: provisioning seeds inventory (store constructors run), a served request builds
  // the guest and owner runtime, and an authenticated ops request builds the ops handler.
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.20" } });
  expect(served.status).toBe(200);
  const ops = await stub.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(await accessToken({})) });
  expect(ops.status).toBe(200);

  const composed = await runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage)));
  expect(composed.length).toBeGreaterThan(0);
  expect(composed.filter((table) => !migrated.includes(table))).toEqual([]);
});

test("16 D3 composition: every table the production composition creates is on the import/export allowlist or excluded with a reason", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`composition-allowlist-${crypto.randomUUID()}`));
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.21" } });
  expect(served.status).toBe(200);

  const ops = await stub.fetch(`${ORIGIN}/_ops/import/verify`, { headers: opsHeaders(await accessToken({})) });
  expect(ops.status).toBe(200);
  const allowlisted = Object.keys(((await ops.json()) as { tables: Record<string, unknown> }).tables).sort();

  const composed = await runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage)));
  const expected = composed.filter(isApplicationTable).filter((table) => !Object.hasOwn(IMPORT_EXPORT_EXCLUDED, table)).sort();
  expect(allowlisted).toEqual(expected);
});

test("16 D3 composition: every table the production composition creates is in the daily export set or excluded from it with a reason", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`composition-daily-${crypto.randomUUID()}`));
  const migrated = await runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage)));
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.22" } });
  expect(served.status).toBe(200);
  const composed = await runInDurableObject(stub, (_instance, ctx) => userTables(new DurableObjectSqlDatabase(ctx.storage)));

  // Every name on the 12a list is a table the migrations create, so a typo or a renamed store is caught here.
  expect(EXPORT_TABLES.filter((table) => !migrated.includes(table))).toEqual([]);
  const notExported = composed.filter(isApplicationTable).filter((table) => !(EXPORT_TABLES as readonly string[]).includes(table)).sort();
  expect(notExported).toEqual(Object.keys(DAILY_EXPORT_EXCLUDED).sort());
  for (const [table, reason] of Object.entries(DAILY_EXPORT_EXCLUDED)) {
    expect(reason.trim(), `${table} needs a reason`).not.toBe("");
  }
});
