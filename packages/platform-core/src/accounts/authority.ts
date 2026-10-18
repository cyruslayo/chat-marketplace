import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { SqlDatabase } from "../sql-database.js";
import { createPlatformCommandEnvelope, type PlatformCommandEnvelope } from "../envelope.js";
import { normalizeContactEmail } from "./contact.js";

export type GuestSignInCodePurpose = "sign_in" | "change_email" | "delete_account" | "export_data";
export type GuestAccountStatus = "active" | "closed";

export const GUEST_ACCOUNT_POLICY_DEFAULTS = Object.freeze({
  signInCodeDigits: 6,
  signInCodeLifetimeMs: 10 * 60 * 1000,
  signInCodeMaxAttempts: 5,
  codeRequestCooldownMs: 60 * 1000,
  codeRequestsPerEmailPerHour: 5,
  codeRequestsPerAddressPerHour: 20,
  codeChecksPerEmailPerHour: 25,
  codeChecksPerAddressPerHour: 100,
  rateLimitWindowMs: 60 * 60 * 1000,
  accountSessionLifetimeMs: 30 * 24 * 60 * 60 * 1000
});

export interface GuestAccountPolicyOptions {
  readonly signInCodeDigits?: number;
  readonly signInCodeLifetimeMs?: number;
  readonly signInCodeMaxAttempts?: number;
  readonly codeRequestCooldownMs?: number;
  readonly codeRequestsPerEmailPerHour?: number;
  readonly codeRequestsPerAddressPerHour?: number;
  readonly codeChecksPerEmailPerHour?: number;
  readonly codeChecksPerAddressPerHour?: number;
  readonly rateLimitWindowMs?: number;
  readonly accountSessionLifetimeMs?: number;
}

export interface GuestAccountAuditSink {
  record(entry: Record<string, string | number>): void;
}

export interface GuestAccountTelemetrySink {
  record(entry: Record<string, string | number>): void;
}

export interface GuestAccountAuthorityOptions {
  readonly codeHashingKey: string;
  readonly clock?: () => Date;
  readonly audit?: GuestAccountAuditSink;
  readonly telemetry?: GuestAccountTelemetrySink;
  readonly policy?: GuestAccountPolicyOptions;
}

export interface GuestAccount {
  readonly accountGuestId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly phoneNumber: string | null;
  readonly status: GuestAccountStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  /** Changes only when the normalized verified email changes. */
  readonly emailRevision: number;
}

export interface GuestSignInCode {
  readonly challengeId: string;
  /** Plaintext is returned only to the immediate delivery caller and must never be persisted or logged. */
  readonly code: string;
  readonly expiresAt: string;
}

export interface GuestAuthenticatedAccount {
  readonly tenantId: string;
  readonly accountGuestId: string;
  readonly sessionId: string;
}

export interface GuestAccountSession {
  readonly purpose: "sign_in";
  readonly account: GuestAccount;
  readonly sessionId: string;
  readonly sessionSecret: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface GuestAccountActionProof {
  readonly challengeId: string;
  readonly purpose: Exclude<GuestSignInCodePurpose, "sign_in">;
  readonly tenantId: string;
  readonly accountGuestId: string;
  readonly sessionId: string;
  readonly accountRevision: number;
  readonly accountEmailRevision: number;
  readonly expiresAt: string;
}

export interface GuestAccountActionVerification {
  readonly purpose: Exclude<GuestSignInCodePurpose, "sign_in">;
  readonly proof: GuestAccountActionProof;
  readonly verifiedAt: string;
}

export interface GuestAccountEmailChangeCommand {
  readonly email: string;
}

export type GuestCodeVerification = GuestAccountSession | GuestAccountActionVerification;

export type GuestAccountAuthorityErrorCode =
  | "invalid_input"
  | "code_invalid"
  | "code_expired"
  | "code_consumed"
  | "code_attempts_exhausted"
  | "rate_limited"
  | "session_invalid"
  | "account_conflict"
  | "action_proof_invalid";

export class GuestAccountAuthorityError extends Error {
  readonly code: GuestAccountAuthorityErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: GuestAccountAuthorityErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "GuestAccountAuthorityError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface AccountRow {
  account_guest_id: unknown;
  tenant_id: unknown;
  email_normalized: unknown;
  phone_number: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
  revision: unknown;
  email_revision: unknown;
}

interface SessionRow {
  session_id: unknown;
  session_secret_hash: unknown;
  tenant_id: unknown;
  account_guest_id: unknown;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown;
}

interface EmailChangeCommandRow extends AccountRow {
  fingerprint: unknown;
}

interface ChallengeRow {
  challenge_id: unknown;
  code_hash: unknown;
  tenant_id: unknown;
  email_normalized: unknown;
  purpose: unknown;
  account_guest_id: unknown;
  session_id: unknown;
  account_revision: unknown;
  account_email_revision: unknown;
  created_at: unknown;
  expires_at: unknown;
  attempts: unknown;
  consumed_at: unknown;
  invalidated_at: unknown;
  action_consumed_at: unknown;
}

interface VerifyGuestCodeInput {
  readonly challengeId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly code: string;
  readonly purpose: GuestSignInCodePurpose;
  readonly clientAddress: string;
  readonly accountGuestId?: string;
  readonly sessionId?: string;
  readonly sessionSecret?: string;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new GuestAccountAuthorityError("invalid_input", `${label} is required`);
  return value.trim();
}

function parsedTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function projectAccount(row: AccountRow | undefined): GuestAccount | null {
  if (!row ||
    typeof row.account_guest_id !== "string" || row.account_guest_id.trim() === "" ||
    typeof row.tenant_id !== "string" || row.tenant_id.trim() === "" ||
    typeof row.email_normalized !== "string" || row.email_normalized.trim() === "" ||
    !(row.phone_number === null || typeof row.phone_number === "string") ||
    (row.status !== "active" && row.status !== "closed") ||
    typeof row.created_at !== "string" || !parsedTimestamp(row.created_at) ||
     typeof row.updated_at !== "string" || !parsedTimestamp(row.updated_at) ||
     typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
     typeof row.email_revision !== "number" || !Number.isSafeInteger(row.email_revision) || row.email_revision < 0) return null;
  return Object.freeze({
    accountGuestId: row.account_guest_id,
    tenantId: row.tenant_id,
    email: row.email_normalized,
    phoneNumber: row.phone_number,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    revision: row.revision,
    emailRevision: row.email_revision
  });
}

function policyOptions(input: GuestAccountPolicyOptions | undefined): Readonly<Record<keyof typeof GUEST_ACCOUNT_POLICY_DEFAULTS, number>> {
  const values = { ...GUEST_ACCOUNT_POLICY_DEFAULTS, ...input };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value) || value < (name === "codeRequestCooldownMs" ? 0 : 1)) {
      throw new GuestAccountAuthorityError("invalid_input", `Invalid Guest Account policy: ${name}`);
    }
  }
  if (10 ** values.signInCodeDigits > 2 ** 48) throw new GuestAccountAuthorityError("invalid_input", "Sign-In Code digits exceed the cryptographic generator range");
  return Object.freeze(values);
}

