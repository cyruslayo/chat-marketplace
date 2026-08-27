import type { PlatformCommandEnvelope, CommandPrincipal } from "../../../packages/platform-core/src/index.js";

export type MisconductAttribution = "operator_misconduct" | "platform_fault" | "provider_fault" | "extraordinary_event";
export type EnforcementIncidentType = "calendar_error" | "cancellation" | "substitution" | "response_failure" | "negative_balance" | "turnover_defect" | "safety_failure" | "control_circumvention";
export type EnforcementSeverity = "minor" | "serious" | "egregious";
export type EnforcementLevel = "coaching" | "restriction" | "unit_suspension" | "operator_pause" | "termination";
export type TurnoverCapability = "eligible" | "suspended" | "revoked";

type TurnoverRestorationKind = "evidence_only_miss" | "operational_delay_without_guest_impact" | "guest_impacting_failure";

export interface OperatorAuthority {
  canActForOperator(input: { actorId: string; operatorId: string; tenantId: string }): boolean;
}

export interface IncidentRecordInput {
  incidentId: string;
  rootIncidentId?: string;
  operatorId: string;
  unitId: string;
  incidentType: EnforcementIncidentType;
  severity: EnforcementSeverity;
  attribution: MisconductAttribution;
  reportedAtIso: string;
}

export interface ProtectiveActionRecord {
  enforcementId: string;
  operatorId: string;
  unitId: string;
  tenantId: string;
  reason: string;
  initiatedBy: string;
  status: "protective_suspension_active";
  isFinalDecision: false;
  initiatedAtIso: string;
}

export interface FinalizedEnforcementRecord {
  enforcementId: string;
  operatorId: string;
  unitId: string;
  tenantId: string;
  decision: EnforcementLevel;
  authorizedHumanId: string;
  classifiedIncidentIds: readonly string[];
  status: "finalized";
  isFinalDecision: true;
  finalizedAtIso: string;
}

export interface EnforcementNoticeRecord {
  enforcementId: string;
  operatorId: string;
  unitId: string;
  tenantId: string;
  status: "delivered" | "failed";
  deliveredAtIso?: string;
}

export interface EnforcementAppealRecord {
  appealId: string;
  enforcementId: string;
  operatorId: string;
  appellantId: string;
  statement: string;
  evidenceReferences: readonly string[];
  status: "appeal_pending" | "exonerated" | "upheld";
  filedAtIso: string;
  reviewerId?: string;
  resolvedAtIso?: string;
}

export interface OperatorUnitProjections {
  operatorId: string;
  unitId: string;
  misconductCount: number;
  enforcementLevel: EnforcementLevel;
  turnoverCapability: TurnoverCapability;
  unitStatus: "active" | "restricted" | "suspended";
  operatorStatus: "active" | "active_with_restrictions" | "paused" | "terminated";
  protectiveActionActive: boolean;
  appealPending: boolean;
}

interface FinalizePayload {
  enforcementId: string;
  operatorId: string;
  unitId: string;
  decision: EnforcementLevel;
  classifiedIncidentIds?: readonly string[];
  approvalTier?: "standard" | "two_person";
  secondApproverId?: string;
}

interface AppealPayload {
  enforcementId: string;
  operatorId: string;
  appellantId: string;
  statement: string;
  evidenceReferences: readonly string[];
}

interface ResolveAppealPayload {
  enforcementId: string;
  operatorId: string;
  decision: "exonerated" | "upheld";
  rationale: string;
}

interface ProtectivePayload {
  operatorId: string;
  unitId: string;
  reason: string;
}

interface RestorePayload {
  operatorId: string;
  unitId: string;
  enforcementId: string;
  kind: TurnoverRestorationKind;
  timelyReadiness?: boolean;
  noGuestImpact?: boolean;
  correctedEvidenceWorkflow?: boolean;
  rootCauseRemediated?: boolean;
  updatedTurnoverPlan?: boolean;
  observedSuccessfulTurnoverRuns?: number;
  nextDateBlocked?: boolean;
  incidentRemediated?: boolean;
  runsAfterRealStays?: number;
  fullOperationalReapproval?: boolean;
  approvalTier?: "standard" | "senior";
}

