import test from "node:test";
import assert from "node:assert/strict";
import {
  LaunchOperationsRehearsalManager,
  SimulationScenarioRecord,
  SupportTierCoverage,
  HumanRecoveryActionRequest,
  OperationalGapRecord
} from "../domains/shortlet/src/launch-rehearsal.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/envelope.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";

test("Every scenario has named participants, clocked targets, injected failures, observed actions, authoritative outcome, and debrief findings.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchOperationsRehearsalManager({ audit });

  const validScenario: SimulationScenarioRecord = {
    scenarioId: "sim-01-request-delivery",
    scenarioName: "Request Delivery & Technical Delivery Window Timeout",
    category: "request_delivery",
    namedParticipants: [
      { name: "Amina Lawal", role: "guest" },
      { name: "Tunde Bakare", role: "operator" },
      { name: "Chidi Nnamdi", role: "primary_responder" },
      { name: "Fatima Bello", role: "backup_responder" },
      { name: "Yusuf Audu", role: "senior_escalation" }
    ],
    clockedTargets: {
      targetResponseMinutes: 5,
      targetOwnershipMinutes: 5,
      maxResolutionMinutes: 15
    },
    injectedFailures: ["Technical delivery window expired after 5 minutes on WhatsApp API"],
    observedActions: [
      "Request delivery failed notification raised",
      "Human Incident Support alerted at 5-minute mark",
      "Manual phone contact attempt logged"
    ],
    authoritativeOutcome: "request_cancelled_and_unit_unblocked",
    debriefFindings: [
      "Operator WhatsApp channel degraded; backup SMS delivery mechanism required"
    ],
    actualOwnershipMinutes: 3,
    actualResponseMinutes: 4
  };

  const recorded = manager.recordScenarioRehearsal(validScenario);
  assert.equal(recorded.scenarioId, "sim-01-request-delivery");
  assert.equal(recorded.authoritativeOutcome, "request_cancelled_and_unit_unblocked");

  const scenarioList = manager.getRehearsedScenarios();
  assert.equal(scenarioList.length, 1);

  // Failure path 1: Missing named participants
  assert.throws(
    () =>
      manager.recordScenarioRehearsal({
        ...validScenario,
        scenarioId: "sim-bad-01",
        namedParticipants: []
      }),
    /Simulation scenario requires non-empty namedParticipants with valid roles/
  );

  // Failure path 2: Missing clocked targets or invalid target times
  assert.throws(
    () =>
      manager.recordScenarioRehearsal({
        ...validScenario,
        scenarioId: "sim-bad-02",
        clockedTargets: { targetResponseMinutes: 0, targetOwnershipMinutes: -1 }
      }),
    /Simulation scenario requires positive clockedTargets/
  );

  // Failure path 3: Missing injected failures, observed actions, authoritative outcome, or debrief findings
  assert.throws(
    () =>
      manager.recordScenarioRehearsal({
        ...validScenario,
        scenarioId: "sim-bad-03",
        injectedFailures: []
      }),
    /Simulation scenario requires injectedFailures, observedActions, authoritativeOutcome, and debriefFindings/
  );

  assert.throws(
    () =>
      manager.recordScenarioRehearsal({
        ...validScenario,
        scenarioId: "sim-bad-04",
        debriefFindings: []
      }),
    /Simulation scenario requires injectedFailures, observedActions, authoritativeOutcome, and debriefFindings/
  );
});

test("General, check-in, and active-stay emergency coverage meets the accepted ownership and escalation targets.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchOperationsRehearsalManager({ audit });

  const validCoverage: SupportTierCoverage[] = [
    {
      tier: "general_support",
      hoursWindow: "08:00-20:00 WAT",
      primaryResponder: "agent_gen_01",
      backupResponder: "agent_gen_02",
      seniorEscalation: "lead_sup_01",
      targetOwnershipMinutes: 15
    },
    {
      tier: "checkin_support",
      hoursWindow: "13:00-24:00 WAT",
      primaryResponder: "agent_chk_01",
      backupResponder: "agent_chk_02",
      seniorEscalation: "lead_sup_01",
      targetOwnershipMinutes: 5
    },
    {
      tier: "active_stay_emergency_support",
      hoursWindow: "24/7",
      primaryResponder: "agent_emg_01",
      backupResponder: "agent_emg_02",
      seniorEscalation: "director_ops_01",
      targetOwnershipMinutes: 5
    }
  ];

  const report = manager.configureSupportCoverage(validCoverage);
  assert.equal(report.allTiersStaffed, true);
  assert.equal(report.escalationTargetsMet, true);

  // Failure path 1: Missing tier coverage (e.g. active stay emergency missing)
  assert.throws(
    () =>
      manager.configureSupportCoverage([
        validCoverage[0],
        validCoverage[1]
      ]),
    /Support coverage must configure all required tiers: general_support, checkin_support, and active_stay_emergency_support/
  );

  // Failure path 2: Missing backup or senior escalation responder
  assert.throws(
    () =>
      manager.configureSupportCoverage([
        validCoverage[0],
        validCoverage[1],
        {
          ...validCoverage[2],
          backupResponder: ""
        }
      ]),
    /Every tier requires primaryResponder, backupResponder, and seniorEscalation/
  );

  // Failure path 3: Target ownership time exceeds ADR 0067 threshold (e.g., checkin_support > 5 mins)
  assert.throws(
    () =>
      manager.configureSupportCoverage([
        validCoverage[0],
        {
          ...validCoverage[1],
          targetOwnershipMinutes: 20
        },
        validCoverage[2]
      ]),
    /Target ownership minutes for checkin_support cannot exceed 5 minutes under ADR 0067/
  );
});