function validPurpose(value: string): value is GuestSignInCodePurpose {
  return value === "sign_in" || value === "change_email" || value === "delete_account" || value === "export_data";
}

function verifyDigest(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function hashGuestAccountSessionSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const GUEST_ACCOUNT_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_accounts (
        account_guest_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        email_normalized TEXT NOT NULL,
        phone_number TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        email_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_accounts_active_email
        ON guest_accounts (tenant_id, email_normalized) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS guest_account_sessions (
        session_id TEXT PRIMARY KEY,
        session_secret_hash TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_guest_account_sessions_owner
        ON guest_account_sessions (tenant_id, account_guest_id, expires_at);
      CREATE TABLE IF NOT EXISTS guest_sign_in_codes (
        challenge_id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        email_normalized TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'change_email', 'delete_account', 'export_data')),
        account_guest_id TEXT,
        session_id TEXT,
        account_revision INTEGER,
        account_email_revision INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at TEXT,
        invalidated_at TEXT,
        action_consumed_at TEXT,
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_guest_codes_email_purpose
        ON guest_sign_in_codes (tenant_id, email_normalized, purpose, created_at);
      CREATE TABLE IF NOT EXISTS guest_account_rate_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        rate_scope_key TEXT NOT NULL,
        email_key TEXT NOT NULL,
        address_key TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK (event_kind IN ('request', 'check')),
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_account_rate_email
        ON guest_account_rate_events (rate_scope_key, email_key, event_kind, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_guest_account_rate_address
        ON guest_account_rate_events (rate_scope_key, address_key, event_kind, occurred_at);
      CREATE TABLE IF NOT EXISTS guest_account_email_commands (
        tenant_id TEXT NOT NULL,
        account_guest_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        email_normalized TEXT NOT NULL,
        email_revision INTEGER NOT NULL DEFAULT 0,
        phone_number TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, account_guest_id, idempotency_key_hash),
        FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
      );
    `;

export class SqliteGuestAccountAuthority {
  readonly #database: SqlDatabase;
  readonly #clock: () => Date;
  readonly #codeHashingKey: string;
  readonly #audit?: GuestAccountAuditSink;
  readonly #telemetry?: GuestAccountTelemetrySink;
  readonly #policy: Readonly<Record<keyof typeof GUEST_ACCOUNT_POLICY_DEFAULTS, number>>;

  /** The composition owns the shared handle and its busy timeout (ADR 0004, ADR 0095). */
  constructor(database: SqlDatabase, options: GuestAccountAuthorityOptions) {
    this.#codeHashingKey = requiredText(options.codeHashingKey, "Guest code hashing key");
    this.#database = database;
    this.#clock = options.clock ?? (() => new Date());
    this.#audit = options.audit;
    this.#telemetry = options.telemetry;
    this.#policy = policyOptions(options.policy);
    this.#database.exec(GUEST_ACCOUNT_SCHEMA);
    const commandColumns = this.#database.prepare("PRAGMA table_info(guest_account_email_commands)").all();
    if (!commandColumns.some((column) => column.name === "assurance_cleanup_completed")) {
      this.#database.exec("ALTER TABLE guest_account_email_commands ADD COLUMN assurance_cleanup_completed INTEGER NOT NULL DEFAULT 0 CHECK (assurance_cleanup_completed IN (0, 1))");
    }
    if (!commandColumns.some((column) => column.name === "email_revision")) {
      this.#database.exec("ALTER TABLE guest_account_email_commands ADD COLUMN email_revision INTEGER NOT NULL DEFAULT 0");
    }
  }

  #now(): Date {
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Server clock is invalid");
    return now;
  }

  #emit(type: string, fields: Record<string, string | number>): void {
    const entry = { type, ...fields };
    try { this.#audit?.record(entry); } catch { /* audit failure cannot block authentication */ }
    try { this.#telemetry?.record(entry); } catch { /* telemetry failure cannot block authentication */ }
  }

  #tx<T>(operation: () => T): T {
    return this.#database.transaction(operation);
  }

  #key(scope: string, value: string): string {
    return createHmac("sha256", this.#codeHashingKey).update(`${scope}\u0000${value}`, "utf8").digest("hex");
  }

  #codeDigest(input: { challengeId: string; tenantId: string; email: string; purpose: GuestSignInCodePurpose; code: string }): string {
    return createHmac("sha256", this.#codeHashingKey)
      .update(`${input.challengeId}\u0000${input.tenantId}\u0000${input.email}\u0000${input.purpose}\u0000${input.code}`, "utf8")
      .digest("hex");
  }

  #sessionRow(sessionId: string): SessionRow | undefined {
    return this.#database.prepare("SELECT * FROM guest_account_sessions WHERE session_id = ?").get([sessionId]) as unknown as SessionRow | undefined;
  }

  #sessionIsValid(input: { sessionId: string; sessionSecret: string; tenantId: string; accountGuestId: string; now: Date }): boolean {
    const row = this.#sessionRow(input.sessionId);
    const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([input.accountGuestId, input.tenantId]) as unknown as AccountRow | undefined);
    const expiresAt = parsedTimestamp(row?.expires_at);
    return Boolean(row &&
      typeof row.tenant_id === "string" && row.tenant_id === input.tenantId &&
      typeof row.account_guest_id === "string" && row.account_guest_id === input.accountGuestId &&
      typeof row.session_secret_hash === "string" && verifyDigest(hashGuestAccountSessionSecret(input.sessionSecret), row.session_secret_hash) &&
      row.revoked_at === null && expiresAt && input.now.getTime() < expiresAt.getTime() &&
      account?.status === "active");
  }

  #requestRateFailure(rateScopeKey: string, emailKey: string, addressKey: string, now: Date): number | null {
    const windowStart = new Date(now.getTime() - this.#policy.rateLimitWindowMs).toISOString();
    const emailEvents = this.#database.prepare("SELECT COUNT(*) AS count FROM guest_account_rate_events WHERE rate_scope_key = ? AND email_key = ? AND event_kind = 'request' AND occurred_at > ?").get([rateScopeKey, emailKey, windowStart]) as { count: number };
    const addressEvents = this.#database.prepare("SELECT COUNT(*) AS count FROM guest_account_rate_events WHERE rate_scope_key = ? AND address_key = ? AND event_kind = 'request' AND occurred_at > ?").get([rateScopeKey, addressKey, windowStart]) as { count: number };
    const last = this.#database.prepare("SELECT MAX(occurred_at) AS occurred_at FROM guest_account_rate_events WHERE rate_scope_key = ? AND email_key = ? AND event_kind = 'request'").get([rateScopeKey, emailKey]) as { occurred_at: string | null };
    let retryAfterMs = 0;
    if (emailEvents.count >= this.#policy.codeRequestsPerEmailPerHour) {
      const first = this.#database.prepare("SELECT occurred_at FROM guest_account_rate_events WHERE rate_scope_key = ? AND email_key = ? AND event_kind = 'request' AND occurred_at > ? ORDER BY occurred_at ASC LIMIT 1").get([rateScopeKey, emailKey, windowStart]) as { occurred_at: string } | undefined;
      if (first) retryAfterMs = Math.max(retryAfterMs, Date.parse(first.occurred_at) + this.#policy.rateLimitWindowMs - now.getTime());
    }
    if (addressEvents.count >= this.#policy.codeRequestsPerAddressPerHour) {
      const first = this.#database.prepare("SELECT occurred_at FROM guest_account_rate_events WHERE rate_scope_key = ? AND address_key = ? AND event_kind = 'request' AND occurred_at > ? ORDER BY occurred_at ASC LIMIT 1").get([rateScopeKey, addressKey, windowStart]) as { occurred_at: string } | undefined;
      if (first) retryAfterMs = Math.max(retryAfterMs, Date.parse(first.occurred_at) + this.#policy.rateLimitWindowMs - now.getTime());
    }
    if (last.occurred_at && this.#policy.codeRequestCooldownMs > 0) {
      retryAfterMs = Math.max(retryAfterMs, Date.parse(last.occurred_at) + this.#policy.codeRequestCooldownMs - now.getTime());
    }
    return retryAfterMs > 0 ? retryAfterMs : null;
  }

  #checkRateFailure(rateScopeKey: string, emailKey: string, addressKey: string, now: Date): number | null {
    const windowStart = new Date(now.getTime() - this.#policy.rateLimitWindowMs).toISOString();
    const emailEvents = this.#database.prepare("SELECT COUNT(*) AS count FROM guest_account_rate_events WHERE rate_scope_key = ? AND email_key = ? AND event_kind = 'check' AND occurred_at > ?").get([rateScopeKey, emailKey, windowStart]) as { count: number };
    const addressEvents = this.#database.prepare("SELECT COUNT(*) AS count FROM guest_account_rate_events WHERE rate_scope_key = ? AND address_key = ? AND event_kind = 'check' AND occurred_at > ?").get([rateScopeKey, addressKey, windowStart]) as { count: number };
    if (emailEvents.count >= this.#policy.codeChecksPerEmailPerHour || addressEvents.count >= this.#policy.codeChecksPerAddressPerHour) {
      const firstEmail = this.#database.prepare("SELECT occurred_at FROM guest_account_rate_events WHERE rate_scope_key = ? AND email_key = ? AND event_kind = 'check' AND occurred_at > ? ORDER BY occurred_at ASC LIMIT 1").get([rateScopeKey, emailKey, windowStart]) as { occurred_at: string } | undefined;
      const firstAddress = this.#database.prepare("SELECT occurred_at FROM guest_account_rate_events WHERE rate_scope_key = ? AND address_key = ? AND event_kind = 'check' AND occurred_at > ? ORDER BY occurred_at ASC LIMIT 1").get([rateScopeKey, addressKey, windowStart]) as { occurred_at: string } | undefined;
      const retryEmail = emailEvents.count >= this.#policy.codeChecksPerEmailPerHour && firstEmail ? Date.parse(firstEmail.occurred_at) + this.#policy.rateLimitWindowMs - now.getTime() : 0;
      const retryAddress = addressEvents.count >= this.#policy.codeChecksPerAddressPerHour && firstAddress ? Date.parse(firstAddress.occurred_at) + this.#policy.rateLimitWindowMs - now.getTime() : 0;
      return Math.max(1, Math.ceil(Math.max(retryEmail, retryAddress) / 1000));
    }
    return null;
  }

  #insertRateEvent(input: { rateScopeKey: string; emailKey: string; addressKey: string; kind: "request" | "check"; at: string }): void {
    this.#database.prepare("INSERT INTO guest_account_rate_events (rate_scope_key, email_key, address_key, event_kind, occurred_at) VALUES (?, ?, ?, ?, ?)")
      .run([input.rateScopeKey, input.emailKey, input.addressKey, input.kind, input.at]);
    this.#database.prepare("DELETE FROM guest_account_rate_events WHERE occurred_at <= ?").run([new Date(Date.parse(input.at) - this.#policy.rateLimitWindowMs).toISOString()]);
  }

  requestCode(input: {
    readonly tenantId: string;
    readonly email: string;
    readonly purpose: GuestSignInCodePurpose;
    readonly clientAddress: string;
    readonly accountGuestId?: string;
    readonly sessionId?: string;
    readonly sessionSecret?: string;
    readonly expectedRevision?: number;
  }): GuestSignInCode {
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    const email = normalizeContactEmail(input.email);
    const clientAddress = requiredText(input.clientAddress, "Client address");
    if (!validPurpose(input.purpose)) throw new GuestAccountAuthorityError("invalid_input", "Sign-In Code purpose is invalid");
    const now = this.#now();
    const createdAt = now.toISOString();
    const challengeId = randomBytes(18).toString("base64url");
    const code = randomInt(0, 10 ** this.#policy.signInCodeDigits).toString().padStart(this.#policy.signInCodeDigits, "0");
    const expiresAt = new Date(now.getTime() + this.#policy.signInCodeLifetimeMs).toISOString();
    const accountGuestId = input.accountGuestId === undefined ? null : requiredText(input.accountGuestId, "Account Guest Id");
    const sessionId = input.sessionId === undefined ? null : requiredText(input.sessionId, "Session ID");
    const sessionSecret = input.sessionSecret === undefined ? null : requiredText(input.sessionSecret, "Session secret");
    const expectedRevision = input.expectedRevision;
    if (input.purpose === "sign_in") {
      if (accountGuestId || sessionId || sessionSecret || expectedRevision !== undefined) throw new GuestAccountAuthorityError("invalid_input", "Sign-In Codes cannot be bound to an existing account session");
    } else if (!accountGuestId || !sessionId || !sessionSecret || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new GuestAccountAuthorityError("session_invalid", "A current Guest Account Session and revision are required");
    }
    const rateScopeKey = this.#key("rate-scope", "all-guest-accounts");
    const emailKey = this.#key("email", email);
    const addressKey = this.#key("address", clientAddress);
    const codeHash = this.#codeDigest({ challengeId, tenantId, email, purpose: input.purpose, code });
    const result = this.#tx((): { challenge?: GuestSignInCode; failure?: GuestAccountAuthorityErrorCode; retryAfterSeconds?: number } => {
      let accountEmailRevision: number | null = null;
      if (input.purpose !== "sign_in") {
        if (!accountGuestId || !sessionId || !sessionSecret || !this.#sessionIsValid({ sessionId, sessionSecret, tenantId, accountGuestId, now })) {
          return { failure: "session_invalid" };
        }
        const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([accountGuestId, tenantId]) as unknown as AccountRow | undefined);
        if (!account || account.revision !== expectedRevision) return { failure: "session_invalid" };
        accountEmailRevision = account.emailRevision;
        if (input.purpose === "change_email" && account.email.toLowerCase() === email) return { failure: "invalid_input" };
        if (input.purpose !== "change_email" && account.email.toLowerCase() !== email) return { failure: "session_invalid" };
      }
      const retryAfterMs = this.#requestRateFailure(rateScopeKey, emailKey, addressKey, now);
      if (retryAfterMs !== null) return { failure: "rate_limited", retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      this.#insertRateEvent({ rateScopeKey, emailKey, addressKey, kind: "request", at: createdAt });
      this.#database.prepare("UPDATE guest_sign_in_codes SET invalidated_at = ? WHERE tenant_id = ? AND email_normalized = ? AND purpose = ? AND consumed_at IS NULL AND invalidated_at IS NULL")
        .run([createdAt, tenantId, email, input.purpose]);
      this.#database.prepare(`INSERT INTO guest_sign_in_codes
        (challenge_id, code_hash, tenant_id, email_normalized, purpose, account_guest_id, session_id, account_revision, account_email_revision, created_at, expires_at, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
        .run([challengeId, codeHash, tenantId, email, input.purpose, accountGuestId, sessionId, expectedRevision ?? null, accountEmailRevision, createdAt, expiresAt]);
      return { challenge: Object.freeze({ challengeId, code, expiresAt }) };
    });
    if (result.failure) {
      this.#emit(result.failure === "rate_limited" ? "guest.account.code.rate_limited" : "guest.account.code.request_rejected", {
        tenantId,
        purpose: input.purpose,
        reasonCode: result.failure
      });
      throw new GuestAccountAuthorityError(result.failure, result.failure === "rate_limited" ? "Try again later" : "Unable to request a Sign-In Code", result.retryAfterSeconds);
    }
    this.#emit("guest.account.code.requested", { tenantId, purpose: input.purpose, expiresAt });
    if (!result.challenge) throw new Error("Code challenge creation failed");
    return result.challenge;
  }

  verifyCode(input: VerifyGuestCodeInput & { readonly purpose: "sign_in" }): GuestAccountSession;
  verifyCode(input: VerifyGuestCodeInput & { readonly purpose: Exclude<GuestSignInCodePurpose, "sign_in"> }): GuestAccountActionVerification;
  verifyCode(input: VerifyGuestCodeInput): GuestCodeVerification;
  verifyCode(input: VerifyGuestCodeInput): GuestCodeVerification {
    const challengeId = requiredText(input.challengeId, "Challenge ID");
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    const email = normalizeContactEmail(input.email);
    const clientAddress = requiredText(input.clientAddress, "Client address");
    if (!validPurpose(input.purpose)) throw new GuestAccountAuthorityError("invalid_input", "Sign-In Code purpose is invalid");
    const code = typeof input.code === "string" ? input.code : "";
    const now = this.#now();
    const nowIso = now.toISOString();
    const rateScopeKey = this.#key("rate-scope", "all-guest-accounts");
    const emailKey = this.#key("email", email);
    const addressKey = this.#key("address", clientAddress);
    const candidateHash = this.#codeDigest({ challengeId, tenantId, email, purpose: input.purpose, code });
    const result = this.#tx((): { verification?: GuestCodeVerification; failure?: GuestAccountAuthorityErrorCode; retryAfterSeconds?: number; audit?: { type: string; fields: Record<string, string | number> } } => {
      const retryAfterSeconds = this.#checkRateFailure(rateScopeKey, emailKey, addressKey, now);
      if (retryAfterSeconds !== null) return { failure: "rate_limited", retryAfterSeconds };
      this.#insertRateEvent({ rateScopeKey, emailKey, addressKey, kind: "check", at: nowIso });
      const row = this.#database.prepare(`SELECT * FROM guest_sign_in_codes
        WHERE challenge_id = ? AND tenant_id = ? AND email_normalized = ? AND purpose = ?`)
        .get([challengeId, tenantId, email, input.purpose]) as unknown as ChallengeRow | undefined;
      if (!row || typeof row.code_hash !== "string") return { failure: "code_invalid", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "invalid" } } };
      if (row.invalidated_at !== null) return { failure: "code_invalid", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "invalid" } } };
      if (row.consumed_at !== null) return { failure: "code_consumed", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "consumed" } } };
      const expiresAt = parsedTimestamp(row.expires_at);
      if (!expiresAt || now.getTime() >= expiresAt.getTime()) return { failure: "code_expired", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "expired" } } };
      if (typeof row.attempts !== "number" || !Number.isSafeInteger(row.attempts) || row.attempts >= this.#policy.signInCodeMaxAttempts) {
        return { failure: "code_attempts_exhausted", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "attempts_exhausted" } } };
      }
      if (input.purpose !== "sign_in") {
        const expectedAccount = input.accountGuestId;
        const expectedSession = input.sessionId;
        const expectedSecret = input.sessionSecret;
        if (!expectedAccount || !expectedSession || !expectedSecret ||
          row.account_guest_id !== expectedAccount || row.session_id !== expectedSession ||
          !this.#sessionIsValid({ sessionId: expectedSession, sessionSecret: expectedSecret, tenantId, accountGuestId: expectedAccount, now })) {
          return { failure: "session_invalid", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "session_invalid" } } };
        }
        const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([expectedAccount, tenantId]) as unknown as AccountRow | undefined);
        if (!account || row.account_revision !== account.revision) return { failure: "session_invalid", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "stale_revision" } } };
      }
      const validCodeShape = new RegExp(`^\\d{${this.#policy.signInCodeDigits}}$`).test(code);
      if (!validCodeShape || !verifyDigest(candidateHash, row.code_hash)) {
        this.#database.prepare("UPDATE guest_sign_in_codes SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL").run([challengeId]);
        const nextAttempts = row.attempts + 1;
        return { failure: nextAttempts >= this.#policy.signInCodeMaxAttempts ? "code_attempts_exhausted" : "code_invalid", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: nextAttempts >= this.#policy.signInCodeMaxAttempts ? "attempts_exhausted" : "invalid" } } };
      }
      const consumed = this.#database.prepare("UPDATE guest_sign_in_codes SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL").run([nowIso, challengeId]);
      if (consumed.changes !== 1) return { failure: "code_consumed", audit: { type: "guest.account.code.rejected", fields: { tenantId, purpose: input.purpose, reasonCode: "consumed" } } };
      if (input.purpose !== "sign_in") {
        const accountGuestId = row.account_guest_id;
        const sessionId = row.session_id;
        const accountRevision = row.account_revision;
        if (typeof accountGuestId !== "string" || typeof sessionId !== "string" || typeof accountRevision !== "number") {
          return { failure: "session_invalid" };
        }
        const accountEmailRevision = Number(row.account_email_revision);
        if (!Number.isSafeInteger(accountEmailRevision) || accountEmailRevision < 0) return { failure: "action_proof_invalid" };
        const proof: GuestAccountActionProof = Object.freeze({ challengeId, purpose: input.purpose, tenantId, accountGuestId, sessionId, accountRevision, accountEmailRevision, expiresAt: expiresAt.toISOString() });
        return { verification: Object.freeze({ purpose: input.purpose, proof, verifiedAt: nowIso }), audit: { type: "guest.account.action_code.verified", fields: { tenantId, accountGuestId, purpose: input.purpose } } };
      }
      let account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE tenant_id = ? AND email_normalized = ? AND status = 'active'").get([tenantId, email]) as unknown as AccountRow | undefined);
      if (!account) {
        const accountGuestId = `gacct-${randomBytes(16).toString("base64url")}`;
        this.#database.prepare(`INSERT INTO guest_accounts
          (account_guest_id, tenant_id, email_normalized, phone_number, status, created_at, updated_at, revision)
          VALUES (?, ?, ?, NULL, 'active', ?, ?, 0)`)
          .run([accountGuestId, tenantId, email, nowIso, nowIso]);
        account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([accountGuestId, tenantId]) as unknown as AccountRow | undefined);
      }
      if (!account || account.status !== "active") return { failure: "code_invalid" };
      const sessionId = `gass-${randomBytes(16).toString("base64url")}`;
      const sessionSecret = randomBytes(32).toString("base64url");
      const sessionExpiresAt = new Date(now.getTime() + this.#policy.accountSessionLifetimeMs).toISOString();
      this.#database.prepare(`INSERT INTO guest_account_sessions
        (session_id, session_secret_hash, tenant_id, account_guest_id, created_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)`)
        .run([sessionId, hashGuestAccountSessionSecret(sessionSecret), tenantId, account.accountGuestId, nowIso, sessionExpiresAt]);
      const verification: GuestAccountSession = Object.freeze({ purpose: "sign_in", account, sessionId, sessionSecret, createdAt: nowIso, expiresAt: sessionExpiresAt });
      return { verification, audit: { type: "guest.account.session.created", fields: { tenantId, accountGuestId: account.accountGuestId, expiresAt: sessionExpiresAt } } };
    });
    if (result.audit) this.#emit(result.audit.type, result.audit.fields);
    if (result.failure) {
      if (!result.audit) this.#emit("guest.account.code.rejected", { tenantId, purpose: input.purpose, reasonCode: result.failure });
      throw new GuestAccountAuthorityError(result.failure, result.failure === "rate_limited" ? "Try again later" : "Invalid or expired Sign-In Code", result.retryAfterSeconds);
    }
    if (!result.verification) throw new Error("Code verification did not produce a result");
    if (result.verification.purpose === "sign_in") {
      this.#emit("guest.account.code.verified", { tenantId, accountGuestId: result.verification.account.accountGuestId, purpose: input.purpose });
    }
    return result.verification;
  }

  consumeActionProof(input: { readonly proof: GuestAccountActionProof; readonly sessionSecret: string }): boolean {
    const proof = input.proof;
    if (!proof || (proof.purpose !== "delete_account" && proof.purpose !== "export_data")) return false;
    const now = this.#now();
    const consumed = this.#tx((): boolean => {
      if (!this.#sessionIsValid({ sessionId: proof.sessionId, sessionSecret: input.sessionSecret, tenantId: proof.tenantId, accountGuestId: proof.accountGuestId, now })) return false;
      const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'").get([proof.accountGuestId, proof.tenantId]) as unknown as AccountRow | undefined);
      if (account?.revision !== proof.accountRevision) return false;
      const result = this.#database.prepare(`UPDATE guest_sign_in_codes SET action_consumed_at = ?
        WHERE challenge_id = ? AND tenant_id = ? AND account_guest_id = ? AND session_id = ? AND purpose = ?
          AND account_revision = ? AND consumed_at IS NOT NULL AND action_consumed_at IS NULL
          AND invalidated_at IS NULL AND expires_at = ? AND expires_at > ?`)
        .run([now.toISOString(), proof.challengeId, proof.tenantId, proof.accountGuestId, proof.sessionId, proof.purpose, proof.accountRevision, proof.expiresAt, now.toISOString()]);
      return result.changes === 1;
    });
    if (consumed) this.#emit("guest.account.action_proof.consumed", { tenantId: proof.tenantId, accountGuestId: proof.accountGuestId, purpose: proof.purpose });
    return consumed;
  }

  changeEmail(input: {
    readonly command: PlatformCommandEnvelope<GuestAccountEmailChangeCommand>;
    readonly proof: GuestAccountActionProof;
    readonly sessionSecret: string;
  }): GuestAccount {
    const command = input.command;
    const proof = input.proof;
    if (!command || command.commandName !== "guest_account.change_email" || !command.principal || command.principal.role !== "guest" ||
      command.principal.id !== proof?.accountGuestId || command.principal.tenantId !== proof?.tenantId ||
      command.expectedVersion !== proof?.accountRevision || !command.idempotencyKey ||
      typeof command.payload?.email !== "string") {
      throw new GuestAccountAuthorityError("action_proof_invalid", "A valid account email-change command is required");
    }
    if (!proof || proof.purpose !== "change_email") throw new GuestAccountAuthorityError("action_proof_invalid", "A fresh email-change proof is required");
    const newEmail = normalizeContactEmail(command.payload.email);
    const key = this.#key("email-change-idempotency", requiredText(command.idempotencyKey, "Idempotency key"));
    // ADRs 0072/0075: bind the receipt to the scoped effect and proof, storing no bearer credentials.
    const fingerprint = this.#key("email-change-command", JSON.stringify({
      commandName: command.commandName, accountGuestId: proof.accountGuestId, tenantId: proof.tenantId,
       expectedVersion: command.expectedVersion, email: newEmail, accountEmailRevision: proof.accountEmailRevision,
      challengeId: proof.challengeId, purpose: proof.purpose, sessionId: proof.sessionId,
      accountRevision: proof.accountRevision, expiresAt: proof.expiresAt
    }));
    const now = this.#now();
    const nowIso = now.toISOString();
    const result = this.#tx((): { account?: GuestAccount; failure?: GuestAccountAuthorityErrorCode; replay?: boolean } => {
      // A recorded effect may be retried after proof expiry, but never without current session authority.
      if (!this.#sessionIsValid({ sessionId: proof.sessionId, sessionSecret: input.sessionSecret, tenantId: proof.tenantId, accountGuestId: proof.accountGuestId, now })) return { failure: "session_invalid" };
      const prior = this.#database.prepare(`SELECT * FROM guest_account_email_commands
        WHERE tenant_id = ? AND account_guest_id = ? AND idempotency_key_hash = ?`)
        .get([proof.tenantId, proof.accountGuestId, key]) as unknown as EmailChangeCommandRow | undefined;
      if (prior) {
        const account = projectAccount(prior);
        if (prior.fingerprint !== fingerprint || !account) return { failure: "action_proof_invalid" };
        return { account, replay: true };
      }
      const row = this.#database.prepare("SELECT * FROM guest_sign_in_codes WHERE challenge_id = ?").get([proof.challengeId]) as unknown as ChallengeRow | undefined;
      if (!row || row.purpose !== "change_email" || row.tenant_id !== proof.tenantId || row.account_guest_id !== proof.accountGuestId || row.session_id !== proof.sessionId || row.account_revision !== proof.accountRevision || row.email_normalized !== newEmail || row.consumed_at === null || row.action_consumed_at !== null || row.invalidated_at !== null) return { failure: "action_proof_invalid" };
      const expiresAt = parsedTimestamp(row.expires_at);
      if (!expiresAt || now.getTime() >= expiresAt.getTime() || proof.expiresAt !== expiresAt.toISOString()) return { failure: "action_proof_invalid" };
      const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'").get([proof.accountGuestId, proof.tenantId]) as unknown as AccountRow | undefined);
      if (!account || account.revision !== proof.accountRevision) return { failure: "action_proof_invalid" };
      const conflict = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE tenant_id = ? AND email_normalized = ? AND status = 'active'").get([proof.tenantId, newEmail]) as unknown as AccountRow | undefined);
      if (conflict && conflict.accountGuestId !== proof.accountGuestId) return { failure: "account_conflict" };
      const proofUse = this.#database.prepare("UPDATE guest_sign_in_codes SET action_consumed_at = ? WHERE challenge_id = ? AND action_consumed_at IS NULL").run([nowIso, proof.challengeId]);
      if (proofUse.changes !== 1) return { failure: "action_proof_invalid" };
       const updated = this.#database.prepare(`UPDATE guest_accounts SET email_revision = email_revision + CASE WHEN email_normalized <> ? THEN 1 ELSE 0 END,
         email_normalized = ?, updated_at = ?, revision = revision + 1
         WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active' AND revision = ?`)
         .run([newEmail, newEmail, nowIso, proof.accountGuestId, proof.tenantId, proof.accountRevision]);
      if (updated.changes !== 1) return { failure: "action_proof_invalid" };
      this.#database.prepare(`UPDATE guest_sign_in_codes SET invalidated_at = ? WHERE tenant_id = ? AND account_guest_id = ?
        AND consumed_at IS NULL AND invalidated_at IS NULL`)
        .run([nowIso, proof.tenantId, proof.accountGuestId]);
      const changed = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ?").get([proof.accountGuestId, proof.tenantId]) as unknown as AccountRow | undefined);
      if (!changed) throw new Error("Account email change did not produce an account");
      this.#database.prepare(`INSERT INTO guest_account_email_commands
        (tenant_id, account_guest_id, idempotency_key_hash, fingerprint, email_normalized, email_revision, phone_number, status, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run([changed.tenantId, changed.accountGuestId, key, fingerprint, changed.email, changed.emailRevision, changed.phoneNumber, changed.status, changed.createdAt, changed.updatedAt, changed.revision]);
      return { account: changed };
    });
    if (result.failure) {
      this.#emit("guest.account.email_change.rejected", { tenantId: proof.tenantId, accountGuestId: proof.accountGuestId, reasonCode: result.failure });
      throw new GuestAccountAuthorityError(result.failure, "Unable to change the account email");
    }
    if (!result.account) throw new Error("Account email change did not produce an account");
    if (!result.replay) this.#emit("guest.account.email_changed", { tenantId: proof.tenantId, accountGuestId: proof.accountGuestId, revision: result.account.revision });
    return result.account;
  }

  /** Replays a committed email change after post-commit Shortlet invalidation failed; cleanup remains retryable. */
  replayEmailChange(input: { readonly tenantId: string; readonly accountGuestId: string; readonly sessionId: string; readonly sessionSecret: string; readonly challengeId: string; readonly email: string; readonly code: string }): GuestAccount {
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    const accountGuestId = requiredText(input.accountGuestId, "Account Guest Id");
    const sessionId = requiredText(input.sessionId, "Session ID");
    const challengeId = requiredText(input.challengeId, "Challenge ID");
    const email = normalizeContactEmail(input.email);
    const idempotencyKeyHash = this.#key("email-change-idempotency", `guest_account.change_email:${challengeId}`);
    const cleanup = this.#database.prepare(`SELECT assurance_cleanup_completed FROM guest_account_email_commands
      WHERE tenant_id = ? AND account_guest_id = ? AND idempotency_key_hash = ?`)
      .get([tenantId, accountGuestId, idempotencyKeyHash]);
    if (!cleanup || cleanup.assurance_cleanup_completed !== 0) {
      throw new GuestAccountAuthorityError("action_proof_invalid", "No pending email-change cleanup can be replayed");
    }
    const now = this.#now();
    if (!this.#sessionIsValid({ sessionId, sessionSecret: input.sessionSecret, tenantId, accountGuestId, now })) {
      throw new GuestAccountAuthorityError("session_invalid", "A current account session is required");
    }
    const challenge = this.#database.prepare("SELECT * FROM guest_sign_in_codes WHERE challenge_id = ?")
      .get([challengeId]) as unknown as ChallengeRow | undefined;
    if (!challenge || challenge.purpose !== "change_email" || challenge.tenant_id !== tenantId || challenge.account_guest_id !== accountGuestId ||
      challenge.session_id !== sessionId || challenge.email_normalized !== email || challenge.consumed_at === null || challenge.action_consumed_at === null ||
      typeof challenge.account_revision !== "number" || typeof challenge.expires_at !== "string") {
      throw new GuestAccountAuthorityError("action_proof_invalid", "No committed email change can be replayed");
    }
    const submittedHash = this.#codeDigest({ challengeId, tenantId, email, purpose: "change_email", code: input.code });
    if (typeof challenge.code_hash !== "string" || !verifyDigest(challenge.code_hash, submittedHash)) {
      throw new GuestAccountAuthorityError("action_proof_invalid", "No committed email change can be replayed");
    }
    const proof: GuestAccountActionProof = {
      challengeId,
      purpose: "change_email",
      tenantId,
      accountGuestId,
      sessionId,
      accountRevision: challenge.account_revision,
      accountEmailRevision: Number(challenge.account_email_revision),
      expiresAt: challenge.expires_at,
    };
    const command = createPlatformCommandEnvelope({
      commandName: "guest_account.change_email",
      principal: { id: accountGuestId, role: "guest", tenantId },
      payload: { email },
      idempotencyKey: `guest_account.change_email:${challengeId}`,
      expectedVersion: proof.accountRevision,
    });
    return this.changeEmail({ command, proof, sessionSecret: input.sessionSecret });
  }

  /** Records completion of the idempotent Shortlet cleanup for the committed email change. */
  markEmailChangeAssuranceCleanupComplete(input: { readonly tenantId: string; readonly accountGuestId: string; readonly challengeId: string }): void {
    const tenantId = requiredText(input.tenantId, "Tenant ID");
    const accountGuestId = requiredText(input.accountGuestId, "Account Guest Id");
    const challengeId = requiredText(input.challengeId, "Challenge ID");
    const key = this.#key("email-change-idempotency", `guest_account.change_email:${challengeId}`);
    const updated = this.#database.prepare(`UPDATE guest_account_email_commands SET assurance_cleanup_completed = 1
      WHERE tenant_id = ? AND account_guest_id = ? AND idempotency_key_hash = ?`)
      .run([tenantId, accountGuestId, key]);
    if (updated.changes !== 1) throw new GuestAccountAuthorityError("action_proof_invalid", "The committed email change cannot be acknowledged");
  }

  findAccountByEmail(emailInput: string, tenantIdInput: string): GuestAccount | null {
    const email = normalizeContactEmail(emailInput);
    const tenantId = requiredText(tenantIdInput, "Tenant ID");
    return projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE tenant_id = ? AND email_normalized = ? AND status = 'active'").get([tenantId, email]) as unknown as AccountRow | undefined);
  }

  /** The active account with this id in the tenant, or null (issue 07: the account page reads its own email and revision). */
  findAccount(accountGuestIdInput: string, tenantIdInput: string): GuestAccount | null {
    const accountGuestId = requiredText(accountGuestIdInput, "Account Guest Id");
    const tenantId = requiredText(tenantIdInput, "Tenant ID");
    return projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE account_guest_id = ? AND tenant_id = ? AND status = 'active'").get([accountGuestId, tenantId]) as unknown as AccountRow | undefined);
  }

  resolveSession(sessionIdInput: string | null | undefined, sessionSecretInput: string | null | undefined): GuestAuthenticatedAccount | null {
    if (!sessionIdInput || !sessionSecretInput) return null;
    const row = this.#sessionRow(sessionIdInput);
    if (!row || typeof row.session_secret_hash !== "string" || typeof row.tenant_id !== "string" || typeof row.account_guest_id !== "string") return null;
    const expiry = parsedTimestamp(row.expires_at);
    if (row.revoked_at !== null || !expiry || this.#now().getTime() >= expiry.getTime() || !verifyDigest(hashGuestAccountSessionSecret(sessionSecretInput), row.session_secret_hash)) return null;
    const account = projectAccount(this.#database.prepare("SELECT * FROM guest_accounts WHERE tenant_id = ? AND account_guest_id = ? AND status = 'active'").get([row.tenant_id, row.account_guest_id]) as unknown as AccountRow | undefined);
    return account ? Object.freeze({ tenantId: account.tenantId, accountGuestId: account.accountGuestId, sessionId: sessionIdInput }) : null;
  }

  sessionRejection(sessionId: string | null | undefined, sessionSecret: string | null | undefined): "missing" | "expired" | "revoked" {
    if (!sessionId || !sessionSecret) return "missing";
    const row = this.#sessionRow(sessionId);
    if (!row || typeof row.session_secret_hash !== "string" || !verifyDigest(hashGuestAccountSessionSecret(sessionSecret), row.session_secret_hash)) return "missing";
    if (row.revoked_at !== null) return "revoked";
    const expiresAt = parsedTimestamp(row.expires_at);
    if (!expiresAt || this.#now().getTime() >= expiresAt.getTime()) return "expired";
    return "missing";
  }

  revokeSession(sessionIdInput: string, tenantIdInput: string): void {
    const sessionId = requiredText(sessionIdInput, "Session ID");
    const tenantId = requiredText(tenantIdInput, "Tenant ID");
    const now = this.#now().toISOString();
    const row = this.#database.prepare("SELECT account_guest_id FROM guest_account_sessions WHERE session_id = ? AND tenant_id = ? AND revoked_at IS NULL").get([sessionId, tenantId]) as { account_guest_id: unknown } | undefined;
    this.#database.prepare("UPDATE guest_account_sessions SET revoked_at = ? WHERE session_id = ? AND tenant_id = ? AND revoked_at IS NULL").run([now, sessionId, tenantId]);
    if (typeof row?.account_guest_id === "string") this.#emit("guest.account.session.revoked", { tenantId, accountGuestId: row.account_guest_id });
  }

  revokeAllSessions(accountGuestIdInput: string, tenantIdInput: string): void {
    const accountGuestId = requiredText(accountGuestIdInput, "Account Guest Id");
    const tenantId = requiredText(tenantIdInput, "Tenant ID");
    const now = this.#now().toISOString();
    this.#database.prepare(`UPDATE guest_account_sessions SET revoked_at = ?
      WHERE account_guest_id = ? AND tenant_id = ? AND revoked_at IS NULL`)
      .run([now, accountGuestId, tenantId]);
    this.#emit("guest.account.sessions.revoked_all", { tenantId, accountGuestId });
  }

  close(): void {
    /* The composition owns the shared handle (ADR 0095). */
  }
}

/**
 * Ends an account's session(s) from a session credential without the code-hashing key (ADR 0093, ADR 0070). Account
 * sign-in can be disabled (no key, or no sender) while stored sessions still exist. A sign-out or sign-out everywhere
 * must still end them, and the session hash needs no key: SHA-256 of the secret, compared in constant time. Returns the
 * account and its Linked Principals when the credential resolves (tenant, not revoked, not expired), otherwise null.
 * With `everywhere` false only the presented session ends; otherwise every session of the account in the tenant.
 */
export function revokeGuestAccountWithoutKey(
  database: SqlDatabase,
  input: { readonly sessionId: string; readonly sessionSecret: string; readonly tenantId: string; readonly everywhere: boolean; readonly now: Date },
): { readonly accountGuestId: string; readonly principalIds: readonly string[] } | null {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'guest_account_sessions'").get([]);
  if (tables === undefined) return null;
  const row = database.prepare("SELECT session_secret_hash, tenant_id, account_guest_id, expires_at, revoked_at FROM guest_account_sessions WHERE session_id = ?").get([input.sessionId]);
  if (!row || typeof row.session_secret_hash !== "string" || row.tenant_id !== input.tenantId || row.revoked_at !== null) return null;
  if (typeof row.account_guest_id !== "string" || typeof row.expires_at !== "string") return null;
  if (!verifyDigest(hashGuestAccountSessionSecret(input.sessionSecret), row.session_secret_hash)) return null;
  const expiresAt = parsedTimestamp(row.expires_at);
  if (!expiresAt || input.now.getTime() >= expiresAt.getTime()) return null;
  const nowIso = input.now.toISOString();
  const accountGuestId = row.account_guest_id;
  if (input.everywhere) {
    database.prepare("UPDATE guest_account_sessions SET revoked_at = ? WHERE account_guest_id = ? AND tenant_id = ? AND revoked_at IS NULL")
      .run([nowIso, accountGuestId, input.tenantId]);
  } else {
    database.prepare("UPDATE guest_account_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").run([nowIso, input.sessionId]);
  }
  const principals = database.prepare("SELECT principal_id FROM guest_account_principals WHERE tenant_id = ? AND account_guest_id = ?").all([input.tenantId, accountGuestId]);
  const principalIds = principals.map((principal) => {
    if (typeof principal.principal_id !== "string" || principal.principal_id === "") throw new Error("Stored principal link is malformed");
    return principal.principal_id;
  });
  return Object.freeze({ accountGuestId, principalIds: Object.freeze(principalIds) });
}
