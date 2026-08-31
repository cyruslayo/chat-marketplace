import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperatorEnforcementManager, SqliteOperatorRepresentativeGrantStore } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type PlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";

const clock = () => new Date("2026-09-10T10:00:00.000Z");
const operatorAuthority = { canActForOperator: ({ actorId, operatorId }: { actorId: string; operatorId: string; tenantId: string }) => actorId === "operator-actor" && operatorId === "op" };
function command<T>(commandName: string, payload: T, role: "admin" | "authorized_staff" | "agent" | "operator" | "guest" | "system" = "admin", id = "human-1", tenantId = "tenant-lagos", idempotencyKey?: string): PlatformCommandEnvelope<T> {
  return createPlatformCommandEnvelope({ commandName, payload, principal: { id, role, tenantId }, ...(idempotencyKey ? { idempotencyKey } : {}) });
}
function grantCommand(payload: { actorId: string; operatorId: string; expiresAtIso: string; responsiblePersonVerifiedAtIso: string }, idempotencyKey: string, principal: CommandPrincipal = { id: "admin-1", role: "admin", tenantId: "tenant-lagos" }): PlatformCommandEnvelope<typeof payload> {
  return command("operator_representative.grant", payload, principal.role, principal.id, principal.tenantId, idempotencyKey);
}
function incident(manager: OperatorEnforcementManager, input: Partial<Parameters<typeof manager.recordIncident>[0]> & { incidentId: string; operatorId: string; unitId: string; incidentType: Parameters<typeof manager.recordIncident>[0]["incidentType"]; severity: Parameters<typeof manager.recordIncident>[0]["severity"]; attribution?: Parameters<typeof manager.recordIncident>[0]["attribution"] }) {
  manager.recordIncident({ reportedAtIso: "2026-09-01T10:00:00.000Z", attribution: "operator_misconduct", ...input });
}
function protect(manager: OperatorEnforcementManager, operatorId: string, unitId: string, id = "support-1", tenantId = "tenant-lagos") {
  return manager.applyImmediateProtectiveAction(command("operator_enforcement.protective_action", { operatorId, unitId, reason: "turnover risk" }, "authorized_staff", id, tenantId));
}
function finalize(manager: OperatorEnforcementManager, enforcementId: string, operatorId: string, unitId: string, classifiedIncidentIds: readonly string[] = [], decision: "unit_suspension" | "operator_pause" | "termination" = "unit_suspension", id = "human-1", tenantId = "tenant-lagos", approvalTier?: "two_person") {
  return manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId, operatorId, unitId, decision, classifiedIncidentIds, ...(approvalTier ? { approvalTier, secondApproverId: "human-2" } : {}) }, "authorized_staff", id, tenantId));
}

