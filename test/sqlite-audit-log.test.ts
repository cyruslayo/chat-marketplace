import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteAuditLog } from "../packages/platform-core/src/sqlite-audit-log.js";
import { InMemoryAuditLog, type AuditLog } from "../packages/platform-core/src/index.js";

test("06a AC1: Audit entries written before a restart through a new environment are readable afterwards in order", () => {
  for (const Environment of [LocalGuestEnvironment, LocalApartmentOwnerEnvironment]) {
    const directory = mkdtempSync(join(tmpdir(), "audit-restart-"));
    const config = { databasePath: join(directory, "pilot.sqlite"), seedFixture: false };
    let env = new Environment(config);
    try {
      env.audit.record({ type: "audit.first", principalId: "synthetic-principal" });
      env.audit.record({ type: "audit.second" });
      const before = env.audit.entries();
      env.close();
      env = new Environment(config);
      assert.deepEqual(env.audit.entries().slice(0, before.length), before);
      assert.deepEqual(before.slice(-2).map((entry) => entry.type), ["audit.first", "audit.second"]);
      assert.ok(before.every((entry) => typeof entry.recordedAt === "string"));
    } finally {
      env.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("06a AC2: No bearer token cookie access code or phone number reaches the audit_log table", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const log = new SqliteAuditLog(db);
    const secrets = ["synthetic-token-xyz", "synthetic-cookie-xyz", "654321", "+2348012345678"];
    log.record({ type: "security.test", principalId: "principal-1", details: {
      bearerToken: secrets[0], cookie: secrets[1], access_code: secrets[2], phoneNumber: secrets[3],
      headers: { authorization: `Bearer ${secrets[0]}`, "Set-Cookie": secrets[1] },
      confirmationToken: secrets[0], paymentReference: secrets[0],
      text: `Bearer ${secrets[0]} phone ${secrets[3]}`,
    } });
    const raw = JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    for (const secret of secrets) assert.ok(!raw.includes(secret));
    assert.match(raw, /REDACTED/);
    assert.equal(log.entries()[0]?.principalId, "principal-1");
  } finally { db.close(); }
});

test("06a AC3: The audit log exposes no way to modify or delete an entry and no any remains in index.ts", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    for (const log of [new SqliteAuditLog(db), new InMemoryAuditLog()]) {
      const port: AuditLog = log;
      assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(log)).sort(), ["constructor", "entries", "record"]);
      port.record({ type: "append.only", details: { status: "original" } });
      const entries = port.entries();
      entries[0]!.type = "mutated";
      (entries[0]!.details as Record<string, unknown>).status = "mutated";
      assert.equal(port.entries()[0]?.type, "append.only");
      assert.deepEqual(port.entries()[0]?.details, { status: "original" });
    }
    assert.doesNotMatch(readFileSync("packages/platform-core/src/index.ts", "utf8"), /\bany\b/);
  } finally { db.close(); }
});

test("06a AC4: Recording an audit entry inside a domain transaction that rolls back leaves no entry", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const log = new SqliteAuditLog(db);
    db.exec("CREATE TABLE domain_state (id TEXT PRIMARY KEY)");
    assert.throws(() => db.transaction(() => {
      db.prepare("INSERT INTO domain_state VALUES (?)").run(["rolled-back"]);
      log.record({ type: "rolled.back" });
      throw new Error("domain failure");
    }), /domain failure/);
    assert.deepEqual(log.entries(), []);
    assert.deepEqual(db.prepare("SELECT * FROM domain_state").all(), []);
    db.transaction(() => {
      log.record({ type: "outer" });
      assert.throws(() => db.transaction(() => { log.record({ type: "inner" }); throw new Error("nested"); }), /nested/);
    });
    assert.deepEqual(log.entries().map((entry) => entry.type), ["outer"]);
  } finally { db.close(); }
});

test("06a AC5: Audit adapters share the typed record and entries contract for compiler and full-suite checks", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    for (const log of [new InMemoryAuditLog(), new SqliteAuditLog(db)]) {
      const port: AuditLog = log;
      const entry = { type: "contract", recordedAt: "2026-10-06T10:00:00.000Z", details: { status: "committed" } };
      port.record(entry);
      assert.deepEqual(port.entries(), [entry]);
    }
  } finally { db.close(); }
});
