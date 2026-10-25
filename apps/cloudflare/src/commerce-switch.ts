import { commerceEnabledFromEnv } from "../../local-guest/src/commerce-switch-local.js";
import { CUTOVER_STATE_TABLE, SCHEMA_MIGRATIONS_TABLE } from "../../../packages/platform-core/src/data-migration.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/**
 * The one commerce switch (ADR 0104 decision 5), read by the Worker and by the commerce object through the single parser in
 * apps/local-guest/src/commerce-switch-local.ts. Unset, empty or "false" is off; exactly "true" is on; any other value throws.
 */
export { commerceEnabledFromEnv, COMMERCE_ENABLED_VARIABLE } from "../../local-guest/src/commerce-switch-local.js";

/** Fixed code for an invalid COMMERCE_ENABLED value on the commerce object. The value is never returned or logged. */
export const COMMERCE_ENABLED_INVALID = "COMMERCE_ENABLED_INVALID";
/** Fixed code for any commerce request while commerce is switched off (ADR 0104 decision 5). */
export const COMMERCE_DISABLED = "COMMERCE_DISABLED";

/**
 * Whether commerce is on, for code that must not fail on a bad value. An invalid value reads as off here; the commerce object
 * itself refuses every request with COMMERCE_ENABLED_INVALID, so a cutover that asks it still fails closed.
 */
export function commerceSwitchIsOn(env: { readonly COMMERCE_ENABLED?: string }): boolean {
  try {
    return commerceEnabledFromEnv({ COMMERCE_ENABLED: env.COMMERCE_ENABLED });
  } catch {
    return false;
  }
}

/** Tables that are the migration ledger, not commerce rows. Every other user table in the commerce object is commerce data. */
const LEDGER_TABLES: ReadonlySet<string> = new Set([SCHEMA_MIGRATIONS_TABLE, CUTOVER_STATE_TABLE]);

/**
 * The commerce object's row count while it is switched off (ADR 0101 amendment, 25 Oct 2026). It counts every user table except
 * the migration ledger, so a table outside the export list (for example a tracking-attempt backup) can never be skipped silently.
 */
export function commerceRowCount(database: SqlDatabase): number {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()
    .map(row => String(row.name))
    .filter(name => !LEDGER_TABLES.has(name));
  // The names come from sqlite_master, never from input, so interpolating them into the count is safe.
  return tables.reduce((total, table) => total + Number(database.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get()?.total ?? 0), 0);
}

/** Whether a table exists in the commerce object (used by the switched-off export and alarm). */
export function commerceTableExists(database: SqlDatabase, table: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = $name").get({ $name: table }) !== undefined;
}
