import type { SqlDatabase } from "./sql-database.js";
import { SCHEMA_MIGRATIONS_TABLE } from "./data-migration.js";

/**
 * Slice 16 / D3: versioned, ordered schema migrations. The Durable Object applies them on startup, and a Node file
 * that is an import target is migrated by the same function, so fresh and migrated installs share one path. Each
 * applied version is recorded in `schema_migrations`. Nothing here drops or rewrites a table, and a database that
 * is ahead of the code is refused rather than downgraded.
 */
export interface SchemaMigration {
  /** 1, 2, 3, ... with no gaps. The position in the list must equal this number. */
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export interface SchemaMigrationResult {
  /** The version the database is at after this call. */
  readonly version: number;
  /** The versions this call applied, in order. Empty when the database was already current. */
  readonly applied: readonly number[];
}

function tableExists(database: SqlDatabase, table: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $name").get({ $name: table }) !== undefined;
}

/** The highest applied version, or 0 when no migration has run (no `schema_migrations` table yet). */
export function schemaVersion(database: SqlDatabase): number {
  if (!tableExists(database, SCHEMA_MIGRATIONS_TABLE)) return 0;
  const row = database.prepare(`SELECT MAX(version) AS version FROM ${SCHEMA_MIGRATIONS_TABLE}`).get();
  return row === undefined || row.version === null ? 0 : Number(row.version);
}

function assertOrdered(migrations: readonly SchemaMigration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error("Schema migrations must be numbered 1, 2, 3 in order, with no gaps");
    if (migration.name.trim() === "") throw new Error("Every schema migration needs a name");
  });
}

/**
 * Applies every migration after the database's current version, each in its own transaction together with its
 * `schema_migrations` row. A failing statement rolls back that migration and stops the run. Calling it again on a
 * current database changes nothing.
 */
export function applySchemaMigrations(database: SqlDatabase, migrations: readonly SchemaMigration[], appliedAt: string): SchemaMigrationResult {
  assertOrdered(migrations);
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  );
  const current = schemaVersion(database);
  if (current > migrations.length) throw new Error("The database has a newer schema than this code knows, so it is not downgraded");

  const applied: number[] = [];
  for (const migration of migrations.slice(current)) {
    database.transaction(() => {
      for (const statement of migration.statements) database.exec(statement);
      database
        .prepare(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, applied_at) VALUES ($version, $name, $appliedAt)`)
        .run({ $version: migration.version, $name: migration.name, $appliedAt: appliedAt });
    });
    applied.push(migration.version);
  }
  return { version: migrations.length, applied };
}
