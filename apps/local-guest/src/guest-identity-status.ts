import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { SqliteGuestIdentityAssurance, isCurrentGovernmentIdAssurance } from "../../../domains/shortlet/src/guest-identity-assurance.js";

/**
 * The read-only identity-status reader for the account (issue 07, ADR 0094). It is the only module outside the schema manifest
 * and the ops import validator that imports the assurance store, and the account runtime is its only importer (AC5 guard in
 * test/guest-identity-assurance.test.ts). It reads the current result and never records one. It is an account display input
 * only: it is not a booking gate and not a physical-access authority (ADR 0085).
 */
export interface GuestAccountAssuranceReader {
  /** True only for a current, verified government-ID result of the account, evaluated lazily at the clock's instant. */
  hasCurrentGovernmentId(accountGuestId: string, tenantId: string): boolean;
}

export function accountAssuranceReader(database: SqlDatabase, clock: () => Date): GuestAccountAssuranceReader {
  const store = new SqliteGuestIdentityAssurance(database, { clock });
  return {
    hasCurrentGovernmentId(accountGuestId, tenantId) {
      return isCurrentGovernmentIdAssurance(store.currentAssurance(accountGuestId, tenantId, clock()));
    },
  };
}
