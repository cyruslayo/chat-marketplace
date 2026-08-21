import { InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";

export type JourneyCategory =
  | "ordinary_booking"
  | "same_day_booking"
  | "payment_failure_and_retry"
  | "late_payment_refund"
  | "failed_access_and_relocation"
  | "operator_cancellation"
  | "booking_amendment"
  | "deposit_claim_and_appeal"
  | "operator_holds_and_turnover"
  | "payout_projections"
  | "support_takeover"
  | "administrative_recovery";

export type ExecutionPathType =
  | "success"
  | "timeout"
  | "duplicate"
  | "concurrency"
  | "provider_failure"
  | "agent_outage"
  | "human_handoff"
  | "reconciliation";

export type ValidationGateType =
  | "provider"
  | "legal"
  | "privacy"
  | "operator"
  | "operational"
  | "accessibility"
  | "security"
  | "reliability"
  | "protocol";

export interface JourneyProofRecord {
  journeyId: string;
  journeyCategory: JourneyCategory;
  authoritativeStateVerified: boolean;
  ledgerVerified: boolean;
  projectionVerified: boolean;
  notificationVerified: boolean;
  auditVerified: boolean;
  conventionalRouteVerified: boolean;
  permittedChannelVerified: boolean;
  channel: "web_agent" | "whatsapp" | "a2ui_adapter";
  commandEnvelopeId: string;
}

export interface ExecutionPathRecord {
  pathId: string;
  journeyId: string;
  pathType: ExecutionPathType;
  handled: boolean;
  recoveryAction?: string;
  reconciledState?: string;
}

export interface DeterministicParityFixture {
  fixtureId: string;
  workflowName: string;
  interfacesTested: ("web_agent" | "whatsapp" | "conventional_web" | "operator_portal")[];
  commandType: string;
  envelopeSchemaMatched: boolean;
  semanticsIdentical: boolean;
  authorizationEnforced: boolean;
  concurrencyEnforced: boolean;
  auditParityVerified: boolean;
}

export interface ValidationGateRecord {
  gateId: string;
  gateType: ValidationGateType;
  gateName: string;
  status: "open" | "closed" | "failed";
  closedAt?: string;
  evidence?: string;
}

export interface LaunchJourneySuiteOptions {
  audit: InMemoryAuditLog;
  enforceStrictParity?: boolean;
  minRequiredGates?: number;
}

export interface ReleaseReadinessSummary {
  ready: boolean;
  summary: {
    totalJourneys: number;
    totalExecutionPaths: number;
    totalParityFixtures: number;
    totalClosedGates: number;
    missingCategories: JourneyCategory[];
    missingPathTypes: ExecutionPathType[];
    missingGateTypes: ValidationGateType[];
  };
}

export class LaunchJourneySuiteManager {
  private readonly audit: InMemoryAuditLog;
  private readonly enforceStrictParity: boolean;
  private readonly minRequiredGates: number;

  private readonly journeyProofs: Map<string, JourneyProofRecord> = new Map();
  private readonly executionPaths: Map<string, ExecutionPathRecord> = new Map();
  private readonly parityFixtures: Map<string, DeterministicParityFixture> = new Map();
  private readonly validationGates: Map<string, ValidationGateRecord> = new Map();

  constructor(options: LaunchJourneySuiteOptions) {
    if (!options || !options.audit) {
      throw new Error("LaunchJourneySuiteManager requires an audit log instance");
    }
    this.audit = options.audit;
    this.enforceStrictParity = options.enforceStrictParity ?? true;
    this.minRequiredGates = options.minRequiredGates ?? 9;
  }

  public recordJourneyProof(record: JourneyProofRecord): JourneyProofRecord {
    if (!record || typeof record !== "object") {
      throw new Error("Invalid journey proof record");
    }
    if (!record.journeyId || record.journeyId.trim() === "") {
      throw new Error("Journey proof requires a non-empty journeyId");
    }
    if (!record.journeyCategory) {
      throw new Error("Journey proof requires a valid journeyCategory");
    }
    if (!record.commandEnvelopeId || record.commandEnvelopeId.trim() === "") {
      throw new Error("Journey proof requires a non-empty commandEnvelopeId");
    }

    const allVerified =
      record.authoritativeStateVerified === true &&
      record.ledgerVerified === true &&
      record.projectionVerified === true &&
      record.notificationVerified === true &&
      record.auditVerified === true &&
      record.conventionalRouteVerified === true &&
      record.permittedChannelVerified === true;

    if (!allVerified) {
      throw new Error(
        `Journey proof ${record.journeyId} failed verification: authoritative state, ledger, projection, notification, audit, conventional route, and channel behavior must all be proved.`
      );
    }

    this.journeyProofs.set(record.journeyId, { ...record });

    this.audit.record({
      timestamp: new Date().toISOString(),
      action: "record_journey_proof",
      actorId: "launch_suite_runner",
      tenantId: "platform",
      details: {
        journeyId: record.journeyId,
        journeyCategory: record.journeyCategory,
        channel: record.channel,
        commandEnvelopeId: record.commandEnvelopeId
      }
    });

    return record;
  }

  public getJourneyProofs(): JourneyProofRecord[] {
    return Array.from(this.journeyProofs.values());
  }

  public recordExecutionPath(record: ExecutionPathRecord): ExecutionPathRecord {
    if (!record || typeof record !== "object") {
      throw new Error("Invalid execution path record");
    }
    if (!record.pathId || record.pathId.trim() === "") {
      throw new Error("Execution path requires a non-empty pathId");
    }
    if (!record.journeyId || record.journeyId.trim() === "") {
      throw new Error("Execution path requires a non-empty journeyId");
    }
    if (!record.pathType) {
      throw new Error("Execution path requires a valid pathType");
    }

    if (record.handled !== true) {
      throw new Error(
        `Execution path ${record.pathId} (${record.pathType}) was not handled successfully.`
      );
    }

    this.executionPaths.set(record.pathId, { ...record });

    this.audit.record({
      timestamp: new Date().toISOString(),
      action: "record_execution_path",
      actorId: "launch_suite_runner",
      tenantId: "platform",
      details: {
        pathId: record.pathId,
        journeyId: record.journeyId,
        pathType: record.pathType,
        handled: record.handled,
        recoveryAction: record.recoveryAction ?? "none"
      }
    });

    return record;
  }

  public getExecutionPaths(): ExecutionPathRecord[] {
    return Array.from(this.executionPaths.values());
  }

  public verifyDeterministicParity(
    fixture: DeterministicParityFixture
  ): DeterministicParityFixture {
    if (!fixture || typeof fixture !== "object") {
      throw new Error("Invalid parity fixture");
    }
    if (!fixture.fixtureId || fixture.fixtureId.trim() === "") {
      throw new Error("Parity fixture requires a non-empty fixtureId");
    }
    if (!fixture.workflowName || fixture.workflowName.trim() === "") {
      throw new Error("Parity fixture requires a non-empty workflowName");
    }
    if (!fixture.commandType || fixture.commandType.trim() === "") {
      throw new Error("Parity fixture requires a non-empty commandType");
    }
    if (!Array.isArray(fixture.interfacesTested) || fixture.interfacesTested.length < 2) {
      throw new Error("Parity fixture requires testing across at least 2 distinct interfaces");
    }

    const parityOk =
      fixture.envelopeSchemaMatched === true &&
      fixture.semanticsIdentical === true &&
      fixture.authorizationEnforced === true &&
      fixture.concurrencyEnforced === true &&
      fixture.auditParityVerified === true;

    if (!parityOk) {
      throw new Error(
        `Deterministic parity failed for fixture ${fixture.fixtureId}: command semantics or controls mismatched across material interfaces.`
      );
    }

    this.parityFixtures.set(fixture.fixtureId, { ...fixture });

    this.audit.record({
      timestamp: new Date().toISOString(),
      action: "verify_deterministic_parity",
      actorId: "launch_suite_runner",
      tenantId: "platform",
      details: {
        fixtureId: fixture.fixtureId,
        workflowName: fixture.workflowName,
        commandType: fixture.commandType,
        interfaceCount: fixture.interfacesTested.length
      }
    });

    return fixture;
  }

  public getParityFixtures(): DeterministicParityFixture[] {
    return Array.from(this.parityFixtures.values());
  }

  public closeValidationGate(gate: ValidationGateRecord): ValidationGateRecord {
    if (!gate || typeof gate !== "object") {
      throw new Error("Invalid validation gate record");
    }
    if (!gate.gateId || gate.gateId.trim() === "") {
      throw new Error("Validation gate requires a non-empty gateId");
    }
    if (!gate.gateName || gate.gateName.trim() === "") {
      throw new Error("Validation gate requires a non-empty gateName");
    }
    if (!gate.gateType) {
      throw new Error("Validation gate requires a valid gateType");
    }

    if (gate.status !== "closed") {
      throw new Error(
        `Validation gate ${gate.gateId} (${gate.gateType}) must be closed before release. Current status: ${gate.status}`
      );
    }

    const closedGate: ValidationGateRecord = {
      ...gate,
      closedAt: gate.closedAt ?? new Date().toISOString()
    };

    this.validationGates.set(gate.gateId, closedGate);

    this.audit.record({
      timestamp: new Date().toISOString(),
      action: "close_validation_gate",
      actorId: "launch_suite_runner",
      tenantId: "platform",
      details: {
        gateId: gate.gateId,
        gateType: gate.gateType,
        gateName: gate.gateName,
        status: closedGate.status
      }
    });

    return closedGate;
  }

  public getValidationGates(): ValidationGateRecord[] {
    return Array.from(this.validationGates.values());
  }

  public evaluateReleaseReadiness(): ReleaseReadinessSummary {
    const requiredCategories: JourneyCategory[] = [
      "ordinary_booking",
      "same_day_booking",
      "payment_failure_and_retry",
      "late_payment_refund",
      "failed_access_and_relocation",
      "operator_cancellation",
      "booking_amendment",
      "deposit_claim_and_appeal",
      "operator_holds_and_turnover",
      "payout_projections",
      "support_takeover",
      "administrative_recovery"
    ];

    const requiredPathTypes: ExecutionPathType[] = [
      "success",
      "timeout",
      "duplicate",
      "concurrency",
      "provider_failure",
      "agent_outage",
      "human_handoff",
      "reconciliation"
    ];

    const requiredGateTypes: ValidationGateType[] = [
      "provider",
      "legal",
      "privacy",
      "operator",
      "operational",
      "accessibility",
      "security",
      "reliability",
      "protocol"
    ];

    const recordedCategories = new Set(
      Array.from(this.journeyProofs.values()).map((p) => p.journeyCategory)
    );
    const recordedPathTypes = new Set(
      Array.from(this.executionPaths.values()).map((p) => p.pathType)
    );
    const closedGateTypes = new Set(
      Array.from(this.validationGates.values())
        .filter((g) => g.status === "closed")
        .map((g) => g.gateType)
    );

    const missingCategories = requiredCategories.filter((c) => !recordedCategories.has(c));
    const missingPathTypes = requiredPathTypes.filter((p) => !recordedPathTypes.has(p));
    const missingGateTypes = requiredGateTypes.filter((g) => !closedGateTypes.has(g));

    const totalClosedGates = this.validationGates.size;
    const ready =
      missingCategories.length === 0 &&
      missingPathTypes.length === 0 &&
      missingGateTypes.length === 0 &&
      totalClosedGates >= this.minRequiredGates &&
      (!this.enforceStrictParity || this.parityFixtures.size > 0);

    return {
      ready,
      summary: {
        totalJourneys: this.journeyProofs.size,
        totalExecutionPaths: this.executionPaths.size,
        totalParityFixtures: this.parityFixtures.size,
        totalClosedGates,
        missingCategories,
        missingPathTypes,
        missingGateTypes
      }
    };
  }
}
