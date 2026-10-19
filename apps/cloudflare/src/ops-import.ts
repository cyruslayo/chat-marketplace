import { identityAssuranceRowForImport } from "../../../domains/shortlet/src/guest-identity-assurance.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { ImportRefusedError, importBatch as importRowsInBatch, type ImportBatchResult } from "./ops-import-core.js";

// The generic batch import, export and cutover helpers live in ops-import-core.ts, which imports no assurance module. This file is
// the Shortlet object's import surface: it adds the identity assurance rule (ADR 0094, ADR 0084) and so reaches the store. The
// CommerceMarket object imports the core directly (final review; guest-identity-assurance AC5).
export * from "./ops-import-core.js";

const IDENTITY_ASSURANCE_TABLE = "guest_identity_assurance";

/** The Shortlet import: the generic batch import with the identity assurance rule applied to its table. */
export function importBatch(database: SqlDatabase, table: string, rows: readonly unknown[], requiredVersion: number, now: Date): ImportBatchResult {
  return importRowsInBatch(database, table, rows, requiredVersion, now, (rowTable, prepared) => {
    if (rowTable !== IDENTITY_ASSURANCE_TABLE) return prepared;
    // A pre-split row has no account_email_revision. Refuse it instead of inventing revision 0: the AC3 migration transform omits
    // those legacy assurance rows and requires the Guest to complete fresh verification.
    try {
      return prepared.map((row) => identityAssuranceRowForImport(database, row, now));
    } catch {
      throw new ImportRefusedError("IDENTITY_ASSURANCE_REFUSED", "An identity assurance row failed validation, so nothing from the batch was written");
    }
  });
}
