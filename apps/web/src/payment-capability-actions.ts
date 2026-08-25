import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { PAYMENT_CAPABILITY_ARTIFACT_KIND, PAYMENT_CAPABILITY_SCHEMA_VERSION, type PaymentCapabilityArtifact } from "./payment-capability-artifact.js";
import type { PaymentCapabilityApplication } from "./payment-capability-application.js";
export const PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT = "shortlet.payment-capability.initialize-ussd";
export type PaymentCapabilityActionResult = { readonly ok: true; readonly artifact: PaymentCapabilityArtifact } | { readonly ok: false; readonly code: "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED"; readonly message: string };
function reject(code: Exclude<PaymentCapabilityActionResult, { ok: true }>["code"], message: string): PaymentCapabilityActionResult { return { ok: false, code, message }; }
export function resolvePaymentCapabilityServerEvent(input: { event: WebServerEventHandoff; application: PaymentCapabilityApplication; principal: CommandPrincipal }): PaymentCapabilityActionResult {
  if (input.event?.message?.action?.name !== PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT) return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  const value: unknown = input.event.message.action.context; if (!value || typeof value !== "object" || Array.isArray(value)) return reject("INVALID_CONTEXT", "The action context is invalid."); const context = value as Record<string, unknown>;
  const keys = Object.keys(context); const required = ["artifactId", "offerId", "capabilityId", "expectedStatus", "projectionVersion"];
  if (keys.length !== required.length || !required.every((k) => keys.includes(k)) || typeof context.artifactId !== "string" || typeof context.offerId !== "string" || typeof context.capabilityId !== "string" || typeof context.expectedStatus !== "string" || typeof context.projectionVersion !== "string") return reject("INVALID_CONTEXT", "The action context is invalid.");
  let current: PaymentCapabilityArtifact; try { current = input.application.getArtifact(context.offerId, input.principal); } catch { return reject("INVALID_ARTIFACT", "No authoritative artifact is available."); }
  if (current.kind !== PAYMENT_CAPABILITY_ARTIFACT_KIND || current.schemaVersion !== PAYMENT_CAPABILITY_SCHEMA_VERSION) return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  if (context.artifactId !== current.id || context.offerId !== current.facts.offerId || context.capabilityId !== current.actions[0]?.capabilityId) return reject("ARTIFACT_MISMATCH", "The action does not match the capability artifact.");
  if (context.expectedStatus !== "certified" || context.projectionVersion !== current.projectionVersion) return reject("STALE_ACTION", "The action is stale; refresh payment capabilities.");
  if (!current.actions.some((a) => a.type === "initialize_ussd")) return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  try { input.application.initializeUssd({ capabilityId: context.capabilityId, offerId: context.offerId, trustedPayerPrincipal: input.principal }); return { ok: true, artifact: input.application.getArtifact(context.offerId, input.principal) }; } catch { return reject("ACTION_NOT_AUTHORIZED", "The payment capability action was rejected."); }
}
