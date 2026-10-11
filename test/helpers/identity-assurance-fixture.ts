import { FIXTURE_IDENTITY_METHOD, type IdentityAssuranceOutcome, type SqliteGuestIdentityAssurance } from "../../domains/shortlet/src/guest-identity-assurance.js";

/**
 * TEST-ONLY FAKE (issue 09, review fix). It records a government-ID-verified outcome for an account with no provider and no
 * evidence. It lives under test/ so no production module can import it (AC5 guard). The method identifier is a fixture id,
 * and the store accepts it only when it is constructed with `allowFixtureMethods: true`, which only test helpers do.
 */
export function recordLocalVerifiedIdentity(
  assurance: Pick<SqliteGuestIdentityAssurance, "recordOutcome">,
  input: { readonly tenantId: string; readonly accountGuestId: string; readonly verifiedAt: string; readonly expiresAt: string },
): void {
  const outcome: IdentityAssuranceOutcome = {
    tenantId: input.tenantId,
    accountGuestId: input.accountGuestId,
    level: "government-ID-verified",
    method: FIXTURE_IDENTITY_METHOD,
    status: "verified",
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    providerReference: null,
  };
  assurance.recordOutcome(outcome);
}
