import type { SqlDatabase, SqlRow, SqlValue } from "../../../packages/platform-core/src/sql-database.js";
import type { SqliteGuestAccountLinks } from "../../../packages/platform-core/src/accounts/links.js";
import type { AccountAssuranceState, AccountAssuranceStateReader } from "../../../packages/platform-core/src/accounts/assurance-state.js";
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

/** ADR 0084 names this platform method for the selected Smile ID Biometric KYC flow (`method (nigeria_nin_v2_biometric_kyc)`). */
export const NIGERIA_NIN_V2_BIOMETRIC_KYC_METHOD = "nigeria_nin_v2_biometric_kyc";
/** Test-only fixture method. The store accepts it only when constructed with `allowFixtureMethods: true` (test helpers only). */
export const FIXTURE_IDENTITY_METHOD = "local-fixture";

/**
 * The provider reference screen (ADR 0084: an opaque provider/job/verification reference; ADR 0075: restricted identifiers are never
 * stored). PROVISIONAL CONSERVATIVE CONSTANTS, awaiting Smile onboarding: ADR 0084 defines no reference format. The length limit is a
 * storage bound, and the digit-run limit is a heuristic (NIN, BVN and phone numbers are 10 to 11 digits). Both are named defaults that
 * the store and the ops import take as options, so a change is a configuration decision, not an edit to the domain logic. Separators
 * (`-` and `_`) are stripped before the digit-run screen, so a restricted number cannot hide behind them. Known trade-off: a legitimate
 * reference with a run of the screened length after stripping is refused (fails closed) until the format is confirmed.
 */
export interface IdentityAssuranceReferencePolicy {
  /** The longest accepted provider reference, in characters. */
  readonly maxProviderReferenceLength: number;
  /** A run of this many digits (after separators are stripped) refuses the reference. */
  readonly restrictedDigitRunLength: number;
}
export const DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY: IdentityAssuranceReferencePolicy = Object.freeze({
  maxProviderReferenceLength: 64,
  restrictedDigitRunLength: 9,
});
const REFERENCE_SHAPE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SEPARATORS = /[-_]/g;

function resolveReferencePolicy(policy: Partial<IdentityAssuranceReferencePolicy> | undefined): IdentityAssuranceReferencePolicy {
  const resolved = {
    maxProviderReferenceLength: policy?.maxProviderReferenceLength ?? DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY.maxProviderReferenceLength,
    restrictedDigitRunLength: policy?.restrictedDigitRunLength ?? DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY.restrictedDigitRunLength,
  };
  for (const value of Object.values(resolved)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error("Identity assurance reference policy values must be positive integers");
  }
  return Object.freeze(resolved);
}

/** Whether a provider reference passes the shape, length and digit-run screen of a policy. */
function referenceAccepted(reference: string, policy: IdentityAssuranceReferencePolicy): boolean {
  if (reference.length > policy.maxProviderReferenceLength) return false;
  if (!REFERENCE_SHAPE.test(reference)) return false;
  return !new RegExp(`\\d{${policy.restrictedDigitRunLength},}`).test(reference.replace(SEPARATORS, ""));
}

export interface IdentityAssuranceOutcome {
  readonly tenantId: string;
  readonly accountGuestId: string;
  /** Platform-owned email version captured before recording; absent legacy imports remain unusable. */
  readonly accountEmailRevision?: number;
  readonly level: IdentityAssuranceLevel;
  /** A platform-owned method identifier (ADR 0094). It is not raw evidence, and only allowlisted methods are accepted. */
  readonly method: string;
  readonly status: IdentityAssuranceStatus;
  /** Required, and must be a valid timestamp no later than the clock, when the status is `verified`. */
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
  readonly accountEmailRevision: number | null;
  readonly level: IdentityAssuranceLevel;
  readonly method: string;
  readonly status: IdentityAssuranceStatus;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
  readonly providerReference: string | null;
}

