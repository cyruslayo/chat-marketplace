import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteRevenueAccountingRepository, SqliteRevenueReleaseStateStore } from "../domains/shortlet/src/sqlite-revenue-accounting.js";
import { RevenueReleaseManager } from "../domains/shortlet/src/revenue-release.js";
import { InMemoryRevenueAccountingRepository, journal, type RevenueAdjustmentRecord } from "../domains/shortlet/src/revenue-accounting.js";
import { verifyReleaseAccountingContract } from "./helpers/revenue-contract.js";
import { setupRevenueRelease, revenuePrincipal, revenueEconomics } from "./revenue-release-fixtures.js";

const legacyInput = {
  booking: { reservationId: "legacy-1", unitId: "unit-1", tenantId: "tenant", operatorId: "operator-1", accommodationKobo: 3_000_000_001, mandatoryChargesKobo: 0, securityDepositKobo: 0, attributableTaxKobo: 0 },
  verifiedAccessIso: "2026-09-01T12:00:00Z", currentIso: "2026-09-02T12:00:00Z", hasUnresolvedBlockingComplaint: false,
};

test("06c AC1: Comments audit lists every piece of instance state and persists it or explains re-derivation", () => {
  const issue = readFileSync(".scratch/cloudflare-deployment/issues/06c-durable-revenue-state.md", "utf8");
  for (const field of ["#releases", "#journals", "#earned", "#adjustments", "#failCommit", "#blockingComplaintQuery"]) assert.ok(issue.includes(field));
  const db = openNodeSqliteDatabase(":memory:");
  try {
    new SqliteRevenueAccountingRepository(db);
    new SqliteRevenueReleaseStateStore(db);
    for (const table of ["revenue_releases", "revenue_journals", "revenue_ledger_lines", "revenue_earned_commission", "revenue_adjustments", "revenue_compatibility_releases", "revenue_compatibility_adjustments"]) {
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get([table])?.name, table);
    }
  } finally { db.close(); }
});

