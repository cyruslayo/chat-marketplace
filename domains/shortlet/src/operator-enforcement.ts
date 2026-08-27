import type { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type MisconductAttribution = "operator_misconduct" | "platform_fault" | "provider_fault" | "extraordinary_event";
export type EnforcementIncidentType = "calendar_error" | "cancellation" | "substitution" | "response_failure" | "negative_balance" | "turnover_defect" | "safety_failure" | "control_circumvention";
export type EnforcementSeverity = "minor" | "serious" | "egregious";
export type EnforcementLevel = "coaching" | "restriction" | "unit_suspension" | "operator_pause" | "termination";
export type TurnoverCapability = "eligible" | "suspended" | "revoked";

export interface IncidentRecordInput { incidentId: string; rootIncidentId?: string; operatorId: string; unitId: string; incidentType: EnforcementIncidentType; severity: EnforcementSeverity; attribution: MisconductAttribution; reportedAtIso: string; }
export interface ProtectiveActionRecord { enforcementId: string; operatorId: string; unitId: string; reason: string; initiatedBy: string; status: "protective_suspension_active"; isFinalDecision: false; initiatedAtIso: string; }
export interface FinalizedEnforcementRecord { enforcementId: string; operatorId: string; unitId: string; tenantId: string; decision: EnforcementLevel; authorizedHumanId: string; status: "finalized"; isFinalDecision: true; finalizedAtIso: string; }
export interface EnforcementNoticeRecord { enforcementId: string; status: "delivered" | "failed"; deliveredAtIso?: string; }
export interface EnforcementAppealRecord { appealId: string; enforcementId: string; operatorId: string; appellantId: string; statement: string; evidenceReferences: readonly string[]; status: "appeal_pending" | "exonerated" | "upheld"; filedAtIso: string; reviewerId?: string; resolvedAtIso?: string; }
export interface OperatorUnitProjections { operatorId: string; unitId: string; misconductCount: number; enforcementLevel: EnforcementLevel; turnoverCapability: TurnoverCapability; unitStatus: "active" | "restricted" | "suspended"; operatorStatus: "active" | "active_with_restrictions" | "paused" | "terminated"; protectiveActionActive: boolean; appealPending: boolean; }

interface FinalizePayload { enforcementId: string; operatorId: string; unitId: string; decision: EnforcementLevel; approvalTier?: "standard" | "senior" | "two_person"; secondApproverId?: string; }
interface AppealPayload { enforcementId: string; operatorId: string; appellantId: string; statement: string; evidenceReferences: readonly string[]; }
interface ResolveAppealPayload { enforcementId: string; operatorId: string; decision: "exonerated" | "upheld"; rationale: string; }

/** ADR 0064/0037/0038/0039/0042/0072/0075: authoritative, human-controlled enforcement state. */
export class OperatorEnforcementManager {
  readonly #incidents = new Map<string, IncidentRecordInput>();
  readonly #protectiveActions = new Map<string, ProtectiveActionRecord>();
  readonly #finalizedEnforcements = new Map<string, FinalizedEnforcementRecord>();
  readonly #notices = new Map<string, EnforcementNoticeRecord>();
  readonly #appeals = new Map<string, EnforcementAppealRecord>();
  readonly #initialDecisionMakers = new Map<string, string>();
  readonly #clock: () => Date;
  #sequence = 0;

  constructor(options: { clock?: () => Date } = {}) { this.#clock = options.clock ?? (() => new Date()); }

  recordIncident(input: IncidentRecordInput): IncidentRecordInput {
    if (this.#incidents.has(input.incidentId)) return { ...this.#incidents.get(input.incidentId)! };
    this.#incidents.set(input.incidentId, { ...input });
    return { ...input };
  }

  applyImmediateProtectiveAction(params: { operatorId: string; unitId: string; reason: string; initiatedBy: string }): ProtectiveActionRecord {
    const enforcementId = `enf_${++this.#sequence}`;
    const record: ProtectiveActionRecord = { ...params, enforcementId, status: "protective_suspension_active", isFinalDecision: false, initiatedAtIso: this.#clock().toISOString() };
    this.#protectiveActions.set(enforcementId, record);
    return { ...record };
  }

  evaluateGraduatedEnforcement(params: { operatorId: string; unitId: string }): { misconductCount: number; enforcementLevel: EnforcementLevel; turnoverCapability: TurnoverCapability } {
    const incidents = [...this.#incidents.values()].filter(i => i.operatorId === params.operatorId && i.attribution === "operator_misconduct");
    const roots = new Map<string, IncidentRecordInput>();
    for (const incident of incidents) roots.set(incident.rootIncidentId ?? incident.incidentId, roots.get(incident.rootIncidentId ?? incident.incidentId) ?? incident);
    const unique = [...roots.values()];
    const turnover = unique.filter(i => i.unitId === params.unitId && i.incidentType === "turnover_defect");
    const protective = [...this.#protectiveActions.values()].some(a => a.operatorId === params.operatorId && a.unitId === params.unitId);
    // ADR 0038: only finally classified guest-impacting failures qualify. Human finalization is the classification boundary.
    const finalized = [...this.#finalizedEnforcements.values()].some(f => f.operatorId === params.operatorId && f.unitId === params.unitId && f.isFinalDecision);
    const serious = finalized ? turnover.filter(i => i.severity === "serious").length : 0;
    const egregious = finalized ? turnover.filter(i => i.severity === "egregious").length : 0;
    const turnoverCapability: TurnoverCapability = egregious > 0 || serious >= 2 ? "revoked" : (protective || (finalized && serious > 0) ? "suspended" : "eligible");
    // ADR 0064 does not define generic recurrence cut-offs; evidence alone cannot create punitive final state.
    const final = [...this.#finalizedEnforcements.values()].filter(f => f.operatorId === params.operatorId && (f.unitId === params.unitId || f.decision === "operator_pause" || f.decision === "termination"));
    const enforcementLevel = final.sort((a, b) => b.finalizedAtIso.localeCompare(a.finalizedAtIso))[0]?.decision ?? (protective ? "unit_suspension" : "coaching");
    return { misconductCount: unique.length, enforcementLevel, turnoverCapability };
  }

  finalizeEnforcementDecision(envelope: PlatformCommandEnvelope<FinalizePayload>): FinalizedEnforcementRecord {
    if (envelope.commandName !== "operator_enforcement.finalize") throw new Error("Invalid command name");
    const p = envelope.payload;
    if (!p || !p.enforcementId || !p.operatorId || !p.unitId || !p.decision) throw new Error("Complete enforcement payload is required");
    if (!envelope.principal.tenantId) throw new Error("Enforcement decision requires tenant scope");
    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") throw new Error("Final enforcement decisions require an authorized human reviewer");
    if (p.decision === "termination" && p.approvalTier !== "senior") throw new Error("Termination requires senior human approval");
    const action = this.#protectiveActions.get(p.enforcementId);
    if (!action || action.operatorId !== p.operatorId || action.unitId !== p.unitId) throw new Error("Enforcement action scope mismatch");
    const egregiousTurnover = [...this.#incidents.values()].some(i => i.operatorId === p.operatorId && i.unitId === p.unitId && i.incidentType === "turnover_defect" && i.severity === "egregious" && i.attribution === "operator_misconduct");
    if (egregiousTurnover && p.approvalTier !== "two_person") throw new Error("Egregious turnover revocation requires two-person approval");
    if (p.approvalTier === "two_person" && (!p.secondApproverId || p.secondApproverId === envelope.principal.id)) throw new Error("Two-person approval requires an independent second approver");
    const existing = this.#finalizedEnforcements.get(p.enforcementId);
    if (existing) return { ...existing };
    const record: FinalizedEnforcementRecord = { enforcementId: p.enforcementId, operatorId: p.operatorId, unitId: p.unitId, tenantId: envelope.principal.tenantId, decision: p.decision, authorizedHumanId: envelope.principal.id, status: "finalized", isFinalDecision: true, finalizedAtIso: this.#clock().toISOString() };
    this.#finalizedEnforcements.set(p.enforcementId, record); this.#initialDecisionMakers.set(p.enforcementId, envelope.principal.id);
    return { ...record };
  }

  recordEnforcementNotice(params: { enforcementId: string; status: "delivered" | "failed"; deliveredAtIso?: string }): EnforcementNoticeRecord {
    if (params.status === "delivered" && !params.deliveredAtIso) throw new Error("Successful notice requires delivery timestamp");
    const record = { ...params }; this.#notices.set(params.enforcementId, record); return { ...record };
  }

  fileEnforcementAppeal(envelope: PlatformCommandEnvelope<AppealPayload>): EnforcementAppealRecord {
    if (envelope.commandName !== "operator_enforcement.appeal") throw new Error("Invalid appeal command");
    const p = envelope.payload; const final = this.#finalizedEnforcements.get(p.enforcementId); const notice = this.#notices.get(p.enforcementId);
    if (!final || final.operatorId !== p.operatorId || envelope.principal.id !== p.appellantId || envelope.principal.role !== "operator" || envelope.principal.tenantId !== final.tenantId) throw new Error("Appeal authority or scope denied");
    if (!notice || notice.status !== "delivered" || !notice.deliveredAtIso) throw new Error("Appeal requires successful enforcement notice");
    const appealId = `appeal_${p.enforcementId}`; if (this.#appeals.has(appealId)) throw new Error("Only one ordinary enforcement appeal is allowed");
    const filed = this.#clock(); const deadline = new Date(new Date(notice.deliveredAtIso).getTime() + 7 * 24 * 60 * 60 * 1000);
    if (filed.getTime() >= deadline.getTime()) throw new Error("Enforcement appeal window has expired");
    if (p.evidenceReferences.some(ref => /^https?:\/\//i.test(ref))) throw new Error("Appeal evidence must use opaque references");
    const record: EnforcementAppealRecord = { appealId, enforcementId: p.enforcementId, operatorId: p.operatorId, appellantId: p.appellantId, statement: p.statement, evidenceReferences: Object.freeze([...p.evidenceReferences]), status: "appeal_pending", filedAtIso: filed.toISOString() };
    this.#appeals.set(appealId, record); return { ...record };
  }

  resolveEnforcementAppeal(envelope: PlatformCommandEnvelope<ResolveAppealPayload>): EnforcementAppealRecord {
    if (envelope.commandName !== "operator_enforcement.resolve_appeal") throw new Error("Invalid appeal decision command");
    const p = envelope.payload; const appeal = this.#appeals.get(`appeal_${p.enforcementId}`); if (!appeal || appeal.operatorId !== p.operatorId) throw new Error("Appeal scope denied");
    if (envelope.principal.role !== "admin" && envelope.principal.role !== "authorized_staff") throw new Error("Appeal decisions require an authorized human reviewer");
    if (!envelope.principal.tenantId || envelope.principal.tenantId !== this.#finalizedEnforcements.get(p.enforcementId)?.tenantId || envelope.principal.id === this.#initialDecisionMakers.get(p.enforcementId)) throw new Error("Appeal reviewer must be an authorized independent human");
    if (appeal.status !== "appeal_pending") throw new Error("Appeal is already resolved");
    appeal.status = p.decision; appeal.reviewerId = envelope.principal.id; appeal.resolvedAtIso = this.#clock().toISOString(); return { ...appeal };
  }

  getProjections(params: { operatorId: string; unitId: string }): OperatorUnitProjections {
    const evaluation = this.evaluateGraduatedEnforcement(params); const protective = [...this.#protectiveActions.values()].some(a => a.operatorId === params.operatorId && a.unitId === params.unitId);
    const appealPending = [...this.#appeals.values()].some(a => a.status === "appeal_pending" && a.operatorId === params.operatorId && this.#finalizedEnforcements.get(a.enforcementId)?.unitId === params.unitId);
    const unitStatus = evaluation.enforcementLevel === "restriction" ? "restricted" : (protective || evaluation.enforcementLevel === "unit_suspension" || evaluation.enforcementLevel === "operator_pause" ? "suspended" : "active");
    const operatorStatus = evaluation.enforcementLevel === "termination" ? "terminated" : evaluation.enforcementLevel === "operator_pause" ? "paused" : evaluation.enforcementLevel === "restriction" ? "active_with_restrictions" : "active";
    return { ...params, ...evaluation, unitStatus, operatorStatus, protectiveActionActive: protective, appealPending };
  }
}
