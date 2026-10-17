import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { runAlarmTasks } from "../src/do-alarm.js";
import { ORIGIN, isolatedPlatformStub, isolatedTenantName, provisionTenant } from "./ops-test-helpers.js";
import { SHORTLET_EXPORT_TABLES, PLATFORM_EXPORT_TABLES, deleteExpiredExports, exportObjectKey, exportTable, lagosDate, runDailyExport, type DailyExportDependencies } from "../src/do-export.js";

const stubFor = (name: string) => env.SHORTLET.get(env.SHORTLET.idFromName(`${name}-${crypto.randomUUID()}`));

async function exportDependencies(
  stub: ReturnType<typeof stubFor>,
  overrides: { readonly retentionDays?: number; readonly orphanGraceHours?: number } = {},
): Promise<void> {
  await runInDurableObject(stub, async (_instance, ctx) => {
    const dependencies: DailyExportDependencies = {
      database: new DurableObjectSqlDatabase(ctx.storage),
      receipts: env.RECEIPTS,
      exports: env.EXPORTS,
      clock: () => new Date(),
      retentionDays: overrides.retentionDays ?? 400,
      orphanGraceHours: overrides.orphanGraceHours ?? 24,
    };
    await runDailyExport(dependencies);
  });
}

async function listKeys(bucket: typeof env.RECEIPTS): Promise<string[]> {
  return (await bucket.list()).objects.map((object) => object.key);
}

test("12a AC1: after the alarm the EXPORTS bucket holds one JSONL object per listed table for the day", async () => {
  const stub = stubFor(`12a-ac1-${crypto.randomUUID()}`);
  const evidence = `12a-evidence-${crypto.randomUUID()}`;
  await runInDurableObject(stub, (_instance, ctx) => {
    const audit = new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage));
    audit.record({ action: evidence, operatorId: "op-evidence" });
    audit.record({ action: `${evidence}-two` });
  });

  await runInDurableObject(stub, async (instance) => { await instance.alarm(); });

  const date = lagosDate(new Date());
  const keys = await listKeys(env.EXPORTS);
  for (const table of SHORTLET_EXPORT_TABLES) expect(keys).toContain(exportObjectKey(date, table));
  const sharedAuditExport = await env.EXPORTS.get(exportObjectKey(date, "audit_log"));
  if (sharedAuditExport !== null) {
    const exportedAudit = await sharedAuditExport.text();
    expect(exportedAudit).not.toContain(evidence);
  }

  // The alarm reschedules itself after the export (the notifier sweep is not configured on this object).
  const scheduled = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm());
  expect(scheduled).toEqual(expect.any(Number));
});

test("Slice 17 AC3: the platform alarm exports platform-owned tables separately", async () => {
  const platform = isolatedPlatformStub(isolatedTenantName("platform-export"));
  await runInDurableObject(platform, (_instance, ctx) => {
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "platform-export-probe" });
  });
  await runInDurableObject(platform, async (instance) => { await instance.alarm(); });
  const date = lagosDate(new Date());
  const keys = await listKeys(env.EXPORTS);
  for (const table of PLATFORM_EXPORT_TABLES) expect(keys).toContain(exportObjectKey(date, table));
  const auditObject = await env.EXPORTS.get(exportObjectKey(date, "audit_log"));
  expect(auditObject).not.toBeNull();
  expect((await auditObject!.text())).toContain("platform-export-probe");
});

test("12a AC2: running the export twice on the same day overwrites the same objects", async () => {
  const stub = stubFor(`12a-ac2-${crypto.randomUUID()}`);
  await runInDurableObject(stub, (_instance, ctx) => {
    new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage)).record({ action: "12a-idempotent" });
  });

  await exportDependencies(stub);
  const date = lagosDate(new Date());
  const first = await (await env.EXPORTS.get(exportObjectKey(date, "audit_log")))!.text();
  await exportDependencies(stub);
  const second = await (await env.EXPORTS.get(exportObjectKey(date, "audit_log")))!.text();

  expect(second).toBe(first);
  expect(first.split("\n").filter((line) => line !== "").length).toBe(1);
});

