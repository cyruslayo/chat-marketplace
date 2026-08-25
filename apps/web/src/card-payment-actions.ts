import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { CARD_PAYMENT_ARTIFACT_KIND, CARD_PAYMENT_SCHEMA_VERSION, type CardPaymentArtifact } from "./card-payment-artifact.js";
import type { CardPaymentApplication } from "./card-payment-application.js";

export const CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT = "shortlet.card-payment.initialize-checkout";
type Context = { readonly artifactId: string; readonly offerId: string; readonly expectedStatus: string; readonly projectionVersion: number };
export type CardPaymentServerEventRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "OFFER_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type CardPaymentServerEventResult = { readonly ok: true; readonly artifact: CardPaymentArtifact } | { readonly ok: false; readonly code: CardPaymentServerEventRejectionCode; readonly message: string };

function contextOf(event: WebServerEventHandoff): Context | undefined {
  const value: unknown = event?.message?.action?.context;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || !["artifactId", "offerId", "expectedStatus", "projectionVersion"].every((key) => keys.includes(key))) return undefined;
  if (typeof record.artifactId !== "string" || !record.artifactId || typeof record.offerId !== "string" || !record.offerId || typeof record.expectedStatus !== "string" || typeof record.projectionVersion !== "number" || !Number.isInteger(record.projectionVersion)) return undefined;
  return record as unknown as Context;
}
function reject(code: CardPaymentServerEventRejectionCode, message: string): CardPaymentServerEventResult { return { ok: false, code, message }; }

export function resolveCardPaymentServerEvent({ event, application, principal }: { readonly event: WebServerEventHandoff; readonly application: CardPaymentApplication; readonly principal: CommandPrincipal }): CardPaymentServerEventResult {
  if (event?.message?.action?.name !== CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT) return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  const context = contextOf(event);
  if (!context) return reject("INVALID_CONTEXT", "The action context is invalid.");
  let current: CardPaymentArtifact;
  try { current = application.getArtifact(context.offerId, principal); } catch { return reject("INVALID_ARTIFACT", "No authoritative artifact is available."); }
  if (current.kind !== CARD_PAYMENT_ARTIFACT_KIND || current.schemaVersion !== CARD_PAYMENT_SCHEMA_VERSION) return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  if (context.artifactId !== current.id) return reject("ARTIFACT_MISMATCH", "The action does not match the payment artifact.");
  if (context.offerId !== current.facts.offerId) return reject("OFFER_MISMATCH", "The action does not match the offer.");
  if (context.expectedStatus !== current.facts.status || context.projectionVersion !== current.projectionVersion) return reject("STALE_ACTION", "The action is stale; refresh payment.");
  if (!current.actions.some((action) => action.type === "initialize_checkout")) return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  try { application.initializeCheckout(context.offerId, principal); return { ok: true, artifact: application.getArtifact(context.offerId, principal) }; } catch { return reject("ACTION_NOT_AUTHORIZED", "The payment action was rejected."); }
}
