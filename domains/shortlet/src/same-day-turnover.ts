/**
 * Qualify a Unit for Same-Day Turnover (Issue 14).
 * Implements ADR 0034, 0035, 0036, 0037, 0038.
 */

export const REQUIRED_TURNOVER_CHECKLIST: readonly string[] = Object.freeze([
  "entire-place-sanitation",
  "linen-and-towel-change",
  "trash-removal",
  "locks-and-privacy-check",
  "essential-utilities-check",
  "critical-amenities-check",
  "listing-accuracy-verify"
]);

export interface EvaluateUnitEligibilityOptions {
  completedStaysCount?: number;
  observedRuns?: any[];
  messageAckRate?: number;
  missedEscalationCount?: number;
  contactsReachable?: boolean;
}

export function evaluateUnitEligibilityForSameDayTurnover({
  completedStaysCount = 0,
  observedRuns = [],
  messageAckRate = 1.0,
  missedEscalationCount = 0,
  contactsReachable = true
}: EvaluateUnitEligibilityOptions): { eligible: boolean; reason?: string } {
  if (completedStaysCount < 5) {
    return { eligible: false, reason: "Requires at least 5 completed platform stays" };
  }
  const passedRuns = observedRuns.filter((r) => r.status === "passed");
  if (passedRuns.length < 3) {
    return { eligible: false, reason: "Requires at least 3 successful platform-observed Turnover Runs" };
  }
  const realStayRuns = passedRuns.filter((r) => r.followingRealStay === true);
  if (realStayRuns.length < 2) {
    return { eligible: false, reason: "At least 2 observed Turnover Runs must follow real guest stays" };
  }
  if (messageAckRate < 0.90) {
    return { eligible: false, reason: "Operational message acknowledgement rate must be at least 90%" };
  }
  if (missedEscalationCount > 0) {
    return { eligible: false, reason: "Cannot have missed urgent escalations" };
  }
  if (!contactsReachable) {
    return { eligible: false, reason: "Primary and backup contacts must be reachable during every observed run" };
  }

  return { eligible: true };
}

export interface ApproveUnitSameDayTurnoverOptions {
  unit: any;
  earliestSameDayArrival?: string;
  turnoverPlan: any;
  reviewerId: string;
}

export function approveUnitSameDayTurnover({
  unit,
  earliestSameDayArrival = "15:00",
  turnoverPlan,
  reviewerId
}: ApproveUnitSameDayTurnoverOptions) {
  if (!unit || typeof unit !== "object") throw new TypeError("Valid unit is required");
  if (!reviewerId) throw new Error("Reviewer ID is required for human operational review approval");
  if (!turnoverPlan || !turnoverPlan.primaryCleanerId || !turnoverPlan.backupCleanerId) {
    throw new Error("Turnover Plan must include confirmed primary and backup cleaning contacts");
  }

  unit.sameDayTurnover = {
    status: "approved",
    earliestSameDayArrival,
    approvedAt: new Date().toISOString(),
    approvedBy: reviewerId,
    turnoverPlan: Object.freeze({
      ...turnoverPlan,
      checklist: turnoverPlan.checklist ?? [...REQUIRED_TURNOVER_CHECKLIST]
    }),
    seriousFailureCount: unit.sameDayTurnover?.seriousFailureCount ?? 0
  };

  return unit.sameDayTurnover;
}

export interface CreateTurnoverRunOptions {
  unitId: string;
  operatorId: string;
  priorCheckoutAt: string;
  readinessDeadline: string;
  turnoverPlan?: any;
  clock?: () => Date;
  idFactory?: () => string;
}

export function createTurnoverRun({
  unitId,
  operatorId,
  priorCheckoutAt,
  readinessDeadline,
  turnoverPlan,
  clock = () => new Date(),
  idFactory = () => crypto.randomUUID()
}: CreateTurnoverRunOptions) {
  if (!unitId || !operatorId || !priorCheckoutAt || !readinessDeadline) {
    throw new Error("unitId, operatorId, priorCheckoutAt, and readinessDeadline are required");
  }

  const runId = `turn-${idFactory()}`;
  const nowIso = clock().toISOString();

  return {
    runId,
    unitId,
    operatorId,
    priorCheckoutAt,
    readinessDeadline,
    readinessState: "pending",
    turnoverPlan: turnoverPlan ?? { checklist: [...REQUIRED_TURNOVER_CHECKLIST] },
    evidence: {
      completedChecklist: [] as string[],
      photoEvidenceUrls: [] as string[],
      testedAccessVerified: false,
      essentialUtilitiesVerified: false
    },
    auditTrail: [
      { timestamp: nowIso, action: "created", actorId: operatorId, details: "Turnover Run created" }
    ],
    incomingBookingDate: undefined as string | undefined
  };
}

