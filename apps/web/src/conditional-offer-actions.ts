import type { WebServerEventHandoff } from "@cylayo/weaver-web";
import type { ActionSpec, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { resolveAction } from "../../../packages/platform-core/src/index.js";
import {
  CONDITIONAL_OFFER_ARTIFACT_KIND,
  CONDITIONAL_OFFER_SCHEMA_VERSION,
  type ConditionalOfferArtifact,
} from "./conditional-offer-artifact.js";
import { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { confirmationTokenDigest } from "../../../domains/shortlet/src/index.js";

export const CONDITIONAL_OFFER_ACCEPT_EVENT = "shortlet.conditional-offer.accept";

type ConditionalOfferActionContext = {
  readonly artifactId: string;
  readonly offerId: string;
  readonly expectedStatus: string;
  readonly offerVersion: number;
  readonly projectionVersion: number;
  readonly confirmationToken: string;
};
export type ConditionalOfferServerEventRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "OFFER_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type ConditionalOfferServerEventResult = { readonly ok: true; readonly artifact: ConditionalOfferArtifact } | { readonly ok: false; readonly code: ConditionalOfferServerEventRejectionCode; readonly message: string };

function conditionalOfferAcceptSpec(application: ConditionalOfferApplication): ActionSpec<ConditionalOfferActionContext, ConditionalOfferArtifact, { readonly offerId: string; readonly confirmationToken: string }> {
  return {
    name: CONDITIONAL_OFFER_ACCEPT_EVENT,
    artifact: {
      kind: CONDITIONAL_OFFER_ARTIFACT_KIND,
      schemaVersion: CONDITIONAL_OFFER_SCHEMA_VERSION,
      load: (context, principal) => application.getArtifact(context.offerId, principal),
      validate: (artifact) => artifact.id === `conditional-offer:${artifact.facts.offerId}` && Number.isInteger(artifact.projectionVersion),
    },
    context: {
      required: {
        artifactId: { type: "string", nonEmpty: true },
        offerId: { type: "string", nonEmpty: true },
        expectedStatus: { type: "string" },
        offerVersion: { type: "integer" },
        projectionVersion: { type: "integer" },
        confirmationToken: { type: "string", nonEmpty: true },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the authoritative artifact." }
        : context.offerId !== artifact.facts.offerId
          ? { code: "OFFER_MISMATCH", message: "The action does not match the Conditional Booking Offer." }
          : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.status },
      { expected: (context) => context.offerVersion, actual: (artifact) => artifact.facts.offerVersion },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    // ADR 0086 / ADR 0106: the presented token must match one of the offer's valid digests. A restored process holds
    // digests, not the plaintext of tokens already issued, so an equality check on the plaintext would fail closed for the live guest.
    isAuthorized: (context, artifact) => {
      const presented = confirmationTokenDigest(context.confirmationToken);
      return artifact.actions.some((candidate) => candidate.type === "accept" && candidate.confirmationTokenDigests?.includes(presented) === true);
    },
    command: (context) => ({ commandName: "conditional_offer.accept", payload: { offerId: context.offerId, confirmationToken: context.confirmationToken } }),
    run: ({ context, principal }) => {
      application.accept({ offerId: context.offerId, confirmationToken: context.confirmationToken, expectedVersion: context.offerVersion, principal });
      return application.getArtifact(context.offerId, principal);
    },
    rejectionMessages: { stale: "The action is stale; refresh the Conditional Booking Offer.", runRejected: "The Conditional Booking Offer action was rejected." },
  };
}

export function resolveConditionalOfferServerEvent({
  event,
  application,
  principal,
}: {
  readonly event: WebServerEventHandoff;
  readonly application: ConditionalOfferApplication;
  readonly principal: CommandPrincipal;
}): ConditionalOfferServerEventResult {
  const outcome = resolveAction(event, [conditionalOfferAcceptSpec(application)], principal);
  if (!outcome.ok) return { ok: false, code: outcome.code as ConditionalOfferServerEventRejectionCode, message: outcome.message };
  return { ok: true, artifact: outcome.artifact };
}

export interface CreateConditionalOfferServerEventHandlerOptions {
  readonly application: ConditionalOfferApplication;
  readonly getPrincipal: () => CommandPrincipal;
  readonly onUpdated: (artifact: ConditionalOfferArtifact) => void;
  readonly onRejected?: (rejection: ConditionalOfferServerEventResult & { readonly ok: false }) => void;
}

export function createConditionalOfferServerEventHandler({ application, getPrincipal, onUpdated, onRejected }: CreateConditionalOfferServerEventHandlerOptions): (event: WebServerEventHandoff) => void {
  const spec = conditionalOfferAcceptSpec(application);
  return (event) => {
    const result = resolveAction(event, [spec], getPrincipal());
    if (result.ok) onUpdated(result.artifact);
    else onRejected?.({ ok: false, code: result.code as ConditionalOfferServerEventRejectionCode, message: result.message });
  };
}
