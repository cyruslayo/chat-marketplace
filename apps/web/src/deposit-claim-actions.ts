import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { DepositClaimApplication } from "./deposit-claim-application.js";
import { depositClaimArtifact, type DepositClaimArtifact, type DepositClaimActionType } from "./deposit-claim-artifact.js";
export const EVENTS = { accept: "shortlet.deposit-claim.accept", dispute: "shortlet.deposit-claim.dispute", "apply-reviewed-decision": "shortlet.deposit-claim.apply-reviewed-decision", "waive-appeal": "shortlet.deposit-claim.waive-appeal" } as const;
type DepositClaimActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type DepositClaimActionResult = { readonly ok: true; readonly artifact: DepositClaimArtifact } | { readonly ok: false; readonly code: DepositClaimActionRejectionCode; readonly message: string };
interface DepositClaimContext { readonly artifactId: string; readonly claimId: string; readonly expectedClaimVersion: number; readonly projectionVersion: string; readonly decisionId?: string; readonly decisionVersion?: string; readonly evidenceVersion?: string; readonly policyVersion?: string }

const STALE_MESSAGE = "The claim action is stale; refresh the claim.";
const RUN_REJECTED_MESSAGE = "The claim action was rejected.";
const staleAwareCode = (error: unknown): DepositClaimActionRejectionCode => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED");

function depositClaimSpec(type: DepositClaimActionType, application: DepositClaimApplication): ActionSpec<DepositClaimContext, DepositClaimArtifact, unknown> {
  const load = (context: DepositClaimContext, principal: CommandPrincipal): DepositClaimArtifact => {
    const current = application.getArtifact(context.claimId.replace(/^deposit-claim:/, ""), principal);
    return depositClaimArtifact(application, current.reservationId, principal);
  };
  return {
    name: EVENTS[type],
    artifact: {
      load,
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: RUN_REJECTED_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: {
      required: {
        artifactId: { type: "string" },
        claimId: { type: "string" },
        expectedClaimVersion: { type: "number" },
        projectionVersion: { type: "string" },
      },
      optional: {
        decisionId: { type: "string" },
        decisionVersion: { type: "string" },
        evidenceVersion: { type: "string" },
        policyVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) => {
      const action = artifact.actions.find((candidate) => candidate.type === type);
      if (!action || context.artifactId !== artifact.id || context.claimId !== artifact.id || context.expectedClaimVersion !== artifact.facts.claimVersion || context.projectionVersion !== artifact.projectionVersion) {
        return { code: "STALE_ACTION", message: STALE_MESSAGE };
      }
      if (
        type === "apply-reviewed-decision" &&
        (context.decisionId !== action.decisionId || context.decisionVersion !== action.decisionVersion || context.evidenceVersion !== action.evidenceVersion || context.policyVersion !== action.policyVersion)
      ) {
        return { code: "STALE_ACTION", message: STALE_MESSAGE };
      }
      return true;
    },
    expect: [],
    isAuthorized: () => true,
    run: ({ context, principal }) => {
      if (type === "accept") application.respond(context.claimId, principal, "accept");
      else if (type === "dispute") application.respond(context.claimId, principal, "dispute");
      else if (type === "waive-appeal") application.waiveAppeal(context.claimId, principal, { decisionId: context.decisionId ?? "", decisionVersion: context.decisionVersion ?? "" });
      else application.applyReviewedDecision(context.claimId, principal, { expectedClaimVersion: context.expectedClaimVersion, decisionId: context.decisionId ?? "", decisionVersion: context.decisionVersion ?? "", evidenceVersion: context.evidenceVersion ?? "", policyVersion: context.policyVersion ?? "" });
      return load(context, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

export function resolveDepositClaimServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: DepositClaimApplication; readonly principal: CommandPrincipal }): DepositClaimActionResult {
  const specs = (Object.keys(EVENTS) as DepositClaimActionType[]).map((type) => depositClaimSpec(type, input.application));
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as DepositClaimActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
