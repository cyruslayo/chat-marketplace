import test from "node:test";
import assert from "node:assert/strict";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations, schemaVersion, type SchemaMigration } from "../packages/platform-core/src/schema-migrations.js";
import { applicationTableNames } from "../packages/platform-core/src/data-migration.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";

/** Slice 16 / D3: versioned, ordered schema migrations shared by fresh and migrated installs. */

const APPLIED_AT = "2026-10-10T00:00:00.000Z";

function memory(): NodeSqliteDatabase {
  return new NodeSqliteDatabase(":memory:");
}

const SAMPLE: readonly SchemaMigration[] = [
  { version: 1, name: "baseline", statements: ["CREATE TABLE sample_one (id TEXT PRIMARY KEY)"] },
  { version: 2, name: "second", statements: ["CREATE TABLE sample_two (id TEXT PRIMARY KEY)"] },
];

test("16 D3: applying the migrations twice records each version once and changes nothing", () => {
  const database = memory();
  const first = applySchemaMigrations(database, SAMPLE, APPLIED_AT);
  assert.equal(first.version, 2);
  assert.deepEqual(first.applied, [1, 2]);
  const tablesAfterFirst = applicationTableNames(database);

  const second = applySchemaMigrations(database, SAMPLE, APPLIED_AT);
  assert.equal(second.version, 2);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(applicationTableNames(database), tablesAfterFirst);
  const rows = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(rows.map((row) => row.version), [1, 2]);
  database.close();
});

test("16 D3: a database that has applied a newer migration than this code knows is refused, not downgraded", () => {
  const database = memory();
  applySchemaMigrations(database, SAMPLE, APPLIED_AT);
  assert.throws(() => applySchemaMigrations(database, SAMPLE.slice(0, 1), APPLIED_AT), /newer/i);
  assert.equal(schemaVersion(database), 2);
  database.close();
});

test("16 D3: migrations must be numbered 1, 2, 3 in order, or nothing is applied", () => {
  const database = memory();
  const gapped: SchemaMigration[] = [
    { version: 1, name: "baseline", statements: ["CREATE TABLE gap_one (id TEXT PRIMARY KEY)"] },
    { version: 3, name: "skipped", statements: ["CREATE TABLE gap_three (id TEXT PRIMARY KEY)"] },
  ];
  assert.throws(() => applySchemaMigrations(database, gapped, APPLIED_AT), /in order/i);
  assert.deepEqual(applicationTableNames(database), []);
  database.close();
});

test("16 D3: a database with no schema_migrations table reports version 0", () => {
  const database = memory();
  assert.equal(schemaVersion(database), 0);
  database.close();
});

test("16 D3: the shortlet schema's latest version is the last migration in its ordered list", () => {
  assert.equal(SHORTLET_SCHEMA_VERSION, SHORTLET_SCHEMA_MIGRATIONS[SHORTLET_SCHEMA_MIGRATIONS.length - 1]!.version);
  assert.deepEqual(SHORTLET_SCHEMA_MIGRATIONS.map((migration) => migration.version), SHORTLET_SCHEMA_MIGRATIONS.map((_m, index) => index + 1));
});