export interface SubmitTurnoverRunEvidenceOptions {
  run: any;
  evidence?: any;
  actorId: string;
  clock?: () => Date;
}

export function submitTurnoverRunEvidence({ run, evidence = {}, actorId, clock = () => new Date() }: SubmitTurnoverRunEvidenceOptions) {
  if (!run) throw new TypeError("TurnoverRun is required");
  if (run.readinessState === "missed_deadline" || run.readinessState === "failed") {
    throw new Error(`Cannot submit evidence for run in state '${run.readinessState}'`);
  }

  const nowIso = clock().toISOString();
  const updatedEvidence = {
    completedChecklist: evidence.completedChecklist ?? run.evidence.completedChecklist,
    photoEvidenceUrls: evidence.photoEvidenceUrls ?? run.evidence.photoEvidenceUrls,
    testedAccessVerified: evidence.testedAccessVerified ?? run.evidence.testedAccessVerified,
    essentialUtilitiesVerified: evidence.essentialUtilitiesVerified ?? run.evidence.essentialUtilitiesVerified
  };

  run.evidence = updatedEvidence;
  run.auditTrail.push({
    timestamp: nowIso,
    action: "evidence_submitted",
    actorId,
    details: "Turnover evidence submitted"
  });

  const requiredItems = run.turnoverPlan?.checklist ?? REQUIRED_TURNOVER_CHECKLIST;
  const checklistPassed = requiredItems.every((item: string) => updatedEvidence.completedChecklist.includes(item));

  if (checklistPassed && updatedEvidence.testedAccessVerified && updatedEvidence.essentialUtilitiesVerified) {
    run.readinessState = "ready_for_arrival";
    run.completedAt = nowIso;
    run.auditTrail.push({
      timestamp: nowIso,
      action: "marked_ready_for_arrival",
      actorId,
      details: "Observed readiness confirmed: Ready for Arrival"
    });
  } else {
    run.readinessState = "in_progress";
  }

  return run;
}

export interface CheckTurnoverRunReadinessOptions {
  run: any;
  unit: any;
  incidentWorkflow?: any;
  availabilityCalendar?: any;
  clock?: () => Date;
}

export function checkTurnoverRunReadiness({
  run,
  unit,
  incidentWorkflow = null,
  availabilityCalendar = null,
  clock = () => new Date()
}: CheckTurnoverRunReadinessOptions) {
  if (!run || !unit) throw new TypeError("TurnoverRun and Unit are required");

  const now = clock();
  const deadline = new Date(run.readinessDeadline);

  if (now > deadline && run.readinessState !== "ready_for_arrival") {
    run.readinessState = "missed_deadline";
    const nowIso = now.toISOString();

    run.auditTrail.push({
      timestamp: nowIso,
      action: "readiness_deadline_missed",
      actorId: "system",
      details: "Readiness deadline missed before Ready for Arrival established"
    });

    if (!unit.sameDayTurnover) unit.sameDayTurnover = {};
    unit.sameDayTurnover.status = "suspended";
    unit.sameDayTurnover.suspendedAt = nowIso;
    unit.sameDayTurnover.suspensionReason = "Missed turnover readiness deadline";

    let incidentRecord = null;
    if (incidentWorkflow) {
      incidentRecord = incidentWorkflow.openBlockingFulfilmentComplaint({
        unitId: unit.id,
        runId: run.runId,
        reason: "Missed turnover readiness deadline",
        humanOwnershipRequired: true,
        pageSupport: true,
        notifyGuest: true,
        searchComparableReplacements: true
      });
    }

    if (availabilityCalendar && run.incomingBookingDate) {
      const startDate = new Date(run.incomingBookingDate);
      const nextDate = new Date(startDate.getTime() + 86400000);
      const endStr = nextDate.toISOString().slice(0, 10);

      availabilityCalendar.addOperatorBlock({
        unitId: unit.id,
        operatorId: run.operatorId,
        start: run.incomingBookingDate,
        end: endStr,
        reason: "Availability protected due to missed turnover deadline",
        clock
      });
    }

    return {
      deadlinePassed: true,
      actionTaken: "suspended_and_escalated",
      run,
      unitStatus: unit.sameDayTurnover.status,
      incidentRecord
    };
  }

  return { deadlinePassed: false, run, unitStatus: unit.sameDayTurnover?.status ?? "disabled" };
}

