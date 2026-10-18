import type { GuestAccount, GuestAccountActionVerification, GuestAccountSession, GuestAuthenticatedAccount, GuestSignInCode, SqliteGuestAccountAuthority } from "./authority.js";
import type { SignedInPrincipalResult } from "./links.js";

export const GUEST_CODE_HASHING_KEY_ENV = "SHORTLET_GUEST_CODE_HASHING_KEY";
export const GUEST_CODE_HASHING_KEY_MIN_LENGTH = 32;
export function usableCodeHashingKey(key: string | null | undefined): string | null {
  return typeof key === "string" && key.length >= GUEST_CODE_HASHING_KEY_MIN_LENGTH ? key : null;
}

export interface RemoteGuestAccounts {
  requestCode(input: Parameters<SqliteGuestAccountAuthority["requestCode"]>[0]): Promise<GuestSignInCode>;
  verifyCode(input: Parameters<SqliteGuestAccountAuthority["verifyCode"]>[0]): Promise<GuestAccountSession | GuestAccountActionVerification>;
  findAccount(accountGuestId: string, tenantId: string): Promise<GuestAccount | null>;
  resolveSession(sessionId: string, secret: string): Promise<GuestAuthenticatedAccount | null>;
  revokeSession(sessionId: string, tenantId: string): Promise<void>;
  revokeAllSessions(accountGuestId: string, tenantId: string): Promise<void>;
  markEmailChangeAssuranceCleanupComplete(input: Parameters<SqliteGuestAccountAuthority["markEmailChangeAssuranceCleanupComplete"]>[0]): Promise<void>;
  changeEmail(input: Parameters<SqliteGuestAccountAuthority["changeEmail"]>[0]): Promise<GuestAccount>;
  replayEmailChange(input: Parameters<SqliteGuestAccountAuthority["replayEmailChange"]>[0]): Promise<GuestAccount>;
  linkSignedInPrincipal(input: { principalId: string; tenantId: string; session: GuestAccountSession }): Promise<SignedInPrincipalResult>;
  linkSignedInPrincipalWithLookup(input: { principalId: string; tenantId: string; session: GuestAccountSession }): Promise<SignedInPrincipalResult>;
  accountForPrincipal(principalId: string): Promise<{ readonly tenantId: string; readonly accountGuestId: string } | null>;
  linkedPrincipals(accountGuestId: string, tenantId: string): Promise<readonly string[]>;
  claimedRequestIds(accountGuestId: string, tenantId: string): Promise<readonly string[]>;
}
