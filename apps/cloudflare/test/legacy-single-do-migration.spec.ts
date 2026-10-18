import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import type { SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { canonicalTableContent, contentSha256, importOrder } from "../../../packages/platform-core/src/data-migration.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { DAILY_EXPORT_EXCLUDED, EXPORT_TABLES, exportObjectKey, exportTable as exportDailyTable } from "../src/do-export.js";
import { cutoverMarkerKey } from "../src/cutover-marker.js";
import { ORIGIN, accessToken, isolatedPlatformStub, isolatedShortletStub, isolatedTenantName, isolatedWorkerFetch, opsHeaders } from "./ops-test-helpers.js";
import {
  LEGACY_ASSURANCE_MIGRATION,
  LEGACY_SINGLE_DO_CREDENTIAL_TABLES,
  LEGACY_SINGLE_DO_TABLES,
  seedLegacySingleDo,
} from "./legacy-single-do-fixture.js";

const EXPORT_DAY = "2038-01-17";

test("test-only gateway bindings scope both real Durable Object namespaces to each unique tenant", () => {
  const firstTenant = isolatedTenantName("namespace-scope");
  const secondTenant = isolatedTenantName("namespace-scope");
  const firstShortlet = isolatedShortletStub(firstTenant);
  const firstPlatform = isolatedPlatformStub(firstTenant);
  const secondShortlet = isolatedShortletStub(secondTenant);
  const secondPlatform = isolatedPlatformStub(secondTenant);

  expect(firstShortlet.id.name).toBe(firstTenant);
  expect(firstPlatform.id.name).toBe(firstTenant);
  expect(secondShortlet.id.name).toBe(secondTenant);
  expect(secondPlatform.id.name).toBe(secondTenant);
  expect(firstShortlet.id.toString()).not.toBe(secondShortlet.id.toString());
  expect(cutoverMarkerKey(firstShortlet.id.toString(), "shortlet"))
    .not.toBe(cutoverMarkerKey(secondShortlet.id.toString(), "shortlet"));
  expect(cutoverMarkerKey(firstPlatform.id.toString(), "platform"))
    .not.toBe(cutoverMarkerKey(secondPlatform.id.toString(), "platform"));
});

/** End-to-end AC3 regression: an actual pre-split SQLite object is exported, then restored through the authenticated gateway. */
test("17 AC3: legacy single-DO export partitions through the gateway, verifies, re-exports and cuts over both DOs", async () => {
  const suffix = crypto.randomUUID();
  const tenantId = isolatedTenantName("legacy-roundtrip");
  const source = env.SHORTLET.get(env.SHORTLET.idFromName(`legacy-single-source-${suffix}`));
  const target = isolatedShortletStub(tenantId);
  const platform = isolatedPlatformStub(tenantId);
  const gateway = (path: string, init: RequestInit) => isolatedWorkerFetch(tenantId, new Request(`${ORIGIN}${path}`, init));
  const headers = opsHeaders(await accessToken({}));
  const exportedTables = LEGACY_SINGLE_DO_TABLES;
  const legacyExportManifest = EXPORT_TABLES.filter((table) => !Object.hasOwn(DAILY_EXPORT_EXCLUDED, table));
  const exportDay = `${EXPORT_DAY}-${suffix}`;
  const keys = legacyExportManifest.map((table) => exportObjectKey(exportDay, table));
  const shortletMarker = cutoverMarkerKey(target.id.toString(), "shortlet");
  const platformMarker = cutoverMarkerKey(platform.id.toString(), "platform");

  try {
    const ids = await runInDurableObject(source, (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      const fixtureIds = seedLegacySingleDo(database, tenantId, suffix);
      // Pin the evidence to the pre-split account row shape from 25aa54c: the source has no email_revision column.
      expect(database.prepare("PRAGMA table_info(guest_accounts)").all().some((column) => column.name === "email_revision")).toBe(false);
      expect(database.prepare("PRAGMA table_info(guest_identity_assurance)").all().some((column) => column.name === "account_email_revision")).toBe(false);
      return fixtureIds;
    });

    // Use the old single-object export writer against its actual schema/data. Credential tables are seeded but absent from
    // the export table list, as in the old exporter; the assurance row is exported but deliberately invalidated on restore.
    expect(LEGACY_SINGLE_DO_CREDENTIAL_TABLES.every((table) => Object.hasOwn(DAILY_EXPORT_EXCLUDED, table))).toBe(true);
    const sourceSnapshot = await runInDurableObject(source, async (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      const dependencies = { database, exports: env.EXPORTS, clock: () => new Date("2038-01-17T10:00:00.000Z"), retentionDays: 400, orphanGraceHours: 24 };
      const rows: Record<string, SqlRow[]> = {};
      for (const table of legacyExportManifest) {
        await exportDailyTable(dependencies, exportDay, table);
        if (exportedTables.includes(table as typeof LEGACY_SINGLE_DO_TABLES[number])) {
          rows[table] = database.prepare(`SELECT * FROM "${table}"`).all();
        }
      }
      const credentialCounts = Object.fromEntries(LEGACY_SINGLE_DO_CREDENTIAL_TABLES.map((table) => [
        table,
        Number(database.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()?.n ?? 0),
      ]));
      const order = importOrder(database, exportedTables);
      return { rows, credentialCounts, order };
    });
    expect(Object.values(sourceSnapshot.credentialCounts).every((count) => count > 0)).toBe(true);
    for (const table of LEGACY_SINGLE_DO_CREDENTIAL_TABLES) {
      expect(await env.EXPORTS.get(exportObjectKey(exportDay, table))).toBeNull();
    }

    const accountIndex = sourceSnapshot.order.indexOf("guest_accounts");
    const principalIndex = sourceSnapshot.order.indexOf("guest_account_principals");
    expect(accountIndex).toBeGreaterThanOrEqual(0);
    expect(principalIndex).toBeGreaterThan(accountIndex);
    expect(sourceSnapshot.order.indexOf("guest_accounts")).toBeLessThan(sourceSnapshot.order.indexOf("guest_identity_assurance"));

    const imported: string[] = [];
    for (const table of sourceSnapshot.order) {
      if (table === "guest_identity_assurance") continue;
      const object = await env.EXPORTS.get(exportObjectKey(exportDay, table));
      expect(object, `legacy export exists for ${table}`).not.toBeNull();
      const rows = (await object!.text()).split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as unknown);
      for (let start = 0; start < rows.length; start += 20) {
        const response = await gateway("/_ops/import", {
          method: "POST",
          headers,
          body: JSON.stringify({ table, rows: rows.slice(start, start + 20) }),
        });
        expect(response.status, `${table} is routed to its owning object`).toBe(200);
      }
      imported.push(table);
    }
    expect(imported).toContain("guest_accounts");
    expect(imported).toContain("guest_contacts");
    expect(imported).toContain("guest_threads");
    expect(imported).toContain("manual_transfers");
    expect(imported).not.toContain("guest_identity_assurance");
    expect(LEGACY_ASSURANCE_MIGRATION).toBe("omit-unbound-legacy-assurance");

    // Each credential family is refused by the real gateway; the fixture contains no credential export objects.
    for (const table of LEGACY_SINGLE_DO_CREDENTIAL_TABLES) {
      const response = await gateway("/_ops/import", {
        method: "POST", headers,
        body: JSON.stringify({ table, rows: [{ session_id: `must-not-import-${suffix}` }] }),
      });
      expect(response.status, table).toBe(400);
      expect((await response.json() as { code?: string }).code).toBe("EXCLUDED_TABLE");
    }

    const verifyResponse = await gateway("/_ops/import/verify", { headers });
    expect(verifyResponse.status).toBe(200);
    const verified = await verifyResponse.json() as {
      tables: Record<string, { rowCount: number; sha256: string }>;
      platform: { tables: Record<string, { rowCount: number; sha256: string }> };
    };
    const combined = { ...verified.tables, ...verified.platform.tables };

    for (const table of imported) {
      const response = await gateway(`/_ops/export?table=${encodeURIComponent(table)}`, { headers });
      expect(response.status, `${table} reverse export uses its owner`).toBe(200);
      const reexport = await response.json() as { rowCount: number; sha256: string; content: string };
      expect(combined[table]).toEqual({ rowCount: reexport.rowCount, sha256: reexport.sha256 });

      // Compare canonical fixture rows, not unrelated rows that may exist in the shared test tenant. The sole account
      // schema addition is its database default; it is not used as evidence for the old assurance record.
      const sourceRows = sourceSnapshot.rows[table] ?? [];
      const expectedRows: SqlRow[] = table === "guest_accounts"
        ? sourceRows.map((row) => ({ ...row, email_revision: 0 }))
        : sourceRows;
      const actualRows = reexport.content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const fixtureKeys: Record<string, readonly string[]> = {
        guest_accounts: [ids.accountGuestId, ids.assuranceAccountGuestId],
        guest_account_principals: [ids.principalId],
        guest_contacts: [ids.principalId],
        guest_threads: [ids.threadId],
        manual_transfers: [ids.transactionId],
      };
      const keyColumn: Record<string, string> = {
        guest_accounts: "account_guest_id", guest_account_principals: "principal_id", guest_contacts: "guest_id",
        guest_threads: "thread_id", manual_transfers: "transfer_id",
      };
      const fixtureRows = actualRows.filter((row) => fixtureKeys[table]?.includes(String(row[keyColumn[table] ?? ""])));
      const expected = canonicalTableContent(expectedRows);
      const actual = canonicalTableContent(fixtureRows as SqlRow[]);
      expect(actual.content, `${table} re-exported fixture rows`).toBe(expected.content);
      expect(await contentSha256(actual.content)).toBe(await contentSha256(expected.content));
    }

    // A legacy assurance with no account_email_revision is purposefully not restored as current assurance.
    const assuranceCount = await runInDurableObject(target, (_instance, ctx) => Number(
      new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?")
        .get([tenantId, ids.assuranceAccountGuestId])?.n ?? 0,
    ));
    expect(assuranceCount).toBe(0);

    const statusResponse = await gateway("/_ops/status", { headers });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json() as { schemaVersion: number; platform: { schemaVersion: number } };
    expect(status.schemaVersion).toBeGreaterThan(0);
    expect(status.platform.schemaVersion).toBeGreaterThan(0);

    const cutoverResponse = await gateway("/_ops/cutover/complete", { method: "POST", headers, body: "{}" });
    expect(cutoverResponse.status).toBe(200);
    const cutover = await cutoverResponse.json() as { cutoverCompletedAt: string; platformCutoverCompletedAt: string };
    expect(cutover.cutoverCompletedAt).toEqual(expect.any(String));
    expect(cutover.platformCutoverCompletedAt).toEqual(expect.any(String));
    expect(shortletMarker).not.toBe(platformMarker);
    expect(await env.EXPORTS.get(shortletMarker)).not.toBeNull();
    expect(await env.EXPORTS.get(platformMarker)).not.toBeNull();

    const cutoverStatusResponse = await gateway("/_ops/status", { headers });
    expect(cutoverStatusResponse.status).toBe(200);
    const cutoverStatus = await cutoverStatusResponse.json() as {
      cutoverCompletedAt: string;
      cutoverMarker: string;
      platform: { cutoverCompletedAt: string; cutoverMarker: string };
    };
    expect(cutoverStatus).toMatchObject({
      cutoverCompletedAt: cutover.cutoverCompletedAt,
      cutoverMarker: "present",
      platform: { cutoverCompletedAt: cutover.platformCutoverCompletedAt, cutoverMarker: "present" },
    });
  } finally {
    for (const key of keys) await env.EXPORTS.delete(key);
    // These tenant-scoped test bindings and UUID tenant are exclusively owned by this invocation.
    await env.EXPORTS.delete(shortletMarker);
    await env.EXPORTS.delete(platformMarker);
    await runInDurableObject(platform, (_instance, ctx) => {
      const database = new DurableObjectSqlDatabase(ctx.storage);
      database.prepare("DELETE FROM guest_account_principals WHERE principal_id = ?").run([`principal-legacy-${suffix}`]);
      database.prepare("DELETE FROM guest_contacts WHERE guest_id = ? AND tenant_id = ?").run([`principal-legacy-${suffix}`, tenantId]);
      database.prepare("DELETE FROM guest_threads WHERE thread_id = ? AND tenant_id = ?").run([`thread-legacy-${suffix}`, tenantId]);
      database.prepare("DELETE FROM guest_accounts WHERE account_guest_id IN (?, ?) AND tenant_id = ?")
        .run([`gacct-legacy-${suffix}`, `gacct-legacy-assurance-${suffix}`, tenantId]);
    });
    await runInDurableObject(target, (_instance, ctx) => {
      new DurableObjectSqlDatabase(ctx.storage).prepare("DELETE FROM manual_transfers WHERE transfer_id = ?").run([`transfer-legacy-${suffix}`]);
    });
    const remaining = await runInDurableObject(platform, (_instance, ctx) =>
      Number(new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT COUNT(*) AS n FROM guest_accounts WHERE account_guest_id IN (?, ?)")
        .get([`gacct-legacy-${suffix}`, `gacct-legacy-assurance-${suffix}`])?.n ?? 0),
    );
    expect(remaining).toBe(0);
  }
}, 60_000);
