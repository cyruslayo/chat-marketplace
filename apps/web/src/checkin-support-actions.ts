import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { CheckInSupportApplication } from "./checkin-support-application.js";
import type { CheckInSupportArtifact } from "./checkin-support-artifact.js";

export const CHECK_IN_CONFIRM_ACCESS_EVENT = "shortlet.check-in.confirm-access";
export const CHECK_IN_REQUEST_SUPPORT_EVENT = "shortlet.check-in.request-support";
export const CHECK_IN_REPORT_PROBLEM_EVENT = "shortlet.check-in.report-problem";
type EventName = typeof CHECK_IN_CONFIRM_ACCESS_EVENT | typeof CHECK_IN_REQUEST_SUPPORT_EVENT | typeof CHECK_IN_REPORT_PROBLEM_EVENT;
export type CheckInActionResult = { readonly ok: true; readonly artifact: CheckInSupportArtifact } | { readonly ok: false; readonly code: "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED"; readonly message: string };
type Context = { readonly artifactId: string; readonly reservationId: string; readonly expectedStatus: string; readonly projectionVersion: string; readonly complaintCategory?: "access_failure" | "habitability_failure" | "substitution" | "safety_issue" | "authority_defect" };
function contextOf(event: WebServerEventHandoff): Context | undefined { const value: unknown = event?.message?.action?.context; if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const r = value as Record<string, unknown>; const keys = Object.keys(r); const required = ["artifactId", "reservationId", "expectedStatus", "projectionVersion"]; if (!required.every((key) => keys.includes(key)) || keys.some((key) => ![...required, "complaintCategory"].includes(key))) return undefined; if (typeof r.artifactId !== "string" || typeof r.reservationId !== "string" || typeof r.expectedStatus !== "string" || typeof r.projectionVersion !== "string") return undefined; return r as Context; }
function reject(code: CheckInActionResult extends infer _T ? "UNSUPPORTED_ACTION" | "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED" : never, message: string): CheckInActionResult { return { ok: false, code, message }; }
export function resolveCheckInSupportServerEvent(input: { readonly event: WebServerEventHandoff; readonly artifact: CheckInSupportArtifact; readonly application: CheckInSupportApplication; readonly principal: CommandPrincipal; readonly contract: { contractId: string; unitId: string } }): CheckInActionResult {
  const name = input.event?.message?.action?.name as EventName; if (![CHECK_IN_CONFIRM_ACCESS_EVENT, CHECK_IN_REQUEST_SUPPORT_EVENT, CHECK_IN_REPORT_PROBLEM_EVENT].includes(name)) return reject("UNSUPPORTED_ACTION", "The action is not supported.");
  const context = contextOf(input.event); if (!context) return reject("INVALID_CONTEXT", "The action context is invalid.");
  const current = input.application.getArtifact(context.reservationId, input.principal, input.contract);
  if (context.artifactId !== current.id || context.reservationId !== current.facts.reservationId || context.expectedStatus !== current.facts.accessStatus || context.projectionVersion !== current.projectionVersion) return reject("STALE_ACTION", "The check-in action is stale; refresh the current status.");
  const action: "confirm_access" | "request_human_support" | "report_access_problem" = name === CHECK_IN_CONFIRM_ACCESS_EVENT ? "confirm_access" : name === CHECK_IN_REQUEST_SUPPORT_EVENT ? "request_human_support" : "report_access_problem";
  if (!current.actions.some((candidate) => candidate.type === action)) return reject("ACTION_NOT_AUTHORIZED", "The requested action is not authorized.");
  try { if (action === "confirm_access") input.application.confirmGuestAccess(context.reservationId, input.principal); else if (action === "request_human_support") input.application.requestHumanSupport(context.reservationId, "access_failure", input.principal); else input.application.reportGuestCheckInProblem(context.reservationId, context.complaintCategory ?? "access_failure", input.principal); return { ok: true, artifact: input.application.getArtifact(context.reservationId, input.principal, input.contract) }; } catch { return reject("ACTION_NOT_AUTHORIZED", "The check-in action was rejected."); }
}
