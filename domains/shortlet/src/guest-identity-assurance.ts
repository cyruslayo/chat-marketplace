import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import type { SqliteGuestAccountLinks } from "./guest-account-links.js";
import type { GuestIdentityVerificationResult, GuestIdentityVerificationResultSource } from "./guest-verification.js";

/**
 * Identity Assurance anchored to the Guest Account (ADR 0094, issue 09). One current result per `(tenantId, accountGuestId)`.
 * The record holds exactly the ADR 0094 fields. No identity evidence, provider payload, score or default expiry is stored.
 */

/** ADR 0094: the account's assurance levels. An absent account is anonymous and is not a stored level. */
export const IDENTITY_ASSURANCE_LEVELS = ["email-verified", "phone-verified", "government-ID-verified"] as const;
export type IdentityAssuranceLevel = (typeof IDENTITY_ASSURANCE_LEVELS)[number];

/**
 * ADR 0084's platform states that may be recorded. `not_started` is the absence of a record, so it is never stored. `expired`
 * is also reached lazily when a verified result passes its explicit `expiresAt` (see `currentAssurance`).
 */
export const IDENTITY_ASSURANCE_STATUSES = ["pending", "verified", "failed", "expired", "provider_unavailable"] as const;
export type IdentityAssuranceStatus = (typeof IDENTITY_ASSURANCE_STATUSES)[number];

export interface IdentityAssuranceOutcome {
  readonly tenantId: string;
  readonly accountGuestId: string;
  readonly level: IdentityAssuranceLevel;
  /** Platform-owned identifier for the evidence method. It is not raw evidence. */
  readonly method: string;
  readonly status: IdentityAssuranceStatus;
  /** Required, and must be a valid timestamp, when the status is `verified`. */
  readonly verifiedAt?: string | null;
  /** Required when the status is `verified`. The authoritative expiry; no default freshness period exists (ADR 0094). */
  readonly expiresAt?: string | null;
  /** Opaque provider or result reference. Absent for non-provider methods. */
  readonly providerReference?: string | null;
}

/** The current result as read at a clock instant. `status` is `expired` once a verified result reaches its `expiresAt`. */
export interface CurrentIdentityAssurance {
  readonly tenantId: string;
  readonly accountGuestId: string;
  readonly level: IdentityAssuranceLevel;
  readonly method: string;
  readonly status: IdentityAssuranceStatus;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
  readonly providerReference: string | null;
}

/**
 * Table DDL (ADR 0094). Applied by the schema migrations (apps/cloudflare/src/schema.ts, migration 4) and by this store's
 * constructor. The trigger removes the current result when the account's email changes, so re-verification is required for
 * any change path, including the authority's `changeEmail`. A sign-in on another device does not touch this table.
 */
export const GUEST_IDENTITY_ASSURANCE_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_identity_assurance (
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('email-verified', 'phone-verified', 'government-ID-verified')),
        method TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed', 'expired', 'provider_unavailable')),
        verified_at TEXT,
        expires_at TEXT,
        provider_reference TEXT,
        PRIMARY KEY (tenant_id, account_guest_id),
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
      CREATE TRIGGER IF NOT EXISTS guest_identity_assurance_on_email_change
        AFTER UPDATE OF email_normalized ON guest_accounts
        WHEN NEW.email_normalized <> OLD.email_normalized
      BEGIN
        DELETE FROM guest_identity_assurance WHERE tenant_id = NEW.tenant_id AND account_guest_id = NEW.account_guest_id;
      END;
    `;

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value.trim();
}

/** A timestamp must parse. It is stored in its normalized ISO form, so every comparison reads the same instant. */
function timestampOrNull(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp`);
  return new Date(value).toISOString();
}

