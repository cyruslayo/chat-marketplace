import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { BANK_TRANSFER_ARTIFACT_KIND, BANK_TRANSFER_SCHEMA_VERSION, type BankTransferArtifact } from "./bank-transfer-artifact.js";
import type { BankTransferPaymentApplication } from "./bank-transfer-application.js";

export const BANK_TRANSFER_INITIALIZE_EVENT = "shortlet.bank-transfer.initialize";
type Context = { readonly artifactId: string; readonly offerId: string; readonly expectedStatus: string; readonly projectionVersion: number };
export type BankTransferActionRejectionCode = "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "INVALID_ARTIFACT" | "ARTIFACT_MISMATCH" | "OFFER_MISMATCH" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED";
export type BankTransferActionResult = { readonly ok: true; readonly artifact: BankTransferArtifact } | { readonly ok: false; readonly code: BankTransferActionRejectionCode; readonly message: string };
function reject(code: BankTransferActionRejectionCode, message: string): BankTransferActionResult { return { ok: false, code, message }; }
function contextOf(event: WebServerEventHandoff): Context | undefined { const value: unknown = event?.message?.action?.context; if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const r = value as Record<string, unknown>; if (Object.keys(r).length !== 4 || typeof r.artifactId !== "string" || typeof r.offerId !== "string" || typeof r.expectedStatus !== "string" || typeof r.projectionVersion !== "number" || !Number.isInteger(r.projectionVersion)) return undefined; return r as unknown as Context; }
export function resolveBankTransferServerEvent({ event, application, principal }: { readonly event: WebServerEventHandoff; readonly application: BankTransferPaymentApplication; readonly principal: CommandPrincipal }): BankTransferActionResult {
  if (event?.message?.action?.name !== BANK_TRANSFER_INITIALIZE_EVENT) return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  const context = contextOf(event); if (!context) return reject("INVALID_CONTEXT", "The action context is invalid.");
  let current: BankTransferArtifact; try { current = application.getArtifact(context.offerId, principal); } catch { return reject("INVALID_ARTIFACT", "No authoritative artifact is available."); }
  if (current.kind !== BANK_TRANSFER_ARTIFACT_KIND || current.schemaVersion !== BANK_TRANSFER_SCHEMA_VERSION) return reject("INVALID_ARTIFACT", "The authoritative artifact is invalid.");
  if (context.artifactId !== current.id) return reject("ARTIFACT_MISMATCH", "The action does not match the payment artifact.");
  if (context.offerId !== current.facts.offerId) return reject("OFFER_MISMATCH", "The action does not match the offer.");
  if (context.expectedStatus !== current.facts.status || context.projectionVersion !== current.projectionVersion) return reject("STALE_ACTION", "The action is stale; refresh payment.");
  if (!current.actions.some((a) => a.type === "initialize_transfer")) return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  try { application.initializeTransfer(context.offerId, principal); return { ok: true, artifact: application.getArtifact(context.offerId, principal) }; } catch { return reject("ACTION_NOT_AUTHORIZED", "The payment action was rejected."); }
}