test("Humans can recover and reconcile each scenario through authorized application routes without direct state manipulation.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchOperationsRehearsalManager({ audit });

  // Record scenario first
  const scenario: SimulationScenarioRecord = {
    scenarioId: "sim-payment-late-success",
    scenarioName: "Payment Expiry & Late Success Simulation",
    category: "payment_expiry_and_late_success",
    namedParticipants: [
      { name: "Emeka Okafor", role: "guest" },
      { name: "Support Agent A", role: "primary_responder" },
      { name: "Support Agent B", role: "backup_responder" },
      { name: "Ops Lead", role: "senior_escalation" }
    ],
    clockedTargets: { targetResponseMinutes: 5, targetOwnershipMinutes: 5 },
    injectedFailures: ["PSP callback received 15 minutes after 20+10m deadline expired"],
    observedActions: ["Payment marked late", "Automatic hold released"],
    authoritativeOutcome: "refunded",
    debriefFindings: ["ADR 0045 automatic refund executed by human command envelope"]
  };
  manager.recordScenarioRehearsal(scenario);

  const commandEnvelope: PlatformCommandEnvelope<{
    scenarioId: string;
    action: string;
    refundAmount: number;
    currency: string;
  }> = {
    commandId: "cmd-reconcile-001",
    commandName: "launch_rehearsal.reconcile_scenario",
    principal: {
      id: "usr_agent_001",
      role: "authorized_staff",
      tenantId: "tenant_ng_01"
    },
    payload: {
      scenarioId: "sim-payment-late-success",
      action: "refund_late_payment",
      refundAmount: 150000,
      currency: "NGN"
    },
    expectedVersion: 1,
    idempotencyKey: "idem-rec-001",
    timestamp: new Date().toISOString()
  };

  const recoveryRequest: HumanRecoveryActionRequest = {
    scenarioId: "sim-payment-late-success",
    responderId: "usr_agent_001",
    responderRole: "authorized_staff",
    actionType: "payment_refund_override",
    platformCommandEnvelope: commandEnvelope as unknown as PlatformCommandEnvelope<Record<string, unknown>>,
    notes: "Executing late payment refund recovery under ADR 0045"
  };

  const recoveryResult = manager.executeHumanRecoveryAction(recoveryRequest);
  assert.equal(recoveryResult.status, "reconciled");
  assert.equal(recoveryResult.routedThroughPlatformCommand, true);
  assert.equal(recoveryResult.authoritativeOutcome, "refunded");

  // Audit check (ADR 0075: no bearer credentials in audit)
  const auditEntries = audit.entries();
  assert.ok(auditEntries.some((e) => e.type === "launch_rehearsal.human_recovery_executed"));
  const jsonStr = JSON.stringify(auditEntries);
  assert.doesNotMatch(jsonStr, /bearer/i);
  assert.doesNotMatch(jsonStr, /secret/i);

  // Failure path 1: Direct state manipulation without command envelope
  assert.throws(
    () =>
      manager.executeHumanRecoveryAction({
        ...recoveryRequest,
        platformCommandEnvelope: null as unknown as PlatformCommandEnvelope<Record<string, unknown>>
      }),
    /Human recovery action must be routed through an authorized PlatformCommandEnvelope/
  );

  // Failure path 2: Command envelope missing principal id or commandName
  assert.throws(
    () =>
      manager.executeHumanRecoveryAction({
        ...recoveryRequest,
        platformCommandEnvelope: {
          ...commandEnvelope,
          principal: { id: "", role: "authorized_staff" }
        } as unknown as PlatformCommandEnvelope<Record<string, unknown>>
      }),
    /Platform command envelope requires authenticated principal id and commandName/
  );
});

