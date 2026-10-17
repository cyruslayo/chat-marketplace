import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { GuestConductApplication } from "./guest-conduct-application.js";
import type { GuestConductArtifact } from "./guest-conduct-artifact.js";
export const GUEST_CONDUCT_APPLY_REVIEWED_EVENT = "shortlet.guest-conduct.apply-reviewed-decision";
export const GUEST_CONDUCT_REQUEST_SUPPORT_EVENT = "shortlet.guest-conduct.request-human-support";
type GuestConductActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type GuestConductActionResult = { readonly ok: true; readonly artifact: GuestConductArtifact } | { readonly ok: false; readonly code: GuestConductActionRejectionCode; readonly message: string };
interface GuestConductContext {
  readonly artifactId: string;
  readonly reservationId: string;
  readonly projectionVersion: string;
  readonly allegationId?: string;
  readonly expectedAllegationVersion?: number;
  readonly ruleVersion?: string;
  readonly evidenceVersion?: string;
}

const STALE_MESSAGE = "The conduct action is stale; refresh the current matter.";
const RUN_REJECTED_MESSAGE = "The conduct action was rejected.";
const staleAwareCode = (error: unknown): GuestConductActionRejectionCode => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED");

const baseRequired: ActionSpec<GuestConductContext, GuestConductArtifact, unknown>["context"]["required"] = {
  artifactId: { type: "string" },
  reservationId: { type: "string" },
  projectionVersion: { type: "string" },
};

function guestConductSpec(
  name: typeof GUEST_CONDUCT_APPLY_REVIEWED_EVENT | typeof GUEST_CONDUCT_REQUEST_SUPPORT_EVENT,
  application: GuestConductApplication,
  required: ActionSpec<GuestConductContext, GuestConductArtifact, unknown>["context"]["required"],
): ActionSpec<GuestConductContext, GuestConductArtifact, unknown> {
  return {
    name,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: RUN_REJECTED_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: {
      required,
      optional: {
        allegationId: { type: "string" },
        expectedAllegationVersion: { type: "number" },
        ruleVersion: { type: "string" },
        evidenceVersion: { type: "string" },
      },
    },
    expect: [
      { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: () => true,
    run: ({ context, principal }) => {
      if (name === GUEST_CONDUCT_REQUEST_SUPPORT_EVENT) return application.requestHumanSupport(context.reservationId, principal);
      return application.applyReviewedDecision({
        reservationId: context.reservationId,
        allegationId: context.allegationId!,
        expectedAllegationVersion: context.expectedAllegationVersion!,
        ruleVersion: context.ruleVersion!,
        evidenceVersion: context.evidenceVersion!,
        principal,
      });
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

export function resolveGuestConductServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: GuestConductApplication; readonly principal: CommandPrincipal }): GuestConductActionResult {
  const reviewedRequired: ActionSpec<GuestConductContext, GuestConductArtifact, unknown>["context"]["required"] = {
    ...baseRequired,
    allegationId: { type: "string", nonEmpty: true },
    expectedAllegationVersion: { type: "number" },
    ruleVersion: { type: "string", nonEmpty: true },
    evidenceVersion: { type: "string", nonEmpty: true },
  };
  const specs = [
    guestConductSpec(GUEST_CONDUCT_REQUEST_SUPPORT_EVENT, input.application, baseRequired),
    guestConductSpec(GUEST_CONDUCT_APPLY_REVIEWED_EVENT, input.application, reviewedRequired),
  ];
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as GuestConductActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
