import type { WebServerEventHandoff } from "@weaver/web";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { MidStayFailureApplication } from "./mid-stay-failure-application.js";
import type { MidStayFailureArtifact } from "./mid-stay-failure-artifact.js";
import { midStayActionContext } from "./mid-stay-failure-artifact.js";
export const MID_STAY_REQUEST_SUPPORT_EVENT = "shortlet.mid-stay-failure.request-human-support";
export const MID_STAY_APPLY_REVIEWED_EVENT = "shortlet.mid-stay-failure.apply-reviewed";
export type MidStayActionContext = { readonly artifactId: string; readonly reservationId: string; readonly incidentId: string; readonly expectedIncidentVersion: number; readonly expectedContractVersion: number; readonly activeStayVersion: string; readonly evidenceVersion: string; readonly assessmentVersion: string; readonly cureVersion: string; readonly economicsVersion: string; readonly projectionVersion: string };
export type MidStayReviewedActionContext = MidStayActionContext & { readonly decisionVersion: string };
export type MidStayActionResult = { readonly ok: true; readonly artifact: MidStayFailureArtifact } | { readonly ok: false; readonly code: "INVALID_CONTEXT" | "STALE_ACTION" | "ACTION_NOT_AUTHORIZED" | "UNSUPPORTED_ACTION"; readonly message: string };
const baseKeys = ["artifactId", "reservationId", "incidentId", "expectedIncidentVersion", "expectedContractVersion", "activeStayVersion", "evidenceVersion", "assessmentVersion", "cureVersion", "economicsVersion", "projectionVersion"] as const;
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stringValue(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === "string" && value.length > 0 ? value : undefined; }
function integerValue(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined; }
function parseContext(event: WebServerEventHandoff, reviewed: boolean): MidStayActionContext | MidStayReviewedActionContext | undefined {
  const value: unknown = event?.message?.action?.context; if (!isRecord(value)) return undefined;
  const expected = reviewed ? [...baseKeys, "decisionVersion"] : [...baseKeys]; const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return undefined;
  const artifactId = stringValue(value, "artifactId"); const reservationId = stringValue(value, "reservationId"); const incidentId = stringValue(value, "incidentId"); const activeStayVersion = stringValue(value, "activeStayVersion"); const evidenceVersion = stringValue(value, "evidenceVersion"); const assessmentVersion = stringValue(value, "assessmentVersion"); const cureVersion = stringValue(value, "cureVersion"); const economicsVersion = stringValue(value, "economicsVersion"); const projectionVersion = stringValue(value, "projectionVersion"); const expectedIncidentVersion = integerValue(value, "expectedIncidentVersion"); const expectedContractVersion = integerValue(value, "expectedContractVersion");
  if (!artifactId || !reservationId || !incidentId || !activeStayVersion || !evidenceVersion || !assessmentVersion || !cureVersion || !economicsVersion || !projectionVersion || expectedIncidentVersion === undefined || expectedContractVersion === undefined) return undefined;
  const base: MidStayActionContext = { artifactId, reservationId, incidentId, expectedIncidentVersion, expectedContractVersion, activeStayVersion, evidenceVersion, assessmentVersion, cureVersion, economicsVersion, projectionVersion };
  if (!reviewed) return base; const decisionVersion = stringValue(value, "decisionVersion"); return decisionVersion ? { ...base, decisionVersion } : undefined;
}
export function resolveMidStayFailureServerEvent(input: { event: WebServerEventHandoff; application: MidStayFailureApplication; principal: CommandPrincipal }): MidStayActionResult {
  const name = input.event?.message?.action?.name; const reviewed = name === MID_STAY_APPLY_REVIEWED_EVENT;
  if (name !== MID_STAY_REQUEST_SUPPORT_EVENT && !reviewed) return { ok: false, code: "UNSUPPORTED_ACTION", message: "The action is not supported." };
  const c = parseContext(input.event, reviewed); if (!c) return { ok: false, code: "INVALID_CONTEXT", message: "The action context is invalid." };
  let current: MidStayFailureArtifact; try { current = input.application.getArtifact(c.reservationId, input.principal); } catch (error) { return { ok: false, code: error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED", message: "The action is not authorized." }; }
  const i = current.facts.incident; const advertised = current.actions.find((action) => action.type === (reviewed ? "apply_reviewed_decision" : "request_human_support")); if (!advertised) return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "The action is not authorized." };
  const matches = current.id === c.artifactId && current.facts.reservationId === c.reservationId && current.facts.contractVersion === c.expectedContractVersion && current.facts.activeStayVersion === c.activeStayVersion && current.facts.economicsVersion === c.economicsVersion && i.incidentId === c.incidentId && i.incidentVersion === c.expectedIncidentVersion && i.evidenceVersion === c.evidenceVersion && i.assessmentVersion === c.assessmentVersion && i.cureVersion === c.cureVersion && current.projectionVersion === c.projectionVersion && (!reviewed || advertised.decisionVersion === (c as MidStayReviewedActionContext).decisionVersion);
  if (!matches) return { ok: false, code: "STALE_ACTION", message: "The action is stale; refresh the current incident." };
  try { return { ok: true, artifact: reviewed ? input.application.applyReviewedDecision(c.reservationId, input.principal, c as MidStayReviewedActionContext) : input.application.requestHumanSupport(c.reservationId, input.principal, c) }; } catch (error) { return { ok: false, code: error instanceof Error && error.message === "STALE_ACTION" ? "STALE_ACTION" : "ACTION_NOT_AUTHORIZED", message: "The action was rejected." }; }
}
export { midStayActionContext };
