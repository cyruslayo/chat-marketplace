import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperatorEnforcementManager, SqliteOperatorEnforcementStateStore } from "../domains/shortlet/src/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

const clock = () => new Date("2026-09-10T10:00:00.000Z");
const staff = { id: "support-1", role: "authorized_staff", tenantId: "tenant-lagos" } as const;
const protect = (manager: OperatorEnforcementManager, unitId = "u") => manager.applyImmediateProtectiveAction(createPlatformCommandEnvelope({
  commandName: "operator_enforcement.protective_action", principal: staff, payload: { operatorId: "op", unitId, reason: "turnover risk" },
}));

async function withDatabase(run: (path: string) => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "enforcement-state-"));
  try { await run(join(directory, "pilot.sqlite")); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("06d AC1: Comments audit lists every piece of instance state and persists it or explains re-derivation", () => {
  const issue = readFileSync(".scratch/cloudflare-deployment/issues/06d-durable-enforcement-and-operator-restart.md", "utf8");
  for (const field of ["#incidents", "#protectiveActions", "#finalizedEnforcements", "#notices", "#appeals", "#restoredUnits", "#restorationDispositions", "#initialDecisionMakers", "#sequence", "#operatorAuthority", "#clock"])
    assert.ok(issue.includes(field), `${field} is missing from the 06d audit`);
});

test("06d AC1: a decision recorded through one connection is read through a new one, in insertion order", async () => {
  await withDatabase((path) => {
    const first = openNodeSqliteDatabase(path);
    const manager = new OperatorEnforcementManager({ clock, store: new SqliteOperatorEnforcementStateStore(first) });
    manager.recordIncident({ incidentId: "i1", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious", attribution: "operator_misconduct", reportedAtIso: "2026-09-01T10:00:00.000Z" });
    manager.recordIncident({ incidentId: "i2", operatorId: "op", unitId: "u", incidentType: "calendar_error", severity: "minor", attribution: "operator_misconduct", reportedAtIso: "2026-09-02T10:00:00.000Z" });
    const action = protect(manager);
    first.close();

    const second = openNodeSqliteDatabase(path);
    try {
      const store = new SqliteOperatorEnforcementStateStore(second);
      assert.deepEqual(store.incidents.values().map((incident) => incident.incidentId), ["i1", "i2"]);
      assert.deepEqual(store.protectiveActions.get(action.enforcementId), action);
      const reopened = new OperatorEnforcementManager({ clock, store });
      assert.equal(reopened.getProjections({ operatorId: "op", unitId: "u" }).protectiveActionActive, true);
      assert.equal(reopened.getProjections({ operatorId: "op", unitId: "u" }).unitStatus, "suspended", "a suspension is still in force after the restart");
      assert.notEqual(protect(reopened, "u2").enforcementId, action.enforcementId, "enforcement ids are never reused after a restart");
    } finally { second.close(); }
  });
});

test("06d AC1: a protective action that fails to save leaves no record, no consumed id and no lifted restoration", async () => {
  await withDatabase((path) => {
    const database = openNodeSqliteDatabase(path);
    try {
      const manager = new OperatorEnforcementManager({ clock, store: new SqliteOperatorEnforcementStateStore(database) });
      database.exec("CREATE TRIGGER refuse_protective_action BEFORE INSERT ON operator_enforcement_records WHEN NEW.collection = 'protective_actions' BEGIN SELECT RAISE(ABORT, 'refused'); END");
      assert.throws(() => protect(manager), /refused/);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM operator_enforcement_records").get()?.n, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM operator_enforcement_sequence").get()?.n, 0, "the id was not consumed");
      database.exec("DROP TRIGGER refuse_protective_action");
      assert.equal(protect(manager).enforcementId, "enf_1");
    } finally { database.close(); }
  });
});

test("06d AC1: stored enforcement records carry no credential or contact material (ADR 0075)", async () => {
  await withDatabase((path) => {
    const database = openNodeSqliteDatabase(path);
    try {
      const manager = new OperatorEnforcementManager({ clock, store: new SqliteOperatorEnforcementStateStore(database) });
      protect(manager);
      const stored = database.prepare("SELECT group_concat(record_json) AS json FROM operator_enforcement_records").get()?.json;
      assert.equal(typeof stored, "string");
      assert.doesNotMatch(String(stored), /token|secret|password|cookie|\+234|@/i);
    } finally { database.close(); }
  });
});
