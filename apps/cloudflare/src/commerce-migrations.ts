import { CUTOVER_STATE_DDL } from "../../../packages/platform-core/src/data-migration.js";
import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";

/**
 * ADR 0101: CommerceMarket has its own migration ledger and owns every commerce transaction table. The domain pack's migrations
 * arrive from `createCommercePack(...).migrations` (ADR 0099: the domain façade exports only the pack), and the cutover flag is
 * appended after them, so its version follows the pack's migration count. This module is the commerce object's import surface:
 * it imports no shortlet schema, so the commerce object reaches no guest identity store (final review; guest-identity-assurance AC5).
 */
export function commerceMigrationsWithCutover(packMigrations: readonly SchemaMigration[]): readonly SchemaMigration[] {
  return [...packMigrations, { version: packMigrations.length + 1, name: "one-way commerce cutover flag", statements: [CUTOVER_STATE_DDL] }];
}
