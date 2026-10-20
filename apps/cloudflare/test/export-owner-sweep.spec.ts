import type { R2Bucket } from "@cloudflare/workers-types";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { COMMERCE_EXPORT_TABLES, EXPORT_TABLES, PLATFORM_EXPORT_TABLES, SHORTLET_EXPORT_TABLES, deleteExpiredExports, exportObjectKey, lagosDate, type DailyExportDependencies } from "../src/do-export.js";
import { runInDurableObject } from "cloudflare:test";

/**
 * Final review F9 (ADR 0095, ADR 0101): every owner's alarm sweeps only its own tables' expired exports. Export keys stay
 * `YYYY-MM-DD/<table>.jsonl` (the restore contract), so ownership is by table name, and the sweep never lists or deletes another
 * owner's objects. Day folders are found with a delimiter listing, not by listing every object in the bucket.
 */

const TODAY = "2032-01-10";
const EXPIRED = ["2031-12-01", "2031-12-02"];
const KEPT_DAYS = ["2032-01-09", TODAY];
const CLOCK = () => new Date("2032-01-10T10:00:00Z");

/** A real R2 bucket that records every list and delete the sweep makes. */
function recordingBucket() {
  const lists: Array<{ prefix?: string; delimiter?: string }> = [];
  const deletes: string[] = [];
  const bucket = {
    list: (options?: { prefix?: string; delimiter?: string; cursor?: string }) => {
      lists.push({ prefix: options?.prefix, delimiter: options?.delimiter });
      return env.EXPORTS.list(options);
    },
    delete: (key: string) => {
      deletes.push(key);
      return env.EXPORTS.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, lists, deletes };
}

function dependencies(exports: R2Bucket): DailyExportDependencies {
  return { database: undefined as never, exports, clock: CLOCK, retentionDays: 1, orphanGraceHours: 24 };
}

async function seed(): Promise<void> {
  for (const day of [...EXPIRED, ...KEPT_DAYS]) {
    for (const table of ["units", "audit_log", "merchants"]) await env.EXPORTS.put(exportObjectKey(day, table), "{}");
  }
}

async function clear(): Promise<void> {
  for (const day of [...EXPIRED, ...KEPT_DAYS]) {
    for (const table of ["units", "audit_log", "merchants"]) await env.EXPORTS.delete(exportObjectKey(day, table));
  }
}

async function keys(): Promise<string[]> {
  return (await env.EXPORTS.list()).objects.map((object) => object.key).filter((key) => key.includes("/")).sort();
}

test("F9: the shortlet sweep deletes only its own expired tables and never lists or deletes another owner's objects", async () => {
  await clear();
  await seed();
  const recorder = recordingBucket();
  const deleted = await deleteExpiredExports(dependencies(recorder.bucket), TODAY, SHORTLET_EXPORT_TABLES);
  expect(deleted).toBe(EXPIRED.length);
  expect(recorder.deletes.sort()).toEqual(EXPIRED.map((day) => exportObjectKey(day, "units")).sort());
  // Every listing is either the root delimiter listing or an exact key of one of the shortlet tables. Nothing lists another owner.
  for (const listing of recorder.lists) {
    if (listing.prefix === undefined) {
      expect(listing.delimiter).toBe("/");
      continue;
    }
    const table = listing.prefix.split("/")[1]?.replace(/\.jsonl$/, "") ?? "";
    expect(SHORTLET_EXPORT_TABLES).toContain(table);
  }
  await clear();
});

test("F9: each owner's expired objects are still deleted by that owner's sweep, and nothing else is", async () => {
  await clear();
  await seed();
  await deleteExpiredExports(dependencies(recordingBucket().bucket), TODAY, PLATFORM_EXPORT_TABLES);
  await deleteExpiredExports(dependencies(recordingBucket().bucket), TODAY, COMMERCE_EXPORT_TABLES);
  // Platform and commerce sweeps delete only their own expired tables: the shortlet units of the expired days stay.
  expect(await keys()).toEqual(
    [...EXPIRED.map((day) => exportObjectKey(day, "units")), ...KEPT_DAYS.flatMap((day) => ["audit_log", "merchants", "units"].map((table) => exportObjectKey(day, table)))].sort(),
  );
  await deleteExpiredExports(dependencies(recordingBucket().bucket), TODAY, SHORTLET_EXPORT_TABLES);
  expect(await keys()).toEqual(
    [...KEPT_DAYS].flatMap((day) => ["audit_log", "merchants", "units"].map((table) => exportObjectKey(day, table))).sort(),
  );
  await clear();
});

test("F9: every exported table has exactly one owner, so every key is swept by exactly one alarm", () => {
  const owners = [...SHORTLET_EXPORT_TABLES, ...PLATFORM_EXPORT_TABLES, ...COMMERCE_EXPORT_TABLES];
  expect(new Set(owners).size).toBe(owners.length);
  expect([...owners].sort()).toEqual([...EXPORT_TABLES].sort());
});

/**
 * Review of 8febb76: a commerce object in its failed state still sweeps its own expired exports (ADR 0075 retention, ADR 0095
 * and ADR 0101 ownership). It exports nothing, and it deletes nothing that another owner or a retained day owns.
 */
test("review of 8febb76: a failed commerce object's alarm deletes its own expired exports, sweeps nothing else, and exports nothing", async () => {
  const stub = env.ISOLATED_COMMERCE.get(env.ISOLATED_COMMERCE.idFromName(`failing-${crypto.randomUUID()}`));
  const today = lagosDate(new Date());
  const expired = "2020-01-01";
  const recent = lagosDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const commerceExpired = exportObjectKey(expired, "merchants");
  const commerceOrdersExpired = exportObjectKey(expired, "merchant_orders");
  const commerceRecent = exportObjectKey(recent, "merchants");
  const shortletExpired = exportObjectKey(expired, "units");
  const platformExpired = exportObjectKey(expired, "audit_log");
  const commerceToday = exportObjectKey(today, "merchants");
  for (const key of [commerceExpired, commerceOrdersExpired, commerceRecent, shortletExpired, platformExpired]) await env.EXPORTS.put(key, "{}");

  await runInDurableObject(stub, async (instance) => {
    await instance.alarm();
  });

  const present = async (key: string) => (await env.EXPORTS.head(key)) !== null;
  expect(await present(commerceExpired)).toBe(false);
  expect(await present(commerceOrdersExpired)).toBe(false);
  expect(await present(commerceRecent)).toBe(true);
  expect(await present(shortletExpired)).toBe(true);
  expect(await present(platformExpired)).toBe(true);
  expect(await present(commerceToday)).toBe(false);
  for (const key of [commerceRecent, shortletExpired, platformExpired]) await env.EXPORTS.delete(key);
});
