import test from "node:test";
import assert from "node:assert/strict";
import { OperatorEnforcementManager } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

const clock = () => new Date("2026-09-10T10:00:00.000Z");
function command<T>(commandName: string, payload: T, role: "admin" | "authorized_staff" | "agent" | "operator" = "admin", id = "human-1", tenantId = "tenant-lagos"): PlatformCommandEnvelope<T> {
  return createPlatformCommandEnvelope({ commandName, payload, principal: { id, role, tenantId } });
}
function incident(manager: OperatorEnforcementManager, input: Partial<Parameters<typeof manager.recordIncident>[0]> & { incidentId: string; operatorId: string; unitId: string; incidentType: Parameters<typeof manager.recordIncident>[0]["incidentType"]; severity: Parameters<typeof manager.recordIncident>[0]["severity"]; attribution?: Parameters<typeof manager.recordIncident>[0]["attribution"] }) {
  manager.recordIncident({ reportedAtIso: "2026-09-01T10:00:00.000Z", attribution: "operator_misconduct", ...input });
}

 test("Severity, recurrence, attribution, restoration, revocation, and egregious-event thresholds follow accepted policy", () => {
  const manager = new OperatorEnforcementManager({ clock });
  incident(manager, { incidentId: "t1", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  incident(manager, { incidentId: "t2", rootIncidentId: "t1", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  assert.equal(manager.evaluateGraduatedEnforcement({ operatorId: "op", unitId: "u" }).misconductCount, 1);
  assert.equal(manager.evaluateGraduatedEnforcement({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  const action = manager.applyImmediateProtectiveAction({ operatorId: "op", unitId: "u", reason: "turnover risk", initiatedBy: "support" });
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: action.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension" }));
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  incident(manager, { incidentId: "t3", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "revoked");
  incident(manager, { incidentId: "eg", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "egregious" });
  const egregiousAction = manager.applyImmediateProtectiveAction({ operatorId: "op", unitId: "u", reason: "egregious turnover", initiatedBy: "support" });
  assert.throws(() => manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: egregiousAction.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension" })), /two-person/);
  manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: egregiousAction.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension", approvalTier: "two_person", secondApproverId: "senior-2" }));
  assert.throws(() => manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: action.enforcementId, operatorId: "op", unitId: "u", decision: "termination" })), /senior/);
});

test("Provider/platform faults and extraordinary events do not count as Operator misconduct", () => {
  const manager = new OperatorEnforcementManager({ clock });
  for (const [id, attribution] of [["p", "platform_fault"], ["v", "provider_fault"], ["x", "extraordinary_event"]] as const) incident(manager, { incidentId: id, operatorId: "op", unitId: "u", incidentType: "safety_failure", severity: "egregious", attribution });
  assert.equal(manager.evaluateGraduatedEnforcement({ operatorId: "op", unitId: "u" }).misconductCount, 0);
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).operatorStatus, "active");
});

test("Immediate protection is distinguished from the independent human final decision and seven-day appeal", () => {
  const manager = new OperatorEnforcementManager({ clock });
  const action = manager.applyImmediateProtectiveAction({ operatorId: "op", unitId: "u", reason: "safety", initiatedBy: "support" });
  assert.equal(action.isFinalDecision, false);
  assert.throws(() => manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: action.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension" }, "agent", "bot")), /authorized human/);
  manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: action.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension" }));
  manager.recordEnforcementNotice({ enforcementId: action.enforcementId, status: "failed" });
  assert.throws(() => manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "op", statement: "appeal", evidenceReferences: ["evidence-1"] }, "operator", "op")), /successful/);
  manager.recordEnforcementNotice({ enforcementId: action.enforcementId, status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  const appeal = manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "op", statement: "appeal", evidenceReferences: ["evidence-1"] }, "operator", "op"));
  assert.equal(appeal.status, "appeal_pending");
  const lateManager = new OperatorEnforcementManager({ clock: () => new Date("2026-09-18T10:00:00.000Z") });
  const lateAction = lateManager.applyImmediateProtectiveAction({ operatorId: "late-op", unitId: "late-u", reason: "safety", initiatedBy: "support" });
  lateManager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: lateAction.enforcementId, operatorId: "late-op", unitId: "late-u", decision: "unit_suspension" }));
  lateManager.recordEnforcementNotice({ enforcementId: lateAction.enforcementId, status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  assert.throws(() => lateManager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: lateAction.enforcementId, operatorId: "late-op", appellantId: "late-op", statement: "late", evidenceReferences: [] }, "operator", "late-op")), /expired/);
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).protectiveActionActive, true);
  assert.throws(() => manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "op", statement: "again", evidenceReferences: [] }, "operator", "op")), /one ordinary/);
  assert.throws(() => manager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: action.enforcementId, operatorId: "op", decision: "upheld", rationale: "ok" }, "authorized_staff", "human-1")), /independent/);
  assert.throws(() => manager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: action.enforcementId, operatorId: "op", decision: "upheld", rationale: "ok" }, "agent", "human-2")), /authorized human/);
  assert.equal(manager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: action.enforcementId, operatorId: "op", decision: "upheld", rationale: "ok" }, "authorized_staff", "human-2")).status, "upheld");
});

test("One underlying incident is not multiplied by downstream reports, and every affected feature or Unit projection updates consistently", () => {
  const manager = new OperatorEnforcementManager({ clock });
  incident(manager, { incidentId: "r1", rootIncidentId: "root", operatorId: "op", unitId: "u1", incidentType: "calendar_error", severity: "serious" });
  incident(manager, { incidentId: "r2", rootIncidentId: "root", operatorId: "op", unitId: "u1", incidentType: "calendar_error", severity: "serious" });
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).misconductCount, 1);
  const local = manager.applyImmediateProtectiveAction({ operatorId: "op", unitId: "u1", reason: "calendar", initiatedBy: "staff" });
  manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: local.enforcementId, operatorId: "op", unitId: "u1", decision: "unit_suspension" }));
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).unitStatus, "suspended");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u2" }).unitStatus, "active");
  const wide = manager.applyImmediateProtectiveAction({ operatorId: "op", unitId: "u1", reason: "operator pause", initiatedBy: "staff" });
  manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: wide.enforcementId, operatorId: "op", unitId: "u1", decision: "operator_pause" }));
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u2" }).operatorStatus, "paused");
});
