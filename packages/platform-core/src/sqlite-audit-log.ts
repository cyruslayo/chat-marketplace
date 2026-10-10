import type { AuditEntry, AuditLog } from "./index.js";
import type { SqlDatabase } from "./sql-database.js";
import { redactSensitiveData } from "./redaction.js";

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const AUDIT_LOG_SCHEMA = `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      recorded_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )`;

/** Append-only application API; the connection remains owned by its composition. */
export class SqliteAuditLog implements AuditLog {
  constructor(private readonly database: SqlDatabase) {
    database.exec(AUDIT_LOG_SCHEMA);
  }

  record(entry: AuditEntry): void {
    // ADR 0075/0095: redact before durable storage, on the caller's shared transaction.
    const redacted = redactSensitiveData(entry) as AuditEntry;
    const recordedAt = redacted.recordedAt ?? new Date().toISOString();
    this.database.prepare("INSERT INTO audit_log (recorded_at, payload_json) VALUES (?, ?)")
      .run([recordedAt, JSON.stringify({ ...redacted, recordedAt })]);
  }

  entries(): AuditEntry[] {
    return this.database.prepare("SELECT payload_json FROM audit_log ORDER BY id").all().map((row) => {
      if (typeof row.payload_json !== "string") throw new Error("Invalid audit payload");
      const payload: unknown = JSON.parse(row.payload_json);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid audit entry");
      return payload as AuditEntry;
    });
  }
}