test("Severity, recurrence, attribution, restoration, revocation, and egregious-event thresholds follow accepted policy", () => {
  const manager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(manager, { incidentId: "s1", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  incident(manager, { incidentId: "s2", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  const first = protect(manager, "op", "u");
  finalize(manager, first.enforcementId, "op", "u", ["s1"]);
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).enforcementLevel, "unit_suspension");
  const second = protect(manager, "op", "u", "support-2");
  finalize(manager, second.enforcementId, "op", "u", ["s2"]);
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "revoked");

  const duplicateManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(duplicateManager, { incidentId: "d1", rootIncidentId: "root", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "egregious" });
  incident(duplicateManager, { incidentId: "d2", rootIncidentId: "root", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "egregious" });
  const duplicateAction = protect(duplicateManager, "op", "u");
  finalize(duplicateManager, duplicateAction.enforcementId, "op", "u", ["d1", "d2"], "unit_suspension", "human-1", "tenant-lagos", "two_person");
  assert.equal(duplicateManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "revoked");

  const restoreManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(restoreManager, { incidentId: "r", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  const restoreAction = protect(restoreManager, "op", "u");
  const restoredFinal = finalize(restoreManager, restoreAction.enforcementId, "op", "u", ["r"]);
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  assert.throws(() => restoreManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: restoreAction.enforcementId, kind: "evidence_only_miss", timelyReadiness: true }, "operator", "op")), /Authorized human/);
  assert.throws(() => restoreManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: restoreAction.enforcementId, kind: "evidence_only_miss", timelyReadiness: true, noGuestImpact: true }, "authorized_staff", "restoration-reviewer")), /incomplete/);
  restoreManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: restoreAction.enforcementId, kind: "evidence_only_miss", timelyReadiness: true, noGuestImpact: true, correctedEvidenceWorkflow: true }, "authorized_staff", "restoration-reviewer"));
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).unitStatus, "active");
  assert.equal(restoredFinal.isFinalDecision, true);
  assert.equal(restoreAction.status, "protective_suspension_active");
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).misconductCount, 1);
  const laterAction = protect(restoreManager, "op", "u", "support-2");
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  restoreManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: restoreAction.enforcementId, kind: "evidence_only_miss", timelyReadiness: true, noGuestImpact: true, correctedEvidenceWorkflow: true }, "authorized_staff", "restoration-reviewer"));
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "suspended");
  restoreManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: laterAction.enforcementId, kind: "evidence_only_miss", timelyReadiness: true, noGuestImpact: true, correctedEvidenceWorkflow: true }, "authorized_staff", "restoration-reviewer"));
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  assert.equal(restoreManager.getProjections({ operatorId: "op", unitId: "other" }).turnoverCapability, "eligible");

  const operationalManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(operationalManager, { incidentId: "operational", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  const operationalAction = protect(operationalManager, "op", "u");
  finalize(operationalManager, operationalAction.enforcementId, "op", "u", ["operational"]);
  assert.throws(() => operationalManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: operationalAction.enforcementId, kind: "operational_delay_without_guest_impact", rootCauseRemediated: true, updatedTurnoverPlan: true, observedSuccessfulTurnoverRuns: 0, nextDateBlocked: true }, "authorized_staff", "restoration-reviewer")), /incomplete/);
  operationalManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: operationalAction.enforcementId, kind: "operational_delay_without_guest_impact", rootCauseRemediated: true, updatedTurnoverPlan: true, observedSuccessfulTurnoverRuns: 1, nextDateBlocked: true }, "authorized_staff", "restoration-reviewer"));
  assert.equal(operationalManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  assert.equal(operationalManager.getProjections({ operatorId: "op", unitId: "u" }).unitStatus, "active");

  const guestImpactManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(guestImpactManager, { incidentId: "guest-impact", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "serious" });
  const guestImpactAction = protect(guestImpactManager, "op", "u");
  finalize(guestImpactManager, guestImpactAction.enforcementId, "op", "u", ["guest-impact"]);
  assert.throws(() => guestImpactManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: guestImpactAction.enforcementId, kind: "guest_impacting_failure", incidentRemediated: true, observedSuccessfulTurnoverRuns: 2, runsAfterRealStays: 2, fullOperationalReapproval: true }, "authorized_staff", "restoration-reviewer")), /incomplete/);
  guestImpactManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: guestImpactAction.enforcementId, kind: "guest_impacting_failure", incidentRemediated: true, observedSuccessfulTurnoverRuns: 3, runsAfterRealStays: 2, fullOperationalReapproval: true, approvalTier: "senior" }, "authorized_staff", "restoration-reviewer"));
  assert.equal(guestImpactManager.getProjections({ operatorId: "op", unitId: "u" }).turnoverCapability, "eligible");
  assert.equal(guestImpactManager.getProjections({ operatorId: "op", unitId: "u" }).unitStatus, "active");

  const egregiousManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(egregiousManager, { incidentId: "eg", operatorId: "op", unitId: "u", incidentType: "turnover_defect", severity: "egregious" });
  const egregiousAction = protect(egregiousManager, "op", "u");
  assert.throws(() => finalize(egregiousManager, egregiousAction.enforcementId, "op", "u", ["eg"]), /two-person/);
  finalize(egregiousManager, egregiousAction.enforcementId, "op", "u", ["eg"], "unit_suspension", "human-1", "tenant-lagos", "two_person");
  assert.throws(() => egregiousManager.restoreTurnoverEligibility(command("operator_enforcement.restore_turnover", { operatorId: "op", unitId: "u", enforcementId: egregiousAction.enforcementId, kind: "guest_impacting_failure", incidentRemediated: true, observedSuccessfulTurnoverRuns: 3, runsAfterRealStays: 2, fullOperationalReapproval: true, approvalTier: "senior" }, "authorized_staff", "restoration-reviewer")), /revocation cannot be restored/);
});

test("Provider/platform faults and extraordinary events do not count as Operator misconduct", () => {
  const manager = new OperatorEnforcementManager({ clock, operatorAuthority });
  for (const [id, attribution] of [["p", "platform_fault"], ["v", "provider_fault"], ["x", "extraordinary_event"]] as const) incident(manager, { incidentId: id, operatorId: "op", unitId: "u", incidentType: "safety_failure", severity: "egregious", attribution });
  assert.equal(manager.evaluateGraduatedEnforcement({ operatorId: "op", unitId: "u" }).misconductCount, 0);
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).operatorStatus, "active");
});

