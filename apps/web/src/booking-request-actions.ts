import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import {
  BOOKING_REQUEST_ARTIFACT_KIND,
  BOOKING_REQUEST_SCHEMA_VERSION,
  type BookingRequestArtifact,
} from "./booking-request-artifact.js";
import { BookingRequestApplication } from "./booking-request-application.js";

export const BOOKING_REQUEST_CONFIRM_EVENT = "shortlet.booking-request.confirm";
export const BOOKING_REQUEST_DECLINE_EVENT = "shortlet.booking-request.decline";

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

function bookingRequestSpec(
  name: typeof BOOKING_REQUEST_CONFIRM_EVENT | typeof BOOKING_REQUEST_DECLINE_EVENT,
  action: "confirm" | "decline",
  application: BookingRequestApplication,
  load: (context: BookingRequestActionContext, principal: CommandPrincipal) => BookingRequestArtifact,
): ActionSpec<BookingRequestActionContext, BookingRequestArtifact, { readonly requestId: string }> {
  return {
    name,
    artifact: {
      kind: BOOKING_REQUEST_ARTIFACT_KIND,
      schemaVersion: BOOKING_REQUEST_SCHEMA_VERSION,
      load,
      validate: (artifact) =>
        artifact.id === `booking-request:${artifact.facts.requestId}` &&
        Number.isInteger(artifact.projectionVersion) &&
        Array.isArray(artifact.actions),
    },
    context: {
      required: {
        artifactId: { type: "string", nonEmpty: true },
        requestId: { type: "string", nonEmpty: true },
        expectedStatus: { type: "string", nonEmpty: true },
        projectionVersion: { type: "integer" },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the authoritative artifact." }
        : context.requestId !== artifact.facts.requestId
          ? { code: "REQUEST_MISMATCH", message: "The action does not match the Booking Request." }
          : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.status },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (context, artifact) =>
      artifact.actions.some((candidate) => candidate.type === action && candidate.requestId === context.requestId),
    command: (context) => ({
      commandName: action === "confirm" ? "booking_request.confirm" : "booking_request.decline",
      payload: { requestId: context.requestId },
    }),
    run: ({ context, principal }) => {
      const result = action === "confirm"
        ? application.confirm({ ...context, action, principal })
        : application.decline({ ...context, action, principal });
      return application.getArtifact(result.requestId, principal);
    },
    rejectionMessages: { stale: "The action is stale; refresh the Booking Request.", runRejected: "The Booking Request action was rejected." },
  };
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
  const specs = [
    bookingRequestSpec(BOOKING_REQUEST_CONFIRM_EVENT, "confirm", application, () => artifact),
    bookingRequestSpec(BOOKING_REQUEST_DECLINE_EVENT, "decline", application, () => artifact),
  ];
  const outcome = resolveAction(event, specs, principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as BookingRequestServerEventRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
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
    const principal = getPrincipal();
    const load = (context: BookingRequestActionContext) => getArtifact(context.requestId, principal);
    const specs = [
      bookingRequestSpec(BOOKING_REQUEST_CONFIRM_EVENT, "confirm", application, load),
      bookingRequestSpec(BOOKING_REQUEST_DECLINE_EVENT, "decline", application, load),
    ];
    const outcome = resolveAction(event, specs, principal);
    if (!outcome.ok) {
      onRejected?.({ ok: false, code: outcome.code as BookingRequestServerEventRejectionCode, message: outcome.message });
      return;
    }
    onUpdated(outcome.artifact);
  };
}
