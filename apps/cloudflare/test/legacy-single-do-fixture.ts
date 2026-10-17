import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/**
 * Synthetic rows written against the pre-split schema at 25aa54c7a26b693a78853dcbcbc5f4d36ee5fd78.
 * The DDL below preserves that schema's legacy account and assurance column shapes: neither has an email revision.
 * Credential values are inert fixture hashes, never usable secrets.
 */
export const LEGACY_SINGLE_DO_TABLES = [
  "guest_accounts",
  "guest_account_principals",
  "guest_contacts",
  "guest_threads",
  "guest_identity_assurance",
  "manual_transfers",
] as const;

export const LEGACY_SINGLE_DO_CREDENTIAL_TABLES = [
  "guest_account_sessions",
  "guest_session_bindings",
  "guest_sign_in_codes",
  "guest_account_email_commands",
  "operator_access_tokens",
  "operator_sessions",
] as const;

/** AC3 migration policy: legacy assurance lacks the account-email revision binding; omit and require re-verification. */
export const LEGACY_ASSURANCE_MIGRATION = "omit-unbound-legacy-assurance" as const;

export interface LegacySingleDoFixtureIds {
  readonly accountGuestId: string;
  readonly principalId: string;
  readonly threadId: string;
  readonly transactionId: string;
  readonly assuranceAccountGuestId: string;
}

