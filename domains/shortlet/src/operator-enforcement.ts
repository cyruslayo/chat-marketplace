import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export type MisconductAttribution = "operator_misconduct" | "platform_fault" | "provider_fault" | "extraordinary_event";

export type EnforcementIncidentType =
  | "calendar_error"
  | "cancellation"
  | "substitution"
  | "response_failure"
  | "negative_balance"
  | "turnover_defect"
  | "safety_failure"
  | "control_circumvention";

export type EnforcementSeverity = "minor" | "serious" | "egregious";

export type EnforcementLevel = "coaching" | "restriction" | "unit_suspension" | "operator_pause" | "termination";

export type TurnoverCapability = "eligible" | "suspended" | "revoked";

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
  reason: string;
  initiatedBy: string;
  status: "protective_suspension_active";
  isFinalDecision: false;
  initiatedAtIso: string;
}

export interface FinalizedEnforcementRecord {
  enforcementId: string;
  decision: EnforcementLevel;
  authorizedHumanId: string;
  status: "finalized";
  isFinalDecision: true;
  finalizedAtIso: string;
}

export interface EnforcementAppealRecord {
  appealId: string;
  enforcementId: string;
  operatorId: string;
  appellantId: string;
  statement: string;
  evidenceUrls: string[];
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
}

/**
 * ADR 0064, ADR 0037, ADR 0038, ADR 0042, ADR 0072:
 * Graduated Operator and turnover enforcement, incident deduplication, misconduct attribution filtering,
 * immediate protective suspension vs independent human final decision and 7-day appeal.
 */
export class OperatorEnforcementManager {
  readonly #incidents = new Map<string, IncidentRecordInput>();
  readonly #protectiveActions = new Map<string, ProtectiveActionRecord>();
  readonly #finalizedEnforcements = new Map<string, FinalizedEnforcementRecord>();
  readonly #appeals = new Map<string, EnforcementAppealRecord>();
  readonly #initialDecisionMakers = new Map<string, string>(); // enforcementId -> humanReviewerId

  /**
   * ADR 0064:
   * Record incident. Platform/provider faults and extraordinary events are NOT counted as operator misconduct.
   * Single root incident is deduplicated.
   */
  recordIncident(input: IncidentRecordInput): IncidentRecordInput {
    this.#incidents.set(input.incidentId, { ...input });
    return { ...input };
  }

  /**
   * ADR 0064:
   * Immediate protective suspension precedes final classification where guests, funds, or inventory are at risk.
   */
  applyImmediateProtectiveAction(params: {
    operatorId: string;
    unitId: string;
    reason: string;
    initiatedBy: string;
  }): ProtectiveActionRecord {
    const enforcementId = `enf_${params.operatorId}_${params.unitId}_${Date.now()}`;
    const record: ProtectiveActionRecord = {
      enforcementId,
      operatorId: params.operatorId,
      unitId: params.unitId,
      reason: params.reason,
      initiatedBy: params.initiatedBy,
      status: "protective_suspension_active",
      isFinalDecision: false,
      initiatedAtIso: new Date().toISOString()
    };

    this.#protectiveActions.set(enforcementId, record);
    return record;
  }

  /**
   * ADR 0064 & ADR 0038:
   * Evaluates graduated enforcement level & turnover capability based on misconduct incidents.
   */
  evaluateGraduatedEnforcement(params: { operatorId: string; unitId: string }): {
    misconductCount: number;
    enforcementLevel: EnforcementLevel;
    turnoverCapability: TurnoverCapability;
  } {
    const operatorIncidents = Array.from(this.#incidents.values()).filter(
      (i) => i.operatorId === params.operatorId
    );

    // Filter out non-misconduct attributions (platform_fault, provider_fault, extraordinary_event)
    const misconductIncidents = operatorIncidents.filter((i) => i.attribution === "operator_misconduct");

    // Deduplicate by rootIncidentId
    const uniqueRootIncidents = new Map<string, IncidentRecordInput>();
    for (const inc of misconductIncidents) {
      const key = inc.rootIncidentId ?? inc.incidentId;
      if (!uniqueRootIncidents.has(key)) {
        uniqueRootIncidents.set(key, inc);
      }
    }

    const uniqueIncidentsList = Array.from(uniqueRootIncidents.values());
    const misconductCount = uniqueIncidentsList.length;

    // Check unit-specific turnover defects (ADR 0038)
    const unitTurnoverDefects = uniqueIncidentsList.filter(
      (i) => i.unitId === params.unitId && i.incidentType === "turnover_defect"
    );

    let turnoverCapability: TurnoverCapability = "eligible";
    const seriousTurnoverCount = unitTurnoverDefects.filter((i) => i.severity === "serious").length;
    const egregiousTurnoverCount = unitTurnoverDefects.filter((i) => i.severity === "egregious").length;

    if (egregiousTurnoverCount >= 1 || seriousTurnoverCount >= 2) {
      // 2 serious OR 1 egregious turnover failure -> Revoked for remainder of launch (ADR 0038)
      turnoverCapability = "revoked";
    } else if (seriousTurnoverCount === 1) {
      turnoverCapability = "suspended";
    }

    // Determine overall enforcement level
    let enforcementLevel: EnforcementLevel = "coaching";
    const hasEgregiousSafety = uniqueIncidentsList.some((i) => i.severity === "egregious" && i.incidentType === "safety_failure");

    if (hasEgregiousSafety) {
      enforcementLevel = "operator_pause";
    } else if (misconductCount >= 3) {
      enforcementLevel = "operator_pause";
    } else if (misconductCount >= 2 || turnoverCapability === "revoked") {
      enforcementLevel = "restriction";
    } else if (misconductCount >= 1 || turnoverCapability === "suspended") {
      enforcementLevel = "coaching";
    }

    return {
      misconductCount,
      enforcementLevel,
      turnoverCapability
    };
  }

