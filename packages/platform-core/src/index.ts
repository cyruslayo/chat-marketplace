/**
 * Framework-neutral platform ports. Domain and application code depend on
 * these small contracts; channel/framework adapters stay outside them.
 */
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
  #events: any[] = [];

  track(event: any) {
    this.#events.push(Object.freeze({ ...event, recordedAt: event.recordedAt ?? new Date().toISOString() }));
  }

  events(): any[] {
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




