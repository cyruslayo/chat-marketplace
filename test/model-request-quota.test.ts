import { test } from "node:test";
import assert from "node:assert/strict";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteModelRequestQuota } from "../packages/platform-core/src/model-request-quota.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";

test("AC1: concurrent reservations cannot exceed tenant-daily or guest-hour limits across database handles", async () => {
  const path = temporaryDatabasePath("model-request-quota-ac1.sqlite");
  const now = () => new Date("2026-10-24T12:00:00.000Z");
  const firstDb = openNodeSqliteDatabase(path);
  const secondDb = openNodeSqliteDatabase(path);
  const options = { dailyTenantLimit: 3, hourlyGuestLimit: 2, clock: now };
  const first = new SqliteModelRequestQuota(firstDb, options);
  const second = new SqliteModelRequestQuota(secondDb, options);
  try {
    const reservations = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 === 0 ? first : second).reserve({ tenantId: "tenant-a", guestId: "guest-a" }),
    ));
    assert.equal(reservations.filter((result) => result.reserved).length, 2);
    assert.equal(reservations.filter((result) => !result.reserved && result.reason === "guest_hour_limit").length, 10);
    assert.equal((await first.reserve({ tenantId: "tenant-a", guestId: "guest-b" })).reserved, true);
    const tenantLimited = await first.reserve({ tenantId: "tenant-a", guestId: "guest-c" });
    assert.equal(tenantLimited.reserved, false);
    if (!tenantLimited.reserved) assert.equal(tenantLimited.reason, "tenant_day_limit");
  } finally {
    firstDb.close();
    secondDb.close();
  }
});

test("AC2: reopening preserves reservations, the guest-hour limit rolls across clock boundaries, and day rollover resets tenant capacity", async () => {
  const path = temporaryDatabasePath("model-request-quota-ac2.sqlite");
  let current = new Date("2026-10-24T22:30:00.000Z");
  const options = { dailyTenantLimit: 4, hourlyGuestLimit: 1, clock: () => new Date(current) };
  const firstDb = openNodeSqliteDatabase(path);
  const first = new SqliteModelRequestQuota(firstDb, options);
  assert.deepEqual(await first.reserve({ tenantId: "tenant-a", guestId: "guest-a" }), { reserved: true });
  firstDb.close();

  const reopenedDb = openNodeSqliteDatabase(path);
  const reopened = new SqliteModelRequestQuota(reopenedDb, options);
  try {
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-a" }), { reserved: false, reason: "guest_hour_limit" });
    current = new Date("2026-10-24T23:00:00.000Z");
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-a" }), { reserved: false, reason: "guest_hour_limit" });
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-b" }), { reserved: true });
    current = new Date("2026-10-24T23:30:00.000Z");
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-a" }), { reserved: true });
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-c" }), { reserved: true });
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-d" }), { reserved: true });
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-e" }), { reserved: false, reason: "tenant_day_limit" });
    current = new Date("2026-10-25T23:01:00.000Z");
    assert.deepEqual(await reopened.reserve({ tenantId: "tenant-a", guestId: "guest-e" }), { reserved: true });
  } finally {
    reopenedDb.close();
  }
});

test("AC1: invalid identities and limits fail closed instead of creating quota records", async () => {
  const path = temporaryDatabasePath("model-request-quota-invalid.sqlite");
  const database = openNodeSqliteDatabase(path);
  try {
    assert.throws(() => new SqliteModelRequestQuota(database, { hourlyGuestLimit: 0 }), /whole number/);
    const quota = new SqliteModelRequestQuota(database);
    await assert.rejects(quota.reserve({ tenantId: "", guestId: "guest-a" }), /identity is invalid/);
    await assert.rejects(quota.reserve({ tenantId: "tenant-a", guestId: "x".repeat(201) }), /identity is invalid/);
  } finally {
    database.close();
  }
});

test("AC2: storage failure and malformed persisted counts reject reservations safely", async () => {
  const path = temporaryDatabasePath("model-request-quota-storage-failure.sqlite");
  const database = openNodeSqliteDatabase(path);
  const quota = new SqliteModelRequestQuota(database, { clock: () => new Date("2026-10-24T12:00:00.000Z") });
  database.prepare("INSERT INTO model_request_tenant_daily (tenant_id, day_key, reservation_count) VALUES (?, ?, ?)")
    .run(["tenant-a", "2026-10-24", "untrusted"]);
  try {
    await assert.rejects(quota.reserve({ tenantId: "tenant-a", guestId: "guest-a" }), /quota state is unavailable/);
  } finally {
    database.close();
  }
  await assert.rejects(quota.reserve({ tenantId: "tenant-b", guestId: "guest-a" }));
});
