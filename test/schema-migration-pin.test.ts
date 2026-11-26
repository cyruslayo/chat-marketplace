import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations, schemaVersion } from "../packages/platform-core/src/schema-migrations.js";

// App-expansion issue 27: the runner records version numbers only, never names (schema-migrations.ts). A branch that reuses a
// number therefore skips its table on any object already at that number. This file pins the Shortlet list as append-only, and
// proves the upgrade paths that the main sync created: main shipped partners as 6, so cancellation cases are 7.

/** Every Shortlet migration that has shipped or been merged, in order. Append new entries; never renumber or rename one. */
const PINNED: ReadonlyArray<readonly [version: number, name: string]> = [
  [1, "baseline: the tables the stores create"],
  [2, "one-way cutover flag"],
  [3, "shortlet booking request contact snapshots"],
  [4, "guest accounts: identity assurance anchored to the account"],
  [5, "owner ledger entries bound to a Billing Period"],
  [6, "founding partner applications"],
  [7, "durable cancellation cases"],
];

function tableExists(database: NodeSqliteDatabase, table: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $name").get({ $name: table }) !== undefined;
}

function withDatabase(run: (database: NodeSqliteDatabase) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "schema-pin-"));
  const database = new NodeSqliteDatabase(join(dir, "object.sqlite"));
  try {
    run(database);
  } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Issue 27 AC3: The Shortlet migration list keeps every pinned [version, name] pair, in order", () => {
  const actual = SHORTLET_SCHEMA_MIGRATIONS.map((migration) => [migration.version, migration.name] as const);
  // The pinned prefix must be unchanged; later entries may only be appended after it.
  assert.deepEqual(actual.slice(0, PINNED.length), PINNED, "an existing migration was renumbered, renamed or removed");
  assert.ok(actual.length >= PINNED.length, "a pinned migration was removed");
});

test("Issue 27 AC1: Partners stays version 6, cancellation cases is version 7, and the schema version is 7", () => {
  assert.equal(SHORTLET_SCHEMA_MIGRATIONS.find((m) => m.name === "founding partner applications")?.version, 6);
  assert.equal(SHORTLET_SCHEMA_MIGRATIONS.find((m) => m.name === "durable cancellation cases")?.version, 7);
  assert.equal(SHORTLET_SCHEMA_VERSION, 7);
});

test("Issue 27 AC2: A database at main's version 6 applies only version 7 and gains cancellation_cases", () => {
  withDatabase((database) => {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 6), "2026-11-26T10:00:00.000Z");
    assert.equal(schemaVersion(database), 6);
    assert.equal(tableExists(database, "partner_applications"), true);
    const result = applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-11-26T11:00:00.000Z");
    assert.deepEqual(result.applied, [7]);
    assert.equal(schemaVersion(database), 7);
    assert.equal(tableExists(database, "partner_applications"), true);
    assert.equal(tableExists(database, "cancellation_cases"), true);
  });
});

test("Issue 27 AC2: A fresh database and a database at version 5 both reach version 7 with both tables", () => {
  withDatabase((database) => {
    const result = applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-11-26T10:00:00.000Z");
    assert.deepEqual(result.applied, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(tableExists(database, "partner_applications"), true);
    assert.equal(tableExists(database, "cancellation_cases"), true);
  });
  withDatabase((database) => {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 5), "2026-11-26T10:00:00.000Z");
    const result = applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-11-26T11:00:00.000Z");
    assert.deepEqual(result.applied, [6, 7]);
    assert.equal(tableExists(database, "partner_applications"), true);
    assert.equal(tableExists(database, "cancellation_cases"), true);
  });
});
