import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { ReservePayoutManager, SqliteReservePayoutStateStore, type ReserveTranche } from "../domains/shortlet/src/index.js";
import { SqliteRevenueAccountingRepository } from "../domains/shortlet/src/sqlite-revenue-accounting.js";
import type { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/index.js";
import { operatorRestartFixture } from "./helpers/operator-restart.js";
import { revenuePrincipal, setupRevenueRelease } from "./revenue-release-fixtures.js";

const staff = (env: LocalApartmentOwnerEnvironment) => ({ id: env.config.adminId, role: "authorized_staff" as const, tenantId: env.config.tenantId });
const holdCommand = (env: LocalApartmentOwnerEnvironment, action: "apply_hold" | "remove_hold", idempotencyKey: string, reason = "risk inspection") =>
  createPlatformCommandEnvelope({
    commandName: "reserve.override_payout_hold", principal: staff(env), idempotencyKey,
    payload: { operatorId: env.config.operatorId, tenantId: env.config.tenantId, action, reason },
  });
const releaseCommand = (env: LocalApartmentOwnerEnvironment, trancheId: string, idempotencyKey: string) =>
  createPlatformCommandEnvelope({ commandName: "reserve.release_tranche", principal: staff(env), idempotencyKey, payload: { trancheId } });
const tranche = (env: LocalApartmentOwnerEnvironment): ReserveTranche => ({
  trancheId: "tr-1", reservationId: "reservation-1", operatorId: env.config.operatorId, tenantId: env.config.tenantId, amountKobo: 5000,
  checkoutDateIso: "2026-09-01T00:00:00.000Z", maturityDateIso: "2026-09-02T00:00:00.000Z", status: "held", policyVersion: "v1.0-launch",
});
const tier = (env: LocalApartmentOwnerEnvironment) => env.reservePayoutManager.evaluateOperatorTrustTier({ operatorId: env.config.operatorId, tenantId: env.config.tenantId });

test("06e AC1: Comments audit lists every piece of instance state and persists it or explains re-derivation", () => {
  const issue = readFileSync(".scratch/cloudflare-deployment/issues/06e-durable-reserve-payout-state.md", "utf8");
  for (const field of ["#tranches", "#adminHolds", "#executedCommands", "#reliabilityAuthority", "#enforcementAuthority", "#scopeAuthority", "#accountingRepository", "#clock", "#store"])
    assert.ok(issue.includes(field), `${field} is missing from the 06e audit`);
});

test("06e AC2: An admin payout hold applied before a restart is still in force after it", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = () => f.server.environment;
    const hold = env().reservePayoutManager.processAdminPayoutOverride(holdCommand(env(), "apply_hold", "hold-1"));
    const before = tier(env());
    assert.equal(before.overriddenByEnforcement, true);
    assert.match(before.reasons.join(), /Active admin hold: risk inspection/);

    await f.restart();

    assert.deepEqual(tier(env()), before, "the hold still forces the tier to standard");
    assert.equal(tier(env()).tier, "standard");
    // A human can still lift the stored hold.
    env().reservePayoutManager.processAdminPayoutOverride(holdCommand(env(), "remove_hold", "hold-2", "cleared"));
    assert.equal(tier(env()).overriddenByEnforcement, false, "removing the hold after the restart lifts it");
    assert.equal(hold.holdActive, true);
  } finally { await f.close(); }
});

test("06e AC3: A command replayed after a restart returns the original result without running again", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = () => f.server.environment;
    const command = holdCommand(env(), "apply_hold", "hold-1");
    const original = env().reservePayoutManager.processAdminPayoutOverride(command);

    await f.restart();
    f.advance(60 * 60 * 1000);

    assert.deepEqual(env().reservePayoutManager.processAdminPayoutOverride(command), original, "same result, same appliedAtIso: nothing re-ran");
    // Failure path: the key is still bound to the first command.
    assert.throws(() => env().reservePayoutManager.processAdminPayoutOverride(holdCommand(env(), "apply_hold", "hold-1", "a different reason")), /Idempotency key was reused for a different command/);
  } finally { await f.close(); }
});