test("Immediate protection is distinguished from the independent human final decision and seven-day appeal", async () => {
  const manager = new OperatorEnforcementManager({ clock, operatorAuthority });
  assert.throws(() => manager.applyImmediateProtectiveAction({} as never), /command/);
  const action = protect(manager, "op", "u");
  assert.equal(action.isFinalDecision, false);
  assert.throws(() => manager.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: action.enforcementId, operatorId: "op", unitId: "u", decision: "unit_suspension" }, "agent", "bot")), /authorized human/i);
  finalize(manager, action.enforcementId, "op", "u");
  assert.throws(() => manager.recordEnforcementNotice({ enforcementId: action.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "not-a-date" }), /invalid/);
  assert.throws(() => manager.recordEnforcementNotice({ enforcementId: action.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-11T10:00:00.000Z" }), /invalid/);
  assert.throws(() => manager.recordEnforcementNotice({ enforcementId: action.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-09T10:00:00.000Z" }), /invalid/);
  manager.recordEnforcementNotice({ enforcementId: action.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "failed" });
  assert.throws(() => manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "appeal", evidenceReferences: [] }, "operator", "operator-actor")), /successful/);
  manager.recordEnforcementNotice({ enforcementId: action.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  assert.throws(() => manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "other-actor", statement: "appeal", evidenceReferences: [] }, "operator", "other-actor")), /authority/);
  assert.throws(() => manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "other-op", appellantId: "operator-actor", statement: "appeal", evidenceReferences: [] }, "operator", "operator-actor")), /authority|scope/);
  manager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: action.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "appeal", evidenceReferences: ["evidence-1"] }, "operator", "operator-actor"));
  assert.throws(() => manager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: action.enforcementId, operatorId: "op", decision: "upheld", rationale: "ok" }, "authorized_staff", "human-1")), /independent/);
  assert.equal(manager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: action.enforcementId, operatorId: "op", decision: "exonerated", rationale: "supported" }, "authorized_staff", "human-2")).status, "exonerated");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u" }).enforcementLevel, "unit_suspension");

  const upheldManager = new OperatorEnforcementManager({ clock, operatorAuthority });
  const upheldAction = protect(upheldManager, "op", "u");
  finalize(upheldManager, upheldAction.enforcementId, "op", "u");
  upheldManager.recordEnforcementNotice({ enforcementId: upheldAction.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  upheldManager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: upheldAction.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "appeal", evidenceReferences: [] }, "operator", "operator-actor"));
  assert.equal(upheldManager.resolveEnforcementAppeal(command("operator_enforcement.resolve_appeal", { enforcementId: upheldAction.enforcementId, operatorId: "op", decision: "upheld", rationale: "decision supported" }, "authorized_staff", "human-2")).status, "upheld");
  assert.equal(upheldManager.getProjections({ operatorId: "op", unitId: "u" }).enforcementLevel, "unit_suspension");

  let boundaryNow = new Date("2026-09-10T10:00:00.000Z");
  const boundaryManager = new OperatorEnforcementManager({ clock: () => boundaryNow, operatorAuthority });
  const boundaryAction = protect(boundaryManager, "op", "u");
  finalize(boundaryManager, boundaryAction.enforcementId, "op", "u");
  boundaryNow = new Date("2026-09-17T10:00:00.000Z");
  boundaryManager.recordEnforcementNotice({ enforcementId: boundaryAction.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  assert.throws(() => boundaryManager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: boundaryAction.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "boundary", evidenceReferences: [] }, "operator", "operator-actor")), /expired/);

  const directory = await mkdtemp(join(tmpdir(), "issue-29-representative-"));
  const databasePath = join(directory, "grants.sqlite");
  let current = new Date("2026-09-10T10:00:00.000Z");
  const store = new SqliteOperatorRepresentativeGrantStore(databasePath, { clock: () => current });
  try {
    const realManager = new OperatorEnforcementManager({ clock: () => current, operatorAuthority: store });
    const realAction = protect(realManager, "op", "u");
    finalize(realManager, realAction.enforcementId, "op", "u");
    realManager.recordEnforcementNotice({ enforcementId: realAction.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: current.toISOString() });
    const grant = store.createGrant(grantCommand({ actorId: "operator-actor", operatorId: "op", expiresAtIso: "2026-09-11T10:00:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-happy"));
    const appeal = realManager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: realAction.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "appeal", evidenceReferences: ["evidence-1"] }, "operator", "operator-actor"));
    assert.equal(appeal.status, "appeal_pending");
    assert.equal(store.canActForOperator({ actorId: grant.actorId, operatorId: grant.operatorId, tenantId: grant.tenantId }), true);
    store.revokeGrant(command("operator_representative.revoke", { grantId: grant.grantId }, "admin", "admin-1", "tenant-lagos", "issue-29-revoke-happy"));

    const appealable = (actorId: string, operatorId: string, tenantId = "tenant-lagos") => {
      const scopedManager = new OperatorEnforcementManager({ clock: () => current, operatorAuthority: store });
      const scopedAction = protect(scopedManager, "op", "u", `support-${actorId}-${operatorId}-${tenantId}`);
      finalize(scopedManager, scopedAction.enforcementId, "op", "u");
      scopedManager.recordEnforcementNotice({ enforcementId: scopedAction.enforcementId, operatorId: "op", unitId: "u", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: current.toISOString() });
      assert.throws(() => scopedManager.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: scopedAction.enforcementId, operatorId, appellantId: actorId, statement: "appeal", evidenceReferences: [] }, "operator", actorId, tenantId)), /authority|scope/);
    };

    appealable("missing-actor", "op");
    store.createGrant(grantCommand({ actorId: "other-actor", operatorId: "op", expiresAtIso: "2026-09-11T10:00:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-wrong-actor"));
    appealable("operator-actor", "op");
    store.createGrant(grantCommand({ actorId: "operator-actor", operatorId: "other-op", expiresAtIso: "2026-09-11T10:00:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-wrong-operator"));
    appealable("operator-actor", "other-op");
    store.createGrant(grantCommand({ actorId: "operator-actor", operatorId: "op", expiresAtIso: "2026-09-11T10:00:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-wrong-tenant", { id: "admin-b", role: "admin", tenantId: "tenant-b" }));
    appealable("operator-actor", "op");
    const revoked = store.createGrant(grantCommand({ actorId: "revoked-actor", operatorId: "op", expiresAtIso: "2026-09-11T10:00:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-revoked"));
    store.revokeGrant(command("operator_representative.revoke", { grantId: revoked.grantId }, "admin", "admin-1", "tenant-lagos", "issue-29-revoke"));
    appealable("revoked-actor", "op");
    store.createGrant(grantCommand({ actorId: "expired-actor", operatorId: "op", expiresAtIso: "2026-09-10T10:01:00.000Z", responsiblePersonVerifiedAtIso: "2026-09-01T10:00:00.000Z" }, "issue-29-expired"));
    current = new Date("2026-09-10T10:02:00.000Z");
    appealable("expired-actor", "op");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("One underlying incident is not multiplied by downstream reports, and every affected feature or Unit projection updates consistently", () => {
  const manager = new OperatorEnforcementManager({ clock, operatorAuthority });
  incident(manager, { incidentId: "r1", rootIncidentId: "root", operatorId: "op", unitId: "u1", incidentType: "calendar_error", severity: "serious" });
  incident(manager, { incidentId: "r2", rootIncidentId: "root", operatorId: "op", unitId: "u1", incidentType: "calendar_error", severity: "serious" });
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).misconductCount, 1);
  const local = protect(manager, "op", "u1");
  finalize(manager, local.enforcementId, "op", "u1");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).unitStatus, "suspended");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u2" }).unitStatus, "active");
  const wide = protect(manager, "op", "u1", "support-2");
  finalize(manager, wide.enforcementId, "op", "u1", [], "operator_pause");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u2" }).operatorStatus, "paused");
  const later = protect(manager, "op", "u2", "support-3");
  finalize(manager, later.enforcementId, "op", "u2");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u2" }).operatorStatus, "paused");

  const terminated = protect(manager, "op", "u1", "support-4");
  finalize(manager, terminated.enforcementId, "op", "u1", [], "termination");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).operatorStatus, "terminated");
  assert.equal(manager.getProjections({ operatorId: "op", unitId: "u1" }).unitStatus, "suspended");

  const other = new OperatorEnforcementManager({ clock, operatorAuthority });
  const otherAction = protect(other, "op", "u1");
  finalize(other, otherAction.enforcementId, "op", "u1");
  other.recordEnforcementNotice({ enforcementId: otherAction.enforcementId, operatorId: "op", unitId: "u1", tenantId: "tenant-lagos", status: "delivered", deliveredAtIso: "2026-09-10T10:00:00.000Z" });
  assert.throws(() => other.fileEnforcementAppeal(command("operator_enforcement.appeal", { enforcementId: otherAction.enforcementId, operatorId: "op", appellantId: "operator-actor", statement: "x", evidenceReferences: [] }, "operator", "operator-actor", "other-tenant")), /scope/);
  assert.throws(() => other.finalizeEnforcementDecision(command("operator_enforcement.finalize", { enforcementId: otherAction.enforcementId, operatorId: "op", unitId: "u1", decision: "unit_suspension" }, "authorized_staff", "human-2", "other-tenant")), /scope/);
});
