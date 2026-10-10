import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/** ADR 0004: health is read from the one shared handle; a closed or broken handle is unhealthy. */
export function databaseHealthy(database: SqlDatabase): boolean {
  try {
    database.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}
