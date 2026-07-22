import test from "node:test";
import assert from "node:assert/strict";
import { OperatorEnforcementManager } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

test("Severity, recurrence, attribution, restoration, revocation, and egregious-event thresholds follow accepted policy", () => {
  const manager = new OperatorEnforcementManager();

  // 1. Single serious turnover failure
  manager.recordIncident({
    incidentId: "inc-turn-1",
    operatorId: "op-801",
    unitId: "unit-801",
    incidentType: "turnover_defect",
    severity: "serious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-01T10:00:00.000Z"
  });

  let eval1 = manager.evaluateGraduatedEnforcement({ operatorId: "op-801", unitId: "unit-801" });
  assert.equal(eval1.turnoverCapability, "suspended");
  assert.equal(eval1.enforcementLevel, "coaching");

  // Second serious turnover failure -> Turnover Revocation (ADR 0038)
  manager.recordIncident({
    incidentId: "inc-turn-2",
    operatorId: "op-801",
    unitId: "unit-801",
    incidentType: "turnover_defect",
    severity: "serious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-05T10:00:00.000Z"
  });

  let eval2 = manager.evaluateGraduatedEnforcement({ operatorId: "op-801", unitId: "unit-801" });
  assert.equal(eval2.turnoverCapability, "revoked");
  assert.equal(eval2.enforcementLevel, "restriction");

  // Egregious safety incident on another unit -> Immediate operator-wide pause review
  manager.recordIncident({
    incidentId: "inc-safety-1",
    operatorId: "op-802",
    unitId: "unit-802",
    incidentType: "safety_failure",
    severity: "egregious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-06T10:00:00.000Z"
  });

  let evalSafety = manager.evaluateGraduatedEnforcement({ operatorId: "op-802", unitId: "unit-802" });
  assert.equal(evalSafety.enforcementLevel, "operator_pause");
});

test("Provider/platform faults and extraordinary events do not count as Operator misconduct", () => {
  const manager = new OperatorEnforcementManager();

  // Platform fault incident
  manager.recordIncident({
    incidentId: "inc-plat-1",
    operatorId: "op-901",
    unitId: "unit-901",
    incidentType: "response_failure",
    severity: "serious",
    attribution: "platform_fault",
    reportedAtIso: "2026-09-01T10:00:00.000Z"
  });

  // Extraordinary event incident (e.g. citywide power grid failure)
  manager.recordIncident({
    incidentId: "inc-extra-1",
    operatorId: "op-901",
    unitId: "unit-901",
    incidentType: "turnover_defect",
    severity: "egregious",
    attribution: "extraordinary_event",
    reportedAtIso: "2026-09-02T10:00:00.000Z"
  });

  const evaluation = manager.evaluateGraduatedEnforcement({ operatorId: "op-901", unitId: "unit-901" });
  // Misconduct count MUST be 0
  assert.equal(evaluation.misconductCount, 0);
  assert.equal(evaluation.enforcementLevel, "coaching"); // Default baseline, no restrictions
});

test("Immediate protection is distinguished from the independent human final decision and seven-day appeal", () => {
  const manager = new OperatorEnforcementManager();

  // Apply immediate protective suspension
  const protective = manager.applyImmediateProtectiveAction({
    operatorId: "op-1001",
    unitId: "unit-1001",
    reason: "Alleged safety breach - gas leak reported",
    initiatedBy: "support-agent-1"
  });

  assert.equal(protective.status, "protective_suspension_active");
  assert.equal(protective.isFinalDecision, false);

  // Autonomous system trying to finalize enforcement decision fails
  const botEnvelope = createPlatformCommandEnvelope({
    commandName: "operator_enforcement.finalize",
    principal: { id: "bot-ai", role: "agent", tenantId: "tenant-lagos" },
    payload: { enforcementId: protective.enforcementId, decision: "unit_suspension" }
  });

  assert.throws(
    () => manager.finalizeEnforcementDecision(botEnvelope, protective.enforcementId, "unit_suspension"),
    /Final enforcement decisions require an authorized human reviewer/
  );

  // Human final decision succeeds
  const humanEnvelope = createPlatformCommandEnvelope({
    commandName: "operator_enforcement.finalize",
    principal: { id: "human-compliance-ada", role: "admin", tenantId: "tenant-lagos" },
    payload: { enforcementId: protective.enforcementId, decision: "unit_suspension" }
  });

  const finalized = manager.finalizeEnforcementDecision(humanEnvelope, protective.enforcementId, "unit_suspension");
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.isFinalDecision, true);

  // Operator files 7-day appeal
  const appeal = manager.fileEnforcementAppeal({
    operatorId: "op-1001",
    enforcementId: protective.enforcementId,
    appellantId: "op-1001-owner",
    statement: "Gas safety certificate provided, false alarm",
    evidenceUrls: ["https://evidence.example.com/cert.pdf"],
    filedAtIso: "2026-09-03T10:00:00.000Z"
  });
  assert.equal(appeal.status, "appeal_pending");

  // Appeal resolution by independent reviewer (different from initial decision maker)
  const resolvedAppeal = manager.resolveEnforcementAppeal({
    enforcementId: protective.enforcementId,
    reviewerId: "indep-human-judge-2",
    decision: "exonerated",
    rationale: "Safety certificate verified by local authority"
  });

  assert.equal(resolvedAppeal.status, "exonerated");
});

test("One underlying incident is not multiplied by downstream reports, and every affected feature or Unit projection updates consistently", () => {
  const manager = new OperatorEnforcementManager();

  // Root incident reported by guest
  manager.recordIncident({
    incidentId: "inc-guest-rep",
    rootIncidentId: "root-inc-777",
    operatorId: "op-1101",
    unitId: "unit-1101",
    incidentType: "calendar_error",
    severity: "serious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-01T10:00:00.000Z"
  });

  // Same root incident reported downstream by support / cleaning inspector
  manager.recordIncident({
    incidentId: "inc-support-rep",
    rootIncidentId: "root-inc-777", // Same root incident!
    operatorId: "op-1101",
    unitId: "unit-1101",
    incidentType: "calendar_error",
    severity: "serious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-01T10:15:00.000Z"
  });

  const evaluation = manager.evaluateGraduatedEnforcement({ operatorId: "op-1101", unitId: "unit-1101" });
  // Incident count MUST be 1 (not duplicated)
  assert.equal(evaluation.misconductCount, 1);

  // Projections update consistently across unit and operator features for 1 incident (coaching)
  const proj1 = manager.getProjections({ operatorId: "op-1101", unitId: "unit-1101" });
  assert.equal(proj1.unitStatus, "active");
  assert.equal(proj1.operatorStatus, "active");

  // Record a second distinct root incident -> restriction
  manager.recordIncident({
    incidentId: "inc-second-root",
    rootIncidentId: "root-inc-888",
    operatorId: "op-1101",
    unitId: "unit-1101",
    incidentType: "substitution",
    severity: "serious",
    attribution: "operator_misconduct",
    reportedAtIso: "2026-09-02T10:00:00.000Z"
  });

  const proj2 = manager.getProjections({ operatorId: "op-1101", unitId: "unit-1101" });
  assert.equal(proj2.misconductCount, 2);
  assert.equal(proj2.unitStatus, "restricted");
  assert.equal(proj2.operatorStatus, "active_with_restrictions");
});