/** Guard every assurance trust read against the current platform email version; transport/schema errors fail closed. */
export async function currentAssuranceForAccount(
  assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance">,
  accountState: AccountAssuranceStateReader,
  accountGuestId: string,
  tenantId: string,
  now: Date,
): Promise<CurrentIdentityAssurance | null> {
  try {
    const [current, state] = await Promise.all([
      Promise.resolve(assurance.currentAssurance(accountGuestId, tenantId, now)),
      accountState.readAccountAssuranceState({ tenantId, accountGuestId }),
    ]);
    if (!state || state.status !== "active" || !Number.isSafeInteger(state.emailRevision) || state.emailRevision < 0 ||
      current === null || current.accountEmailRevision === null || current.accountEmailRevision !== state.emailRevision) return null;
    return current;
  } catch {
    return null;
  }
}

/**
 * Table DDL (ADR 0094). Applied by the schema migrations (apps/cloudflare/src/schema.ts, migration 4) and by this store's
 * constructor. Account email changes invalidate this record through the typed PlatformDO → ShortletPilot seam (ADR 0101);
 * the independent databases cannot enforce that invariant with a trigger.
 */
export const GUEST_IDENTITY_ASSURANCE_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_identity_assurance (
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        account_email_revision INTEGER,
        level TEXT NOT NULL CHECK (level IN ('email-verified', 'phone-verified', 'government-ID-verified')),
        method TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed', 'expired', 'provider_unavailable')),
        verified_at TEXT,
        expires_at TEXT,
         provider_reference TEXT,
         PRIMARY KEY (tenant_id, account_guest_id)
       );
    `;

export interface SqliteGuestIdentityAssuranceOptions extends Partial<IdentityAssuranceReferencePolicy> {
  /** The authoritative clock. A verified outcome cannot be recorded with a `verifiedAt` later than it. No default is applied. */
  readonly clock: () => Date;
  /** Test helpers only: accepts the fixture method. Production composition never sets it. */
  readonly allowFixtureMethods?: boolean;
}

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

function acceptedMethods(allowFixtureMethods: boolean): readonly string[] {
  return allowFixtureMethods ? [NIGERIA_NIN_V2_BIOMETRIC_KYC_METHOD, FIXTURE_IDENTITY_METHOD] : [NIGERIA_NIN_V2_BIOMETRIC_KYC_METHOD];
}

/**
 * Validates an outcome and returns the only fields that are stored. Anything else on the input is ignored, never persisted.
 * The rules are the same for a recorded outcome and for an ops import row (see identityAssuranceRowForImport).
 */
function normalizeOutcome(outcome: IdentityAssuranceOutcome, now: Date, allowFixtureMethods: boolean, policy: IdentityAssuranceReferencePolicy) {
  // The clock is the authority for "not later than now". An invalid clock would make that comparison fail open, so it is refused.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("A valid clock instant is required");
  const tenantId = requiredText(outcome?.tenantId, "Tenant ID");
  const accountGuestId = requiredText(outcome?.accountGuestId, "Account Guest Id");
  const accountEmailRevision = outcome.accountEmailRevision;
  if (accountEmailRevision !== undefined && (!Number.isSafeInteger(accountEmailRevision) || accountEmailRevision < 0)) {
    throw new Error("accountEmailRevision must be a non-negative safe integer");
  }
  if (!isLevel(outcome.level)) throw new Error("Identity assurance level must be one of the ADR 0094 levels");
  if (!isStatus(outcome.status)) throw new Error("Identity assurance status must be one of the ADR 0084 recorded states");
  if (typeof outcome.method !== "string" || !acceptedMethods(allowFixtureMethods).includes(outcome.method)) {
    throw new Error("Identity assurance method must be a platform-owned identifier");
  }
  const verifiedAt = timestampOrNull(outcome.verifiedAt, "verifiedAt");
  const expiresAt = timestampOrNull(outcome.expiresAt, "expiresAt");
  if (verifiedAt !== null && Date.parse(verifiedAt) > now.getTime()) {
    throw new Error("verifiedAt cannot be later than the clock");
  }
  if (outcome.status === "verified") {
    if (verifiedAt === null) throw new Error("A verified outcome requires a verifiedAt timestamp");
    // No default freshness period: the expiry must be explicit and later than the verification (ADR 0094).
    if (expiresAt === null) throw new Error("A verified outcome requires an explicit expiresAt timestamp; no default expiry applies");
  }
  if (verifiedAt !== null && expiresAt !== null && Date.parse(expiresAt) <= Date.parse(verifiedAt)) {
    throw new Error("expiresAt must be later than verifiedAt");
  }
  let providerReference: string | null = null;
  if (outcome.providerReference !== undefined && outcome.providerReference !== null) {
    const reference = outcome.providerReference;
    if (typeof reference !== "string" || !referenceAccepted(reference, policy)) {
      throw new Error("providerReference must be an opaque platform reference, not a restricted identifier");
    }
    providerReference = reference;
  }
  return { tenantId, accountGuestId, accountEmailRevision: accountEmailRevision ?? null, level: outcome.level, method: outcome.method, status: outcome.status, verifiedAt, expiresAt, providerReference };
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
    accountEmailRevision: typeof row.account_email_revision === "number" && Number.isSafeInteger(row.account_email_revision) && row.account_email_revision >= 0 ? row.account_email_revision : null,
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
 * The validation an ops import applies to one `guest_identity_assurance` row (ops-import.ts). It is the recording rules plus
 * the active-account check, so an import cannot write a current `verified` row that a recorded outcome could not. It returns
 * the normalized row to insert. A failure throws a generic error that names no value.
 */
export function identityAssuranceRowForImport(
  database: SqlDatabase,
  row: Readonly<Record<string, SqlValue>>,
  now: Date,
  policy: Partial<IdentityAssuranceReferencePolicy> = DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY,
): Record<string, SqlValue> {
  const text = (value: SqlValue | undefined): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new Error("An identity assurance column has the wrong type");
    return value;
  };
  const revisionValue = row.account_email_revision;
  if (typeof revisionValue !== "number" || !Number.isSafeInteger(revisionValue) || revisionValue < 0) throw new Error("Legacy identity assurance has no trustworthy platform email version");
  const normalized = normalizeOutcome({
    tenantId: text(row.tenant_id) as string,
    accountGuestId: text(row.account_guest_id) as string,
    accountEmailRevision: revisionValue,
    level: text(row.level) as IdentityAssuranceLevel,
    method: text(row.method) as string,
    status: text(row.status) as IdentityAssuranceStatus,
    verifiedAt: text(row.verified_at) ?? null,
    expiresAt: text(row.expires_at) ?? null,
    providerReference: text(row.provider_reference) ?? null,
  }, now, false, resolveReferencePolicy(policy));
  // Restore: an exported row must import even when its account has since closed (the export is the record of what was true).
  // Any status is accepted here, but the account must exist in the same tenant. recordOutcome still requires an active account.
  return {
    tenant_id: normalized.tenantId,
    account_guest_id: normalized.accountGuestId,
    account_email_revision: normalized.accountEmailRevision,
    level: normalized.level,
    method: normalized.method,
    status: normalized.status,
    verified_at: normalized.verifiedAt,
    expires_at: normalized.expiresAt,
    provider_reference: normalized.providerReference,
  };
}

/**
 * The identity-assurance store and service (ADR 0094). The store is account-scoped: a result belongs to one tenant and one
 * Guest Account, never to a principal, session, thread, request or payment.
 */
export class SqliteGuestIdentityAssurance {
  readonly #database: SqlDatabase;
  readonly #clock: () => Date;
  readonly #allowFixtureMethods: boolean;
  readonly #policy: IdentityAssuranceReferencePolicy;

  constructor(database: SqlDatabase, options: SqliteGuestIdentityAssuranceOptions) {
    this.#database = database;
    this.#clock = options.clock;
    this.#allowFixtureMethods = options.allowFixtureMethods === true;
    this.#policy = resolveReferencePolicy(options);
    this.#database.exec(GUEST_IDENTITY_ASSURANCE_SCHEMA);
  }

  /**
   * Records the authoritative outcome for an account, replacing the previous result for that account. The account must be an
   * active Guest Account of the same tenant. Invalid input is refused before anything is written.
   */
  recordOutcome(outcome: IdentityAssuranceOutcome): void {
    const record = normalizeOutcome(outcome, this.#clock(), this.#allowFixtureMethods, this.#policy);
    let account: SqlRow | undefined;
    let accountTablePresent = true;
    try {
      account = this.#database
        .prepare("SELECT account_guest_id, email_revision FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'")
        .get([record.accountGuestId, record.tenantId]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("no such table: guest_accounts")) accountTablePresent = false;
      else throw error;
    }
    if (accountTablePresent && account === undefined) throw new Error("Identity assurance requires an active Guest Account of this tenant");
    const storedRevision = account?.email_revision;
    const accountEmailRevision = record.accountEmailRevision ?? (typeof storedRevision === "number" ? storedRevision : null);
    if (!accountTablePresent && accountEmailRevision === null) throw new Error("Identity assurance requires an active account email version");
    if (account !== undefined && accountEmailRevision !== storedRevision) throw new Error("Identity assurance account email version is stale");
    this.#database
      .prepare(`INSERT INTO guest_identity_assurance (tenant_id, account_guest_id, account_email_revision, level, method, status, verified_at, expires_at, provider_reference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, account_guest_id) DO UPDATE SET
          account_email_revision = excluded.account_email_revision, level = excluded.level, method = excluded.method, status = excluded.status,
          verified_at = excluded.verified_at, expires_at = excluded.expires_at, provider_reference = excluded.provider_reference`)
      .run([record.tenantId, record.accountGuestId, accountEmailRevision, record.level, record.method, record.status, record.verifiedAt, record.expiresAt, record.providerReference]);
  }

  /**
   * The current result for an active account at `now`. Expiry is evaluated here, lazily, against the explicit `expiresAt`: a
   * verified result reads as `expired` once `now` is at or after it. A closed or missing account has no current result.
   * Nothing is rewritten, and no background job is needed.
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

  /** Local composition adapter. Cloudflare's split composition injects the async PlatformDO reader instead. */
  async readAccountAssuranceState(input: { readonly tenantId: string; readonly accountGuestId: string }): Promise<AccountAssuranceState> {
    try {
      const row = this.#database.prepare("SELECT status, email_revision FROM guest_accounts WHERE tenant_id = ? AND account_guest_id = ?")
        .get([input.tenantId, input.accountGuestId]);
      if (!row) return { status: "missing" };
      if (row.status === "closed") return { status: "closed" };
      if (row.status !== "active" || !Number.isSafeInteger(row.email_revision) || Number(row.email_revision) < 0) return { status: "missing" };
      return { status: "active", emailRevision: Number(row.email_revision) };
    } catch {
      return { status: "missing" };
    }
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
  readonly #accountState: AccountAssuranceStateReader;

  constructor({
    links,
    assurance,
    accountState,
    clock,
  }: {
    links: Pick<SqliteGuestAccountLinks, "accountForPrincipal">;
    assurance: Pick<SqliteGuestIdentityAssurance, "currentAssurance" | "readAccountAssuranceState">;
    accountState?: AccountAssuranceStateReader;
    clock: () => Date;
  }) {
    this.#links = links;
    this.#assurance = assurance;
    this.#accountState = accountState ?? assurance;
    this.#clock = clock;
  }

  async getVerificationResult({ tenantId, guestId }: { tenantId: string; guestId: string }): Promise<GuestIdentityVerificationResult | null> {
    if (!tenantId || !guestId) return null;
    const link = this.#links.accountForPrincipal(guestId);
    if (link === null || link.tenantId !== tenantId) return null;
    const current = await currentAssuranceForAccount(this.#assurance, this.#accountState, link.accountGuestId, tenantId, this.#clock());
    return { tenantId, guestId, governmentIdVerified: isCurrentGovernmentIdAssurance(current) };
  }
}
