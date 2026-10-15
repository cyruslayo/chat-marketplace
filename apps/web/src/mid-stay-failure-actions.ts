import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { MidStayFailureApplication } from "./mid-stay-failure-application.js";
import type { MidStayFailureArtifact } from "./mid-stay-failure-artifact.js";
import { midStayActionContext } from "./mid-stay-failure-artifact.js";
export const MID_STAY_REQUEST_SUPPORT_EVENT = "shortlet.mid-stay-failure.request-human-support";
export const MID_STAY_APPLY_REVIEWED_EVENT = "shortlet.mid-stay-failure.apply-reviewed";
export type MidStayActionContext = { readonly artifactId: string; readonly reservationId: string; readonly incidentId: string; readonly expectedIncidentVersion: number; readonly expectedContractVersion: number; readonly activeStayVersion: string; readonly evidenceVersion: string; readonly assessmentVersion: string; readonly cureVersion: string; readonly economicsVersion: string; readonly projectionVersion: string };
export type MidStayReviewedActionContext = MidStayActionContext & { readonly decisionVersion: string };
type MidStayContext = MidStayActionContext & { readonly decisionVersion?: string };
type MidStayActionRejectionCode = "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED" | "UNSUPPORTED_ACTION";
export type MidStayActionResult = { readonly ok: true; readonly artifact: MidStayFailureArtifact } | { readonly ok: false; readonly code: MidStayActionRejectionCode; readonly message: string };

const STALE_MESSAGE = "The action is stale; refresh the current incident.";
const AUTHORIZATION_MESSAGE = "The action is not authorized.";
const RUN_REJECTED_MESSAGE = "The action was rejected.";
const staleAwareCode = (error: unknown): MidStayActionRejectionCode => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED");

const baseContextSchema: ActionSpec<MidStayContext, MidStayFailureArtifact, unknown>["context"]["required"] = {
  artifactId: { type: "string", nonEmpty: true },
  reservationId: { type: "string", nonEmpty: true },
  incidentId: { type: "string", nonEmpty: true },
  expectedIncidentVersion: { type: "integer", min: 1 },
  expectedContractVersion: { type: "integer", min: 1 },
  activeStayVersion: { type: "string", nonEmpty: true },
  evidenceVersion: { type: "string", nonEmpty: true },
  assessmentVersion: { type: "string", nonEmpty: true },
  cureVersion: { type: "string", nonEmpty: true },
  economicsVersion: { type: "string", nonEmpty: true },
  projectionVersion: { type: "string", nonEmpty: true },
};

const baseExpect: ActionSpec<MidStayContext, MidStayFailureArtifact, unknown>["expect"] = [
  { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
  { expected: (context) => context.reservationId, actual: (artifact) => artifact.facts.reservationId },
  { expected: (context) => context.expectedContractVersion, actual: (artifact) => artifact.facts.contractVersion },
  { expected: (context) => context.activeStayVersion, actual: (artifact) => artifact.facts.activeStayVersion },
  { expected: (context) => context.economicsVersion, actual: (artifact) => artifact.facts.economicsVersion },
  { expected: (context) => context.incidentId, actual: (artifact) => artifact.facts.incident.incidentId },
  { expected: (context) => context.expectedIncidentVersion, actual: (artifact) => artifact.facts.incident.incidentVersion },
  { expected: (context) => context.evidenceVersion, actual: (artifact) => artifact.facts.incident.evidenceVersion },
  { expected: (context) => context.assessmentVersion, actual: (artifact) => artifact.facts.incident.assessmentVersion },
  { expected: (context) => context.cureVersion, actual: (artifact) => artifact.facts.incident.cureVersion },
  { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
];

function midStayRequestSupportSpec(application: MidStayFailureApplication): ActionSpec<MidStayContext, MidStayFailureArtifact, unknown> {
  return {
    name: MID_STAY_REQUEST_SUPPORT_EVENT,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: { required: baseContextSchema },
    expect: baseExpect,
    isAuthorized: (_context, artifact) => artifact.actions.some((candidate) => candidate.type === "request_human_support"),
    authorizationRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
    run: ({ context, principal }) => {
      application.requestHumanSupport(context.reservationId, principal, context as MidStayActionContext);
      return application.getArtifact(context.reservationId, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

function midStayApplyReviewedSpec(application: MidStayFailureApplication): ActionSpec<MidStayContext, MidStayFailureArtifact, unknown> {
  return {
    name: MID_STAY_APPLY_REVIEWED_EVENT,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: { required: { ...baseContextSchema, decisionVersion: { type: "string", nonEmpty: true } } },
    crossMatch: (context, artifact) => {
      const advertised = artifact.actions.find((candidate) => candidate.type === "apply_reviewed_decision");
      return advertised && advertised.decisionVersion === context.decisionVersion ? true : { code: "STALE_ACTION", message: STALE_MESSAGE };
    },
    expect: baseExpect,
    isAuthorized: (_context, artifact) => artifact.actions.some((candidate) => candidate.type === "apply_reviewed_decision"),
    authorizationRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
    run: ({ context, principal }) => {
      application.applyReviewedDecision(context.reservationId, principal, context as MidStayReviewedActionContext);
      return application.getArtifact(context.reservationId, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

export function resolveMidStayFailureServerEvent(input: { event: WebServerEventHandoff; application: MidStayFailureApplication; principal: CommandPrincipal }): MidStayActionResult {
  const specs = [midStayRequestSupportSpec(input.application), midStayApplyReviewedSpec(input.application)];
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as MidStayActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
export { midStayActionContext };
