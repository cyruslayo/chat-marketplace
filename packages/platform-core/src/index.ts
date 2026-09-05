/**
 * Framework-neutral platform ports. Domain and application code depend on
 * these small contracts; channel/framework adapters stay outside them.
 */
import type { TelemetryEvent, TransitionTelemetryEvent } from "./telemetry.js";

export class InMemoryAuditLog {
  #entries: any[] = [];

  record(entry: any) {
    this.#entries.push(Object.freeze({ ...entry, recordedAt: entry.recordedAt ?? new Date().toISOString() }));
  }

  entries(): any[] {
    return this.#entries.map((entry) => ({ ...entry }));
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

