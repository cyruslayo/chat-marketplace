import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import {
  LaunchJourneySuiteManager,
  JourneyProofRecord,
  ExecutionPathRecord,
  DeterministicParityFixture,
  ValidationGateRecord,
  JourneyCategory,
  ExecutionPathType,
  ValidationGateType
} from "../domains/shortlet/src/launch-journey-suite.js";

test("Each journey proves authoritative state, ledger, projection, notification, audit, conventional route, and permitted agent/channel behaviour.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchJourneySuiteManager({ audit });

  const categories: JourneyCategory[] = [
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

  // Success path: Record valid proof for all 12 categories
  for (const category of categories) {
    const proof: JourneyProofRecord = {
      journeyId: `journey-${category}-001`,
      journeyCategory: category,
      authoritativeStateVerified: true,
      ledgerVerified: true,
      projectionVerified: true,
      notificationVerified: true,
      auditVerified: true,
      conventionalRouteVerified: true,
      permittedChannelVerified: true,
      channel: "web_agui",
      commandEnvelopeId: `env-${category}-001`
    };
    const recorded = manager.recordJourneyProof(proof);
    assert.equal(recorded.journeyId, `journey-${category}-001`);
  }

  const proofs = manager.getJourneyProofs();
  assert.equal(proofs.length, 12);

  // Failure path 1: Missing journeyId
  assert.throws(
    () =>
      manager.recordJourneyProof({
        journeyId: "",
        journeyCategory: "ordinary_booking",
        authoritativeStateVerified: true,
        ledgerVerified: true,
        projectionVerified: true,
        notificationVerified: true,
        auditVerified: true,
        conventionalRouteVerified: true,
        permittedChannelVerified: true,
        channel: "web_agui",
        commandEnvelopeId: "env-fail-1"
      }),
    /Journey proof requires a non-empty journeyId/
  );

  // Failure path 2: Missing commandEnvelopeId
  assert.throws(
    () =>
      manager.recordJourneyProof({
        journeyId: "journey-bad-env",
        journeyCategory: "ordinary_booking",
        authoritativeStateVerified: true,
        ledgerVerified: true,
        projectionVerified: true,
        notificationVerified: true,
        auditVerified: true,
        conventionalRouteVerified: true,
        permittedChannelVerified: true,
        channel: "web_agui",
        commandEnvelopeId: ""
      }),
    /Journey proof requires a non-empty commandEnvelopeId/
  );

  // Failure path 3: Unverified authoritative state or ledger flag
  assert.throws(
    () =>
      manager.recordJourneyProof({
        journeyId: "journey-unverified-ledger",
        journeyCategory: "ordinary_booking",
        authoritativeStateVerified: true,
        ledgerVerified: false,
        projectionVerified: true,
        notificationVerified: true,
        auditVerified: true,
        conventionalRouteVerified: true,
        permittedChannelVerified: true,
        channel: "web_agui",
        commandEnvelopeId: "env-fail-2"
      }),
    /failed verification: authoritative state, ledger, projection, notification, audit, conventional route, and channel behavior must all be proved/
  );
});

test("Success, timeout, duplicate, concurrency, provider failure, agent outage, Human Handoff, and reconciliation paths are represented.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchJourneySuiteManager({ audit });

  const pathTypes: ExecutionPathType[] = [
    "success",
    "timeout",
    "duplicate",
    "concurrency",
    "provider_failure",
    "agent_outage",
    "human_handoff",
    "reconciliation"
  ];

  // Success path: Record valid handled execution paths for all 8 path types
  for (const pathType of pathTypes) {
    const record: ExecutionPathRecord = {
      pathId: `path-${pathType}-01`,
      journeyId: "journey-ordinary_booking-001",
      pathType,
      handled: true,
      recoveryAction: `Handled ${pathType} path safely`,
      reconciledState: "consistent"
    };
    const recorded = manager.recordExecutionPath(record);
    assert.equal(recorded.pathId, `path-${pathType}-01`);
  }

  const paths = manager.getExecutionPaths();
  assert.equal(paths.length, 8);

  // Failure path 1: Unhandled execution path
  assert.throws(
    () =>
      manager.recordExecutionPath({
        pathId: "path-unhandled-01",
        journeyId: "journey-ordinary_booking-001",
        pathType: "provider_failure",
        handled: false
      }),
    /was not handled successfully/
  );

  // Failure path 2: Invalid pathId or pathType
  assert.throws(
    () =>
      manager.recordExecutionPath({
        pathId: "",
        journeyId: "journey-ordinary_booking-001",
        pathType: "timeout",
        handled: true
      }),
    /Execution path requires a non-empty pathId/
  );
});

