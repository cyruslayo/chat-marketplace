/**
 * Framework-neutral platform ports. Domain and application code depend on
 * these small contracts; channel/framework adapters stay outside them.
 */
export class InMemoryAuditLog {
  #entries = [];

  record(entry) {
    this.#entries.push(Object.freeze({ ...entry, recordedAt: entry.recordedAt ?? new Date().toISOString() }));
  }

  entries() {
    return this.#entries.map((entry) => ({ ...entry }));
  }
}

export class InMemoryTelemetry {
  #events = [];

  track(event) {
    this.#events.push(Object.freeze({ ...event, recordedAt: event.recordedAt ?? new Date().toISOString() }));
  }

  events() {
    return this.#events.map((event) => ({ ...event }));
  }
}
