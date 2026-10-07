import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { runAlarmTasks } from "../src/do-alarm.js";
import { EXPORT_TABLES, exportObjectKey, lagosDate, runDailyExport, type DailyExportDependencies } from "../src/do-export.js";

const stubFor = (name: string) => env.SHORTLET.get(env.SHORTLET.idFromName(name));

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
  await runInDurableObject(stub, (_instance, ctx) => {
    const audit = new SqliteAuditLog(new DurableObjectSqlDatabase(ctx.storage));
    audit.record({ action: "12a-evidence", operatorId: "op-evidence" });
    audit.record({ action: "12a-evidence-two" });
  });

  await runInDurableObject(stub, async (instance) => { await instance.alarm(); });

  const date = lagosDate(new Date());
  const keys = await listKeys(env.EXPORTS);
  for (const table of EXPORT_TABLES) expect(keys).toContain(exportObjectKey(date, table));

  const auditObject = await env.EXPORTS.get(exportObjectKey(date, "audit_log"));
  expect(auditObject).not.toBeNull();
  const lines = (await auditObject!.text()).split("\n").filter((line) => line !== "");
  expect(lines.length).toBe(2);
  // The audit table stores its entry as JSON; the export is a faithful row copy.
  expect(JSON.parse(JSON.parse(lines[0]!).payload_json).action).toBe("12a-evidence");

  // The alarm reschedules itself after the export (the notifier sweep is not configured on this object).
  const scheduled = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm());
  expect(scheduled).toEqual(expect.any(Number));
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