  /**
   * ADR 0064 & ADR 0072:
   * Final enforcement decision requires PlatformCommandEnvelope with authorized human decision.
   */
  finalizeEnforcementDecision(
    envelope: PlatformCommandEnvelope<any>,
    enforcementId: string,
    decision: EnforcementLevel
  ): FinalizedEnforcementRecord {
    if (envelope.commandName !== "operator_enforcement.finalize") {
      throw new Error(`Invalid command name: ${envelope.commandName}`);
    }

    // Fail closed: Principal role MUST be admin/human reviewer, NOT agent or system
    if (!envelope.principal || envelope.principal.role !== "admin") {
      throw new Error("Final enforcement decisions require an authorized human reviewer");
    }

    const record: FinalizedEnforcementRecord = {
      enforcementId,
      decision,
      authorizedHumanId: envelope.principal.id,
      status: "finalized",
      isFinalDecision: true,
      finalizedAtIso: new Date().toISOString()
    };

    this.#finalizedEnforcements.set(enforcementId, record);
    this.#initialDecisionMakers.set(enforcementId, envelope.principal.id);
    return record;
  }

  /**
   * ADR 0064:
   * File a 7-day appeal for an enforcement action.
   */
  fileEnforcementAppeal(params: {
    operatorId: string;
    enforcementId: string;
    appellantId: string;
    statement: string;
    evidenceUrls: string[];
    filedAtIso: string;
  }): EnforcementAppealRecord {
    const appealId = `appeal_${params.enforcementId}`;
    const record: EnforcementAppealRecord = {
      appealId,
      enforcementId: params.enforcementId,
      operatorId: params.operatorId,
      appellantId: params.appellantId,
      statement: params.statement,
      evidenceUrls: params.evidenceUrls,
      status: "appeal_pending",
      filedAtIso: params.filedAtIso
    };

    this.#appeals.set(appealId, record);
    return { ...record };
  }

  /**
   * ADR 0064:
   * Resolve an enforcement appeal before an independent human reviewer.
   */
  resolveEnforcementAppeal(params: {
    enforcementId: string;
    reviewerId: string;
    decision: "exonerated" | "upheld";
    rationale: string;
  }): EnforcementAppealRecord {
    const appealId = `appeal_${params.enforcementId}`;
    const appeal = this.#appeals.get(appealId);
    if (!appeal) throw new Error(`Appeal not found: ${appealId}`);

    const initialMaker = this.#initialDecisionMakers.get(params.enforcementId);
    if (initialMaker && initialMaker === params.reviewerId) {
      throw new Error("Enforcement appeal reviewer must be independent from initial decision maker");
    }

    appeal.status = params.decision;
    appeal.reviewerId = params.reviewerId;
    appeal.resolvedAtIso = new Date().toISOString();

    return { ...appeal };
  }

  /**
   * ADR 0064:
   * Return consistent Unit and Operator status projections across features.
   */
  getProjections(params: { operatorId: string; unitId: string }): OperatorUnitProjections {
    const evaluation = this.evaluateGraduatedEnforcement(params);

    let unitStatus: "active" | "restricted" | "suspended" = "active";
    if (evaluation.enforcementLevel === "unit_suspension" || evaluation.enforcementLevel === "operator_pause") {
      unitStatus = "suspended";
    } else if (evaluation.enforcementLevel === "restriction") {
      unitStatus = "restricted";
    }

    let operatorStatus: "active" | "active_with_restrictions" | "paused" | "terminated" = "active";
    if (evaluation.enforcementLevel === "termination") {
      operatorStatus = "terminated";
    } else if (evaluation.enforcementLevel === "operator_pause") {
      operatorStatus = "paused";
    } else if (evaluation.enforcementLevel === "restriction") {
      operatorStatus = "active_with_restrictions";
    }

    return {
      operatorId: params.operatorId,
      unitId: params.unitId,
      misconductCount: evaluation.misconductCount,
      enforcementLevel: evaluation.enforcementLevel,
      turnoverCapability: evaluation.turnoverCapability,
      unitStatus,
      operatorStatus
    };
  }
}
