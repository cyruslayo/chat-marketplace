import type { WebServerEventHandoff } from "@weaver/web";

const VIEW_UNIT_ACTION_NAME = "shortlet.discovery.view-unit";
const DISCOVERY_ARTIFACT_KIND = "shortlet.discovery-results";
const DISCOVERY_SCHEMA_VERSION = "shortlet.discovery/v1";
const APPLICATION_BASE_ORIGIN = "https://app.example";

export interface AuthoritativeDiscoveryAction {
  readonly type: "view-unit";
  readonly unitId: string;
  readonly conventionalRoute: string;
}

export interface AuthoritativeDiscoveryArtifact {
  readonly id: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly projectionVersion: number;
  readonly actions: readonly AuthoritativeDiscoveryAction[];
}

export interface DiscoveryRouteEffect {
  readonly kind: "open-conventional-route";
  readonly route: string;
  readonly artifactId: string;
  readonly unitId: string;
}

export type DiscoveryServerEventRejectionCode =
  | "UNSUPPORTED_ACTION"
  | "INVALID_CONTEXT"
  | "ARTIFACT_MISMATCH"
  | "INVALID_ARTIFACT"
  | "ACTION_NOT_AUTHORIZED"
  | "INVALID_ROUTE";

export interface DiscoveryServerEventRejection {
  readonly ok: false;
  readonly code: DiscoveryServerEventRejectionCode;
  readonly message: string;
}

export interface DiscoveryServerEventSuccess {
  readonly ok: true;
  readonly effect: DiscoveryRouteEffect;
}

export type DiscoveryServerEventResult = DiscoveryServerEventSuccess | DiscoveryServerEventRejection;

export interface ResolveDiscoveryServerEventInput {
  readonly event: WebServerEventHandoff;
  readonly artifact: AuthoritativeDiscoveryArtifact;
}

interface DiscoveryActionContext {
  readonly artifactId: string;
  readonly unitId: string;
}

function reject(code: DiscoveryServerEventRejectionCode, message: string): DiscoveryServerEventRejection {
  return { ok: false, code, message };
}

function readContext(event: WebServerEventHandoff): DiscoveryActionContext | undefined {
  const context: unknown = event?.message?.action?.context;
  if (context === null || typeof context !== "object" || Array.isArray(context)) return undefined;
  const keys = Object.keys(context);
  if (keys.length !== 2 || !keys.includes("artifactId") || !keys.includes("unitId")) return undefined;
  if (!("artifactId" in context) || !("unitId" in context)) return undefined;
  if (typeof context.artifactId !== "string" || context.artifactId.trim() === "") return undefined;
  if (typeof context.unitId !== "string" || context.unitId.trim() === "") return undefined;
  return { artifactId: context.artifactId, unitId: context.unitId };
}

function isValidArtifactIdentity(artifact: AuthoritativeDiscoveryArtifact): boolean {
  return typeof artifact.id === "string"
    && artifact.id.trim() !== ""
    && artifact.kind === DISCOVERY_ARTIFACT_KIND
    && artifact.schemaVersion === DISCOVERY_SCHEMA_VERSION
    && Number.isInteger(artifact.projectionVersion)
    && artifact.projectionVersion >= 0
    && Array.isArray(artifact.actions);
}

function isSafeConventionalRoute(route: string, unitId: string): boolean {
  if (route.trim() === "" || !route.startsWith("/") || route.startsWith("//")) return false;

  try {
    const parsedRoute = new URL(route, APPLICATION_BASE_ORIGIN);
    const expectedPathname = `/stays/${encodeURIComponent(unitId)}`;
    return parsedRoute.origin === APPLICATION_BASE_ORIGIN
      && parsedRoute.pathname === expectedPathname;
  } catch {
    return false;
  }
}

export function resolveDiscoveryServerEvent({
  event,
  artifact,
}: ResolveDiscoveryServerEventInput): DiscoveryServerEventResult {
  if (event?.message?.action?.name !== VIEW_UNIT_ACTION_NAME) {
    return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  }

  const context = readContext(event);
  if (context === undefined) {
    return reject("INVALID_CONTEXT", "The action context is invalid.");
  }
  if (!isValidArtifactIdentity(artifact)) {
    return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  }
  if (context.artifactId !== artifact.id) {
    return reject("ARTIFACT_MISMATCH", "The action does not match the authoritative artifact.");
  }

  const action = artifact.actions.find((candidate) =>
    candidate.type === "view-unit" && candidate.unitId === context.unitId
  );
  if (action === undefined) {
    return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  }
  if (typeof action.conventionalRoute !== "string" || !isSafeConventionalRoute(action.conventionalRoute, action.unitId)) {
    return reject("INVALID_ROUTE", "The authoritative route is invalid.");
  }

  return {
    ok: true,
    effect: {
      kind: "open-conventional-route",
      route: action.conventionalRoute,
      artifactId: artifact.id,
      unitId: action.unitId,
    },
  };
}

export interface CreateDiscoveryServerEventHandlerOptions {
  readonly getArtifact: (artifactId: string) => AuthoritativeDiscoveryArtifact | undefined;
  readonly onEffect: (effect: DiscoveryRouteEffect) => void;
  readonly onRejected?: (rejection: DiscoveryServerEventRejection) => void;
}

export function createDiscoveryServerEventHandler({
  getArtifact,
  onEffect,
  onRejected,
}: CreateDiscoveryServerEventHandlerOptions): (event: WebServerEventHandoff) => void {
  return (event) => {
    if (event?.message?.action?.name !== VIEW_UNIT_ACTION_NAME) {
      onRejected?.(reject("UNSUPPORTED_ACTION", "The action is not supported."));
      return;
    }
    const context = readContext(event);
    if (context === undefined) {
      onRejected?.(reject("INVALID_CONTEXT", "The action context is invalid."));
      return;
    }
    const artifact = getArtifact(context.artifactId);
    if (artifact === undefined) {
      onRejected?.(reject("INVALID_ARTIFACT", "No authoritative artifact is available."));
      return;
    }
    const result = resolveDiscoveryServerEvent({ event, artifact });
    if (!result.ok) {
      onRejected?.(result);
      return;
    }
    onEffect(result.effect);
  };
}