test("06e AC4: Reserve tranches survive a restart and a release cannot be repeated after one", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = () => f.server.environment;
    setupRevenueRelease({ accounting: env().accountingRepository }).app.releaseRevenue("reservation-1", revenuePrincipal);
    env().reservePayoutManager.registerReserveTranche(tranche(env()));

    await f.restart();
    assert.equal(env().reservePayoutManager.getReserveTranche("tr-1")?.status, "held");
    const released = env().reservePayoutManager.processReleaseReserveTrancheCommand(releaseCommand(env(), "tr-1", "release-1"));
    assert.equal(released.status, "released");
    const journals = () => env().accountingRepository.findLedgerEntriesForRelease("revenue-release:reservation-1").length;
    const journalsBefore = journals();

    await f.restart();

    assert.deepEqual(env().reservePayoutManager.getReserveTranche("tr-1"), released);
    assert.deepEqual(env().reservePayoutManager.processReleaseReserveTrancheCommand(releaseCommand(env(), "tr-1", "release-1")), released, "a retry returns the stored result");
    assert.throws(() => env().reservePayoutManager.processReleaseReserveTrancheCommand(releaseCommand(env(), "tr-1", "release-2")), /Duplicate release attempted/);
    assert.equal(journals(), journalsBefore, "no second ledger movement");
  } finally { await f.close(); }
});

test("06e AC4: A tranche that fails to save leaves no ledger adjustment and no executed command", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    const accounting = new SqliteRevenueAccountingRepository(database);
    setupRevenueRelease({ accounting }).app.releaseRevenue("reservation-1", revenuePrincipal);
    const manager = new ReservePayoutManager({
      accountingRepository: accounting, store: new SqliteReservePayoutStateStore(database),
      scopeAuthority: { isOperatorInTenant: () => true }, clock: () => new Date("2026-09-03T00:00:00.000Z"),
    });
    const held: ReserveTranche = { trancheId: "tr-1", reservationId: "reservation-1", operatorId: "op", tenantId: "tenant", amountKobo: 5000, checkoutDateIso: "2026-09-01T00:00:00.000Z", maturityDateIso: "2026-09-02T00:00:00.000Z", status: "held", policyVersion: "v1.0-launch" };
    manager.registerReserveTranche(held);
    database.exec("CREATE TRIGGER refuse_tranche_update BEFORE UPDATE ON reserve_payout_records WHEN NEW.collection = 'tranches' BEGIN SELECT RAISE(ABORT, 'refused'); END");
    const count = (table: string) => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;
    const adjustmentsBefore = count("revenue_adjustments");
    const command = createPlatformCommandEnvelope({ commandName: "reserve.release_tranche", principal: { id: "admin", role: "admin", tenantId: "tenant" }, idempotencyKey: "release-1", payload: { trancheId: "tr-1" } });

    assert.throws(() => manager.processReleaseReserveTrancheCommand(command), /refused/);

    assert.equal(count("revenue_adjustments"), adjustmentsBefore, "the ledger adjustment rolled back with the tranche");
    assert.deepEqual(manager.getReserveTranche("tr-1"), held, "still held");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM reserve_payout_records WHERE collection = 'executed_commands'").get()?.n, 0);
    database.exec("DROP TRIGGER refuse_tranche_update");
    assert.equal(manager.processReleaseReserveTrancheCommand(command).status, "released", "the same command succeeds once saving works");
  } finally { database.close(); }
});

test("06e AC5: Stored reserve-payout records carry no credential or contact material (ADR 0075)", async () => {
  const f = await operatorRestartFixture();
  try {
    const env = f.server.environment;
    env.reservePayoutManager.processAdminPayoutOverride(holdCommand(env, "apply_hold", "hold-1"));
    env.reservePayoutManager.registerReserveTranche(tranche(env));
    const database = openNodeSqliteDatabase(f.databasePath);
    try {
      const stored = database.prepare("SELECT group_concat(record_json) AS json FROM reserve_payout_records").get()?.json;
      assert.equal(typeof stored, "string");
      assert.doesNotMatch(String(stored), /token|secret|password|cookie|\+234|@/i);
    } finally { database.close(); }
  } finally { await f.close(); }
});
