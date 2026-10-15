import type { SqlDatabase, SqlRow } from "../sql-database.js";
import { GuestAccountAuthorityError, type GuestAccountSession, type SqliteGuestAccountAuthority } from "./authority.js";

/**
 * Table DDL for Linked Principals and resource-scoped request claims (ADR 0093). Applied by the schema migrations
 * (apps/cloudflare/src/schema.ts) and by this store's constructor. A principal links to at most one account (its primary
 * key), and a Booking Request is claimed by at most one account. Neither table rewrites a committed booking row (ADR 0004).
 */
export const GUEST_ACCOUNT_LINK_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_account_principals (
        principal_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_guest_account_principals_account
        ON guest_account_principals (tenant_id, account_guest_id);
      CREATE TABLE IF NOT EXISTS guest_account_request_claims (
        request_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_guest_account_request_claims_account
        ON guest_account_request_claims (tenant_id, account_guest_id);
    `;

/** A Booking Request whose immutable contact snapshot equals the proven email (see the interaction store). */
export interface BookingRequestContactMatch {
  readonly requestId: string;
  readonly primaryGuestId: string;
  readonly tenantId: string;
}

/** The part of the interaction store that claims need. The mutable guest contact is never consulted (ADR 0093). */
export interface GuestRequestContactIndex {
  findBookingRequestIdsByContactEmail(contactEmail: string, tenantId: string): readonly BookingRequestContactMatch[];
}

export interface GuestPrincipalLink {
  readonly principalId: string;
  readonly tenantId: string;
  readonly accountGuestId: string;
  readonly linkedAt: string;
}

export interface SignedInPrincipalResult {
  readonly link: GuestPrincipalLink;
  /** Every Booking Request the account holds by claim after this sign-in, in request-id order. */
  readonly claimedRequestIds: readonly string[];
}

export interface GuestAccountLinksOptions {
  readonly requests: GuestRequestContactIndex;
  /** Verifies the sign-in session that proves a principal's account (ADR 0093). Only its resolveSession is used. */
  readonly authority: Pick<SqliteGuestAccountAuthority, "resolveSession">;
  readonly clock?: () => Date;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new GuestAccountAuthorityError("invalid_input", `${label} is required`);
  return value.trim();
}

function projectLink(row: SqlRow | undefined): GuestPrincipalLink | null {
  if (!row ||
    typeof row.principal_id !== "string" || row.principal_id === "" ||
    typeof row.tenant_id !== "string" || row.tenant_id === "" ||
    typeof row.account_guest_id !== "string" || row.account_guest_id === "" ||
    typeof row.linked_at !== "string") return null;
  return Object.freeze({ principalId: row.principal_id, tenantId: row.tenant_id, accountGuestId: row.account_guest_id, linkedAt: row.linked_at });
}

/**
 * Linked Principals and scoped request claims. Every write runs in one transaction, and a conflicting link fails closed
 * without moving existing ownership (ADR 0093, ADR 0094).
 */
export class SqliteGuestAccountLinks {
  readonly #database: SqlDatabase;
  readonly #requests: GuestRequestContactIndex;
  readonly #authority: Pick<SqliteGuestAccountAuthority, "resolveSession">;
  readonly #clock: () => Date;

  constructor(database: SqlDatabase, options: GuestAccountLinksOptions) {
    this.#database = database;
    this.#requests = options.requests;
    this.#authority = options.authority;
    this.#clock = options.clock ?? (() => new Date());
    this.#database.exec(GUEST_ACCOUNT_LINK_SCHEMA);
  }

  /**
   * Called by a successful sign-in (issue 06). The proof is the authority's sign-in session, verified against the store
   * here (ADR 0093): a plain email, a forged secret, a revoked or expired session, or one from another tenant fails
   * closed. The account and its email come from the verified session, never from the caller. Linking and claiming commit
   * together or not at all.
   */
  linkSignedInPrincipal(input: { principalId: string; tenantId: string; session: GuestAccountSession }): SignedInPrincipalResult {
    const principalId = requiredText(input.principalId, "Principal ID");
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    return this.#database.transaction(() => {
      const proven = input.session?.purpose === "sign_in"
        ? this.#authority.resolveSession(input.session.sessionId, input.session.sessionSecret)
        : null;
      if (!proven || proven.tenantId !== tenantId) throw new GuestAccountAuthorityError("session_invalid", "The sign-in session is not valid for this tenant");
      const accountGuestId = proven.accountGuestId;
      const account = this.#activeAccount(accountGuestId, tenantId);
      if (!account) throw new GuestAccountAuthorityError("session_invalid", "The sign-in session is not valid for this tenant");
      const link = this.#linkInTransaction(principalId, tenantId, accountGuestId);
      this.#claimInTransaction(accountGuestId, tenantId, account.email);
      return { link, claimedRequestIds: this.claimedRequestIds(accountGuestId, tenantId) };
    });
  }

  /** The principals linked to an account in one tenant, in the order they were linked. */
  linkedPrincipals(accountGuestId: string, tenantId: string): readonly string[] {
    const account = requiredText(accountGuestId, "Account Guest Id");
    const tenant = requiredText(tenantId, "Tenant ID");
    const rows = this.#database
      .prepare("SELECT principal_id FROM guest_account_principals WHERE tenant_id = ? AND account_guest_id = ? ORDER BY linked_at, principal_id")
      .all([tenant, account]);
    return Object.freeze(rows.map((row) => {
      if (typeof row.principal_id !== "string" || row.principal_id === "") throw new Error("Stored principal link is malformed");
      return row.principal_id;
    }));
  }

  /** The account a principal is linked to, or null. A missing or empty principal has no link. */
  accountForPrincipal(principalId: string): { readonly tenantId: string; readonly accountGuestId: string } | null {
    const link = this.#linkAnyStatus(principalId);
    // A closed account holds no current authority (issue 09): its principals resolve to no account.
    if (!link || this.#activeAccount(link.accountGuestId, link.tenantId) === null) return null;
    return { tenantId: link.tenantId, accountGuestId: link.accountGuestId };
  }

  /** The link row of a principal whatever the account's status. Claims use it so a closed owner is still an owner. */
  #linkAnyStatus(principalId: string): GuestPrincipalLink | null {
    if (typeof principalId !== "string" || principalId.trim() === "") return null;
    return projectLink(this.#database.prepare("SELECT * FROM guest_account_principals WHERE principal_id = ?").get([principalId.trim()])) ?? null;
  }

  /** The Booking Requests an account holds by scoped claim in one tenant. */
  claimedRequestIds(accountGuestId: string, tenantId: string): readonly string[] {
    const account = requiredText(accountGuestId, "Account Guest Id");
    const tenant = requiredText(tenantId, "Tenant ID");
    const rows = this.#database
      .prepare("SELECT request_id FROM guest_account_request_claims WHERE tenant_id = ? AND account_guest_id = ? ORDER BY request_id")
      .all([tenant, account]);
    return Object.freeze(rows.map((row) => {
      if (typeof row.request_id !== "string" || row.request_id === "") throw new Error("Stored request claim is malformed");
      return row.request_id;
    }));
  }

  #activeAccount(accountGuestId: string, tenantId: string): { readonly email: string } | null {
    const row = this.#database
      .prepare("SELECT email_normalized FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'")
      .get([accountGuestId, tenantId]);
    return typeof row?.email_normalized === "string" ? { email: row.email_normalized } : null;
  }

  #linkInTransaction(principalId: string, tenantId: string, accountGuestId: string): GuestPrincipalLink {
    const row = this.#database.prepare("SELECT * FROM guest_account_principals WHERE principal_id = ?").get([principalId]);
    if (row !== undefined) {
      const existing = projectLink(row);
      if (existing && existing.tenantId === tenantId && existing.accountGuestId === accountGuestId) return existing;
      // Fail closed: a principal already linked elsewhere, or a malformed link, is never moved or re-pointed.
      throw new GuestAccountAuthorityError("account_conflict", "This browser is already linked to a different Guest Account");
    }
    const linkedAt = this.#clock().toISOString();
    this.#database
      .prepare("INSERT INTO guest_account_principals (principal_id, tenant_id, account_guest_id, linked_at) VALUES (?, ?, ?, ?)")
      .run([principalId, tenantId, accountGuestId, linkedAt]);
    return Object.freeze({ principalId, tenantId, accountGuestId, linkedAt });
  }

  /**
   * Claims the Booking Requests whose immutable contact snapshot equals the proven email. A request already claimed by
   * another account is not moved, and neither is a request whose principal is linked to another account.
   */
  #claimInTransaction(accountGuestId: string, tenantId: string, email: string): void {
    for (const match of this.#requests.findBookingRequestIdsByContactEmail(email, tenantId)) {
      if (match.tenantId !== tenantId) continue;
      const claim = this.#database.prepare("SELECT account_guest_id FROM guest_account_request_claims WHERE request_id = ?").get([match.requestId]);
      if (claim !== undefined && claim.account_guest_id !== accountGuestId) continue;
      const owner = this.#linkAnyStatus(match.primaryGuestId);
      if (owner !== null && (owner.tenantId !== tenantId || owner.accountGuestId !== accountGuestId)) continue;
      if (claim === undefined) {
        this.#database
          .prepare("INSERT INTO guest_account_request_claims (request_id, tenant_id, account_guest_id, claimed_at) VALUES (?, ?, ?, ?)")
          .run([match.requestId, tenantId, accountGuestId, this.#clock().toISOString()]);
      }
    }
  }
}
