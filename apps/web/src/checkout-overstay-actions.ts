import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import type { CheckoutOverstayApplication } from "./checkout-overstay-application.js";
import type { CheckoutArtifact } from "./checkout-overstay-artifact.js";
export const CHECKOUT_ACCEPT_LATE_CHECKOUT_EVENT = "shortlet.checkout.accept-late-checkout";
type Context = { readonly artifactId: string; readonly reservationId: string; readonly requestedTime: "12:00" | "13:00" | "14:00"; readonly quoteId: string; readonly expectedCheckoutTime: string; readonly expectedTermVersion: string; readonly projectionVersion: string };
type CheckoutActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type CheckoutActionResult = { readonly ok: true; readonly artifact: CheckoutArtifact } | { readonly ok: false; readonly code: CheckoutActionRejectionCode; readonly message: string };

const STALE_MESSAGE = "The checkout action is stale; refresh the current checkout.";
const RUN_REJECTED_MESSAGE = "The checkout action was rejected.";
const staleAwareCode = (error: unknown): CheckoutActionRejectionCode => (error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED");

function checkoutAcceptLateCheckoutSpec(application: CheckoutOverstayApplication): ActionSpec<Context, CheckoutArtifact, unknown> {
  return {
    name: CHECKOUT_ACCEPT_LATE_CHECKOUT_EVENT,
    artifact: {
      load: (context, principal) => application.getArtifact(context.reservationId, principal),
      loadRejected: { code: "ACTION_NOT_AUTHORIZED", message: RUN_REJECTED_MESSAGE },
      loadRejectedCode: staleAwareCode,
    },
    context: {
      required: {
        artifactId: { type: "string" },
        reservationId: { type: "string" },
        requestedTime: { type: "string", pattern: "^(12|13|14):00$" },
        quoteId: { type: "string" },
        expectedCheckoutTime: { type: "string" },
        expectedTermVersion: { type: "string" },
        projectionVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) => {
      const action = artifact.actions.find((candidate) => candidate.requestedTime === context.requestedTime);
      return !action || action.quoteId !== context.quoteId ? { code: "STALE_ACTION", message: STALE_MESSAGE } : true;
    },
    expect: [
      { expected: (context) => context.artifactId, actual: (artifact) => artifact.id },
      { expected: (context) => context.reservationId, actual: (artifact) => artifact.facts.reservationId },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
      { expected: (context) => context.expectedCheckoutTime, actual: (artifact) => artifact.facts.effectiveCheckoutTime },
      { expected: (context) => context.expectedTermVersion, actual: (artifact) => artifact.facts.termVersion },
    ],
    isAuthorized: () => true,
    run: ({ context, principal }) => application.acceptLateCheckout(context.reservationId, context.requestedTime, principal, context),
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
    runRejectedCode: staleAwareCode,
  };
}

export function resolveCheckoutServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: CheckoutOverstayApplication; readonly principal: CommandPrincipal }): CheckoutActionResult {
  const outcome = resolveAction(input.event, [checkoutAcceptLateCheckoutSpec(input.application)], input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as CheckoutActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
