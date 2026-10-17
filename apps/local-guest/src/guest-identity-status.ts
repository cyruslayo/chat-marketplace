import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { SqliteGuestIdentityAssurance, currentAssuranceForAccount, isCurrentGovernmentIdAssurance } from "../../../domains/shortlet/src/guest-identity-assurance.js";
import type { AccountAssuranceStateReader } from "../../../packages/platform-core/src/accounts/assurance-state.js";

/**
 * The read-only identity-status reader for the account (issue 07, ADR 0094). It is the only module outside the schema manifest
 * and the ops import validator that imports the assurance store, and the account runtime is its only importer (AC5 guard in
 * test/guest-identity-assurance.test.ts). It reads the current result and never records one. It is an account display input
 * only: it is not a booking gate and not a physical-access authority (ADR 0085).
 */
export interface GuestAccountAssuranceReader {
  /** True only for a current, verified government-ID result of the account, evaluated lazily at the clock's instant. */
  hasCurrentGovernmentId(accountGuestId: string, tenantId: string): boolean;
  hasCurrentGovernmentIdWithCurrentEmail(accountGuestId: string, tenantId: string): Promise<boolean>;
}

export interface GuestAccountAssuranceInvalidator {
  invalidateGuestIdentityAssurance(input: { readonly tenantId: string; readonly accountGuestId: string }): Promise<void>;
}

export function accountAssuranceReader(database: SqlDatabase, clock: () => Date, accountState?: AccountAssuranceStateReader): GuestAccountAssuranceReader {
  const store = new SqliteGuestIdentityAssurance(database, { clock });
  return {
    hasCurrentGovernmentId(accountGuestId, tenantId) {
      // GuestIdentity resolution is synchronous and cannot call the authoritative PlatformDO RPC. It therefore never projects
      // stale local assurance as current; the account-status and check-in trust consumers use the guarded async method below.
      void accountGuestId;
      void tenantId;
      return false;
    },
    async hasCurrentGovernmentIdWithCurrentEmail(accountGuestId, tenantId) {
      const stateReader = accountState ?? store;
      return isCurrentGovernmentIdAssurance(await currentAssuranceForAccount(store, stateReader, accountGuestId, tenantId, clock()));
    },
  };
}

export function accountAssuranceInvalidator(database: SqlDatabase): GuestAccountAssuranceInvalidator {
  return {
    async invalidateGuestIdentityAssurance({ tenantId, accountGuestId }) {
      database.prepare("DELETE FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?").run([tenantId, accountGuestId]);
    },
  };
}
