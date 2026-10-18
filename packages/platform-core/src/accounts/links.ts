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

/** Remote/domain-pack implementation; deliberately asynchronous so callers cannot hide network I/O in a SQLite transaction. */
export interface AsyncGuestRequestContactIndex {
  findBookingRequestIdsByContactEmail(contactEmail: string, tenantId: string): Promise<readonly BookingRequestContactMatch[]>;
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
  readonly asyncRequests?: AsyncGuestRequestContactIndex;
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
  readonly #asyncRequests: AsyncGuestRequestContactIndex;
  readonly #authority: Pick<SqliteGuestAccountAuthority, "resolveSession">;
  readonly #clock: () => Date;

  constructor(database: SqlDatabase, options: GuestAccountLinksOptions) {
    this.#database = database;
    this.#requests = options.requests;
    this.#asyncRequests = options.asyncRequests ?? { findBookingRequestIdsByContactEmail: async (email, tenant) => this.#requests.findBookingRequestIdsByContactEmail(email, tenant) };
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

  /**
   * Cross-DO sign-in linking (ADR 0101). Phase one snapshots the proven active account then awaits authoritative Shortlet
   * request contacts with no Platform SQLite transaction open. Phase two re-resolves the session and checks the account's
   * email/revision snapshot before atomically linking and claiming. Any lookup, validation, or stale-snapshot failure commits
   * neither link nor claim; callers remain responsible for revoking a newly-issued session on failure.
   */
  async linkSignedInPrincipalWithLookup(input: { principalId: string; tenantId: string; session: GuestAccountSession }): Promise<SignedInPrincipalResult> {
    const principalId = requiredText(input.principalId, "Principal ID");
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    const firstProof = input.session?.purpose === "sign_in"
      ? this.#authority.resolveSession(input.session.sessionId, input.session.sessionSecret)
      : null;
    if (!firstProof || firstProof.tenantId !== tenantId || firstProof.accountGuestId !== input.session.account.accountGuestId) {
      throw new GuestAccountAuthorityError("session_invalid", "The sign-in session is not valid for this tenant");
    }
    const firstAccount = this.#activeAccountSnapshot(firstProof.accountGuestId, tenantId);
    if (!firstAccount || firstAccount.email !== input.session.account.email || firstAccount.emailRevision !== input.session.account.emailRevision) {
      throw new GuestAccountAuthorityError("session_invalid", "The sign-in session is not valid for this tenant");
    }

    const rawMatches = await this.#asyncRequests.findBookingRequestIdsByContactEmail(firstAccount.email, tenantId);
    if (!Array.isArray(rawMatches)) throw new GuestAccountAuthorityError("invalid_input", "The request contact lookup returned invalid data");
    const matches = rawMatches.map((match) => {
      if (!match || typeof match !== "object" ||
        typeof match.requestId !== "string" || match.requestId.trim() === "" ||
        typeof match.primaryGuestId !== "string" || match.primaryGuestId.trim() === "" ||
        typeof match.tenantId !== "string" || match.tenantId !== tenantId) {
        throw new GuestAccountAuthorityError("invalid_input", "The request contact lookup returned invalid data");
      }
      return { requestId: match.requestId.trim(), primaryGuestId: match.primaryGuestId.trim(), tenantId };
    });
    const uniqueMatches = new Map<string, BookingRequestContactMatch>();
    for (const match of matches) {
      const previous = uniqueMatches.get(match.requestId);
      if (previous && previous.primaryGuestId !== match.primaryGuestId) {
        throw new GuestAccountAuthorityError("invalid_input", "The request contact lookup returned ambiguous data");
      }
      uniqueMatches.set(match.requestId, match);
    }

    return this.#database.transaction(() => {
      const proven = this.#authority.resolveSession(input.session.sessionId, input.session.sessionSecret);
      const current = this.#activeAccountSnapshot(firstProof.accountGuestId, tenantId);
      if (!proven || proven.tenantId !== tenantId || proven.accountGuestId !== firstProof.accountGuestId ||
        !current || current.email !== firstAccount.email || current.revision !== firstAccount.revision || current.emailRevision !== firstAccount.emailRevision) {
        throw new GuestAccountAuthorityError("session_invalid", "The sign-in session changed during account linking");
      }
      const link = this.#linkInTransaction(principalId, tenantId, firstProof.accountGuestId);
      this.#claimMatchesInTransaction(firstProof.accountGuestId, tenantId, [...uniqueMatches.values()]);
      return { link, claimedRequestIds: this.claimedRequestIds(firstProof.accountGuestId, tenantId) };
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

  #activeAccountSnapshot(accountGuestId: string, tenantId: string): { readonly email: string; readonly revision: number; readonly emailRevision: number } | null {
    const row = this.#database.prepare("SELECT email_normalized, revision, email_revision FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'").get([accountGuestId, tenantId]);
    return typeof row?.email_normalized === "string" && Number.isSafeInteger(row.revision) && Number.isSafeInteger(row.email_revision)
      ? { email: row.email_normalized, revision: Number(row.revision), emailRevision: Number(row.email_revision) }
      : null;
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
    this.#claimMatchesInTransaction(accountGuestId, tenantId, this.#requests.findBookingRequestIdsByContactEmail(email, tenantId));
  }

  #claimMatchesInTransaction(accountGuestId: string, tenantId: string, matches: readonly BookingRequestContactMatch[]): void {
    for (const match of matches) {
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
