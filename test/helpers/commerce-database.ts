import { createCommercePack } from "../../domains/commerce/src/index.js";
import { applySchemaMigrations, type SchemaMigration } from "../../packages/platform-core/src/schema-migrations.js";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";

/** Shared clock for commerce node tests. */
export const COMMERCE_TEST_CLOCK = (): Date => new Date("2026-10-16T00:00:00.000Z");

/**
 * The commerce migration ledger, read from the pack (the façade exports no migration list). Tests derive versions from
 * this list instead of hard-coding them, so a later migration does not break them (issue 24 review 10 and 3).
 */
export function commerceMigrations(database: SqlDatabase): readonly SchemaMigration[] {
  return createCommercePack({ database, clock: COMMERCE_TEST_CLOCK }).migrations;
}

/** Applies the commerce ledger, up to and including `upToVersion` (default: all). The ledger is the source of truth. */
export function migrateCommerceDatabase(database: SqlDatabase, upToVersion?: number): void {
  const all = commerceMigrations(database);
  const selected = upToVersion === undefined ? all : all.slice(0, upToVersion);
  applySchemaMigrations(database, selected, COMMERCE_TEST_CLOCK().toISOString());
}
