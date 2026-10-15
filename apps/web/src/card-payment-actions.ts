import type { WebServerEventHandoff } from "@weaver/web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import { CARD_PAYMENT_ARTIFACT_KIND, CARD_PAYMENT_SCHEMA_VERSION, type CardPaymentArtifact } from "./card-payment-artifact.js";
import type { CardPaymentApplication } from "./card-payment-application.js";

export const CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT = "shortlet.card-payment.initialize-checkout";
export const CARD_PAYMENT_VERIFY_RETURN_EVENT = "shortlet.card-payment.verify-return";

type Context = {
  readonly artifactId: string;
  readonly offerId: string;
  readonly expectedStatus: string;
  readonly expectedPurpose?: string;
  readonly expectedJourneyVersion?: number;
  readonly expectedStage?: string;
  readonly depositPolicyVersion?: string;
  readonly projectionVersion: number;
};
export type CardPaymentServerEventRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "OFFER_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type CardPaymentServerEventResult = { readonly ok: true; readonly artifact: CardPaymentArtifact } | { readonly ok: false; readonly code: CardPaymentServerEventRejectionCode; readonly message: string };

const STALE_MESSAGE = "The action is stale; refresh payment.";
const RUN_REJECTED_MESSAGE = "The payment action was rejected.";

/** The card-payment initialize-checkout action, declared for the platform gate (ADR 0072/0099). */
export function cardPaymentInitializeCheckoutSpec(application: CardPaymentApplication): ActionSpec<Context, CardPaymentArtifact, { readonly offerId: string }> {
  return {
    name: CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT,
    artifact: {
      kind: CARD_PAYMENT_ARTIFACT_KIND,
      schemaVersion: CARD_PAYMENT_SCHEMA_VERSION,
      load: (context, principal) => application.getArtifact(context.offerId, principal),
    },
    context: {
      required: {
        artifactId: { type: "string", nonEmpty: true },
        offerId: { type: "string", nonEmpty: true },
        expectedStatus: { type: "string" },
        projectionVersion: { type: "integer" },
      },
      optional: {
        expectedPurpose: { type: "string" },
        expectedJourneyVersion: { type: "number" },
        expectedStage: { type: "string" },
        depositPolicyVersion: { type: "string" },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the payment artifact." }
        : context.offerId !== artifact.facts.offerId
          ? { code: "OFFER_MISMATCH", message: "The action does not match the offer." }
          : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.status },
      { expected: (context) => context.expectedPurpose, actual: (artifact) => artifact.actions[0]?.expectedPurpose ?? "stay" },
      { expected: (context) => context.expectedJourneyVersion, actual: (artifact) => artifact.facts.journeyVersion ?? 1 },
      { expected: (context) => context.expectedStage, actual: (artifact) => artifact.facts.journeyStage ?? artifact.facts.status },
      { expected: (context) => context.depositPolicyVersion, actual: (artifact) => artifact.facts.depositPolicyVersion ?? "" },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((action) => action.type === "initialize_checkout"),
    command: (context) => ({ commandName: "card_payment.initialize_checkout", payload: { offerId: context.offerId } }),
    run: ({ context, principal, envelope }) => {
      application.initializeCheckoutFromCommand(envelope!);
      return application.getArtifact(context.offerId, principal);
    },
    rejectionMessages: { stale: STALE_MESSAGE, runRejected: RUN_REJECTED_MESSAGE },
  };
}

export function resolveCardPaymentServerEvent({ event, application, principal }: { readonly event: WebServerEventHandoff; readonly application: CardPaymentApplication; readonly principal: CommandPrincipal }): CardPaymentServerEventResult {
  const outcome = resolveAction(event, [cardPaymentInitializeCheckoutSpec(application)], principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as CardPaymentServerEventRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}
