import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateUnitEligibilityForSameDayTurnover,
  approveUnitSameDayTurnover,
  createTurnoverRun,
  submitTurnoverRunEvidence,
  checkTurnoverRunReadiness,
  restoreSameDayTurnoverCapability,
  revokeSameDayTurnoverCapability,
  isSameDayTurnoverPermitted,
  AvailabilityCalendar,
  UnitRepository,
  seedIssue01Units
} from "../domains/shortlet/src/index.js";

function setupUnit() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const unit = repository.findAll()[0];
  return { repository, unit };
}

test("Units without active qualification cannot expose same-day arrival inventory after checkout", () => {
  const { unit } = setupUnit();

  // Unit default: no sameDayTurnover record -> permitted is false
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "15:00"), false);

  // Unit with disabled or suspended status -> permitted is false
  unit.sameDayTurnover = { status: "disabled" };
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "15:00"), false);

  unit.sameDayTurnover.status = "suspended";
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "15:00"), false);

  // Unit approved with earliest 15:00 -> permitted at 15:00, rejected at 14:00
  approveUnitSameDayTurnover({
    unit,
    earliestSameDayArrival: "15:00",
    turnoverPlan: { primaryCleanerId: "cln-1", backupCleanerId: "cln-2" },
    reviewerId: "rev-ops-1"
  });
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "15:00"), true);
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "14:00"), false);
});

test("Observation engine evaluates 5 stays and 3 observed runs threshold before review eligibility", () => {
  // Fewer than 5 stays
  assert.equal(
    evaluateUnitEligibilityForSameDayTurnover({ completedStaysCount: 4, observedRuns: [{ status: "passed", followingRealStay: true }] }).eligible,
    false
  );

  // 5 stays, but fewer than 3 passed runs
  assert.equal(
    evaluateUnitEligibilityForSameDayTurnover({
      completedStaysCount: 5,
      observedRuns: [{ status: "passed", followingRealStay: true }, { status: "passed", followingRealStay: true }]
    }).eligible,
    false
  );

  // 5 stays, 3 passed runs (2 real stays), 90%+ ack rate, no missed escalations -> eligible!
  const validEval = evaluateUnitEligibilityForSameDayTurnover({
    completedStaysCount: 5,
    observedRuns: [
      { status: "passed", followingRealStay: true },
      { status: "passed", followingRealStay: true },
      { status: "passed", followingRealStay: false }
    ],
    messageAckRate: 0.95,
    missedEscalationCount: 0,
    contactsReachable: true
  });
  assert.equal(validEval.eligible, true);
});

test("Every Turnover Run has a plan, responsible Operator, evidence, deadline, readiness state, and audit trail", () => {
  const run = createTurnoverRun({
    unitId: "unit-lagos-001",
    operatorId: "operator-001",
    priorCheckoutAt: "2026-08-10T11:00:00Z",
    readinessDeadline: "2026-08-10T14:30:00Z",
    turnoverPlan: {
      primaryCleanerId: "cln-01",
      backupCleanerId: "cln-02",
      checklist: ["entire-place-sanitation", "linen-and-towel-change", "locks-and-privacy-check", "essential-utilities-check"]
    },
    clock: () => new Date("2026-08-10T11:05:00Z")
  });

  assert.ok(run.runId.startsWith("turn-"));
  assert.equal(run.unitId, "unit-lagos-001");
  assert.equal(run.operatorId, "operator-001");
  assert.equal(run.readinessState, "pending");
  assert.equal(run.auditTrail.length, 1);

  // Submit evidence
  submitTurnoverRunEvidence({
    run,
    evidence: {
      completedChecklist: ["entire-place-sanitation", "linen-and-towel-change", "locks-and-privacy-check", "essential-utilities-check"],
      photoEvidenceUrls: ["https://cdn.example.com/photo1.jpg"],
      testedAccessVerified: true,
      essentialUtilitiesVerified: true
    },
    actorId: "cln-01",
    clock: () => new Date("2026-08-10T13:45:00Z")
  });

  assert.equal(run.readinessState, "ready_for_arrival");
  assert.equal(run.auditTrail.length, 3);
});