test("06c AC2: Revenue records and release decisions made before a restart are the same after it", () => {
  const directory = mkdtempSync(join(tmpdir(), "revenue-restart-"));
  const config = { databasePath: join(directory, "pilot.sqlite"), seedFixture: false };
  let env = new LocalApartmentOwnerEnvironment(config);
  try {
    const production = setupRevenueRelease({ accounting: env.accountingRepository });
    const release = production.app.releaseRevenue("reservation-1", revenuePrincipal);
    const correction: RevenueAdjustmentRecord = {
      adjustmentId: "adjustment-1", adjustmentVersion: 1, reservationId: release.reservationId, releaseId: release.releaseId,
      source: "refund", sourceReference: "synthetic-refund-1", reasonCode: "refund_accepted",
      journal: journal({ correlationId: release.releaseId, createdAt: legacyInput.currentIso, lines: [
        { lineId: "correction-debit", account: "operator_net_recognized", side: "debit", amountKobo: 7, currency: "NGN" },
        { lineId: "correction-credit", account: "operator_payable", side: "credit", amountKobo: 7, currency: "NGN" },
      ] }),
    };
    env.accountingRepository.postAdjustment({ adjustment: correction });
    const journals = env.accountingRepository.findLedgerEntriesForRelease(release.releaseId);
    const earned = env.accountingRepository.getEarnedCommissionRecord(release.releaseId);
    env.revenueReleaseManager.processRevenueRelease(legacyInput);
    const adjustment = env.revenueReleaseManager.postLedgerAdjustment({ reservationId: "legacy-1", reason: "correction", adjustmentKobo: -7, recordedAtIso: legacyInput.currentIso });
    env.close();
    env = new LocalApartmentOwnerEnvironment(config);
    assert.deepEqual(env.accountingRepository.findReleaseByReservationId("reservation-1"), release);
    assert.deepEqual(env.accountingRepository.findReleaseById(release.releaseId), release);
    assert.deepEqual(env.accountingRepository.findLedgerEntriesForRelease(release.releaseId), journals);
    assert.deepEqual(env.accountingRepository.getEarnedCommissionRecord(release.releaseId), earned);
    assert.deepEqual(env.accountingRepository.findAdjustmentsForRelease(release.releaseId), [correction]);
    assert.deepEqual(env.accountingRepository.postAdjustment({ adjustment: correction }), correction);
    assert.deepEqual(env.accountingRepository.findLedgerEntriesForRelease(release.releaseId), journals);
    assert.throws(() => env.revenueReleaseManager.processRevenueRelease(legacyInput), /already processed/);
    const db = openNodeSqliteDatabase(config.databasePath);
    try { assert.equal(db.prepare("SELECT adjustment_kobo FROM revenue_compatibility_adjustments WHERE adjustment_id = ?").get([adjustment.adjustmentId])?.adjustment_kobo, -7); } finally { db.close(); }
  } finally { env.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("06c AC3: A release that fails halfway leaves no partial ledger rows", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const accounting = new SqliteRevenueAccountingRepository(db);
    const setup = setupRevenueRelease({ accounting });
    db.exec("CREATE TRIGGER fail_revenue BEFORE INSERT ON revenue_earned_commission BEGIN SELECT RAISE(ABORT, 'halfway'); END");
    assert.throws(() => db.transaction(() => setup.app.releaseRevenue("reservation-1", revenuePrincipal)), /halfway/);
    for (const table of ["revenue_releases", "revenue_journals", "revenue_ledger_lines", "revenue_earned_commission"]) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
    db.exec("DROP TRIGGER fail_revenue");
    const release = setup.app.releaseRevenue("reservation-1", revenuePrincipal);
    assert.equal(accounting.findLedgerEntriesForRelease(release.releaseId).length, 1);
  } finally { db.close(); }
});

test("06c AC4: Amounts round-trip exactly as integers in kobo including a value above 2^31", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const manager = new RevenueReleaseManager({ stateStore: new SqliteRevenueReleaseStateStore(db) });
    const release = manager.processRevenueRelease(legacyInput);
    assert.equal(release.commissionBaseKobo, 3_000_000_001);
    const row = db.prepare("SELECT commission_base_kobo, typeof(commission_base_kobo) AS storage_type FROM revenue_compatibility_releases").get();
    assert.equal(row?.commission_base_kobo, release.commissionBaseKobo);
    assert.equal(row?.storage_type, "integer");
    const accounting = new SqliteRevenueAccountingRepository(db);
    const production = setupRevenueRelease({ accounting, providers: { economics: { getEconomics: () => ({ ...revenueEconomics, commissionableOperatorRevenueKobo: 3_000_000_001 }) } } });
    const committed = production.app.releaseRevenue("reservation-1", revenuePrincipal);
    assert.deepEqual(accounting.findReleaseById(committed.releaseId), committed);
    assert.equal(accounting.findLedgerEntriesForRelease(committed.releaseId)[0]?.lines[0]?.amountKobo, 3_000_000_001);
    assert.equal(db.prepare("SELECT commission_base_kobo FROM revenue_releases").get()?.commission_base_kobo, 3_000_000_001);
    assert.ok(db.prepare("SELECT amount_kobo, typeof(amount_kobo) AS kind FROM revenue_ledger_lines").all().every((line) => line.kind === "integer" && typeof line.amount_kobo === "number" && Number.isSafeInteger(line.amount_kobo)));
    assert.throws(() => new SqliteRevenueReleaseStateStore(db).recordAdjustment({ adjustmentId: "fraction", reservationId: "legacy-1", type: "ledger_adjustment", reason: "invalid", adjustmentKobo: 1.5, recordedAtIso: legacyInput.currentIso }), /integer/);
  } finally { db.close(); }
});

test("06c AC5: Existing revenue and release scenarios pass against both implementations through a shared contract helper", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    verifyReleaseAccountingContract(new InMemoryRevenueAccountingRepository());
    verifyReleaseAccountingContract(new SqliteRevenueAccountingRepository(db));
    for (const file of ["test/post-commission-and-revenue-release.test.ts", "test/integrate-revenue-release-application.test.ts"]) assert.match(readFileSync(file, "utf8"), /registerRevenueContract/);
  } finally { db.close(); }
});
