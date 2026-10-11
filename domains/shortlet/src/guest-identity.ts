import type { GuestAuthenticatedAccount, SqliteGuestAccountAuthority } from "./guest-account-authority.js";
import type { SqliteGuestAccountLinks } from "./guest-account-links.js";
import type { GuestContact, GuestContactSource } from "./guest-contact.js";

/**
 * `email-verified` when a valid Guest Account Session is presented; `anonymous` otherwise. Later assurance levels come
 * from ADR 0094 and the identity-assurance port (issue 09).
 */
export type GuestAssurance = "anonymous" | "email-verified";

/**
 * What one browser session may read and act on (ADR 0093). `principalIds` is the session principal plus the Linked
 * Principals of its account; `claimedRequestIds` lists the Booking Requests the account holds by scoped claim. Absent
 * an account, the identity covers its own principal and nothing else.
 */
export interface GuestIdentity {
  readonly principalId: string;
  readonly tenantId: string;
  readonly accountGuestId?: string;
  readonly assurance: GuestAssurance;
  readonly principalIds: readonly string[];
  readonly claimedRequestIds: readonly string[];
}

export interface GuestAccountSessionCredentials {
  readonly sessionId: string;
  readonly sessionSecret: string;
}

export interface GuestIdentityResolutionInput {
  readonly principalId: string;
  readonly tenantId: string;
  /** The account cookie's credentials, when the browser presents one. Absent or invalid means no account. */
  readonly accountSession?: GuestAccountSessionCredentials | null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The identity of a browser with no account: its own principal and nothing more (ADR 0085: browsing never needs an account). */
export function anonymousGuestIdentity(principalId: string, tenantId: string): GuestIdentity {
  return Object.freeze({
    principalId,
    tenantId,
    assurance: "anonymous" as const,
    principalIds: Object.freeze([principalId]),
    claimedRequestIds: Object.freeze([]),
  });
}

/**
 * The one place a browser session becomes a Guest identity. Every Guest-scoped read goes through it. A missing principal
 * or tenant yields no identity at all. An account session that does not resolve, or whose principal is linked to a
 * different account, degrades to the anonymous identity rather than granting account history.
 */
export class GuestIdentityResolver {
  readonly #authority: Pick<SqliteGuestAccountAuthority, "resolveSession">;
  readonly #links: Pick<SqliteGuestAccountLinks, "accountForPrincipal" | "linkedPrincipals" | "claimedRequestIds">;

  constructor(
    authority: Pick<SqliteGuestAccountAuthority, "resolveSession">,
    links: Pick<SqliteGuestAccountLinks, "accountForPrincipal" | "linkedPrincipals" | "claimedRequestIds">,
  ) {
    this.#authority = authority;
    this.#links = links;
  }

  resolve(input: GuestIdentityResolutionInput): GuestIdentity | null {
    if (!nonEmpty(input.principalId) || !nonEmpty(input.tenantId)) return null;
    const principalId = input.principalId.trim();
    const tenantId = input.tenantId.trim();
    if (!input.accountSession) return anonymousGuestIdentity(principalId, tenantId);
    const account: GuestAuthenticatedAccount | null = this.#authority.resolveSession(input.accountSession.sessionId, input.accountSession.sessionSecret);
    if (!account || account.tenantId !== tenantId) return anonymousGuestIdentity(principalId, tenantId);
    // Fail closed (AGENTS anti-pattern 1): the presented principal must be linked to exactly this account. A principal with
    // no link row, or linked elsewhere, does not inherit the account's history.
    const ownLink = this.#links.accountForPrincipal(principalId);
    if (ownLink === null || ownLink.tenantId !== tenantId || ownLink.accountGuestId !== account.accountGuestId) {
      return anonymousGuestIdentity(principalId, tenantId);
    }
    const principalIds = [principalId, ...this.#links.linkedPrincipals(account.accountGuestId, tenantId).filter((id) => id !== principalId)];
    return Object.freeze({
      principalId,
      tenantId,
      accountGuestId: account.accountGuestId,
      assurance: "email-verified" as const,
      principalIds: Object.freeze(principalIds),
      claimedRequestIds: this.#links.claimedRequestIds(account.accountGuestId, tenantId),
    });
  }
}

/**
 * Whether an identity may act on a record owned by a principal in a tenant. Fails closed for a missing tenant or owner,
 * a tenant mismatch, and any principal outside the identity's own set (AGENTS anti-pattern 1).
 */
export function authorizesPrincipalOwner(
  identity: GuestIdentity | null | undefined,
  owner: { readonly principalId?: string | null; readonly tenantId?: string | null },
): boolean {
  if (!identity || !nonEmpty(owner.principalId) || !nonEmpty(owner.tenantId)) return false;
  if (owner.tenantId !== identity.tenantId) return false;
  return identity.principalIds.includes(owner.principalId);
}

/** Whether an identity may act on a Booking Request: its primary guest is in the identity, or the request is claimed by its account. */
export function authorizesBookingRequest(
  identity: GuestIdentity | null | undefined,
  request: { readonly requestId?: string | null; readonly primaryGuestId?: string | null; readonly tenantId?: string | null },
): boolean {
  if (!identity || !nonEmpty(request.requestId) || !nonEmpty(request.tenantId)) return false;
  if (request.tenantId !== identity.tenantId) return false;
  if (authorizesPrincipalOwner(identity, { principalId: request.primaryGuestId, tenantId: request.tenantId })) return true;
  return identity.accountGuestId !== undefined && identity.claimedRequestIds.includes(request.requestId);
}

/** The contact an account-authorized read uses: the account's contact first, then the session principal's (ADR 0093). */
export function resolveGuestContact(identity: GuestIdentity, contacts: GuestContactSource): GuestContact | null {
  if (identity.accountGuestId !== undefined) {
    const accountContact = contacts.find(identity.accountGuestId, identity.tenantId);
    if (accountContact !== null) return accountContact;
  }
  return contacts.find(identity.principalId, identity.tenantId);
}