test("A missed deadline initiates incident workflow and immediately protects incoming availability", () => {
  const { unit } = setupUnit();
  approveUnitSameDayTurnover({
    unit,
    earliestSameDayArrival: "15:00",
    turnoverPlan: { primaryCleanerId: "cln-1", backupCleanerId: "cln-2" },
    reviewerId: "rev-ops-1"
  });

  const run = createTurnoverRun({
    unitId: unit.id,
    operatorId: unit.operator.id,
    priorCheckoutAt: "2026-08-10T11:00:00Z",
    readinessDeadline: "2026-08-10T14:30:00Z",
    clock: () => new Date("2026-08-10T11:05:00Z")
  });

  run.incomingBookingDate = "2026-08-10";

  let incidentOpened = false;
  const incidentWorkflow = {
    openBlockingFulfilmentComplaint: (params) => {
      incidentOpened = true;
      assert.equal(params.unitId, unit.id);
      assert.equal(params.humanOwnershipRequired, true);
      return { complaintId: "cmp-101", status: "open" };
    }
  };

  const calendar = new AvailabilityCalendar();

  // Clock is now 14:35 (deadline was 14:30)
  const result = checkTurnoverRunReadiness({
    run,
    unit,
    incidentWorkflow,
    availabilityCalendar: calendar,
    clock: () => new Date("2026-08-10T14:35:00Z")
  });

  assert.equal(result.deadlinePassed, true);
  assert.equal(result.actionTaken, "suspended_and_escalated");
  assert.equal(run.readinessState, "missed_deadline");
  assert.equal(unit.sameDayTurnover.status, "suspended");
  assert.equal(incidentOpened, true);

  // Incoming date is blocked in availability calendar
  const avail = calendar.getAuthoritativeAvailability({
    unitId: unit.id,
    checkIn: "2026-08-10",
    checkOut: "2026-08-11"
  });
  assert.equal(avail.isAvailable, false);
});

test("Restoration and revocation enforce defect, serious-failure, recurrence, and egregious-failure thresholds", () => {
  const { unit } = setupUnit();
  approveUnitSameDayTurnover({
    unit,
    earliestSameDayArrival: "15:00",
    turnoverPlan: { primaryCleanerId: "cln-1", backupCleanerId: "cln-2" },
    reviewerId: "rev-ops-1"
  });

  unit.sameDayTurnover.status = "suspended";

  // 1. Evidence-only restoration requires proof of timely readiness and approver
  assert.throws(
    () => restoreSameDayTurnoverCapability({ unit, failureClassification: "evidence_only", evidenceProof: false, approverId: "rev-1" }),
    /proof of timely readiness/
  );

  restoreSameDayTurnoverCapability({ unit, failureClassification: "evidence_only", evidenceProof: true, approverId: "rev-1" });
  assert.equal(unit.sameDayTurnover.status, "approved");

  // 2. Operational delay restoration requires root cause remediated + 1 new observed run
  unit.sameDayTurnover.status = "suspended";
  assert.throws(
    () => restoreSameDayTurnoverCapability({ unit, failureClassification: "actual_operational_delay", rootCauseRemediated: false, approverId: "rev-1" }),
    /root-cause remediation/
  );

  restoreSameDayTurnoverCapability({
    unit,
    failureClassification: "actual_operational_delay",
    rootCauseRemediated: true,
    newObservedRuns: [{ status: "passed" }],
    approverId: "rev-1"
  });
  assert.equal(unit.sameDayTurnover.status, "approved");

  // 3. Egregious failure requires 2-person senior approval and revokes capability
  unit.sameDayTurnover.status = "suspended";
  assert.throws(
    () => revokeSameDayTurnoverCapability({ unit, reason: "Falsified readiness photos", isEgregious: true, reviewerId: "rev-1" }),
    /two-person senior approval/
  );

  const revokeResult = revokeSameDayTurnoverCapability({
    unit,
    reason: "Falsified readiness photos",
    isEgregious: true,
    reviewerId: "rev-1",
    secondReviewerId: "rev-senior-2"
  });
  assert.equal(revokeResult.revoked, true);
  assert.equal(unit.sameDayTurnover.status, "revoked");

  // Revoked unit cannot be used for same-day turnover
  assert.equal(isSameDayTurnoverPermitted(unit, "2026-08-10", "2026-08-10", "15:00"), false);
});