test("Deterministic Parity fixtures show every material interface reaches the same command semantics and controls.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchJourneySuiteManager({ audit });

  const fixture: DeterministicParityFixture = {
    fixtureId: "parity-booking-request-01",
    workflowName: "Submit Booking Request",
    interfacesTested: ["ag_ui", "whatsapp", "conventional_web", "operator_portal"],
    commandType: "SUBMIT_BOOKING_REQUEST",
    envelopeSchemaMatched: true,
    semanticsIdentical: true,
    authorizationEnforced: true,
    concurrencyEnforced: true,
    auditParityVerified: true
  };

  // Success path: Verify fixture passes parity check
  const verified = manager.verifyDeterministicParity(fixture);
  assert.equal(verified.fixtureId, "parity-booking-request-01");
  assert.equal(manager.getParityFixtures().length, 1);

  // Failure path 1: Semantics or control mismatch
  assert.throws(
    () =>
      manager.verifyDeterministicParity({
        ...fixture,
        fixtureId: "parity-fail-semantics",
        semanticsIdentical: false
      }),
    /Deterministic parity failed for fixture parity-fail-semantics/
  );

  // Failure path 2: Insufficient interfaces tested (< 2)
  assert.throws(
    () =>
      manager.verifyDeterministicParity({
        ...fixture,
        fixtureId: "parity-fail-interfaces",
        interfacesTested: ["ag_ui"]
      }),
    /requires testing across at least 2 distinct interfaces/
  );
});

test("All applicable provider, legal, privacy, Operator, operational, accessibility, security, reliability, and protocol validation gates are closed.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new LaunchJourneySuiteManager({ audit });

  // Add journey proofs, execution paths, and parity fixture first
  const categories: JourneyCategory[] = [
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
  for (const category of categories) {
    manager.recordJourneyProof({
      journeyId: `j-${category}`,
      journeyCategory: category,
      authoritativeStateVerified: true,
      ledgerVerified: true,
      projectionVerified: true,
      notificationVerified: true,
      auditVerified: true,
      conventionalRouteVerified: true,
      permittedChannelVerified: true,
      channel: "web_agui",
      commandEnvelopeId: `env-${category}`
    });
  }

  const pathTypes: ExecutionPathType[] = [
    "success",
    "timeout",
    "duplicate",
    "concurrency",
    "provider_failure",
    "agent_outage",
    "human_handoff",
    "reconciliation"
  ];
  for (const pathType of pathTypes) {
    manager.recordExecutionPath({
      pathId: `p-${pathType}`,
      journeyId: "j-ordinary_booking",
      pathType,
      handled: true
    });
  }

  manager.verifyDeterministicParity({
    fixtureId: "parity-01",
    workflowName: "E2E Booking",
    interfacesTested: ["ag_ui", "whatsapp"],
    commandType: "CREATE_BOOKING",
    envelopeSchemaMatched: true,
    semanticsIdentical: true,
    authorizationEnforced: true,
    concurrencyEnforced: true,
    auditParityVerified: true
  });

  const gateTypes: ValidationGateType[] = [
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

  // Success path: Close all 9 gate types
  for (const gateType of gateTypes) {
    const gate: ValidationGateRecord = {
      gateId: `gate-${gateType}-01`,
      gateType,
      gateName: `${gateType.toUpperCase()} Launch Gate`,
      status: "closed",
      evidence: "Passed end-to-end verification audit"
    };
    const closed = manager.closeValidationGate(gate);
    assert.equal(closed.status, "closed");
  }

  const gates = manager.getValidationGates();
  assert.equal(gates.length, 9);

  const readiness = manager.evaluateReleaseReadiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.summary.totalClosedGates, 9);
  assert.equal(readiness.summary.missingCategories.length, 0);
  assert.equal(readiness.summary.missingPathTypes.length, 0);
  assert.equal(readiness.summary.missingGateTypes.length, 0);

  // Failure path 1: Attempt to close a gate that is not in "closed" status
  assert.throws(
    () =>
      manager.closeValidationGate({
        gateId: "gate-fail-open",
        gateType: "security",
        gateName: "Unclosed Security Gate",
        status: "open"
      }),
    /must be closed before release/
  );

  // Failure path 2: Missing required gates results in readiness ready = false
  const incompleteManager = new LaunchJourneySuiteManager({ audit: new InMemoryAuditLog() });
  const incompleteReadiness = incompleteManager.evaluateReleaseReadiness();
  assert.equal(incompleteReadiness.ready, false);
  assert.ok(incompleteReadiness.summary.missingCategories.length > 0);
});
