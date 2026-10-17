import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { RelocationApplication } from "./relocation-application.js";
import type { RelocationArtifact, RelocationAction } from "./relocation-artifact.js";
export const CHOOSE_REFUND_EVENT = "shortlet.relocation.choose-refund";
export const CHOOSE_CANDIDATE_EVENT = "shortlet.relocation.choose-candidate";
type RelocationActionRejectionCode = "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED" | "UNSUPPORTED_ACTION";
export type RelocationActionResult = { readonly ok: true; readonly artifact: RelocationArtifact } | { readonly ok: false; readonly code: RelocationActionRejectionCode; readonly message: string };

interface RelocationContext {
  readonly artifactId: string;
  readonly reservationId: string;
  readonly caseId: string;
  readonly expectedCaseVersion: number;
  readonly expectedContractVersion: number;
  readonly eligibilityVersion: string;
  readonly remainingStayEconomicsVersion: string;
  readonly relocationPolicyVersion: string;
  readonly refundObligationVersion: string;
  readonly projectionVersion: string;
  readonly candidateSetVersion?: string;
  readonly candidateId?: string;
  readonly candidateVersion?: string;
  readonly termsVersion?: string;
  readonly comparabilityVersion?: string;
  readonly transportQuoteVersion?: string;
  readonly approvalVersion?: string;
  readonly availabilityVersion?: string;
}

const STALE_MESSAGE = "The action is stale.";
const REFRESH_MESSAGE = "Refresh the current remedy.";
const RUN_REJECTED_MESSAGE = "The action was rejected.";
const staleAwareCode = (error: unknown): RelocationActionRejectionCode => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED");

const baseRequired: ActionSpec<RelocationContext, RelocationArtifact, unknown>["context"]["required"] = {
  artifactId: { type: "string", nonEmpty: true },
  reservationId: { type: "string", nonEmpty: true },
  caseId: { type: "string", nonEmpty: true },
  expectedCaseVersion: { type: "integer", min: 1 },
  expectedContractVersion: { type: "integer", min: 1 },
  eligibilityVersion: { type: "string", nonEmpty: true },
  remainingStayEconomicsVersion: { type: "string", nonEmpty: true },
  relocationPolicyVersion: { type: "string", nonEmpty: true },
  refundObligationVersion: { type: "string", nonEmpty: true },
  projectionVersion: { type: "string", nonEmpty: true },
};

function relocationSpec(
  name: typeof CHOOSE_REFUND_EVENT | typeof CHOOSE_CANDIDATE_EVENT,
  candidate: boolean,
  application: RelocationApplication,
  required: ActionSpec<RelocationContext, RelocationArtifact, unknown>["context"]["required"],
): ActionSpec<RelocationContext, RelocationArtifact, unknown> {
  const actionType = candidate ? "choose_relocation_candidate" : "choose_refund";
  return {
    name,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: RUN_REJECTED_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: { required },
    crossMatch: (context, artifact) => {
      const advertised = artifact.actions.find((action) => action.type === actionType && (!candidate || action.candidateId === context.candidateId));
      if (!advertised) return { code: "STALE_ACTION", message: REFRESH_MESSAGE };
      return advertised.projectionVersion === context.projectionVersion ? true : { code: "STALE_ACTION", message: STALE_MESSAGE };
    },
    expect: [],
    isAuthorized: () => true,
    run: ({ context, principal }) =>
      candidate
        ? application.chooseRelocation(context.reservationId, principal, context as unknown as RelocationAction)
        : application.chooseRefund(context.reservationId, principal, context as unknown as RelocationAction),
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

export function resolveRelocationServerEvent(input: { event: WebServerEventHandoff; application: RelocationApplication; principal: CommandPrincipal }): RelocationActionResult {
  const candidateRequired: ActionSpec<RelocationContext, RelocationArtifact, unknown>["context"]["required"] = {
    ...baseRequired,
    candidateSetVersion: { type: "string", nonEmpty: true },
    candidateId: { type: "string", nonEmpty: true },
    candidateVersion: { type: "string", nonEmpty: true },
    termsVersion: { type: "string", nonEmpty: true },
    comparabilityVersion: { type: "string", nonEmpty: true },
    transportQuoteVersion: { type: "string", nonEmpty: true },
    approvalVersion: { type: "string", nonEmpty: true },
    availabilityVersion: { type: "string", nonEmpty: true },
  };
  const specs = [
    relocationSpec(CHOOSE_REFUND_EVENT, false, input.application, baseRequired),
    relocationSpec(CHOOSE_CANDIDATE_EVENT, true, input.application, candidateRequired),
  ];
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as RelocationActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
