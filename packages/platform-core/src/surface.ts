export const APPROVED_CATALOGUES: readonly string[] = Object.freeze([
  "common/v1",
  "discovery/v1",
  "booking/v1",
  "incident/v1",
  "operator/v1"
]);

export interface CreateSurfaceOptions {
  catalogue: string;
  projectionVersion?: number;
  facts?: any;
  workflowState?: any;
  textFallback?: string;
  conventionalRoute?: string;
}

export class GenerativeSurfaceManager {
  #surfaces = new Map<string, any>();

  #validateCatalogue(catalogue: string) {
    if (!APPROVED_CATALOGUES.includes(catalogue)) {
      throw new Error(`Unsupported catalogue: ${catalogue}`);
    }
  }

  createSurface({ catalogue, projectionVersion = 1, facts = {}, workflowState = {}, textFallback = "", conventionalRoute = "" }: CreateSurfaceOptions) {
    this.#validateCatalogue(catalogue);

    const surfaceId = `surf-${crypto.randomUUID()}`;
    const surface = {
      surfaceId,
      catalogue,
      revision: projectionVersion,
      status: "active",
      facts: Object.freeze({ ...facts }),
      workflowState: Object.freeze({ ...workflowState }),
      textFallback,
      conventionalRoute,
      isFallback: false
    };
    this.#surfaces.set(surfaceId, surface);
    return { ...surface };
  }

  renderWithFallback({ catalogue, projectionVersion = 1, workflowState = {}, textFallback = "", conventionalRoute = "" }: CreateSurfaceOptions) {
    this.#validateCatalogue(catalogue);

    const surfaceId = `surf-${crypto.randomUUID()}`;
    const surface = {
      surfaceId,
      catalogue,
      revision: projectionVersion,
      status: "active",
      facts: Object.freeze({}),
      workflowState: Object.freeze({ ...workflowState }),
      textFallback,
      conventionalRoute,
      isFallback: true
    };
    this.#surfaces.set(surfaceId, surface);
    return { ...surface };
  }

  getSurface(surfaceId: string) {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) throw new Error(`Surface not found: ${surfaceId}`);
    return { ...surface };
  }

  updateSurfaceProjection(surfaceId: string, { projectionVersion, facts = {} }: { projectionVersion: number; facts?: any }) {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) throw new Error(`Surface not found: ${surfaceId}`);

    if (projectionVersion < surface.revision) {
      surface.status = "stale";
    } else {
      surface.revision = projectionVersion;
      surface.facts = Object.freeze({ ...facts });
    }
  }

  expireSurface(surfaceId: string) {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) throw new Error(`Surface not found: ${surfaceId}`);
    surface.status = "expired";
  }

  executeSurfaceAction(surfaceId: string, { actionName, payload = {} }: { actionName: string; payload?: any }) {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) throw new Error(`Surface not found: ${surfaceId}`);

    if (surface.status !== "active") {
      throw new Error(`Action authority revoked: surface is ${surface.status}`);
    }

    return {
      success: true,
      surfaceId,
      actionName,
      payload,
      executedAt: new Date().toISOString()
    };
  }
}

export interface RecordedSurfaceCreatedEvent {
  readonly type: "surface.created";
  readonly surfaceId: string;
  readonly catalogue: string;
  readonly revision: number;
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface RecordedSurfaceUpdatedEvent {
  readonly type: "surface.updated";
  readonly surfaceId: string;
  readonly revision: number;
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface RecordedSurfaceExpiredEvent {
  readonly type: "surface.expired";
  readonly surfaceId: string;
}

export type RecordedSurfaceEvent =
  | RecordedSurfaceCreatedEvent
  | RecordedSurfaceUpdatedEvent
  | RecordedSurfaceExpiredEvent;

export interface RecordedSurfaceProjection {
  readonly surfaceId: string;
  readonly catalogue: string;
  readonly revision: number;
  readonly status: "active" | "stale" | "expired";
  readonly facts: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecordedSurfaceCreatedEvent(
  event: unknown
): event is RecordedSurfaceCreatedEvent {
  return isRecord(event)
    && event.type === "surface.created"
    && isNonEmptyString(event.surfaceId)
    && isNonEmptyString(event.catalogue)
    && isNonNegativeInteger(event.revision)
    && isRecord(event.facts);
}

function isRecordedSurfaceUpdatedEvent(
  event: unknown
): event is RecordedSurfaceUpdatedEvent {
  return isRecord(event)
    && event.type === "surface.updated"
    && isNonEmptyString(event.surfaceId)
    && isNonNegativeInteger(event.revision)
    && isRecord(event.facts);
}

function isRecordedSurfaceExpiredEvent(
  event: unknown
): event is RecordedSurfaceExpiredEvent {
  return isRecord(event)
    && event.type === "surface.expired"
    && isNonEmptyString(event.surfaceId);
}

export class RecordedSurfaceProjector {
  renderRecordedStream(
    events: readonly unknown[]
  ): RecordedSurfaceProjection | null {
    let normalized: RecordedSurfaceProjection | null = null;
    for (const event of events) {
      if (isRecordedSurfaceCreatedEvent(event)) {
        normalized = {
          surfaceId: event.surfaceId,
          catalogue: event.catalogue,
          revision: event.revision,
          status: "active",
          facts: { ...event.facts }
        };
      } else if (isRecordedSurfaceUpdatedEvent(event)) {
        const current = normalized as RecordedSurfaceProjection | null;
        if (!current || current.surfaceId !== event.surfaceId) {
          continue;
        }
        if (event.revision < current.revision) {
          normalized = {
            surfaceId: current.surfaceId,
            catalogue: current.catalogue,
            revision: current.revision,
            status: "stale",
            facts: current.facts
          };
        } else {
          normalized = {
            surfaceId: current.surfaceId,
            catalogue: current.catalogue,
            revision: event.revision,
            status: current.status,
            facts: { ...event.facts }
          };
        }
      } else if (isRecordedSurfaceExpiredEvent(event)) {
        const current = normalized as RecordedSurfaceProjection | null;
        if (!current || current.surfaceId !== event.surfaceId) {
          continue;
        }
        normalized = {
          surfaceId: current.surfaceId,
          catalogue: current.catalogue,
          revision: current.revision,
          status: "expired",
          facts: current.facts
        };
      }
    }
    return normalized;
  }
}

// Temporary compatibility export for the former platform-core API name.
export { RecordedSurfaceProjector as IndependentReferenceClient };
