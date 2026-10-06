import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { setupRevenueRelease, revenuePrincipal } from "../revenue-release-fixtures.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";
import { InMemoryRevenueAccountingRepository, type RevenueAccountingRepository } from "../../domains/shortlet/src/revenue-accounting.js";
import { RevenueReleaseManager } from "../../domains/shortlet/src/revenue-release.js";
import { SqliteRevenueAccountingRepository, SqliteRevenueReleaseStateStore } from "../../domains/shortlet/src/sqlite-revenue-accounting.js";

export function verifyReleaseAccountingContract(accounting: RevenueAccountingRepository): void {
  const fixture = setupRevenueRelease({ accounting });
  const release = fixture.app.releaseRevenue("reservation-1", revenuePrincipal);
  assert.deepEqual(fixture.app.releaseRevenue("reservation-1", revenuePrincipal), release);
  assert.deepEqual(accounting.findReleaseById(release.releaseId), release);
  assert.equal(accounting.findLedgerEntriesForRelease(release.releaseId).length, 1);
  assert.equal(accounting.getEarnedCommissionRecord(release.releaseId)?.earnedCommissionKobo, release.commissionKobo);
}

/** Registers the existing scenarios unchanged in meaning, with each implementation owning its test handles. */
export function registerRevenueContract(register: (fixture: {
  test: typeof test;
  createAccounting: () => RevenueAccountingRepository;
  createManager: (options?: ConstructorParameters<typeof RevenueReleaseManager>[0]) => RevenueReleaseManager;
}) => void): void {
  for (const adapter of ["memory", "sqlite"] as const) describe(`revenue contract (${adapter})`, () => {
    const databases: SqlDatabase[] = [];
    const open = () => {
      const database = openNodeSqliteDatabase(":memory:");
      databases.push(database);
      return database;
    };
    after(() => { for (const database of databases) database.close(); });
    register({
      test,
      createAccounting: () => adapter === "memory" ? new InMemoryRevenueAccountingRepository() : new SqliteRevenueAccountingRepository(open()),
      createManager: (options = {}) => new RevenueReleaseManager({ ...options, ...(adapter === "sqlite" ? { stateStore: new SqliteRevenueReleaseStateStore(open()) } : {}) }),
    });
  });
}
