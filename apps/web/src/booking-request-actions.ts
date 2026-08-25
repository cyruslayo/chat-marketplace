import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  BOOKING_REQUEST_ARTIFACT_KIND,
  BOOKING_REQUEST_SCHEMA_VERSION,
  type BookingRequestArtifact,
} from "./booking-request-artifact.js";
import { BookingRequestApplication } from "./booking-request-application.js";

export const BOOKING_REQUEST_CONFIRM_EVENT = "shortlet.booking-request.confirm";
export const BOOKING_REQUEST_DECLINE_EVENT = "shortlet.booking-request.decline";

type BookingRequestEventName = typeof BOOKING_REQUEST_CONFIRM_EVENT | typeof BOOKING_REQUEST_DECLINE_EVENT;
export type BookingRequestServerEventRejectionCode =
  | "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH"
  | "REQUEST_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";

export interface BookingRequestServerEventRejection {
  readonly ok: false;
  readonly code: BookingRequestServerEventRejectionCode;
  readonly message: string;
}

export interface BookingRequestServerEventSuccess {
  readonly ok: true;
  readonly artifact: BookingRequestArtifact;
}

export type BookingRequestServerEventResult = BookingRequestServerEventSuccess | BookingRequestServerEventRejection;

interface BookingRequestActionContext {
  readonly artifactId: string;
  readonly requestId: string;
  readonly expectedStatus: string;
  readonly projectionVersion: number;
}

function reject(code: BookingRequestServerEventRejectionCode, message: string): BookingRequestServerEventRejection {
  return { ok: false, code, message };
}

function readContext(event: WebServerEventHandoff): BookingRequestActionContext | undefined {
  const context: unknown = event?.message?.action?.context;
  if (context === null || typeof context !== "object" || Array.isArray(context)) return undefined;
  const record = context as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || !keys.every((key) => ["artifactId", "requestId", "expectedStatus", "projectionVersion"].includes(key))) return undefined;
  if (typeof record.artifactId !== "string" || record.artifactId.trim() === "") return undefined;
  if (typeof record.requestId !== "string" || record.requestId.trim() === "") return undefined;
  if (typeof record.expectedStatus !== "string" || record.expectedStatus.trim() === "") return undefined;
  if (typeof record.projectionVersion !== "number" || !Number.isInteger(record.projectionVersion)) return undefined;
  return {
    artifactId: record.artifactId,
    requestId: record.requestId,
    expectedStatus: record.expectedStatus,
    projectionVersion: record.projectionVersion,
  };
}

function validArtifact(artifact: BookingRequestArtifact): boolean {
  return artifact.kind === BOOKING_REQUEST_ARTIFACT_KIND
    && artifact.schemaVersion === BOOKING_REQUEST_SCHEMA_VERSION
    && artifact.id === `booking-request:${artifact.facts.requestId}`
    && Number.isInteger(artifact.projectionVersion)
    && Array.isArray(artifact.actions);
}

export function resolveBookingRequestServerEvent({
  event,
  artifact,
  application,
  principal,
}: {
  readonly event: WebServerEventHandoff;
  readonly artifact: BookingRequestArtifact;
  readonly application: BookingRequestApplication;
  readonly principal: CommandPrincipal;
}): BookingRequestServerEventResult {
  const name = event?.message?.action?.name;
  if (name !== BOOKING_REQUEST_CONFIRM_EVENT && name !== BOOKING_REQUEST_DECLINE_EVENT) {
    return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  }
  const context = readContext(event);
  if (!context) return reject("INVALID_CONTEXT", "The action context is invalid.");
  if (!validArtifact(artifact)) return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  if (context.artifactId !== artifact.id) return reject("ARTIFACT_MISMATCH", "The action does not match the authoritative artifact.");
  if (context.requestId !== artifact.facts.requestId) return reject("REQUEST_MISMATCH", "The action does not match the Booking Request.");
  if (context.expectedStatus !== artifact.facts.status || context.projectionVersion !== artifact.projectionVersion) {
    return reject("STALE_ACTION", "The action is stale; refresh the Booking Request.");
  }
  const action = name === BOOKING_REQUEST_CONFIRM_EVENT ? "confirm" : "decline";
  if (!artifact.actions.some((candidate) => candidate.type === action && candidate.requestId === context.requestId)) {
    return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  }
  try {
    const result = action === "confirm"
      ? application.confirm({ ...context, action, principal })
      : application.decline({ ...context, action, principal });
    return { ok: true, artifact: application.getArtifact(result.requestId, principal) };
  } catch {
    return reject("ACTION_NOT_AUTHORIZED", "The Booking Request action was rejected.");
  }
}

export interface CreateBookingRequestServerEventHandlerOptions {
  readonly application: BookingRequestApplication;
  readonly getArtifact: (requestId: string, principal: CommandPrincipal) => BookingRequestArtifact;
  readonly getPrincipal: () => CommandPrincipal;
  readonly onUpdated: (artifact: BookingRequestArtifact) => void;
  readonly onRejected?: (rejection: BookingRequestServerEventRejection) => void;
}

export function createBookingRequestServerEventHandler({
  application,
  getArtifact,
  getPrincipal,
  onUpdated,
  onRejected,
}: CreateBookingRequestServerEventHandlerOptions): (event: WebServerEventHandoff) => void {
  return (event) => {
    const name = event?.message?.action?.name;
    if (name !== BOOKING_REQUEST_CONFIRM_EVENT && name !== BOOKING_REQUEST_DECLINE_EVENT) {
      onRejected?.(reject("UNSUPPORTED_ACTION", "The action is not supported."));
      return;
    }
    const context = readContext(event);
    if (!context) {
      onRejected?.(reject("INVALID_CONTEXT", "The action context is invalid."));
      return;
    }
    const principal = getPrincipal();
    let artifact: BookingRequestArtifact;
    try {
      artifact = getArtifact(context.requestId, principal);
    } catch {
      onRejected?.(reject("INVALID_ARTIFACT", "No authoritative artifact is available."));
      return;
    }
    const result = resolveBookingRequestServerEvent({ event, artifact, application, principal });
    if (!result.ok) {
      onRejected?.(result);
      return;
    }
    onUpdated(result.artifact);
  };
}
