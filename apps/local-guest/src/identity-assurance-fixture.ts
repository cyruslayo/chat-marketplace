import type { IdentityAssuranceOutcome, SqliteGuestIdentityAssurance } from "../../../domains/shortlet/src/guest-identity-assurance.js";

/**
 * LOCAL FAKE, for tests and the local walkthrough only (issue 09). It records a government-ID-verified outcome for an account as
 * a provider would, with no provider and no evidence. No production composition may import it, and the fixture method name is
 * not a provider method.
 */
export const LOCAL_FIXTURE_IDENTITY_METHOD = "local-fixture";

export function recordLocalVerifiedIdentity(
  assurance: Pick<SqliteGuestIdentityAssurance, "recordOutcome">,
  input: { readonly tenantId: string; readonly accountGuestId: string; readonly verifiedAt: string; readonly expiresAt: string },
): void {
  const outcome: IdentityAssuranceOutcome = {
    tenantId: input.tenantId,
    accountGuestId: input.accountGuestId,
    level: "government-ID-verified",
    method: LOCAL_FIXTURE_IDENTITY_METHOD,
    status: "verified",
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    providerReference: null,
  };
  assurance.recordOutcome(outcome);
}