test("12a AC3: an old receipt with no metadata row is swept, and one with a row or a newer one is kept", async () => {
  const stub = stubFor(`12a-ac3-${crypto.randomUUID()}`);
  const orphan = `12a-orphan-old-${crypto.randomUUID()}`;
  const withRow = `12a-with-row-${crypto.randomUUID()}`;
  await env.RECEIPTS.put(orphan, Uint8Array.from([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  await env.RECEIPTS.put(withRow, Uint8Array.from([4, 5, 6]), { httpMetadata: { contentType: "image/png" } });
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    database.exec("CREATE TABLE IF NOT EXISTS manual_transfer_receipts (receipt_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB, object_key TEXT, size_bytes INTEGER)");
    database.prepare("INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, object_key, size_bytes) VALUES ($id, $transfer, $type, $key, $size)")
      .run({ $id: crypto.randomUUID(), $transfer: "transfer-1", $type: "image/png", $key: withRow, $size: 3 });
  });

  // A 24-hour grace keeps a fresh object even without a row; a zero grace treats it as old.
  await exportDependencies(stub, { orphanGraceHours: 24 });
  expect(await listKeys(env.RECEIPTS)).toEqual(expect.arrayContaining([orphan, withRow]));

  await exportDependencies(stub, { orphanGraceHours: 0 });
  const keys = await listKeys(env.RECEIPTS);
  expect(keys).not.toContain(orphan);
  expect(keys).toContain(withRow);
});

test("12a AC4: exports older than the configured retention are deleted and newer ones are kept", async () => {
  const stub = stubFor(`12a-ac4-${crypto.randomUUID()}`);
  const oldKey = exportObjectKey("2020-01-01", "audit_log");
  const futureKey = exportObjectKey("2999-01-01", "audit_log");
  await env.EXPORTS.put(oldKey, "old", { httpMetadata: { contentType: "application/x-ndjson" } });
  await env.EXPORTS.put(futureKey, "future", { httpMetadata: { contentType: "application/x-ndjson" } });

  await exportDependencies(stub, { retentionDays: 400 });

  const keys = await listKeys(env.EXPORTS);
  expect(keys).not.toContain(oldKey);
  expect(keys).toContain(futureKey);
  await env.EXPORTS.delete(futureKey);
});

test("12a AC5: one failing task does not stop the others (the alarm reschedules regardless)", async () => {
  const ran: string[] = [];
  const failed = await runAlarmTasks(
    [
      { name: "daily-export", run: () => { throw new Error("export failed"); } },
      { name: "notifications", run: () => { ran.push("notifications"); } },
    ],
    () => {},
  );
  expect(failed).toEqual(["daily-export"]);
  expect(ran).toEqual(["notifications"]);
});

/** Records which R2 write methods the exporter calls, delegating everything else to the real EXPORTS bucket. */
function recordingBucket(calls: string[]): typeof env.EXPORTS {
  return new Proxy(env.EXPORTS, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return (value as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

async function everyKey(bucket: typeof env.EXPORTS): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
}

test("16 D3 export: a table larger than one R2 part is streamed in parts and keeps every row in rowid order", async () => {
  const stub = isolatedPlatformStub(isolatedTenantName("16-d3-large"));
  const date = "2031-03-03";
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    for (let id = 1; id <= 6000; id += 1) {
      database.prepare("INSERT INTO telemetry_events (id, recorded_at, payload_json) VALUES ($id, $at, $payload)")
        .run({ $id: id, $at: "2031-03-03T00:00:00Z", $payload: `${String(id).padStart(6, "0")}${"x".repeat(994)}` });
    }
  });

  const calls: string[] = [];
  const written = await runInDurableObject(stub, (_instance, ctx) =>
    exportTable({
      database: new DurableObjectSqlDatabase(ctx.storage),
      receipts: env.RECEIPTS,
      exports: recordingBucket(calls),
      clock: () => new Date("2031-03-03T10:00:00Z"),
      retentionDays: 400,
      orphanGraceHours: 24,
      tableOwner: "platform",
    }, date, "telemetry_events"),
  );

  expect(written).toBe(6000);
  expect(calls).toContain("createMultipartUpload");
  const lines = (await (await env.EXPORTS.get(exportObjectKey(date, "telemetry_events")))!.text()).split("\n").filter((line) => line !== "");
  expect(lines.length).toBe(6000);
  expect(JSON.parse(lines[0]!).id).toBe(1);
  expect(JSON.parse(lines[5999]!).id).toBe(6000);
  await env.EXPORTS.delete(exportObjectKey(date, "telemetry_events"));
});

test("16 D3 retention: old exports beyond the first 1,000-object listing page are deleted too", async () => {
  const stub = stubFor(`16-d3-retention-${crypto.randomUUID()}`);
  const keys = Array.from({ length: 1005 }, (_, index) => exportObjectKey("2020-01-01", `bulk-${String(index).padStart(4, "0")}`));
  await Promise.all(keys.map((key) => env.EXPORTS.put(key, "old", { httpMetadata: { contentType: "application/x-ndjson" } })));

  const deleted = await runInDurableObject(stub, (_instance, ctx) =>
    deleteExpiredExports({
      database: new DurableObjectSqlDatabase(ctx.storage),
      receipts: env.RECEIPTS,
      exports: env.EXPORTS,
      clock: () => new Date(),
      retentionDays: 400,
      orphanGraceHours: 24,
    }, lagosDate(new Date())),
  );

  expect(deleted).toBeGreaterThanOrEqual(keys.length);
  const remaining = new Set(await everyKey(env.EXPORTS));
  expect(keys.filter((key) => remaining.has(key))).toEqual([]);
}, 60_000);

test("12a AC6 (F1): with notifications unset, a provisioned object schedules its alarm and the daily export still runs", async () => {
  const stub = stubFor(`12a-f1-no-notify-${crypto.randomUUID()}`);
  // Test-only: remove the notification bindings from this object's env before its first request, so its runtime has no
  // notifier. The other test objects keep the notification configuration from wrangler.test.jsonc.
  await runInDurableObject(stub, (instance) => {
    const mutable = instance as unknown as { env: Record<string, unknown> };
    mutable.env = { ...mutable.env, RESEND_API_KEY: undefined, SHORTLET_NOTIFICATION_FROM: undefined, SHORTLET_OPERATOR_ALERT_EMAILS: undefined };
  });
  await provisionTenant(stub);
  const served = await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.40" } });
  expect(served.status).toBe(200);

  const scheduled = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm());
  expect(scheduled).toEqual(expect.any(Number));

  await runInDurableObject(stub, async (instance) => { await instance.alarm(); });
  const keys = await listKeys(env.EXPORTS);
  expect(keys).toContain(exportObjectKey(lagosDate(new Date()), "units"));
});