function isLevel(value: unknown): value is IdentityAssuranceLevel {
  return typeof value === "string" && (IDENTITY_ASSURANCE_LEVELS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is IdentityAssuranceStatus {
  return typeof value === "string" && (IDENTITY_ASSURANCE_STATUSES as readonly string[]).includes(value);
}

/** Validates an outcome and returns the only fields that are stored. Anything else on the input is ignored, never persisted. */
function normalizeOutcome(outcome: IdentityAssuranceOutcome) {
  const tenantId = requiredText(outcome?.tenantId, "Tenant ID");
  const accountGuestId = requiredText(outcome?.accountGuestId, "Account Guest Id");
  if (!isLevel(outcome.level)) throw new Error("Identity assurance level must be one of the ADR 0094 levels");
  if (!isStatus(outcome.status)) throw new Error("Identity assurance status must be one of the ADR 0084 recorded states");
  const method = requiredText(outcome.method, "Identity assurance method");
  const verifiedAt = timestampOrNull(outcome.verifiedAt, "verifiedAt");
  const expiresAt = timestampOrNull(outcome.expiresAt, "expiresAt");
  if (outcome.status === "verified") {
    if (verifiedAt === null) throw new Error("A verified outcome requires a verifiedAt timestamp");
    // No default freshness period: the expiry must be explicit and later than the verification (ADR 0094).
    if (expiresAt === null) throw new Error("A verified outcome requires an explicit expiresAt timestamp; no default expiry applies");
  }
  if (verifiedAt !== null && expiresAt !== null && Date.parse(expiresAt) <= Date.parse(verifiedAt)) {
    throw new Error("expiresAt must be later than verifiedAt");
  }
  const providerReference = outcome.providerReference === undefined || outcome.providerReference === null
    ? null
    : requiredText(outcome.providerReference, "Provider reference");
  return { tenantId, accountGuestId, level: outcome.level, method, status: outcome.status, verifiedAt, expiresAt, providerReference };
}

/** Projects a stored row. A malformed row throws rather than being read as current assurance (fail closed). */
function projectRow(row: SqlRow): CurrentIdentityAssurance {
  if (typeof row.tenant_id !== "string" || typeof row.account_guest_id !== "string" || !isLevel(row.level) || !isStatus(row.status) || typeof row.method !== "string") {
    throw new Error("Stored identity assurance is malformed");
  }
  const verifiedAt = typeof row.verified_at === "string" ? timestampOrNull(row.verified_at, "verifiedAt") : null;
  const expiresAt = typeof row.expires_at === "string" ? timestampOrNull(row.expires_at, "expiresAt") : null;
  if (row.status === "verified" && (verifiedAt === null || expiresAt === null)) throw new Error("Stored identity assurance is malformed");
  return {
    tenantId: row.tenant_id,
    accountGuestId: row.account_guest_id,
    level: row.level,
    method: row.method,
    status: row.status,
    verifiedAt,
    expiresAt,
    providerReference: typeof row.provider_reference === "string" ? row.provider_reference : null,
  };
}

/** Whether a current result is government-ID verified now. Email-only, pending, failed, expired and absent results are not. */
export function isCurrentGovernmentIdAssurance(current: CurrentIdentityAssurance | null): boolean {
  return current !== null && current.status === "verified" && current.level === "government-ID-verified";
}

/**
 * The identity-assurance store and service (ADR 0094). The store is account-scoped: a result belongs to one tenant and one
 * Guest Account, never to a principal, session, thread, request or payment.
 */
export class SqliteGuestIdentityAssurance {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
    this.#database.exec(GUEST_IDENTITY_ASSURANCE_SCHEMA);
  }

  /**
   * Records the authoritative outcome for an account, replacing the previous result for that account. The account must be an
   * active Guest Account of the same tenant. Invalid input is refused before anything is written.
   */
  recordOutcome(outcome: IdentityAssuranceOutcome): void {
    const record = normalizeOutcome(outcome);
    const account = this.#database
      .prepare("SELECT account_guest_id FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'")
      .get([record.accountGuestId, record.tenantId]);
    if (account === undefined) throw new Error("Identity assurance requires an active Guest Account of this tenant");
    this.#database
      .prepare(`INSERT INTO guest_identity_assurance (tenant_id, account_guest_id, level, method, status, verified_at, expires_at, provider_reference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, account_guest_id) DO UPDATE SET
          level = excluded.level, method = excluded.method, status = excluded.status,
          verified_at = excluded.verified_at, expires_at = excluded.expires_at, provider_reference = excluded.provider_reference`)
      .run([record.tenantId, record.accountGuestId, record.level, record.method, record.status, record.verifiedAt, record.expiresAt, record.providerReference]);
  }

  /**
   * The current result for an account at `now`. Expiry is evaluated here, lazily, against the explicit `expiresAt`: a verified
   * result reads as `expired` once `now` is at or after it. Nothing is rewritten, and no background job is needed.
   */
  currentAssurance(accountGuestId: string, tenantId: string, now: Date): CurrentIdentityAssurance | null {
    const account = requiredText(accountGuestId, "Account Guest Id");
    const tenant = requiredText(tenantId, "Tenant ID");
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("A valid clock instant is required");
    const row = this.#database
      .prepare("SELECT * FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?")
      .get([tenant, account]);
    if (row === undefined) return null;
    const stored = projectRow(row);
    const expired = stored.status === "verified" && stored.expiresAt !== null && now.getTime() >= Date.parse(stored.expiresAt);
    return Object.freeze({ ...stored, status: expired ? "expired" : stored.status });
  }
}

/**
 * The account-backed `GuestIdentityVerificationResultSource` (the port in guest-verification.ts). A Primary Guest id is mapped
 * to its account through its Linked Principal, and the account's current result is returned. A Primary Guest with no account
 * returns null. A principal read under another tenant returns null.
 */
export class AccountBackedGuestIdentityVerificationResultSource implements GuestIdentityVerificationResultSource {
  readonly #links: Pick<SqliteGuestAccountLinks, "accountForPrincipal">;
  readonly #assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance">;
  readonly #clock: () => Date;

  constructor({
    links,
    assurance,
    clock,
  }: {
    links: Pick<SqliteGuestAccountLinks, "accountForPrincipal">;
    assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance">;
    clock: () => Date;
  }) {
    this.#links = links;
    this.#assurance = assurance;
    this.#clock = clock;
  }

  getVerificationResult({ tenantId, guestId }: { tenantId: string; guestId: string }): GuestIdentityVerificationResult | null {
    if (!tenantId || !guestId) return null;
    const link = this.#links.accountForPrincipal(guestId);
    if (link === null || link.tenantId !== tenantId) return null;
    const current = this.#assurance.currentAssurance(link.accountGuestId, tenantId, this.#clock());
    return { tenantId, guestId, governmentIdVerified: isCurrentGovernmentIdAssurance(current) };
  }
}
