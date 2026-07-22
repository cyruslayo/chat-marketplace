export const AG_UI_PROFILE = Object.freeze({
  id: "ag-ui/0.0.57-shortlet-launch-v1",
  protocolVersion: "0.0.57",
  transport: "https-post-sse",
  artifactSchema: "shortlet.discovery/v1",
  allowedInboundMessageRoles: ["assistant"]
});

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
  profile: any;
  facts?: any;
  workflowState?: any;
  textFallback?: string;
  conventionalRoute?: string;
}

export class GenerativeSurfaceManager {
  #surfaces = new Map<string, any>();

  #validateProfileAndCatalogue(catalogue: string, profile: any) {
    if (!APPROVED_CATALOGUES.includes(catalogue)) {
      throw new Error(`Unsupported catalogue: ${catalogue}`);
    }
    if (!profile || profile.id !== AG_UI_PROFILE.id) {
      throw new Error(`Pinned interaction profile mismatch: expected ${AG_UI_PROFILE.id}`);
    }
  }

  createSurface({ catalogue, projectionVersion = 1, profile, facts = {}, workflowState = {}, textFallback = "", conventionalRoute = "" }: CreateSurfaceOptions) {
    this.#validateProfileAndCatalogue(catalogue, profile);

    const surfaceId = `surf-${crypto.randomUUID()}`;
    const surface = {
      surfaceId,
      catalogue,
      revision: projectionVersion,
      status: "active",
      profile: Object.freeze({ ...profile }),
      facts: Object.freeze({ ...facts }),
      workflowState: Object.freeze({ ...workflowState }),
      textFallback,
      conventionalRoute,
      isFallback: false
    };
    this.#surfaces.set(surfaceId, surface);
    return { ...surface };
  }

  renderWithFallback({ catalogue, projectionVersion = 1, profile, workflowState = {}, textFallback = "", conventionalRoute = "" }: CreateSurfaceOptions) {
    this.#validateProfileAndCatalogue(catalogue, profile);

    const surfaceId = `surf-${crypto.randomUUID()}`;
    const surface = {
      surfaceId,
      catalogue,
      revision: projectionVersion,
      status: "active",
      profile: Object.freeze({ ...profile }),
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

export class IndependentReferenceClient {
  renderRecordedStream(events: any[]) {
    let normalized: any = null;
    for (const event of events) {
      if (event.type === "surface.created") {
        normalized = {
          surfaceId: event.surfaceId,
          catalogue: event.catalogue,
          revision: event.revision,
          status: "active",
          facts: { ...event.facts }
        };
      } else if (event.type === "surface.updated" && normalized?.surfaceId === event.surfaceId) {
        if (event.revision < normalized.revision) {
          normalized.status = "stale";
        } else {
          normalized.revision = event.revision;
          normalized.facts = { ...event.facts };
        }
      } else if (event.type === "surface.expired" && normalized?.surfaceId === event.surfaceId) {
        normalized.status = "expired";
      }
    }
    return normalized;
  }
}