test("Material gaps receive owners and blocking severity; launch cannot pass on undocumented workarounds.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchOperationsRehearsalManager({ audit });

  // 1. Setup coverage
  manager.configureSupportCoverage([
    {
      tier: "general_support",
      hoursWindow: "08:00-20:00 WAT",
      primaryResponder: "p1",
      backupResponder: "b1",
      seniorEscalation: "s1",
      targetOwnershipMinutes: 15
    },
    {
      tier: "checkin_support",
      hoursWindow: "13:00-24:00 WAT",
      primaryResponder: "p2",
      backupResponder: "b2",
      seniorEscalation: "s1",
      targetOwnershipMinutes: 5
    },
    {
      tier: "active_stay_emergency_support",
      hoursWindow: "24/7",
      primaryResponder: "p3",
      backupResponder: "b3",
      seniorEscalation: "s2",
      targetOwnershipMinutes: 5
    }
  ]);

  // 2. Setup 13 core rehearsal scenarios covering required operational categories
  const categories = [
    "request_delivery",
    "payment_expiry_and_late_success",
    "same_day_arrival_and_turnover",
    "failed_access",
    "relocation",
    "mid_stay_failure",
    "cancellation",
    "noshow",
    "deposit_claims",
    "overstay",
    "operator_enforcement",
    "provider_outage",
    "human_handoff_and_return"
  ] as const;

  categories.forEach((cat, idx) => {
    manager.recordScenarioRehearsal({
      scenarioId: `sim-core-${idx + 1}`,
      scenarioName: `Simulation for ${cat}`,
      category: cat,
      namedParticipants: [
        { name: "Guest User", role: "guest" },
        { name: "Operator", role: "operator" },
        { name: "Responder", role: "primary_responder" },
        { name: "Backup", role: "backup_responder" },
        { name: "Escalation", role: "senior_escalation" }
      ],
      clockedTargets: { targetResponseMinutes: 5, targetOwnershipMinutes: 5 },
      injectedFailures: [`Injected failure for ${cat}`],
      observedActions: [`Observed action for ${cat}`],
      authoritativeOutcome: `outcome_${cat}`,
      debriefFindings: [`Debrief finding for ${cat}`]
    });
  });

  // 3. Register a non-blocking gap with owner and plan
  const validGap: OperationalGapRecord = {
    gapId: "gap-01",
    scenarioId: "sim-core-1",
    description: "Minor delay in SMS fallback notification",
    owner: "Lead Infrastructure Engineer",
    severity: "non_blocking",
    remediationPlan: "Optimize SMS provider retry policy before week 2",
    status: "identified"
  };
  manager.registerOperationalGap(validGap);

  // Check launch readiness passes
  let report = manager.evaluateLaunchReadiness();
  assert.equal(report.isLaunchApproved, true);
  assert.equal(report.blockingGapsCount, 0);

  // Failure path 1: Registering a gap without owner or remediation plan
  assert.throws(
    () =>
      manager.registerOperationalGap({
        ...validGap,
        gapId: "gap-bad-01",
        owner: ""
      }),
    /Operational gap requires non-empty owner, severity, description, and remediationPlan/
  );

  assert.throws(
    () =>
      manager.registerOperationalGap({
        ...validGap,
        gapId: "gap-bad-02",
        remediationPlan: ""
      }),
    /Operational gap requires non-empty owner, severity, description, and remediationPlan/
  );

  // Failure path 2: Unresolved blocking gap without resolution prevents launch approval
  manager.registerOperationalGap({
    gapId: "gap-blocking-01",
    scenarioId: "sim-core-4",
    description: "Access code sync failure during ISP outage",
    owner: "Head of Systems",
    severity: "blocking",
    remediationPlan: "Deploy local offline Bluetooth code generator fallback",
    status: "identified"
  });

  report = manager.evaluateLaunchReadiness();
  assert.equal(report.isLaunchApproved, false);
  assert.equal(report.blockingGapsCount, 1);

  // Resolving the blocking gap permits launch approval
  manager.resolveOperationalGap("gap-blocking-01", "REF-BLUETOOTH-FALLBACK-DEPLOYED");
  report = manager.evaluateLaunchReadiness();
  assert.equal(report.isLaunchApproved, true);
  assert.equal(report.blockingGapsCount, 0);
});
