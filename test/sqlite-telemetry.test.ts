import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteTelemetry } from "../packages/platform-core/src/sqlite-telemetry.js";
import { InMemoryTelemetry, type Telemetry, type TelemetryEvent, type TransitionTelemetryEvent } from "../packages/platform-core/src/index.js";

const transition: TransitionTelemetryEvent = {
  type: "test.transition", eventVersion: "1", timestamp: "2026-10-06T10:00:00Z",
  transitionKey: "tenant:aggregate:1:committed", tenantId: "synthetic-tenant", nextState: "committed",
};

test("06b AC1: Events survive a restart", () => {
  for (const Environment of [LocalGuestEnvironment, LocalApartmentOwnerEnvironment]) {
    const directory = mkdtempSync(join(tmpdir(), "telemetry-restart-"));
    const config = { databasePath: join(directory, "pilot.sqlite"), seedFixture: false };
    let env = new Environment(config);
    try {
      env.telemetry.track({ type: "telemetry.first" });
      env.telemetry.track({ type: "telemetry.second" });
      const before = env.telemetry.events();
      env.close();
      env = new Environment(config);
      assert.deepEqual(env.telemetry.events().slice(0, before.length), before);
      assert.deepEqual(before.slice(-2).map((event) => event.type), ["telemetry.first", "telemetry.second"]);
    } finally {
      env.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("06b AC2: A transition tracked before a restart is not recorded again after it", () => {
  const directory = mkdtempSync(join(tmpdir(), "telemetry-dedupe-"));
  const path = join(directory, "telemetry.sqlite");
  let db = openNodeSqliteDatabase(path);
  const sink: TelemetryEvent[] = [];
  try {
    new SqliteTelemetry(db, { sink: (event) => sink.push(event) }).trackTransition(transition);
    db.close();
    db = openNodeSqliteDatabase(path);
    const telemetry = new SqliteTelemetry(db, { sink: (event) => sink.push(event) });
    telemetry.trackTransition(transition);
    telemetry.trackTransition(transition);
    assert.equal(telemetry.events().length, 1);
    assert.equal(sink.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM telemetry_events").get()?.count, 1);
    telemetry.trackTransition({ ...transition, transitionKey: "tenant:aggregate:2:committed" });
    assert.equal(telemetry.events().length, 2);
    // Ordinary events must not accidentally dedupe on a payload's transitionKey.
    telemetry.track(transition);
    telemetry.track(transition);
    assert.equal(telemetry.events().length, 4);
    const before = telemetry.events();
    assert.throws(() => db.transaction(() => {
      telemetry.trackTransition({ ...transition, transitionKey: "rolled-back" });
      throw new Error("rollback");
    }), /rollback/);
    assert.deepEqual(telemetry.events(), before);
    telemetry.trackTransition({ ...transition, transitionKey: "rolled-back" });
    assert.equal(telemetry.events().length, 5);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("06b AC3: Neither the table nor the sink ever receives a raw token cookie or phone number", () => {
  const db = openNodeSqliteDatabase(":memory:");
  const sink: TelemetryEvent[] = [];
  try {
    const telemetry = new SqliteTelemetry(db, { sink: (event) => sink.push(event) });
    const secrets = ["synthetic-secret-xyz", "synthetic-cookie-xyz", "+2348012345678"];
    const sensitive = { token: secrets[0], Cookie: secrets[1], phone_number: secrets[2], authorization: `Bearer ${secrets[0]}` };
    telemetry.track({ type: "test.redaction", details: [sensitive] });
    telemetry.trackTransition({ ...transition, transitionKey: `Bearer ${secrets[0]}` });
    for (const output of [JSON.stringify(db.prepare("SELECT * FROM telemetry_events").all()), JSON.stringify(sink)]) {
      for (const secret of secrets) assert.ok(!output.includes(secret));
      assert.match(output, /REDACTED/);
    }
    assert.equal(sink.length, 2);
  } finally { db.close(); }
});

test("06b AC4: Telemetry adapters share the typed contract for compiler and full-suite checks", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    for (const port of [new InMemoryTelemetry(), new SqliteTelemetry(db)] satisfies Telemetry[]) {
      port.track({ type: "regular", recordedAt: "2026-10-06T10:00:00Z" });
      port.trackTransition(transition);
      port.trackTransition(transition);
      assert.equal(port.events().length, 2);
      const events = port.events();
      events.pop();
      assert.equal(port.events().length, 2);
    }
  } finally { db.close(); }
});
