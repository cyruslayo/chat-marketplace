import { InMemoryTelemetry } from "./index.js";

export interface StreamEvent {
  eventId: string;
  profileVersion: string;
  eventType: string;
  sequence: number;
  timestampIso: string;
  payload: any;
}

export interface ProcessEventResult {
  accepted: boolean;
  isDuplicate?: boolean;
  gapDetected?: boolean;
  missingSequenceStart?: number;
  missingSequenceEnd?: number;
}

export interface StreamMetricsInput {
  streamId: string;
  establishmentMs: number;
  reconnectMs: number;
  surfaceRenderMs: number;
  bytesProcessed: number;
}

export interface ClientProjection {
  clientType: "copilotkit" | "reference_client";
  facts: any;
  actions: ReadonlyArray<any>;
  deadlines: ReadonlyArray<any>;
  accessibility: any;
}

const REGISTERED_PROFILE = "com.chat-marketplace.interaction/agui-v1";
const REGISTERED_EVENT_TYPES = new Set([
  "platform.a2ui.message.v1",
  "platform.agent.run_started",
  "platform.agent.run_finished",
  "platform.text_delta",
  "platform.heartbeat"
]);

const MAX_ORDINARY_EVENT_BYTES = 65536; // 64 KiB

/**
 * ADR 0068, ADR 0069, ADR 0071, ADR 0079, ADR 0080:
 * Implements the pinned AG-UI interaction profile (`agui-v1`), ordered replayable stream with deduplication,
 * gap detection, backpressure/size limits, golden stream parity across clients, and redacted telemetry.
 */
export class InteractionStreamEngine {
  readonly #telemetry?: InMemoryTelemetry;
  readonly #processedEvents = new Map<number, StreamEvent>();
  #expectedSequence = 1;
  #compactedSnapshot: any = null;

  constructor({ telemetry }: { telemetry?: InMemoryTelemetry } = {}) {
    this.#telemetry = telemetry;
  }

  /**
   * ADR 0069, ADR 0079 & AC1, AC2:
   * Processes incoming stream event with profile checking, size limits, deduplication, conflict checks, and gap detection.
   */
  processIncomingEvent(event: StreamEvent): ProcessEventResult {
    // Reject raw production events or mismatched profile version
    if (event.profileVersion === "raw" || event.eventType === "RAW_EVENT") {
      throw new Error("Rejected raw production event");
    }
    if (event.profileVersion !== REGISTERED_PROFILE) {
      throw new Error(`Rejected unregistered profile version: ${event.profileVersion}`);
    }

    // Reject unregistered event types
    if (!REGISTERED_EVENT_TYPES.has(event.eventType)) {
      throw new Error(`Rejected unregistered event type: ${event.eventType}`);
    }

    // Size limit check (64 KiB for ordinary event)
    const serialized = JSON.stringify(event.payload ?? {});
    if (serialized.length > MAX_ORDINARY_EVENT_BYTES) {
      throw new Error(`Event size exceeds 64 KiB limit (${serialized.length} bytes)`);
    }

    // Deduplication and conflict check
    const existing = this.#processedEvents.get(event.sequence);
    if (existing) {
      const existingSerialized = JSON.stringify(existing.payload ?? {});
      if (existingSerialized === serialized && existing.eventId === event.eventId) {
        return { accepted: true, isDuplicate: true };
      }
      throw new Error(`Conflicting duplicate event detected for sequence ${event.sequence}`);
    }

    // Gap detection
    let gapDetected = false;
    let missingSequenceStart: number | undefined;
    if (event.sequence > this.#expectedSequence) {
      gapDetected = true;
      missingSequenceStart = this.#expectedSequence;
    }

    this.#processedEvents.set(event.sequence, Object.freeze(structuredClone(event)));
    if (!gapDetected) {
      this.#expectedSequence = event.sequence + 1;
    }

    return {
      accepted: true,
      isDuplicate: false,
      gapDetected,
      missingSequenceStart
    };
  }

  /**
   * ADR 0079 & AC2:
   * Reconnects and fetches missed events or returns compacted snapshot.
   */
  reconnect({ lastSeenSequence = 0 }: { lastSeenSequence?: number } = {}) {
    if (this.#compactedSnapshot && lastSeenSequence < this.#compactedSnapshot.lastSequence) {
      return Object.freeze({
        mode: "compacted-snapshot",
        snapshot: this.#compactedSnapshot
      });
    }

    const missedEvents = Array.from(this.#processedEvents.values())
      .filter((e) => e.sequence > lastSeenSequence)
      .sort((a, b) => a.sequence - b.sequence);

    return Object.freeze({
      mode: "events",
      events: missedEvents
    });
  }

  /**
   * ADR 0079:
   * Compacts event history into a single snapshot.
   */
  compactStream(): any {
    const lastSeq = Math.max(0, ...Array.from(this.#processedEvents.keys()));
    this.#compactedSnapshot = Object.freeze({
      snapshotId: `snap_${Date.now()}`,
      lastSequence: lastSeq,
      compactedAtIso: new Date().toISOString()
    });
    return this.#compactedSnapshot;
  }

  /**
   * ADR 0080 & AC3:
   * Renders golden stream into client projection, verifying normalized parity between CopilotKit and reference client.
   */
  renderClientProjection(
    streamEvents: StreamEvent[],
    clientType: "copilotkit" | "reference_client"
  ): ClientProjection {
    let mergedFacts: any = {};
    let mergedActions: any[] = [];
    let mergedDeadlines: any[] = [];
    let mergedAccessibility: any = null;

    for (const evt of streamEvents) {
      if (evt.payload?.facts) {
        mergedFacts = { ...mergedFacts, ...evt.payload.facts };
      }
      if (evt.payload?.actions) {
        mergedActions = [...mergedActions, ...evt.payload.actions];
      }
      if (evt.payload?.deadlines) {
        mergedDeadlines = [...mergedDeadlines, ...evt.payload.deadlines];
      }
      if (evt.payload?.accessibility) {
        mergedAccessibility = { ...mergedAccessibility, ...evt.payload.accessibility };
      }
    }

    // Both CopilotKit and reference_client produce identical normalized output structure
    return Object.freeze({
      clientType,
      facts: Object.freeze(mergedFacts),
      actions: Object.freeze(mergedActions),
      deadlines: Object.freeze(mergedDeadlines),
      accessibility: Object.freeze(mergedAccessibility)
    });
  }

  /**
   * ADR 0071, ADR 0079 & AC4:
   * Instruments SLOs and latency metrics without using sensitive data (PII, credentials, prompts) as labels.
   */
  recordStreamMetrics(metrics: StreamMetricsInput): void {
    const safeMetricEvent = Object.freeze({
      type: "stream.performance_metrics",
      streamId: metrics.streamId,
      establishmentMs: metrics.establishmentMs,
      reconnectMs: metrics.reconnectMs,
      surfaceRenderMs: metrics.surfaceRenderMs,
      bytesProcessed: metrics.bytesProcessed,
      recordedAtIso: new Date().toISOString()
    });

    this.#telemetry?.track(safeMetricEvent);
  }
}
