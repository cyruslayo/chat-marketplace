import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { CancellationApplication } from "./cancellation-application.js";
import type { CancellationArtifact } from "./cancellation-artifact.js";

export const CANCELLATION_CANCEL_EVENT = "shortlet.cancellation.cancel" as const;
export const CANCELLATION_REVIEW_EVENT = "shortlet.cancellation.apply-reviewed" as const;
export const CANCELLATION_NO_SHOW_EVENT = "shortlet.cancellation.confirm-no-show" as const;
export type CancellationActionContext = Readonly<{ artifactId: string; reservationId: string; expectedReservationStatus: "confirmed"; expectedContractVersion: number; policyVersion: string; economicsVersion: string; arrivalVersion: string; projectionVersion: string; contactAttemptVersion?: string; decisionVersion?: string }>;
export type CancellationActionResult = { readonly ok: true; readonly artifact: CancellationArtifact } | { readonly ok: false; readonly code: "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED"; readonly message: string };
const EVENT_NAMES = [CANCELLATION_CANCEL_EVENT, CANCELLATION_REVIEW_EVENT, CANCELLATION_NO_SHOW_EVENT] as const;
function contextOf(event: WebServerEventHandoff): CancellationActionContext | undefined {
  const value: unknown = event?.message?.action?.context;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = ["artifactId", "reservationId", "expectedReservationStatus", "expectedContractVersion", "policyVersion", "economicsVersion", "arrivalVersion", "projectionVersion", "contactAttemptVersion", "decisionVersion"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return undefined;
  const required = ["artifactId", "reservationId", "expectedReservationStatus", "expectedContractVersion", "policyVersion", "economicsVersion", "arrivalVersion", "projectionVersion"];
  if (required.some((key) => !(key in record))) return undefined;
  if (typeof record.artifactId !== "string" || typeof record.reservationId !== "string" || record.expectedReservationStatus !== "confirmed" || typeof record.expectedContractVersion !== "number" || !Number.isInteger(record.expectedContractVersion) || typeof record.policyVersion !== "string" || typeof record.economicsVersion !== "string" || typeof record.arrivalVersion !== "string" || typeof record.projectionVersion !== "string") return undefined;
  if (record.contactAttemptVersion !== undefined && typeof record.contactAttemptVersion !== "string") return undefined;
  if (record.decisionVersion !== undefined && typeof record.decisionVersion !== "string") return undefined;
  return record as unknown as CancellationActionContext;
}
export function cancellationActionContext(action: { readonly artifactId: string; readonly reservationId: string; readonly expectedReservationStatus: "confirmed"; readonly expectedContractVersion: number; readonly policyVersion: string; readonly economicsVersion: string; readonly arrivalVersion: string; readonly projectionVersion: string; readonly contactAttemptVersion?: string; readonly decisionVersion?: string }): CancellationActionContext {
  return Object.freeze({ artifactId: action.artifactId, reservationId: action.reservationId, expectedReservationStatus: action.expectedReservationStatus, expectedContractVersion: action.expectedContractVersion, policyVersion: action.policyVersion, economicsVersion: action.economicsVersion, arrivalVersion: action.arrivalVersion, projectionVersion: action.projectionVersion, ...(action.contactAttemptVersion ? { contactAttemptVersion: action.contactAttemptVersion } : {}), ...(action.decisionVersion ? { decisionVersion: action.decisionVersion } : {}) });
}
export function resolveCancellationServerEvent(input: { readonly event: WebServerEventHandoff; readonly application: CancellationApplication; readonly principal: CommandPrincipal }): CancellationActionResult {
  const name = input.event?.message?.action?.name;
  if (!EVENT_NAMES.includes(name as typeof EVENT_NAMES[number])) return { ok: false, code: "UNSUPPORTED_ACTION", message: "The action is not supported." };
  const context = contextOf(input.event); if (!context) return { ok: false, code: "INVALID_CONTEXT", message: "The action context is invalid." };
  try {
    const current = input.application.getArtifact(context.reservationId, input.principal);
    const action = current.actions.find((candidate) => candidate.type === (name === CANCELLATION_CANCEL_EVENT ? "cancel_booking" : name === CANCELLATION_NO_SHOW_EVENT ? "confirm_no_show" : "apply_reviewed_cancellation"));
    if (current.id !== context.artifactId || current.facts.reservationId !== context.reservationId || current.facts.reservationStatus !== context.expectedReservationStatus || current.facts.contractVersion !== context.expectedContractVersion || current.facts.policy.version !== context.policyVersion || current.facts.economicsVersion !== context.economicsVersion || current.facts.arrivalVersion !== context.arrivalVersion || current.projectionVersion !== context.projectionVersion || !action || (name === CANCELLATION_NO_SHOW_EVENT && context.contactAttemptVersion !== current.facts.contactAttemptVersion)) return { ok: false, code: "STALE_ACTION", message: "The cancellation action is stale; refresh the current cancellation." };
    if (name === CANCELLATION_CANCEL_EVENT) return { ok: true, artifact: input.application.cancel(context.reservationId, input.principal, context) };
    if (name === CANCELLATION_NO_SHOW_EVENT) return { ok: true, artifact: input.application.confirmNoShow(context.reservationId, input.principal, context) };
    return { ok: true, artifact: input.application.processReviewedCancellation(context.reservationId, input.principal, context) };
  } catch (error) { return { ok: false, code: error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED", message: "The cancellation action was rejected." }; }
}