export interface RestoreSameDayTurnoverOptions {
  unit: any;
  failureClassification: "evidence_only" | "actual_operational_delay" | "serious_failure" | string;
  evidenceProof?: boolean;
  newObservedRuns?: any[];
  rootCauseRemediated?: boolean;
  approverId: string;
  isSeniorApproval?: boolean;
}

export function restoreSameDayTurnoverCapability({
  unit,
  failureClassification,
  evidenceProof = false,
  newObservedRuns = [],
  rootCauseRemediated = false,
  approverId,
  isSeniorApproval = false
}: RestoreSameDayTurnoverOptions) {
  if (!unit || !unit.sameDayTurnover) throw new Error("Unit has no same-day turnover record");
  if (!approverId) throw new Error("Human approver ID is required for restoration");

  if (failureClassification === "evidence_only") {
    if (!evidenceProof) {
      throw new Error("Evidence-only miss restoration requires proof of timely readiness and no guest impact");
    }
  } else if (failureClassification === "actual_operational_delay") {
    if (!rootCauseRemediated) {
      throw new Error("Actual operational delay restoration requires root-cause remediation");
    }
    const passedRuns = newObservedRuns.filter((r) => r.status === "passed");
    if (passedRuns.length < 1) {
      throw new Error("Actual operational delay restoration requires 1 newly observed successful Turnover Run");
    }
  } else if (failureClassification === "serious_failure") {
    if (!rootCauseRemediated) {
      throw new Error("Serious failure restoration requires completed incident remediation");
    }
    if (!isSeniorApproval) {
      throw new Error("Serious failure restoration requires senior human approval");
    }
    const passedRuns = newObservedRuns.filter((r) => r.status === "passed");
    const realStayRuns = passedRuns.filter((r) => r.followingRealStay === true);
    if (passedRuns.length < 3 || realStayRuns.length < 2) {
      throw new Error("Serious failure restoration requires 3 new observed runs with at least 2 following real stays");
    }
  } else {
    throw new Error(`Unknown failure classification '${failureClassification}'`);
  }

  unit.sameDayTurnover.status = "approved";
  unit.sameDayTurnover.restoredAt = new Date().toISOString();
  unit.sameDayTurnover.restoredBy = approverId;
  unit.sameDayTurnover.lastFailureClassification = failureClassification;

  return unit.sameDayTurnover;
}

export interface RevokeSameDayTurnoverOptions {
  unit: any;
  reason: string;
  isEgregious?: boolean;
  reviewerId: string;
  secondReviewerId?: string | null;
}

export function revokeSameDayTurnoverCapability({
  unit,
  reason,
  isEgregious = false,
  reviewerId,
  secondReviewerId = null
}: RevokeSameDayTurnoverOptions) {
  if (!unit || !unit.sameDayTurnover) throw new Error("Unit has no same-day turnover record");
  if (!reviewerId) throw new Error("Reviewer ID is required for revocation");

  if (isEgregious && !secondReviewerId) {
    throw new Error("Egregious failure revocation requires two-person senior approval");
  }

  const currentFailures = (unit.sameDayTurnover.seriousFailureCount ?? 0) + (isEgregious ? 0 : 1);
  unit.sameDayTurnover.seriousFailureCount = currentFailures;

  if (isEgregious || currentFailures >= 2) {
    unit.sameDayTurnover.status = "revoked";
    unit.sameDayTurnover.revokedAt = new Date().toISOString();
    unit.sameDayTurnover.revocationReason = reason;
    unit.sameDayTurnover.revokedBy = [reviewerId, secondReviewerId].filter(Boolean);
    return { revoked: true, unitStatus: "revoked", seriousFailureCount: currentFailures };
  }

  unit.sameDayTurnover.status = "suspended";
  return { revoked: false, unitStatus: "suspended", seriousFailureCount: currentFailures };
}

export function isSameDayTurnoverPermitted(unit: any, priorCheckoutDate: string, requestedCheckInDate: string, requestedCheckInTime = "15:00"): boolean {
  if (!unit || unit.sameDayTurnover?.status !== "approved") {
    return false;
  }
  if (requestedCheckInDate !== priorCheckoutDate) {
    return true;
  }
  const earliest = unit.sameDayTurnover.earliestSameDayArrival ?? "15:00";
  return requestedCheckInTime >= earliest;
}