/** ADR 0037/0038/0064/0072/0075: authoritative, human-controlled enforcement state. */
export class OperatorEnforcementManager {
  readonly #incidents = new Map<string, IncidentRecordInput>();
  readonly #protectiveActions = new Map<string, ProtectiveActionRecord>();
  readonly #finalizedEnforcements = new Map<string, FinalizedEnforcementRecord>();
  readonly #notices = new Map<string, EnforcementNoticeRecord>();
  readonly #appeals = new Map<string, EnforcementAppealRecord>();
  readonly #restoredUnits = new Set<string>();
  readonly #restorationDispositions: Array<{ enforcementId: string; operatorId: string; unitId: string; disposition: "restored"; kind: TurnoverRestorationKind; recordedAtIso: string }> = [];
  readonly #operatorAuthority: OperatorAuthority;
  readonly #initialDecisionMakers = new Map<string, string>();
  readonly #clock: () => Date;
  #sequence = 0;

  constructor(options: { clock?: () => Date; operatorAuthority?: OperatorAuthority } = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#operatorAuthority = options.operatorAuthority ?? { canActForOperator: () => false };
  }

  recordIncident(input: IncidentRecordInput): IncidentRecordInput {
    if (this.#incidents.has(input.incidentId)) return { ...this.#incidents.get(input.incidentId)! };
    this.#incidents.set(input.incidentId, { ...input });
    return { ...input };
  }

  applyImmediateProtectiveAction(envelope: PlatformCommandEnvelope<ProtectivePayload>): ProtectiveActionRecord {
    this.#requireHumanCommand(envelope, "operator_enforcement.protective_action");
    const { operatorId, unitId, reason } = envelope.payload;
    if (!operatorId || !unitId || !reason || !envelope.principal.tenantId) throw new Error("Complete protective action scope is required");
    const enforcementId = `enf_${++this.#sequence}`;
    this.#restoredUnits.delete(`${operatorId}:${unitId}`);
    const record: ProtectiveActionRecord = {
      enforcementId, operatorId, unitId, tenantId: envelope.principal.tenantId, reason,
      initiatedBy: envelope.principal.id, status: "protective_suspension_active", isFinalDecision: false,
      initiatedAtIso: this.#clock().toISOString()
    };
    this.#protectiveActions.set(enforcementId, record);
    return { ...record };
  }

  evaluateGraduatedEnforcement(params: { operatorId: string; unitId: string }): { misconductCount: number; enforcementLevel: EnforcementLevel; turnoverCapability: TurnoverCapability } {
    const misconduct = [...this.#incidents.values()].filter(i => i.operatorId === params.operatorId && i.attribution === "operator_misconduct");
    const roots = new Map<string, IncidentRecordInput>();
    for (const incident of misconduct) {
      const root = incident.rootIncidentId ?? incident.incidentId;
      if (!roots.has(root)) roots.set(root, incident);
    }
    const unique = [...roots.values()];
    const classified = this.#classifiedTurnoverRoots(params);
    const serious = classified.filter(i => i.severity === "serious").length;
    const egregious = classified.filter(i => i.severity === "egregious").length;
    const protective = this.#hasActiveProtection(params);
    const revoked = egregious > 0 || serious >= 2;
    const restored = this.#restoredUnits.has(`${params.operatorId}:${params.unitId}`);
    const turnoverCapability: TurnoverCapability = revoked ? "revoked" : protective || (!restored && serious > 0) ? "suspended" : "eligible";
    return {
      misconductCount: unique.length,
      enforcementLevel: this.#effectiveUnitDecision(params),
      turnoverCapability
    };
  }

  finalizeEnforcementDecision(envelope: PlatformCommandEnvelope<FinalizePayload>): FinalizedEnforcementRecord {
    this.#requireHumanCommand(envelope, "operator_enforcement.finalize");
    const p = envelope.payload;
    if (!p || !p.enforcementId || !p.operatorId || !p.unitId || !p.decision || !envelope.principal.tenantId) throw new Error("Complete enforcement payload is required");
    const action = this.#protectiveActions.get(p.enforcementId);
    if (!action || action.operatorId !== p.operatorId || action.unitId !== p.unitId || action.tenantId !== envelope.principal.tenantId) throw new Error("Enforcement action scope mismatch");
    const ids = [...new Set(p.classifiedIncidentIds ?? [])];
    for (const id of ids) {
      const incident = this.#incidents.get(id);
      if (!incident || incident.operatorId !== p.operatorId || incident.unitId !== p.unitId || incident.attribution !== "operator_misconduct" || incident.incidentType !== "turnover_defect") throw new Error("Classified incident scope mismatch");
    }
    const hasEgregious = ids.some(id => this.#incidents.get(id)?.severity === "egregious");
    if (hasEgregious && p.decision !== "termination" && p.approvalTier !== "two_person") throw new Error("Egregious turnover revocation requires two-person approval");
    if (hasEgregious && p.approvalTier !== "two_person") throw new Error("Egregious turnover revocation requires two-person approval");
    if (p.approvalTier === "two_person" && (!p.secondApproverId || p.secondApproverId === envelope.principal.id)) throw new Error("Two-person approval requires an independent second approver");
    const existing = this.#finalizedEnforcements.get(p.enforcementId);
    if (existing) return { ...existing };
    const record: FinalizedEnforcementRecord = {
      enforcementId: p.enforcementId, operatorId: p.operatorId, unitId: p.unitId, tenantId: envelope.principal.tenantId,
      decision: p.decision, authorizedHumanId: envelope.principal.id, classifiedIncidentIds: Object.freeze(ids),
      status: "finalized", isFinalDecision: true, finalizedAtIso: this.#clock().toISOString()
    };
    this.#finalizedEnforcements.set(p.enforcementId, record);
    this.#initialDecisionMakers.set(p.enforcementId, envelope.principal.id);
    return { ...record };
  }

  recordEnforcementNotice(params: { enforcementId: string; operatorId: string; unitId: string; tenantId: string; status: "delivered" | "failed"; deliveredAtIso?: string }): EnforcementNoticeRecord {
    const final = this.#finalizedEnforcements.get(params.enforcementId);
    if (!final || final.operatorId !== params.operatorId || final.unitId !== params.unitId || final.tenantId !== params.tenantId) throw new Error("Notice enforcement scope mismatch");
    if (params.status === "delivered") {
      if (!params.deliveredAtIso) throw new Error("Successful notice requires delivery timestamp");
      const delivered = Date.parse(params.deliveredAtIso);
      const decided = Date.parse(final.finalizedAtIso);
      if (!Number.isFinite(delivered) || delivered > this.#clock().getTime() || delivered < decided) throw new Error("Notice delivery timestamp is invalid");
    }
    const previous = this.#notices.get(params.enforcementId);
    if (previous?.status === "delivered") return { ...previous };
    const record = { ...params };
    this.#notices.set(params.enforcementId, record);
    return { ...record };
  }

  fileEnforcementAppeal(envelope: PlatformCommandEnvelope<AppealPayload>): EnforcementAppealRecord {
    if (envelope.commandName !== "operator_enforcement.appeal") throw new Error("Invalid appeal command");
    const p = envelope.payload;
    const final = this.#finalizedEnforcements.get(p.enforcementId);
    const notice = this.#notices.get(p.enforcementId);
    if (!final || final.operatorId !== p.operatorId || final.tenantId !== envelope.principal.tenantId || envelope.principal.id !== p.appellantId || envelope.principal.role !== "operator" || !this.#operatorAuthority.canActForOperator({ actorId: envelope.principal.id, operatorId: final.operatorId, tenantId: final.tenantId })) throw new Error("Appeal authority or scope denied");
    if (!notice || notice.status !== "delivered" || !notice.deliveredAtIso) throw new Error("Appeal requires successful enforcement notice");
    const appealId = `appeal_${p.enforcementId}`;
    if (this.#appeals.has(appealId)) throw new Error("Only one ordinary enforcement appeal is allowed");
    const filed = this.#clock();
    const delivered = Date.parse(notice.deliveredAtIso);
    if (!Number.isFinite(delivered) || filed.getTime() >= delivered + 7 * 24 * 60 * 60 * 1000) throw new Error("Enforcement appeal window has expired");
    if (p.evidenceReferences.some(ref => /^https?:\/\//i.test(ref))) throw new Error("Appeal evidence must use opaque references");
    const record: EnforcementAppealRecord = { appealId, enforcementId: p.enforcementId, operatorId: p.operatorId, appellantId: p.appellantId, statement: p.statement, evidenceReferences: Object.freeze([...p.evidenceReferences]), status: "appeal_pending", filedAtIso: filed.toISOString() };
    this.#appeals.set(appealId, record);
    return { ...record };
  }

  resolveEnforcementAppeal(envelope: PlatformCommandEnvelope<ResolveAppealPayload>): EnforcementAppealRecord {
    if (envelope.commandName !== "operator_enforcement.resolve_appeal") throw new Error("Invalid appeal decision command");
    const p = envelope.payload;
    const appeal = this.#appeals.get(`appeal_${p.enforcementId}`);
    const final = this.#finalizedEnforcements.get(p.enforcementId);
    if (!appeal || !final || appeal.operatorId !== p.operatorId || final.tenantId !== envelope.principal.tenantId) throw new Error("Appeal scope denied");
    if (!this.#isHuman(envelope.principal) || envelope.principal.id === this.#initialDecisionMakers.get(p.enforcementId)) throw new Error("Appeal reviewer must be an authorized independent human");
    if (appeal.status !== "appeal_pending") throw new Error("Appeal is already resolved");
    appeal.status = p.decision;
    appeal.reviewerId = envelope.principal.id;
    appeal.resolvedAtIso = this.#clock().toISOString();
    return { ...appeal };
  }

  restoreTurnoverEligibility(envelope: PlatformCommandEnvelope<RestorePayload>): void {
    this.#requireHumanCommand(envelope, "operator_enforcement.restore_turnover");
    const p = envelope.payload;
    if (!p.operatorId || !p.unitId || !p.enforcementId || !envelope.principal.tenantId || !this.#unitBelongsToTenant(p.operatorId, p.unitId, envelope.principal.tenantId)) throw new Error("Restoration scope denied");
    if (!this.#hasRevocation(p.operatorId, p.unitId)) {
      const action = this.#protectiveActions.get(p.enforcementId);
      if (!action || action.operatorId !== p.operatorId || action.unitId !== p.unitId || action.tenantId !== envelope.principal.tenantId) throw new Error("Restoration action scope denied");
    }
    if (this.#hasRevocation(p.operatorId, p.unitId)) throw new Error("Turnover revocation cannot be restored");
    const qualifies = p.kind === "evidence_only_miss"
      ? p.timelyReadiness === true && p.noGuestImpact === true && p.correctedEvidenceWorkflow === true
      : p.kind === "operational_delay_without_guest_impact"
        ? p.rootCauseRemediated === true && p.updatedTurnoverPlan === true && p.observedSuccessfulTurnoverRuns === 1 && p.nextDateBlocked === true
        : p.incidentRemediated === true && p.observedSuccessfulTurnoverRuns === 3 && p.runsAfterRealStays === 2 && p.fullOperationalReapproval === true && p.approvalTier === "senior";
    if (!qualifies) throw new Error("Required turnover remediation evidence is incomplete");
    // ADR 0037/0064: restoration is authorized human review, not Operator membership authority.
    this.#restorationDispositions.push({
      enforcementId: p.enforcementId,
      operatorId: p.operatorId,
      unitId: p.unitId,
      disposition: "restored",
      kind: p.kind,
      recordedAtIso: this.#clock().toISOString()
    });
    this.#restoredUnits.add(`${p.operatorId}:${p.unitId}`);
  }

  getProjections(params: { operatorId: string; unitId: string }): OperatorUnitProjections {
    const evaluation = this.evaluateGraduatedEnforcement(params);
    const protective = this.#hasActiveProtection(params);
    const appealPending = [...this.#appeals.values()].some(a => {
      if (a.status !== "appeal_pending" || a.operatorId !== params.operatorId) return false;
      const final = this.#finalizedEnforcements.get(a.enforcementId);
      return final?.unitId === params.unitId || final?.decision === "operator_pause" || final?.decision === "termination";
    });
    const unitStatus = evaluation.enforcementLevel === "restriction" ? "restricted" : (protective || evaluation.enforcementLevel === "unit_suspension" || evaluation.enforcementLevel === "operator_pause" || evaluation.enforcementLevel === "termination" ? "suspended" : "active");
    const operatorStatus = evaluation.enforcementLevel === "termination" ? "terminated" : evaluation.enforcementLevel === "operator_pause" ? "paused" : evaluation.enforcementLevel === "restriction" ? "active_with_restrictions" : "active";
    return { ...params, ...evaluation, unitStatus, operatorStatus, protectiveActionActive: protective, appealPending };
  }

  #isHuman(principal: CommandPrincipal): boolean { return principal.role === "admin" || principal.role === "authorized_staff"; }
  #requireHumanCommand<T>(envelope: PlatformCommandEnvelope<T>, commandName: string): void {
    if (envelope.commandName !== commandName) throw new Error("Invalid command name");
    if (!envelope.principal.tenantId || !this.#isHuman(envelope.principal)) throw new Error("Authorized human command principal is required");
  }
  #hasActiveProtection(params: { operatorId: string; unitId: string }): boolean {
    return [...this.#protectiveActions.values()].some(a => a.operatorId === params.operatorId && a.unitId === params.unitId && !this.#restorationDispositions.some(d => d.enforcementId === a.enforcementId));
  }
  #unitBelongsToTenant(operatorId: string, unitId: string, tenantId: string): boolean {
    return [...this.#protectiveActions.values()].some(a => a.operatorId === operatorId && a.unitId === unitId && a.tenantId === tenantId);
  }
  #hasRevocation(operatorId: string, unitId: string): boolean {
    const classified = this.#classifiedTurnoverRoots({ operatorId, unitId }, true);
    return classified.some(i => i.severity === "egregious") || classified.filter(i => i.severity === "serious").length >= 2;
  }
  #classifiedTurnoverRoots(params: { operatorId: string; unitId: string }, includeRestored = false): IncidentRecordInput[] {
    const ids = new Set<string>();
    for (const final of this.#effectiveFinals()) {
      if (!includeRestored && this.#restorationDispositions.some(d => d.enforcementId === final.enforcementId)) continue;
      if (final.operatorId !== params.operatorId || final.unitId !== params.unitId) continue;
      for (const id of final.classifiedIncidentIds) ids.add(id);
    }
    const roots = new Map<string, IncidentRecordInput>();
    for (const id of ids) {
      const incident = this.#incidents.get(id);
      if (incident) roots.set(incident.rootIncidentId ?? incident.incidentId, incident);
    }
    return [...roots.values()].filter(i => i.incidentType === "turnover_defect");
  }
  #effectiveFinals(): FinalizedEnforcementRecord[] {
    return [...this.#finalizedEnforcements.values()].filter(final => this.#appeals.get(`appeal_${final.enforcementId}`)?.status !== "exonerated");
  }
  #effectiveUnitDecision(params: { operatorId: string; unitId: string }): EnforcementLevel {
    const finals = this.#effectiveFinals().filter(f => f.operatorId === params.operatorId && (f.unitId === params.unitId || f.decision === "operator_pause" || f.decision === "termination"));
    if (finals.some(f => f.decision === "termination")) return "termination";
    if (finals.some(f => f.decision === "operator_pause")) return "operator_pause";
    const unitFinals = finals.filter(f => f.unitId === params.unitId && !this.#restorationDispositions.some(d => d.enforcementId === f.enforcementId));
    const rank: Record<EnforcementLevel, number> = { coaching: 0, restriction: 1, unit_suspension: 2, operator_pause: 3, termination: 4 };
    unitFinals.sort((a, b) => rank[b.decision] - rank[a.decision] || b.finalizedAtIso.localeCompare(a.finalizedAtIso) || b.enforcementId.localeCompare(a.enforcementId));
    return unitFinals[0]?.decision ?? (this.#hasActiveProtection(params) ? "unit_suspension" : "coaching");
  }
}
