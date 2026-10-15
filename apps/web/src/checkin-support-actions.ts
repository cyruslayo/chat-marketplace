import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { CheckInSupportApplication } from "./checkin-support-application.js";
import type { CheckInSupportArtifact } from "./checkin-support-artifact.js";

export const CHECK_IN_CONFIRM_ACCESS_EVENT = "shortlet.check-in.confirm-access";
export const CHECK_IN_REQUEST_SUPPORT_EVENT = "shortlet.check-in.request-support";
export const CHECK_IN_REPORT_PROBLEM_EVENT = "shortlet.check-in.report-problem";
type EventName = typeof CHECK_IN_CONFIRM_ACCESS_EVENT | typeof CHECK_IN_REQUEST_SUPPORT_EVENT | typeof CHECK_IN_REPORT_PROBLEM_EVENT;
type CheckInActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type CheckInActionResult = { readonly ok: true; readonly artifact: CheckInSupportArtifact } | { readonly ok: false; readonly code: CheckInActionRejectionCode; readonly message: string };
type Context = { readonly artifactId: string; readonly reservationId: string; readonly expectedStatus: string; readonly projectionVersion: string; readonly complaintCategory?: "access_failure" | "habitability_failure" | "substitution" | "safety_issue" | "authority_defect" };
export type CheckInSupportContract = { readonly contractId: string; readonly unitId: string };

const STALE_MESSAGE = "The check-in action is stale; refresh the current status.";

function checkInSupportSpec(
  name: EventName,
  actionType: "confirm_access" | "request_human_support" | "report_access_problem",
  application: CheckInSupportApplication,
  contract: CheckInSupportContract,
): ActionSpec<Context, CheckInSupportArtifact, unknown> {
  return {
    name,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal, contract),
    },
    context: {
      required: {
        artifactId: { type: "string" },
        reservationId: { type: "string" },
        expectedStatus: { type: "string" },
        projectionVersion: { type: "string" },
      },
      optional: {
        complaintCategory: { type: "string" },
      },
    },
    expect: [
      { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
      { expected: (context) => context.reservationId, actual: (artifact) => artifact.facts.reservationId },
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.accessStatus },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((candidate) => candidate.type === actionType),
    run: ({ context, principal }) => {
      if (actionType === "confirm_access") application.confirmGuestAccess(context.reservationId, principal);
      else if (actionType === "request_human_support") application.requestHumanSupport(context.reservationId, "access_failure", principal);
      else application.reportGuestCheckInProblem(context.reservationId, context.complaintCategory ?? "access_failure", principal);
      return application.getArtifact(context.reservationId, principal, contract);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: "The check-in action was rejected." },
  };
}

export function resolveCheckInSupportServerEvent(input: { readonly event: WebServerEventHandoff; readonly artifact: CheckInSupportArtifact; readonly application: CheckInSupportApplication; readonly principal: CommandPrincipal; readonly contract: CheckInSupportContract }): CheckInActionResult {
  const specs = [
    checkInSupportSpec(CHECK_IN_CONFIRM_ACCESS_EVENT, "confirm_access", input.application, input.contract),
    checkInSupportSpec(CHECK_IN_REQUEST_SUPPORT_EVENT, "request_human_support", input.application, input.contract),
    checkInSupportSpec(CHECK_IN_REPORT_PROBLEM_EVENT, "report_access_problem", input.application, input.contract),
  ];
  const outcome = resolveAction(input.event, specs, input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as CheckInActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
