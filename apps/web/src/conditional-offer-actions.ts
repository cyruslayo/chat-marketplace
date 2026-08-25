import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import {
  CONDITIONAL_OFFER_ARTIFACT_KIND,
  CONDITIONAL_OFFER_SCHEMA_VERSION,
  type ConditionalOfferArtifact,
} from "./conditional-offer-artifact.js";
import { ConditionalOfferApplication } from "./conditional-offer-application.js";

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

function reject(code: ConditionalOfferServerEventRejectionCode, message: string): ConditionalOfferServerEventResult {
  return { ok: false, code, message };
}

function readContext(event: WebServerEventHandoff): ConditionalOfferActionContext | undefined {
  const context: unknown = event?.message?.action?.context;
  if (context === null || typeof context !== "object" || Array.isArray(context)) return undefined;
  const record = context as Record<string, unknown>;
  const required = ["artifactId", "offerId", "expectedStatus", "offerVersion", "projectionVersion", "confirmationToken"];
  const keys = Object.keys(record);
  if (keys.length !== required.length || !required.every((key) => keys.includes(key))) return undefined;
  if (typeof record.artifactId !== "string" || !record.artifactId || typeof record.offerId !== "string" || !record.offerId) return undefined;
  if (typeof record.expectedStatus !== "string" || typeof record.confirmationToken !== "string" || !record.confirmationToken) return undefined;
  if (typeof record.offerVersion !== "number" || !Number.isInteger(record.offerVersion) || typeof record.projectionVersion !== "number" || !Number.isInteger(record.projectionVersion)) return undefined;
  return record as unknown as ConditionalOfferActionContext;
}

function validArtifact(artifact: ConditionalOfferArtifact): boolean {
  return artifact.kind === CONDITIONAL_OFFER_ARTIFACT_KIND
    && artifact.schemaVersion === CONDITIONAL_OFFER_SCHEMA_VERSION
    && artifact.id === `conditional-offer:${artifact.facts.offerId}`
    && Number.isInteger(artifact.projectionVersion);
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
  if (event?.message?.action?.name !== CONDITIONAL_OFFER_ACCEPT_EVENT) return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  const context = readContext(event);
  if (!context) return reject("INVALID_CONTEXT", "The action context is invalid.");
  let artifact: ConditionalOfferArtifact;
  try {
    artifact = application.getArtifact(context.offerId, principal);
  } catch {
    return reject("INVALID_ARTIFACT", "No authoritative artifact is available.");
  }
  if (!validArtifact(artifact)) return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  if (context.artifactId !== artifact.id) return reject("ARTIFACT_MISMATCH", "The action does not match the authoritative artifact.");
  if (context.offerId !== artifact.facts.offerId) return reject("OFFER_MISMATCH", "The action does not match the Conditional Booking Offer.");
  if (context.expectedStatus !== artifact.facts.status || context.offerVersion !== artifact.facts.offerVersion || context.projectionVersion !== artifact.projectionVersion) {
    return reject("STALE_ACTION", "The action is stale; refresh the Conditional Booking Offer.");
  }
  const action = artifact.actions.find((candidate) => candidate.type === "accept");
  if (!action || action.confirmationToken !== context.confirmationToken) return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  try {
    application.accept({ offerId: context.offerId, confirmationToken: context.confirmationToken, expectedVersion: context.offerVersion, principal });
    return { ok: true, artifact: application.getArtifact(context.offerId, principal) };
  } catch {
    return reject("ACTION_NOT_AUTHORIZED", "The Conditional Booking Offer action was rejected.");
  }
}

export interface CreateConditionalOfferServerEventHandlerOptions {
  readonly application: ConditionalOfferApplication;
  readonly getPrincipal: () => CommandPrincipal;
  readonly onUpdated: (artifact: ConditionalOfferArtifact) => void;
  readonly onRejected?: (rejection: ConditionalOfferServerEventResult & { readonly ok: false }) => void;
}

export function createConditionalOfferServerEventHandler({ application, getPrincipal, onUpdated, onRejected }: CreateConditionalOfferServerEventHandlerOptions): (event: WebServerEventHandoff) => void {
  return (event) => {
    const principal = getPrincipal();
    const result = resolveConditionalOfferServerEvent({ event, application, principal });
    if (result.ok) onUpdated(result.artifact);
    else onRejected?.(result);
  };
}
