/**
 * Framework-neutral platform ports. Domain and application code depend on
 * these small contracts; channel/framework adapters stay outside them.
 */
import type { TelemetryEvent, TransitionTelemetryEvent } from "./telemetry.js";
import { redactSensitiveData } from "./redaction.js";

/** Callers own the shape/narrowing of domain-specific fields (ADR 0070/0075). */
export interface AuditEntry extends Record<string, unknown> {
  recordedAt?: string;
}

export interface AuditLog {
  record(entry: AuditEntry): void;
  entries(): AuditEntry[];
}

export class InMemoryAuditLog implements AuditLog {
  #entries: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    const redacted = redactSensitiveData(entry) as AuditEntry;
    this.#entries.push(structuredClone({ ...redacted, recordedAt: redacted.recordedAt ?? new Date().toISOString() }));
  }

  entries(): AuditEntry[] {
    return structuredClone(this.#entries);
  }
}

export class InMemoryTelemetry {
  #events: TelemetryEvent[] = [];
  #transitionKeys = new Set<string>();

  track(event: object): void {
    const record = event as Record<string, unknown>;
    this.#events.push(Object.freeze({ ...record, recordedAt: record.recordedAt ?? new Date().toISOString() }));
  }

  trackTransition(event: TransitionTelemetryEvent): void {
    if (this.#transitionKeys.has(event.transitionKey)) return;
    this.#transitionKeys.add(event.transitionKey);
    this.track(event);
  }

  events(): TelemetryEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }
}

export * from "./thread.js";
export * from "./surface.js";
export * from "./envelope.js";
export * from "./human-handoff.js";
export * from "./stream-replay.js";
export * from "./provider-contracts.js";
export * from "./interaction-security.js";
export * from "./reconciliation.js";
export * from "./provider-certification.js";
export * from "./telemetry.js";

