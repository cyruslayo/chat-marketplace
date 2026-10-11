import test from "node:test";
import assert from "node:assert/strict";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations, schemaVersion, type SchemaMigration } from "../packages/platform-core/src/schema-migrations.js";
import { applicationTableNames, cutoverCompletedAt } from "../packages/platform-core/src/data-migration.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import * as productionSchema from "../apps/cloudflare/src/schema.js";
import { ImportRefusedError, importBatch } from "../apps/cloudflare/src/ops-import.js";
import { LOCAL_BOOKING_SCHEMA } from "../apps/local-guest/src/fixture.js";

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

test("16 D3 gap: a schema_migrations table with rows 1 and 3 is refused, and is not read as version 3", () => {
  const database = memory();
  database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  database.exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'baseline', '${APPLIED_AT}'), (3, 'skipped', '${APPLIED_AT}')`);
  assert.throws(() => schemaVersion(database), /gap/i);
  database.close();
});

test("16 D1 cutover: a database whose migrations ran but whose migration_state table is missing is refused, not read as not cut over", () => {
  const database = memory();
  applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, APPLIED_AT);
  database.exec("DROP TABLE migration_state");
  assert.throws(() => cutoverCompletedAt(database), /cutover/i);
  database.close();
});

test("16 D1 cutover: a file that was never migrated still reads as not cut over", () => {
  const database = memory();
  assert.equal(cutoverCompletedAt(database), null);
  database.close();
});

test("16 D3 import: an import into an object whose cutover state is missing is refused with SCHEMA_NOT_READY and writes nothing", () => {
  const database = memory();
  applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, APPLIED_AT);
  database.exec("DROP TABLE migration_state");
  assert.throws(
    () => importBatch(database, "units", [], SHORTLET_SCHEMA_VERSION, new Date()),
    (error: unknown) => error instanceof ImportRefusedError && error.code === "SCHEMA_NOT_READY",
  );
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_state'").all();
  assert.deepEqual(tables, []);
  database.close();
});

/** Whitespace-insensitive, so a reformatted but identical DDL still matches. */
function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

test("16 D3 freeze: the production schema's local booking DDL is the local fixture's DDL, and a change to either fails here", () => {
  const frozen = (productionSchema as { LOCAL_BOOKING_DDL?: string }).LOCAL_BOOKING_DDL;
  assert.equal(typeof frozen, "string", "the production schema exports its frozen local booking DDL");
  assert.equal(normalizedSql(frozen ?? ""), normalizedSql(LOCAL_BOOKING_SCHEMA));
});

test("16 D3 freeze: migration 1 applies the frozen local booking DDL itself, so the production schema does not import the fixture", () => {
  const frozen = (productionSchema as { LOCAL_BOOKING_DDL?: string }).LOCAL_BOOKING_DDL;
  assert.ok(frozen !== undefined && SHORTLET_SCHEMA_MIGRATIONS[0]!.statements.includes(frozen));
});
