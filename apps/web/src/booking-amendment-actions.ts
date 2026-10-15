import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { BookingAmendmentApplication } from "./booking-amendment-application.js";
import type { BookingAmendmentArtifact } from "./booking-amendment-artifact.js";

export const BOOKING_AMENDMENT_ACCEPT_EVENT = "shortlet.booking-amendment.accept";
export interface BookingAmendmentAcceptContext { readonly artifactId: string; readonly contractId: string; readonly amendmentId: string; readonly amendmentVersion: number; readonly expectedContractVersion: number; readonly quoteId: string; readonly quoteVersion: string | number; readonly projectionVersion: string; }
export type BookingAmendmentActionResult = { readonly ok: true; readonly artifact: BookingAmendmentArtifact } | { readonly ok: false; readonly code: BookingAmendmentAcceptRejectionCode; readonly message: string };
type BookingAmendmentAcceptRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
const keys = ["artifactId", "contractId", "amendmentId", "amendmentVersion", "expectedContractVersion", "quoteId", "quoteVersion", "projectionVersion"] as const;
export function isBookingAmendmentAcceptContext(value: unknown): value is BookingAmendmentAcceptContext { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const record = value as Record<string, unknown>; return keys.length === Object.keys(record).length && keys.every((key) => key in record) && typeof record.artifactId === "string" && typeof record.contractId === "string" && typeof record.amendmentId === "string" && typeof record.amendmentVersion === "number" && typeof record.expectedContractVersion === "number" && typeof record.quoteId === "string" && (typeof record.quoteVersion === "string" || typeof record.quoteVersion === "number") && typeof record.projectionVersion === "string"; }

const STALE_MESSAGE = "The amendment action is stale; refresh the current proposal.";

function bookingAmendmentAcceptSpec(application: BookingAmendmentApplication): ActionSpec<BookingAmendmentAcceptContext, BookingAmendmentArtifact, { readonly amendmentId: string }> {
  return {
    name: BOOKING_AMENDMENT_ACCEPT_EVENT,
    artifact: {
      load: (context, principal) => application.getArtifact(context.contractId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: "The action is not authorized." },
    },
    context: {
      required: {
        artifactId: { type: "string" },
        contractId: { type: "string" },
        amendmentId: { type: "string" },
        amendmentVersion: { type: "integer" },
        expectedContractVersion: { type: "integer" },
        quoteId: { type: "string" },
        quoteVersion: { type: "string-or-number" },
        projectionVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) => {
      const proposal = artifact.facts.proposal;
      if (
        !proposal ||
        context.artifactId !== artifact.id ||
        context.contractId !== artifact.facts.contractId ||
        context.amendmentId !== proposal.amendmentId ||
        context.amendmentVersion !== proposal.amendmentVersion ||
        context.quoteId !== proposal.quoteId ||
        String(context.quoteVersion) !== String(proposal.quoteVersion)
      ) {
        return { code: "STALE_ACTION", message: STALE_MESSAGE };
      }
      return true;
    },
    expect: [
      { expected: (context) => context.expectedContractVersion, actual: (artifact) => artifact.facts.currentContractVersion },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: () => true,
    command: (context) => ({ commandName: "booking_amendment.accept", payload: { amendmentId: context.amendmentId } }),
    run: ({ context, principal }) => {
      application.acceptAmendment(context.amendmentId, principal);
      return application.getArtifact(context.contractId, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: "The amendment action was rejected." },
    runRejectedCode: (error) => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED"),
  };
}

export function resolveBookingAmendmentServerEvent({ event, application, principal }: { readonly event: WebServerEventHandoff; readonly application: BookingAmendmentApplication; readonly principal: CommandPrincipal }): BookingAmendmentActionResult {
  const outcome = resolveAction(event, [bookingAmendmentAcceptSpec(application)], principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as BookingAmendmentAcceptRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
