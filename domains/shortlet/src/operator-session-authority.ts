import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const OPERATOR_ACCESS_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
export const OPERATOR_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface OperatorAuthenticatedPrincipal { readonly actorId: string; readonly tenantId: string; readonly sessionId: string; }
export interface OperatorAuditSink { record(entry: Record<string, string | number>): void; }
export interface OperatorTelemetrySink { record(entry: Record<string, string | number>): void; }

export function hashOperatorSecret(secret: string): string { return createHash("sha256").update(secret, "utf8").digest("hex"); }

function required(value: string, label: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`); return value; }

export class SqliteOperatorSessionAuthority {
  readonly #db: DatabaseSync;
  readonly #clock: () => Date;
  readonly #audit?: OperatorAuditSink;
  readonly #telemetry?: OperatorTelemetrySink;
  constructor(databasePath: string, options: { clock?: () => Date; audit?: OperatorAuditSink; telemetry?: OperatorTelemetrySink } = {}) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#clock = options.clock ?? (() => new Date()); this.#audit = options.audit; this.#telemetry = options.telemetry;
    this.#db.exec(`CREATE TABLE IF NOT EXISTS operator_access_tokens (
      token_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
    ); CREATE INDEX IF NOT EXISTS idx_operator_access_tokens_expiry ON operator_access_tokens(expires_at);
    CREATE TABLE IF NOT EXISTS operator_sessions (
      session_id TEXT PRIMARY KEY, session_secret_hash TEXT NOT NULL, actor_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    ); CREATE INDEX IF NOT EXISTS idx_operator_sessions_actor ON operator_sessions(actor_id, tenant_id);`);
  }
  #now(): Date { const now = this.#clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Server clock is invalid"); return now; }
  #emit(type: string, fields: Record<string, string | number>): void { try { this.#audit?.record({ type, ...fields }); } catch { /* telemetry/audit must not block auth */ } try { this.#telemetry?.record({ type, ...fields }); } catch { /* same */ } }
  #tx<T>(fn: () => T): T { this.#db.exec("BEGIN IMMEDIATE"); try { const value = fn(); this.#db.exec("COMMIT"); return value; } catch (error) { try { this.#db.exec("ROLLBACK"); } catch { /* preserve */ } throw error; } }

  provisionAccessToken(input: { actorId: string; tenantId: string; representativeAuthorized: boolean }): { token: string; actorId: string; tenantId: string; expiresAt: string } {
    const actorId = required(input.actorId, "Actor ID"), tenantId = required(input.tenantId, "Tenant ID");
    if (!input.representativeAuthorized) throw new Error("Active representative grant is required before provisioning");
    const now = this.#now(), expiresAt = new Date(now.getTime() + OPERATOR_ACCESS_TOKEN_LIFETIME_MS).toISOString();
    const token = randomBytes(32).toString("base64url");
    this.#db.prepare("INSERT INTO operator_access_tokens (token_hash, actor_id, tenant_id, created_at, expires_at) VALUES ($hash,$actor,$tenant,$created,$expires)").run({ $hash: hashOperatorSecret(token), $actor: actorId, $tenant: tenantId, $created: now.toISOString(), $expires: expiresAt });
    this.#emit("operator.access_token.provisioned", { actorId, tenantId, expiresAt });
    return { token, actorId, tenantId, expiresAt };
  }

  authenticateAccessToken(tokenInput: string): { sessionId: string; sessionSecret: string; principal: OperatorAuthenticatedPrincipal; expiresAt: string } {
    const token = required(tokenInput, "Access token"), hash = hashOperatorSecret(token), now = this.#now();
    return this.#tx(() => {
      const row = this.#db.prepare("SELECT * FROM operator_access_tokens WHERE token_hash = $hash").get({ $hash: hash }) as { token_hash: string; actor_id: string; tenant_id: string; expires_at: string; consumed_at: string | null } | undefined;
      if (!row) { this.#emit("operator.login.failed", { reasonCode: "invalid_token" }); throw new Error("Invalid access token"); }
      if (row.consumed_at) { this.#emit("operator.login.failed", { reasonCode: "token_consumed" }); throw new Error("Access token already consumed"); }
      if (now.getTime() >= Date.parse(row.expires_at)) { this.#emit("operator.login.failed", { reasonCode: "token_expired" }); throw new Error("Access token expired"); }
      const consumedAt = now.toISOString(); const consumed = this.#db.prepare("UPDATE operator_access_tokens SET consumed_at = $at WHERE token_hash = $hash AND consumed_at IS NULL").run({ $at: consumedAt, $hash: hash });
      if (consumed.changes !== 1) { this.#emit("operator.login.failed", { reasonCode: "token_consumed" }); throw new Error("Access token already consumed"); }
      const sessionId = `ops-${randomBytes(16).toString("base64url")}`, sessionSecret = randomBytes(32).toString("base64url"), expiresAt = new Date(now.getTime() + OPERATOR_SESSION_LIFETIME_MS).toISOString();
      this.#db.prepare("INSERT INTO operator_sessions (session_id, session_secret_hash, actor_id, tenant_id, created_at, expires_at) VALUES ($id,$hash,$actor,$tenant,$created,$expires)").run({ $id: sessionId, $hash: hashOperatorSecret(sessionSecret), $actor: row.actor_id, $tenant: row.tenant_id, $created: consumedAt, $expires: expiresAt });
      this.#emit("operator.access_token.consumed", { actorId: row.actor_id, tenantId: row.tenant_id });
      this.#emit("operator.session.created", { actorId: row.actor_id, tenantId: row.tenant_id, sessionId, expiresAt });
      return { sessionId, sessionSecret, principal: { actorId: row.actor_id, tenantId: row.tenant_id, sessionId }, expiresAt };
    });
  }

  resolveSession(sessionIdInput: string | null | undefined, sessionSecretInput: string | null | undefined): OperatorAuthenticatedPrincipal | null {
    if (!sessionIdInput || !sessionSecretInput) return null;
    const row = this.#db.prepare("SELECT * FROM operator_sessions WHERE session_id = $id").get({ $id: sessionIdInput }) as { session_id: string; session_secret_hash: string; actor_id: string; tenant_id: string; expires_at: string; revoked_at: string | null } | undefined;
    if (!row || row.revoked_at || this.#now().getTime() >= Date.parse(row.expires_at) || hashOperatorSecret(sessionSecretInput) !== row.session_secret_hash) { if (row && !row.revoked_at && this.#now().getTime() >= Date.parse(row.expires_at)) this.#emit("operator.session.rejected", { sessionId: row.session_id, reasonCode: "session_expired" }); return null; }
    return { actorId: row.actor_id, tenantId: row.tenant_id, sessionId: row.session_id };
  }

  revokeSession(sessionId: string): void { const now = this.#now().toISOString(); this.#db.prepare("UPDATE operator_sessions SET revoked_at = $at WHERE session_id = $id AND revoked_at IS NULL").run({ $at: now, $id: sessionId }); this.#emit("operator.session.revoked", { sessionId }); }
  revokeAll(actorId: string, tenantId: string): void { const now = this.#now().toISOString(); this.#db.prepare("UPDATE operator_sessions SET revoked_at = $at WHERE actor_id = $actor AND tenant_id = $tenant AND revoked_at IS NULL").run({ $at: now, $actor: actorId, $tenant: tenantId }); this.#emit("operator.session.revoked_all", { actorId, tenantId }); }
  inspect(): { tokens: readonly Record<string, unknown>[]; sessions: readonly Record<string, unknown>[] } { const tokens = this.#db.prepare("SELECT token_hash, actor_id, tenant_id, created_at, expires_at, consumed_at FROM operator_access_tokens").all() as unknown as Record<string, unknown>[]; const sessions = this.#db.prepare("SELECT session_id, session_secret_hash, actor_id, tenant_id, created_at, expires_at, revoked_at FROM operator_sessions").all() as unknown as Record<string, unknown>[]; return { tokens, sessions }; }
  close(): void { if (this.#db.isOpen) this.#db.close(); }
}
