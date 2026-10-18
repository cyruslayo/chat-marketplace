import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

const TENANT = "tenant-platform-schema-split";

test("Slice 17 AC1: PlatformDO applies only platform migrations while ShortletPilot applies only shortlet migrations", async () => {
  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  const shortlet = env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));
  const platformTables = await runInDurableObject(platform, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row.name)),
  );
  const shortletTables = await runInDurableObject(shortlet, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row.name)),
  );

  expect(platformTables).toEqual(expect.arrayContaining([
    "guest_accounts", "guest_account_sessions", "guest_contacts", "guest_threads", "guest_session_bindings", "audit_log", "telemetry_events",
  ]));
  expect(shortletTables).toEqual(expect.arrayContaining(["units", "operators", "guest_booking_requests", "guest_identity_assurance"]));
  const platformDataTables = platformTables.filter((table) => !["schema_migrations", "migration_state"].includes(table));
  const shortletDataTables = shortletTables.filter((table) => !["schema_migrations", "migration_state"].includes(table));
  expect(platformDataTables.filter((table) => shortletDataTables.includes(table))).toEqual([]);
  expect(platformTables).not.toContain("guest_identity_assurance");
  const assuranceForeignKeys = await runInDurableObject(shortlet, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage).prepare("PRAGMA foreign_key_list(guest_identity_assurance)").all(),
  );
  expect(assuranceForeignKeys.some((row) => row.table === "guest_accounts")).toBe(false);
}, 30000);