export function seedLegacySingleDo(database: SqlDatabase, tenantId: string, suffix: string): LegacySingleDoFixtureIds {
  // Shortlet's current schema already has the post-split assurance shape; replace it with the legacy source shape for this fixture.
  database.exec("DROP TRIGGER IF EXISTS guest_identity_assurance_on_email_change; DROP TABLE IF EXISTS guest_identity_assurance;");
  database.exec(`
    CREATE TABLE guest_accounts (
      account_guest_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email_normalized TEXT NOT NULL,
      phone_number TEXT, status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_guest_accounts_active_email
      ON guest_accounts (tenant_id, email_normalized) WHERE status = 'active';
    CREATE TABLE guest_account_principals (
      principal_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, account_guest_id TEXT NOT NULL, linked_at TEXT NOT NULL,
      FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
    );
    CREATE INDEX idx_guest_account_principals_account ON guest_account_principals (tenant_id, account_guest_id);
    CREATE TABLE guest_contacts (
      guest_id TEXT NOT NULL, tenant_id TEXT NOT NULL, phone_number TEXT, contact_email TEXT,
      revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guest_id, tenant_id)
    );
    CREATE TABLE guest_threads (
      thread_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL, thread_json TEXT NOT NULL
    );
    CREATE TABLE guest_identity_assurance (
      tenant_id TEXT NOT NULL, account_guest_id TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('email-verified', 'phone-verified', 'government-ID-verified')),
      method TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed', 'expired', 'provider_unavailable')),
      verified_at TEXT, expires_at TEXT, provider_reference TEXT, PRIMARY KEY (tenant_id, account_guest_id),
      FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
    );
    CREATE TRIGGER guest_identity_assurance_on_email_change
      AFTER UPDATE OF email_normalized ON guest_accounts
      WHEN NEW.email_normalized <> OLD.email_normalized
    BEGIN
      DELETE FROM guest_identity_assurance WHERE tenant_id = NEW.tenant_id AND account_guest_id = NEW.account_guest_id;
    END;
    CREATE TABLE guest_account_sessions (
      session_id TEXT PRIMARY KEY, session_secret_hash TEXT NOT NULL, tenant_id TEXT NOT NULL, account_guest_id TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
      FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
    );
    CREATE INDEX idx_guest_account_sessions_owner ON guest_account_sessions (tenant_id, account_guest_id, expires_at);
    CREATE TABLE guest_session_bindings (
      session_id TEXT PRIMARY KEY, session_secret_hash TEXT NOT NULL, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL
    );
    CREATE TABLE guest_sign_in_codes (
      challenge_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, tenant_id TEXT NOT NULL, email_normalized TEXT NOT NULL,
      purpose TEXT NOT NULL, account_guest_id TEXT, session_id TEXT, account_revision INTEGER, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, invalidated_at TEXT,
      action_consumed_at TEXT
    );
    CREATE INDEX idx_guest_codes_email_purpose ON guest_sign_in_codes (tenant_id, email_normalized, purpose, created_at);
    CREATE TABLE guest_account_email_commands (
      tenant_id TEXT NOT NULL, account_guest_id TEXT NOT NULL, idempotency_key_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL, email_normalized TEXT NOT NULL, phone_number TEXT, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, account_guest_id, idempotency_key_hash),
      FOREIGN KEY (account_guest_id) REFERENCES guest_accounts(account_guest_id)
    );
  `);

  const ids: LegacySingleDoFixtureIds = {
    accountGuestId: `gacct-legacy-${suffix}`,
    principalId: `principal-legacy-${suffix}`,
    threadId: `thread-legacy-${suffix}`,
    transactionId: `transfer-legacy-${suffix}`,
    assuranceAccountGuestId: `gacct-legacy-assurance-${suffix}`,
  };
  const timestamp = "2026-10-01T09:00:00.000Z";
  const insertAccount = database.prepare(`INSERT INTO guest_accounts
    (account_guest_id, tenant_id, email_normalized, phone_number, status, created_at, updated_at, revision)
    VALUES (?, ?, ?, NULL, 'active', ?, ?, 0)`);
  insertAccount.run([ids.accountGuestId, tenantId, `legacy-${suffix}@example.test`, timestamp, timestamp]);
  insertAccount.run([ids.assuranceAccountGuestId, tenantId, `assurance-${suffix}@example.test`, timestamp, timestamp]);
  database.prepare("INSERT INTO guest_account_principals (principal_id, tenant_id, account_guest_id, linked_at) VALUES (?, ?, ?, ?)")
    .run([ids.principalId, tenantId, ids.accountGuestId, timestamp]);
  database.prepare("INSERT INTO guest_contacts (guest_id, tenant_id, phone_number, contact_email, revision) VALUES (?, ?, ?, ?, 2)")
    .run([ids.principalId, tenantId, "+2348000000000", `legacy-${suffix}@example.test`]);
  database.prepare("INSERT INTO guest_threads (thread_id, principal_id, tenant_id, thread_json) VALUES (?, ?, ?, ?)")
    .run([ids.threadId, ids.principalId, tenantId, JSON.stringify({ threadId: ids.threadId, stage: "discovery", history: [] })]);
  database.prepare(`INSERT INTO guest_identity_assurance
    (tenant_id, account_guest_id, level, method, status, verified_at, expires_at, provider_reference)
    VALUES (?, ?, 'government-ID-verified', 'legacy-fixture-method', 'verified', ?, ?, NULL)`)
    .run([tenantId, ids.assuranceAccountGuestId, timestamp, "2031-10-01T09:00:00.000Z"]);

  // This real shortlet transaction table is part of the pre-split schema and remains domain-owned after the split.
  database.prepare(`INSERT INTO manual_transfers (transfer_id, offer_id, booking_reference, seq, transfer_json)
    VALUES (?, ?, ?, 1, ?)`)
    .run([ids.transactionId, `offer-legacy-${suffix}`, `booking-legacy-${suffix}`, JSON.stringify({ transferId: ids.transactionId, status: "pending" })]);

  // Populate every legacy credential class on the same source object; the exporter must never create an object for them.
  database.prepare(`INSERT INTO guest_account_sessions (session_id, session_secret_hash, tenant_id, account_guest_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run([`gacct-session-${suffix}`, "a".repeat(64), tenantId, ids.accountGuestId, timestamp, "2026-10-31T09:00:00.000Z"]);
  database.prepare("INSERT INTO guest_session_bindings (session_id, session_secret_hash, principal_id, tenant_id) VALUES (?, ?, ?, ?)")
    .run([`binding-${suffix}`, "b".repeat(64), ids.principalId, tenantId]);
  database.prepare(`INSERT INTO guest_sign_in_codes (challenge_id, code_hash, tenant_id, email_normalized, purpose, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'sign_in', ?, ?)`)
    .run([`challenge-${suffix}`, "c".repeat(64), tenantId, `legacy-${suffix}@example.test`, timestamp, "2026-10-01T09:10:00.000Z"]);
  database.prepare(`INSERT INTO guest_account_email_commands
    (tenant_id, account_guest_id, idempotency_key_hash, fingerprint, email_normalized, status, created_at, updated_at, revision)
    VALUES (?, ?, ?, ?, ?, 'done', ?, ?, 1)`)
    .run([tenantId, ids.accountGuestId, "d".repeat(64), "e".repeat(64), `legacy-${suffix}@example.test`, timestamp, timestamp]);
  database.prepare(`INSERT INTO operator_access_tokens (token_hash, actor_id, tenant_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(["f".repeat(64), `operator-legacy-${suffix}`, tenantId, timestamp, "2026-10-01T10:00:00.000Z"]);
  database.prepare(`INSERT INTO operator_sessions (session_id, session_secret_hash, actor_id, tenant_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run([`operator-session-${suffix}`, "1".repeat(64), `operator-legacy-${suffix}`, tenantId, timestamp, "2026-10-02T09:00:00.000Z"]);

  return ids;
}
