import test from "node:test";
import assert from "node:assert/strict";
import { CheckInSupportManager } from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createEnvelope<T>(
  commandName: string,
  payload: T,
  actorId = "guest-123",
  tenantId = "tenant-lagos"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd-${Math.random().toString(36).slice(2)}`,
    commandName,
    timestamp: "2026-08-10T15:00:00.000Z",
    principal: {
      id: actorId,
      role: "guest",
      tenantId
    },
    payload
  };
}

test("Arrival boundaries, support ownership, evidence requests, and escalation are visible and auditable", () => {
  const manager = new CheckInSupportManager();
  const clock = () => new Date("2026-08-10T14:30:00.000Z");

  // Valid arrival window & support ownership
  const scheduleEnv = createEnvelope("checkin_support.schedule", {
    reservationId: "res-101",
    checkInWindow: {
      checkInDate: "2026-08-10",
      earliestAccessTime: "14:00",
      latestPermittedArrival: "22:00"
    },
    assignedAgentId: "agent-human-1",
    backupAgentId: "agent-human-2"
  });

  const sched = manager.scheduleHumanSupport(scheduleEnv, clock);
  assert.equal(sched.status, "scheduled");
  assert.equal(sched.assignedAgentId, "agent-human-1");

  // Escalation request
  const escalateEnv = createEnvelope("checkin_support.escalate", {
    reservationId: "res-101",
    reason: "Guest at gate, operator primary contact unreachable"
  });
  const escalated = manager.escalateIncident(escalateEnv, clock);
  assert.equal(escalated.status, "escalated");

  const proj = manager.projectCheckInStatus("res-101");
  assert.equal(proj.supportOwnership.status, "escalated");
  assert.equal(proj.supportOwnership.assignedAgentId, "agent-human-1");
  assert.equal(proj.checkInWindow?.earliestAccessTime, "14:00");
  assert.equal(proj.checkInWindow?.latestPermittedArrival, "22:00");

  // Invalid check-in window outside 14:00-22:00 WAT MUST throw
  const badWindowEnv = createEnvelope("checkin_support.schedule", {
    reservationId: "res-bad",
    checkInWindow: {
      checkInDate: "2026-08-10",
      earliestAccessTime: "11:00", // Invalid: before 14:00 WAT
      latestPermittedArrival: "23:00" // Invalid: after 22:00 WAT
    },
    assignedAgentId: "agent-human-1",
    backupAgentId: "agent-human-2"
  });
  assert.throws(
    () => manager.scheduleHumanSupport(badWindowEnv, clock),
    /Contractual check-in window must be between 14:00 and 22:00 WAT/
  );
});

test("Verified Access follows independent evidence priority and cannot be declared by Operator assertion or chat state alone", () => {
  const manager = new CheckInSupportManager();
  const clock = () => new Date("2026-08-10T15:00:00.000Z");

  manager.scheduleHumanSupport(
    createEnvelope("checkin_support.schedule", {
      reservationId: "res-202",
      checkInWindow: { checkInDate: "2026-08-10", earliestAccessTime: "14:00", latestPermittedArrival: "22:00" },
      assignedAgentId: "agent-human-1",
      backupAgentId: "agent-human-2"
    }),
    clock
  );

  // Failure path: Operator assertion alone CANNOT declare Verified Access
  const opAssertionEnv = createEnvelope("checkin_support.submit_evidence", {
    reservationId: "res-202",
    evidence: {
      evidenceId: "ev-op-1",
      source: "operator_assertion" as const,
      timestamp: "2026-08-10T15:00:00.000Z",
      details: { note: "Operator claims guest checked in" }
    }
  });

  assert.throws(
    () => manager.submitAccessEvidence(opAssertionEnv, clock),
    /Verified Access cannot be declared by Operator assertion or chat state alone/
  );

  // Failure path: Chat state alone CANNOT declare Verified Access
  const chatStateEnv = createEnvelope("checkin_support.submit_evidence", {
    reservationId: "res-202",
    evidence: {
      evidenceId: "ev-chat-1",
      source: "chat_state" as const,
      timestamp: "2026-08-10T15:00:00.000Z",
      details: { note: "Guest said 'I am inside' in unstructured chat" }
    }
  });

  assert.throws(
    () => manager.submitAccessEvidence(chatStateEnv, clock),
    /Verified Access cannot be declared by Operator assertion or chat state alone/
  );

  // Success path: Higher priority evidence (authenticated guest confirmation or platform code)
  const validGuestEvidenceEnv = createEnvelope("checkin_support.submit_evidence", {
    reservationId: "res-202",
    evidence: {
      evidenceId: "ev-guest-1",
      source: "guest_confirmation" as const,
      timestamp: "2026-08-10T15:00:00.000Z",
      details: { confirmationCode: "CODE-987" }
    }
  });

  const verified = manager.submitAccessEvidence(validGuestEvidenceEnv, clock);
  assert.equal(verified.status, "verified_access");
  assert.equal(verified.evidenceSource, "guest_confirmation");
  assert.ok(verified.protectionWindowStartsAt);
});

test("Blocking complaints hold exposed revenue and preserve the current incident context for human review", () => {
  const manager = new CheckInSupportManager();
  const clock = () => new Date("2026-08-10T16:00:00.000Z");

  manager.scheduleHumanSupport(
    createEnvelope("checkin_support.schedule", {
      reservationId: "res-303",
      checkInWindow: { checkInDate: "2026-08-10", earliestAccessTime: "14:00", latestPermittedArrival: "22:00" },
      assignedAgentId: "agent-human-1",
      backupAgentId: "agent-human-2"
    }),
    clock
  );

  // Raise blocking complaint
  const complaintEnv = createEnvelope("checkin_support.raise_complaint", {
    reservationId: "res-303",
    type: "habitability_failure" as const,
    details: { reason: "AC and water not functioning upon arrival" }
  });

  const complaint = manager.raiseBlockingComplaint(complaintEnv, clock);
  assert.equal(complaint.status, "open");
  assert.equal(complaint.revenueHeld, true);
  assert.equal(complaint.type, "habitability_failure");

  const proj = manager.projectCheckInStatus("res-303");
  assert.equal(proj.revenueHeld, true);
  assert.equal(proj.activeComplaints.length, 1);
  assert.equal(proj.activeComplaints[0].complaintId, complaint.complaintId);
});

test("Late voluntary arrival and actual failed access produce distinct outcomes under the accepted policy", () => {
  const manager = new CheckInSupportManager();

  // Case A: Late voluntary arrival (valid access provided at check-in time 14:00 WAT, guest arrived 21:00 WAT)
  const clockLate = () => new Date("2026-08-10T21:00:00.000Z");
  manager.scheduleHumanSupport(
    createEnvelope("checkin_support.schedule", {
      reservationId: "res-late-1",
      checkInWindow: { checkInDate: "2026-08-10", earliestAccessTime: "14:00", latestPermittedArrival: "22:00" },
      assignedAgentId: "agent-human-1",
      backupAgentId: "agent-human-2"
    }),
    clockLate
  );

  const lateEvidenceEnv = createEnvelope("checkin_support.submit_evidence", {
    reservationId: "res-late-1",
    evidence: {
      evidenceId: "ev-late",
      source: "support_verification" as const,
      timestamp: "2026-08-10T21:00:00.000Z",
      details: { note: "Guest arrived late voluntarily, valid keybox access was ready since 14:00", isLateVoluntaryArrival: true }
    }
  });

  const lateResult = manager.submitAccessEvidence(lateEvidenceEnv, clockLate);
  assert.equal(lateResult.status, "late_voluntary_arrival");

  // Case B: Actual failed access (lockbox key missing, guest turned away)
  const clockFailed = () => new Date("2026-08-10T16:00:00.000Z");
  manager.scheduleHumanSupport(
    createEnvelope("checkin_support.schedule", {
      reservationId: "res-failed-1",
      checkInWindow: { checkInDate: "2026-08-10", earliestAccessTime: "14:00", latestPermittedArrival: "22:00" },
      assignedAgentId: "agent-human-1",
      backupAgentId: "agent-human-2"
    }),
    clockFailed
  );

  const failedEvidenceEnv = createEnvelope("checkin_support.submit_evidence", {
    reservationId: "res-failed-1",
    evidence: {
      evidenceId: "ev-fail",
      source: "support_verification" as const,
      timestamp: "2026-08-10T16:00:00.000Z",
      details: { note: "Key code defective, operator failed to provide key", accessFailed: true }
    }
  });

  const failedResult = manager.submitAccessEvidence(failedEvidenceEnv, clockFailed);
  assert.equal(failedResult.status, "failed_access");

  // Outcomes are distinct!
  assert.notEqual(lateResult.status, failedResult.status);
});
