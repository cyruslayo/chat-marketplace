import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { CancellationApplication } from "./cancellation-application.js";
import type { CancellationArtifact } from "./cancellation-artifact.js";

export const CANCELLATION_CANCEL_EVENT = "shortlet.cancellation.cancel" as const;
export const CANCELLATION_REVIEW_EVENT = "shortlet.cancellation.apply-reviewed" as const;
export const CANCELLATION_NO_SHOW_EVENT = "shortlet.cancellation.confirm-no-show" as const;
export type CancellationActionContext = Readonly<{ artifactId: string; reservationId: string; expectedReservationStatus: "confirmed"; expectedContractVersion: number; policyVersion: string; economicsVersion: string; arrivalVersion: string; projectionVersion: string; contactAttemptVersion?: string; decisionVersion?: string }>;
export type CancellationActionResult = { readonly ok: true; readonly artifact: CancellationArtifact } | { readonly ok: false; readonly code: CancellationActionRejectionCode; readonly message: string };
type CancellationActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
type CancellationEventName = typeof CANCELLATION_CANCEL_EVENT | typeof CANCELLATION_REVIEW_EVENT | typeof CANCELLATION_NO_SHOW_EVENT;

const STALE_MESSAGE = "The cancellation action is stale; refresh the current cancellation.";
const RUN_REJECTED_MESSAGE = "The cancellation action was rejected.";

export function cancellationActionContext(action: { readonly artifactId: string; readonly reservationId: string; readonly expectedReservationStatus: "confirmed"; readonly expectedContractVersion: number; readonly policyVersion: string; readonly economicsVersion: string; readonly arrivalVersion: string; readonly projectionVersion: string; readonly contactAttemptVersion?: string; readonly decisionVersion?: string }): CancellationActionContext {
  return Object.freeze({ artifactId: action.artifactId, reservationId: action.reservationId, expectedReservationStatus: action.expectedReservationStatus, expectedContractVersion: action.expectedContractVersion, policyVersion: action.policyVersion, economicsVersion: action.economicsVersion, arrivalVersion: action.arrivalVersion, projectionVersion: action.projectionVersion, ...(action.contactAttemptVersion ? { contactAttemptVersion: action.contactAttemptVersion } : {}), ...(action.decisionVersion ? { decisionVersion: action.decisionVersion } : {}) });
}

function cancellationSpec(
  name: CancellationEventName,
  actionType: "cancel_booking" | "apply_reviewed_cancellation" | "confirm_no_show",
  application: CancellationApplication,
  expect: ActionSpec<CancellationActionContext, CancellationArtifact>["expect"],
  crossMatch?: ActionSpec<CancellationActionContext, CancellationArtifact>["crossMatch"],
): ActionSpec<CancellationActionContext, CancellationArtifact, { readonly reservationId: string }> {
  return {
    name,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: RUN_REJECTED_MESSAGE },
    },
    context: {
      required: {
        artifactId: { type: "string" },
        reservationId: { type: "string" },
        expectedReservationStatus: { type: "string", enum: ["confirmed"] },
        expectedContractVersion: { type: "integer" },
        policyVersion: { type: "string" },
        economicsVersion: { type: "string" },
        arrivalVersion: { type: "string" },
        projectionVersion: { type: "string" },
      },
      optional: {
        contactAttemptVersion: { type: "string" },
        decisionVersion: { type: "string" },
      },
    },
    ...(crossMatch ? { crossMatch } : {}),
    expect,
    isAuthorized: (_context, artifact) => artifact.actions.some((candidate) => candidate.type === actionType),
    authorizationRejected: { code: "STALE_ACTION", message: STALE_MESSAGE },
    command: (context) => ({ commandName: name, payload: { reservationId: context.reservationId } }),
    run: ({ context, principal }) => {
      if (actionType === "cancel_booking") return application.cancel(context.reservationId, principal, context);
      if (actionType === "confirm_no_show") return application.confirmNoShow(context.reservationId, principal, context);
      return application.processReviewedCancellation(context.reservationId, principal, context);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: (error) => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED"),
  };
}

const baseExpect: ActionSpec<CancellationActionContext, CancellationArtifact>["expect"] = [
  { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
  { expected: (context) => context.reservationId, actual: (artifact) => artifact.facts.reservationId },
  { expected: (context) => context.expectedReservationStatus, actual: (artifact) => artifact.facts.reservationStatus },
  { expected: (context) => context.expectedContractVersion, actual: (artifact) => artifact.facts.contractVersion },
  { expected: (context) => context.policyVersion, actual: (artifact) => artifact.facts.policy.version },
  { expected: (context) => context.economicsVersion, actual: (artifact) => artifact.facts.economicsVersion },
  { expected: (context) => context.arrivalVersion, actual: (artifact) => artifact.facts.arrivalVersion },
  { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
];

export function resolveCancellationServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: CancellationApplication; readonly principal: CommandPrincipal }): CancellationActionResult {
  const { application } = input;
  const specs = [
    cancellationSpec(CANCELLATION_CANCEL_EVENT, "cancel_booking", application, baseExpect),
    cancellationSpec(CANCELLATION_REVIEW_EVENT, "apply_reviewed_cancellation", application, baseExpect),
    cancellationSpec(
      CANCELLATION_NO_SHOW_EVENT,
      "confirm_no_show",
      application,
      baseExpect,
      (context, artifact) =>
        context.contactAttemptVersion !== artifact.facts.contactAttemptVersion
          ? { code: "STALE_ACTION", message: STALE_MESSAGE }
          : true,
    ),
  ];
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as CancellationActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
