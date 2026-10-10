import { createHash } from "node:crypto";
import type { Telemetry, TelemetryEvent, TransitionTelemetryEvent } from "./index.js";
import type { SqlDatabase } from "./sql-database.js";
import { redactSensitiveData } from "./redaction.js";

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const TELEMETRY_SCHEMA = `CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY,
      transition_key TEXT,
      recorded_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS telemetry_transition_key ON telemetry_events (transition_key)`;

export class SqliteTelemetry implements Telemetry {
  readonly #sink?: (event: TelemetryEvent) => void;

  constructor(private readonly database: SqlDatabase, options: { sink?: (event: TelemetryEvent) => void } = {}) {
    this.#sink = options.sink;
    database.exec(TELEMETRY_SCHEMA);
  }

  track(event: object): void {
    this.#insert(event, null);
  }

  trackTransition(event: TransitionTelemetryEvent): void {
    // ADR 0075/0079: hash the raw dedupe identity so credentials cannot leak into the index.
    const key = createHash("sha256").update(event.transitionKey).digest("hex");
    this.#insert(event, key);
  }

  #insert(event: object, key: string | null): void {
    const redacted = redactSensitiveData(event) as TelemetryEvent;
    const recordedAt = typeof redacted.recordedAt === "string" ? redacted.recordedAt : new Date().toISOString();
    const payload = { ...redacted, recordedAt };
    const result = this.database.prepare(
      "INSERT OR IGNORE INTO telemetry_events (transition_key, recorded_at, payload_json) VALUES (?, ?, ?)",
    ).run([key, recordedAt, JSON.stringify(payload)]);
    // This optional observational sink follows insertion, not an outer transaction's commit.
    // The durable table is authoritative; no external sink is wired by this slice.
    if (result.changes === 1) this.#sink?.(structuredClone(payload));
  }

  events(): TelemetryEvent[] {
    return this.database.prepare("SELECT payload_json FROM telemetry_events ORDER BY id").all().map((row) => {
      if (typeof row.payload_json !== "string") throw new Error("Invalid telemetry payload");
      const payload: unknown = JSON.parse(row.payload_json);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid telemetry event");
      return payload as TelemetryEvent;
    });
  }
}
