import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal, SecurityContext } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { HumanHandoffApplication } from "./human-handoff-application.js";
import type { HumanHandoffArtifact } from "./human-handoff-artifact.js";
export const HUMAN_HANDOFF_STOP_EVENT = "platform.handoff.stop-current-run";
export const HUMAN_HANDOFF_REQUEST_EVENT = "platform.handoff.request-human";
type HumanHandoffActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type HumanHandoffActionResult = { readonly ok: true; readonly artifact: HumanHandoffArtifact } | { readonly ok: false; readonly code: HumanHandoffActionRejectionCode; readonly message: string };
type Context = { readonly artifactId: string; readonly threadId: string; readonly expectedMode: "automated"; readonly projectionVersion: string };

const STALE_MESSAGE = "The action is stale; refresh the current interaction.";
const AUTHORIZATION_MESSAGE = "The action is not authorized.";
const RUN_REJECTED_MESSAGE = "The action was rejected.";

function humanHandoffSpec(
  name: typeof HUMAN_HANDOFF_STOP_EVENT | typeof HUMAN_HANDOFF_REQUEST_EVENT,
  actionType: "stop_current_run" | "request_human_support",
  application: HumanHandoffApplication,
  securityContext: SecurityContext,
): ActionSpec<Context, HumanHandoffArtifact, unknown> {
  return {
    name,
    artifact: {
      load: (context) => application.getArtifact(context.threadId, securityContext),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
    },
    context: {
      required: {
        artifactId: { type: "string" },
        threadId: { type: "string" },
        expectedMode: { type: "string", enum: ["automated"] },
        projectionVersion: { type: "string" },
      },
    },
    expect: [
      { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
      { expected: (context) => context.threadId, actual: (artifact) => artifact.facts.threadId },
      { expected: (context) => context.expectedMode, actual: (artifact) => artifact.facts.mode },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((candidate) => candidate.type === actionType),
    authorizationRejected: { code: "ACTION_NOT_AUTHORIZED", message: AUTHORIZATION_MESSAGE },
    run: ({ context }) => (actionType === "stop_current_run" ? application.stopCurrentRun(context.threadId, securityContext) : application.requestHumanSupport(context.threadId, securityContext)),
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
  };
}

export function resolveHumanHandoffServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: HumanHandoffApplication; readonly context: SecurityContext }): HumanHandoffActionResult {
  const { application, context: securityContext } = input;
  // The gate's principal contract is CommandPrincipal; these platform handoff actions authenticate with a
  // SecurityContext, which the spec closes over. The synthesized principal is only what the gate checks against.
  const gatePrincipal: CommandPrincipal = { id: securityContext.principalId, role: "guest", tenantId: securityContext.tenantId };
  const specs = [
    humanHandoffSpec(HUMAN_HANDOFF_STOP_EVENT, "stop_current_run", application, securityContext),
    humanHandoffSpec(HUMAN_HANDOFF_REQUEST_EVENT, "request_human_support", application, securityContext),
  ];
  const outcome = resolveAction(input.event, specs, gatePrincipal);
  if (!outcome.ok) return { ok: false, code: outcome.code as HumanHandoffActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
