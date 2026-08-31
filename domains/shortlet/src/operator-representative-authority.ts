import { DatabaseSync } from "node:sqlite";
import type { PlatformCommandEnvelope } from "../../../packages/platform-core/src/envelope.js";

export const OPERATOR_ACTIONS_PERMISSION = "operator_actions" as const;
export const OPERATOR_REPRESENTATIVE_GRANT_COMMAND = "operator_representative.grant" as const;
export const OPERATOR_REPRESENTATIVE_REVOKE_COMMAND = "operator_representative.revoke" as const;

export interface CreateOperatorRepresentativeGrantPayload {
  actorId: string;
  operatorId: string;
  expiresAtIso: string;
  responsiblePersonVerifiedAtIso: string;
  verificationReference?: string;
}

export interface RevokeOperatorRepresentativeGrantPayload {
  grantId: string;
}

export interface OperatorRepresentativeGrant {
  grantId: string;
  actorId: string;
  operatorId: string;
  tenantId: string;
  permission: typeof OPERATOR_ACTIONS_PERMISSION;
  grantedAtIso: string;
  expiresAtIso: string;
  authorizedGrantorId: string;
  responsiblePersonVerifiedAtIso: string;
  verificationReference?: string;
  revokedAtIso?: string;
  revokedById?: string;
}

export interface OperatorRepresentativeAuditEntry {
  grantId: string;
  actorId: string;
  operatorId: string;
  tenantId: string;
  permission: typeof OPERATOR_ACTIONS_PERMISSION;
  transition: "granted" | "revoked";
  authorizedHumanId: string;
  timestamp: string;
}

export interface OperatorRepresentativeAuthority {
  canActForOperator(input: { actorId: string; operatorId: string; tenantId: string }): boolean;
}

interface GrantRow {
  grant_id: unknown;
  actor_id: unknown;
  operator_id: unknown;
  tenant_id: unknown;
  permission: unknown;
  granted_at_iso: unknown;
  expires_at_iso: unknown;
  authorized_grantor_id: unknown;
  responsible_person_verified_at_iso: unknown;
  verification_reference: unknown;
  revoked_at_iso: unknown;
  revoked_by_id: unknown;
}

interface CommandRow {
  idempotency_key: unknown;
  command_name: unknown;
  fingerprint: unknown;
  grant_id: unknown;
}

interface AuditRow {
  grant_id: unknown;
  actor_id: unknown;
  operator_id: unknown;
  tenant_id: unknown;
  permission: unknown;
  transition: unknown;
  authorized_human_id: unknown;
  timestamp: unknown;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

function parsedTimestamp(value: unknown, label: string): Date {
  if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return new Date(value);
}

function storedTimestamp(value: unknown): Date | undefined {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value)) ? new Date(value) : undefined;
}

function opaqueReference(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol !== "http:" && url.protocol !== "https:";
  } catch {
    return true;
  }
}

function project(row: GrantRow): OperatorRepresentativeGrant | undefined {
  const grantedAt = storedTimestamp(row.granted_at_iso);
  const expiresAt = storedTimestamp(row.expires_at_iso);
  const verifiedAt = storedTimestamp(row.responsible_person_verified_at_iso);
  const revokedAt = row.revoked_at_iso === null ? undefined : storedTimestamp(row.revoked_at_iso);
  const hasRevokedAt = row.revoked_at_iso !== null;
  const hasRevokedBy = row.revoked_by_id !== null;
  if (
    typeof row.grant_id !== "string" || row.grant_id.trim() === "" ||
    typeof row.actor_id !== "string" || row.actor_id.trim() === "" ||
    typeof row.operator_id !== "string" || row.operator_id.trim() === "" ||
    typeof row.tenant_id !== "string" || row.tenant_id.trim() === "" ||
    row.permission !== OPERATOR_ACTIONS_PERMISSION ||
    typeof row.authorized_grantor_id !== "string" || row.authorized_grantor_id.trim() === "" ||
    !grantedAt || !expiresAt || !verifiedAt || verifiedAt > grantedAt || grantedAt >= expiresAt ||
    (row.verification_reference !== null && !opaqueReference(row.verification_reference)) ||
    hasRevokedAt !== hasRevokedBy ||
    (hasRevokedAt && (!revokedAt || typeof row.revoked_by_id !== "string" || row.revoked_by_id.trim() === "" || revokedAt < grantedAt))
  ) return undefined;
  return {
    grantId: row.grant_id, actorId: row.actor_id, operatorId: row.operator_id, tenantId: row.tenant_id,
    permission: OPERATOR_ACTIONS_PERMISSION, grantedAtIso: row.granted_at_iso as string, expiresAtIso: row.expires_at_iso as string,
    authorizedGrantorId: row.authorized_grantor_id, responsiblePersonVerifiedAtIso: row.responsible_person_verified_at_iso as string,
    ...(row.verification_reference === null ? {} : { verificationReference: row.verification_reference }),
    ...(row.revoked_at_iso === null ? {} : { revokedAtIso: row.revoked_at_iso as string }),
    ...(row.revoked_by_id === null ? {} : { revokedById: row.revoked_by_id as string })
  };
}

