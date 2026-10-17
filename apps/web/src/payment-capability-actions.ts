import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import { PAYMENT_CAPABILITY_ARTIFACT_KIND, PAYMENT_CAPABILITY_SCHEMA_VERSION, type PaymentCapabilityArtifact } from "./payment-capability-artifact.js";
import type { PaymentCapabilityApplication } from "./payment-capability-application.js";

export const PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT = "shortlet.payment-capability.initialize-ussd";
type PaymentCapabilityActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type PaymentCapabilityActionResult = { readonly ok: true; readonly artifact: PaymentCapabilityArtifact } | { readonly ok: false; readonly code: PaymentCapabilityActionRejectionCode; readonly message: string };

interface PaymentCapabilityActionContext {
  readonly artifactId: string;
  readonly offerId: string;
  readonly capabilityId: string;
  readonly expectedStatus: string;
  readonly projectionVersion: string;
}

function paymentCapabilitySpec(application: PaymentCapabilityApplication): ActionSpec<PaymentCapabilityActionContext, PaymentCapabilityArtifact, { readonly capabilityId: string; readonly offerId: string }> {
  return {
    name: PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT,
    artifact: {
      kind: PAYMENT_CAPABILITY_ARTIFACT_KIND,
      schemaVersion: PAYMENT_CAPABILITY_SCHEMA_VERSION,
      load: (context, principal) => application.getArtifact(context.offerId, principal),
    },
    context: {
      required: {
        artifactId: { type: "string" },
        offerId: { type: "string" },
        capabilityId: { type: "string" },
        expectedStatus: { type: "string" },
        projectionVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id || context.offerId !== artifact.facts.offerId || context.capabilityId !== artifact.actions[0]?.capabilityId
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the capability artifact." }
        : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: () => "certified" },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((action) => action.type === "initialize_ussd"),
    command: (context) => ({ commandName: "payment_capability.initialize_ussd", payload: { capabilityId: context.capabilityId, offerId: context.offerId } }),
    run: ({ context, principal }) => {
      application.initializeUssd({ capabilityId: context.capabilityId, offerId: context.offerId, trustedPayerPrincipal: principal });
      return application.getArtifact(context.offerId, principal);
    },
    rejectionMessages: { stale: "The action is stale; refresh payment capabilities.", runRejected: "The payment capability action was rejected." },
  };
}

export function resolvePaymentCapabilityServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: PaymentCapabilityApplication; readonly principal: CommandPrincipal }): PaymentCapabilityActionResult {
  const outcome = resolveAction(input.event, [paymentCapabilitySpec(input.application)], input.principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as PaymentCapabilityActionRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