export class SqliteOperatorRepresentativeGrantStore implements OperatorRepresentativeAuthority {
  readonly databasePath: string;
  readonly #clock: () => Date;
  #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string, options: { clock?: () => Date } = {}) {
    this.databasePath = databasePath;
    this.#clock = options.clock ?? (() => new Date());
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS operator_representative_grants (
        grant_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, operator_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL, permission TEXT NOT NULL, granted_at_iso TEXT NOT NULL,
        expires_at_iso TEXT NOT NULL, authorized_grantor_id TEXT NOT NULL,
        responsible_person_verified_at_iso TEXT NOT NULL, verification_reference TEXT,
        revoked_at_iso TEXT, revoked_by_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operator_rep_lookup
        ON operator_representative_grants (actor_id, operator_id, tenant_id, permission);
      CREATE TABLE IF NOT EXISTS operator_representative_commands (
        idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL,
        fingerprint TEXT NOT NULL, grant_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_representative_audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT, grant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL, operator_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
        permission TEXT NOT NULL, transition TEXT NOT NULL,
        authorized_human_id TEXT NOT NULL, timestamp TEXT NOT NULL
      );
    `);
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.#database.exec("COMMIT"); return result; }
    catch (error) { try { this.#database.exec("ROLLBACK"); } catch { /* preserve original error */ } throw error; }
  }

  #now(): { date: Date; iso: string } {
    const date = this.#clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error("Server clock is invalid");
    return { date, iso: date.toISOString() };
  }

  #grant(grantId: string): OperatorRepresentativeGrant | undefined {
    const row = this.#database.prepare("SELECT * FROM operator_representative_grants WHERE grant_id = $grantId").get({ $grantId: grantId }) as GrantRow | undefined;
    return row ? project(row) : undefined;
  }

  #fingerprint(commandName: string, principalId: string, role: string, tenantId: string | undefined, payload: object): string {
    return JSON.stringify({ commandName, principalId, role, tenantId: tenantId ?? null, payload });
  }

  #assertHuman(envelope: PlatformCommandEnvelope<unknown>): string {
    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") {
      throw new Error("Only authorized platform humans may manage representative grants");
    }
    requiredText(envelope.principal.id, "Principal ID");
    return envelope.principal.id;
  }

  createGrant(envelope: PlatformCommandEnvelope<CreateOperatorRepresentativeGrantPayload>): OperatorRepresentativeGrant {
    if (envelope.commandName !== OPERATOR_REPRESENTATIVE_GRANT_COMMAND) throw new Error("Unsupported representative grant command");
    const grantorId = this.#assertHuman(envelope);
    const tenantId = requiredText(envelope.principal.tenantId, "Principal tenant");
    const payload = envelope.payload;
    const actorId = requiredText(payload?.actorId, "Actor ID");
    const operatorId = requiredText(payload?.operatorId, "Operator ID");
    if (grantorId === actorId) throw new Error("A principal cannot grant authority to itself");
    const now = this.#now();
    const expires = parsedTimestamp(payload?.expiresAtIso, "Expiry");
    if (expires <= now.date) throw new Error("Expiry must be strictly after server time");
    const verified = parsedTimestamp(payload?.responsiblePersonVerifiedAtIso, "Responsible-person verification timestamp");
    if (verified > now.date) throw new Error("Responsible-person verification cannot be in the future");
    const reference = payload?.verificationReference;
    if (reference !== undefined && !opaqueReference(reference)) throw new Error("Verification reference must be a non-empty opaque reference");
    const key = requiredText(envelope.idempotencyKey, "Idempotency key");
    const fingerprint = this.#fingerprint(envelope.commandName, grantorId, envelope.principal.role, envelope.principal.tenantId, {
      actorId, operatorId, expiresAtIso: expires.toISOString(), responsiblePersonVerifiedAtIso: verified.toISOString(), verificationReference: reference ?? null
    });
    return this.#transaction(() => {
      const prior = this.#database.prepare("SELECT * FROM operator_representative_commands WHERE idempotency_key = $key").get({ $key: key }) as CommandRow | undefined;
      if (prior) {
        if (prior.command_name !== envelope.commandName || prior.fingerprint !== fingerprint) throw new Error("Idempotency key was reused for a different command");
        const existing = typeof prior.grant_id === "string" ? this.#grant(prior.grant_id) : undefined;
        if (!existing) throw new Error("Idempotency record is invalid");
        return existing;
      }
      const grant: OperatorRepresentativeGrant = {
        grantId: `grant-${crypto.randomUUID()}`, actorId, operatorId, tenantId, permission: OPERATOR_ACTIONS_PERMISSION,
        grantedAtIso: now.iso, expiresAtIso: expires.toISOString(), authorizedGrantorId: grantorId,
        responsiblePersonVerifiedAtIso: verified.toISOString(), ...(reference === undefined ? {} : { verificationReference: reference })
      };
      this.#database.prepare(`INSERT INTO operator_representative_grants
        (grant_id, actor_id, operator_id, tenant_id, permission, granted_at_iso, expires_at_iso,
         authorized_grantor_id, responsible_person_verified_at_iso, verification_reference)
        VALUES ($grantId, $actorId, $operatorId, $tenantId, $permission, $grantedAt, $expiresAt,
                $grantor, $verifiedAt, $reference)`).run({ $grantId: grant.grantId, $actorId: actorId, $operatorId: operatorId,
        $tenantId: tenantId, $permission: OPERATOR_ACTIONS_PERMISSION, $grantedAt: now.iso, $expiresAt: grant.expiresAtIso,
        $grantor: grantorId, $verifiedAt: grant.responsiblePersonVerifiedAtIso, $reference: reference ?? null });
      this.#database.prepare("INSERT INTO operator_representative_commands VALUES ($key, $name, $fingerprint, $grantId)").run({ $key: key, $name: envelope.commandName, $fingerprint: fingerprint, $grantId: grant.grantId });
      this.#audit(grant, "granted", grantorId, now.iso);
      return grant;
    });
  }

  revokeGrant(envelope: PlatformCommandEnvelope<RevokeOperatorRepresentativeGrantPayload>): OperatorRepresentativeGrant {
    if (envelope.commandName !== OPERATOR_REPRESENTATIVE_REVOKE_COMMAND) throw new Error("Unsupported representative revoke command");
    const revokerId = this.#assertHuman(envelope);
    const tenantId = requiredText(envelope.principal.tenantId, "Principal tenant");
    const grantId = requiredText(envelope.payload?.grantId, "Grant ID");
    const key = requiredText(envelope.idempotencyKey, "Idempotency key");
    const fingerprint = this.#fingerprint(envelope.commandName, revokerId, envelope.principal.role, envelope.principal.tenantId, { grantId });
    return this.#transaction(() => {
      const prior = this.#database.prepare("SELECT * FROM operator_representative_commands WHERE idempotency_key = $key").get({ $key: key }) as CommandRow | undefined;
      if (prior) {
        if (prior.command_name !== envelope.commandName || prior.fingerprint !== fingerprint) throw new Error("Idempotency key was reused for a different command");
        const existing = typeof prior.grant_id === "string" ? this.#grant(prior.grant_id) : undefined;
        if (!existing) throw new Error("Idempotency record is invalid");
        return existing;
      }
      const grant = this.#grant(grantId);
      if (!grant) throw new Error("Representative grant not found");
      if (grant.tenantId !== tenantId) throw new Error("Cross-tenant grant revocation is forbidden");
      if (grant.revokedAtIso) {
        this.#database.prepare("INSERT INTO operator_representative_commands VALUES ($key, $name, $fingerprint, $grantId)").run({ $key: key, $name: envelope.commandName, $fingerprint: fingerprint, $grantId: grantId });
        return grant;
      }
      const now = this.#now();
      this.#database.prepare("UPDATE operator_representative_grants SET revoked_at_iso = $at, revoked_by_id = $by WHERE grant_id = $grantId AND revoked_at_iso IS NULL").run({ $at: now.iso, $by: revokerId, $grantId: grantId });
      const revoked = { ...grant, revokedAtIso: now.iso, revokedById: revokerId };
      this.#database.prepare("INSERT INTO operator_representative_commands VALUES ($key, $name, $fingerprint, $grantId)").run({ $key: key, $name: envelope.commandName, $fingerprint: fingerprint, $grantId: grantId });
      this.#audit(revoked, "revoked", revokerId, now.iso);
      return revoked;
    });
  }

  #audit(grant: OperatorRepresentativeGrant, transition: "granted" | "revoked", humanId: string, timestamp: string): void {
    this.#database.prepare("INSERT INTO operator_representative_audit (grant_id, actor_id, operator_id, tenant_id, permission, transition, authorized_human_id, timestamp) VALUES ($grantId, $actorId, $operatorId, $tenantId, $permission, $transition, $humanId, $timestamp)").run({ $grantId: grant.grantId, $actorId: grant.actorId, $operatorId: grant.operatorId, $tenantId: grant.tenantId, $permission: grant.permission, $transition: transition, $humanId: humanId, $timestamp: timestamp });
  }

  canActForOperator(input: { actorId: string; operatorId: string; tenantId: string }): boolean {
    if (!input || !input.actorId || !input.operatorId || !input.tenantId) return false;
    const rows = this.#database.prepare("SELECT * FROM operator_representative_grants WHERE actor_id = $actorId AND operator_id = $operatorId AND tenant_id = $tenantId AND permission = $permission").all({ $actorId: input.actorId, $operatorId: input.operatorId, $tenantId: input.tenantId, $permission: OPERATOR_ACTIONS_PERMISSION }) as unknown as GrantRow[];
    const now = this.#now().date;
    return rows.some((row) => { const grant = project(row); if (!grant || grant.revokedAtIso) return false; const expiry = Date.parse(grant.expiresAtIso); return Number.isFinite(expiry) && now.getTime() < expiry; });
  }

  listGrants(): OperatorRepresentativeGrant[] {
    const rows = this.#database.prepare("SELECT * FROM operator_representative_grants ORDER BY granted_at_iso").all() as unknown as GrantRow[];
    return rows.flatMap((row) => { const grant = project(row); return grant ? [grant] : []; });
  }

  auditEntries(): OperatorRepresentativeAuditEntry[] {
    const rows = this.#database.prepare("SELECT grant_id, actor_id, operator_id, tenant_id, permission, transition, authorized_human_id, timestamp FROM operator_representative_audit ORDER BY audit_id").all() as unknown as AuditRow[];
    return rows.flatMap((row) => row.permission === OPERATOR_ACTIONS_PERMISSION && typeof row.grant_id === "string" && typeof row.actor_id === "string" && typeof row.operator_id === "string" && typeof row.tenant_id === "string" && (row.transition === "granted" || row.transition === "revoked") && typeof row.authorized_human_id === "string" && typeof row.timestamp === "string" ? [{ grantId: row.grant_id, actorId: row.actor_id, operatorId: row.operator_id, tenantId: row.tenant_id, permission: OPERATOR_ACTIONS_PERMISSION, transition: row.transition, authorizedHumanId: row.authorized_human_id, timestamp: row.timestamp }] : []);
  }

  close(): void { if (!this.#closed) { this.#database.close(); this.#closed = true; } }
}
