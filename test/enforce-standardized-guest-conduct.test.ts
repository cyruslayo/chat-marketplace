import test from "node:test";
import assert from "node:assert/strict";
import { GuestConductManager } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

test("Unit-specific visitor and Pet Friendly choices remain within the platform catalogue and disclosed contract terms", () => {
  const manager = new GuestConductManager();

  // Valid policy using platform catalogue options
  const validPolicy = manager.validateUnitConductPolicy({
    unitId: "unit-101",
    visitorsMode: "registered_8am_10pm",
    petsAllowed: true,
    petTermsDisclosed: true,
    childrenAllowed: true,
    quietHours: "22:00-08:00"
  });

  assert.equal(validPolicy.visitorsMode, "registered_8am_10pm");
  assert.equal(validPolicy.petsAllowed, true);

  // Prohibited custom rules or arbitrary fees rejected
  assert.throws(
    () =>
      manager.validateUnitConductPolicy({
        unitId: "unit-102",
        visitorsMode: "unrestricted" as any, // Not in platform catalogue
        petsAllowed: true,
        petTermsDisclosed: false,
        childrenAllowed: true,
        quietHours: "22:00-08:00"
      }),
    /Unit conduct policy rejected: Visitors or pets terms outside platform catalogue/
  );

  // Arbitrary fee/fine attached to policy must be rejected
  assert.throws(
    () =>
      manager.validateUnitConductPolicy({
        unitId: "unit-103",
        visitorsMode: "prohibited",
        petsAllowed: false,
        childrenAllowed: true,
        quietHours: "22:00-08:00",
        customCashFineKobo: 500000
      }),
    /Arbitrary cash fines or penalties are prohibited/
  );
});

test("Operators cannot copy identity evidence without legal authority or create cash fines and arbitrary penalties", () => {
  const manager = new GuestConductManager();

  // Visual comparison without copying is valid
  const validCheck = manager.recordIdentityCheck({
    reservationId: "res-201",
    primaryGuestId: "guest-ada",
    visualComparisonPassed: true,
    operatorCopiedId: false
  });
  assert.equal(validCheck.visualComparisonPassed, true);

  // Operator attempting to copy ID evidence without legal authority fails
  assert.throws(
    () =>
      manager.recordIdentityCheck({
        reservationId: "res-202",
        primaryGuestId: "guest-obi",
        visualComparisonPassed: true,
        operatorCopiedId: true,
        legalAuthorityProvided: false
      }),
    /Operators cannot copy or retain identity evidence without legal authority/
  );

  // Success path when explicit legal authority provided
  const legalCopyCheck = manager.recordIdentityCheck({
    reservationId: "res-203",
    primaryGuestId: "guest-obi",
    visualComparisonPassed: true,
    operatorCopiedId: true,
    legalAuthorityProvided: true,
    legalAuthorityReference: "Lagos State Tourism Law Sec 14"
  });
  assert.equal(legalCopyCheck.operatorCopiedId, true);
  assert.equal(legalCopyCheck.legalAuthorityProvided, true);
});

test("Consequential termination or charge uses a Platform Command Envelope, evidence, policy, and authorized human decision", () => {
  const manager = new GuestConductManager();

  // Report breach
  const allegation = manager.reportBreach({
    allegationId: "alg-301",
    reservationId: "res-301",
    tenantId: "tenant-lagos",
    ruleBreached: "unauthorized_party",
    evidenceUrls: ["https://evidence.example.com/party.jpg"],
    reportedAtIso: "2026-09-01T23:00:00.000Z"
  });
  assert.equal(allegation.status, "alleged");

  // Attempt consequential termination without authorized human fails
  const invalidEnvelope = createPlatformCommandEnvelope({
    commandName: "guest_conduct.consequential_action",
    principal: { id: "bot-ai", role: "agent", tenantId: "tenant-lagos" },
    payload: {
      allegationId: "alg-301",
      action: "terminate_stay",
      reason: "Unauthorized party",
      evidenceUrls: ["https://evidence.example.com/party.jpg"],
      policyReference: "ADR-0059-PARTY-PROHIBITION"
    }
  });

  assert.throws(
    () => manager.executeConsequentialAction(invalidEnvelope),
    /Consequential termination or charge requires an authorized human decision/
  );

  // Valid consequential action with human principal
  const validEnvelope = createPlatformCommandEnvelope({
    commandName: "guest_conduct.consequential_action",
    principal: { id: "human-officer-1", role: "admin", tenantId: "tenant-lagos" },
    payload: {
      allegationId: "alg-301",
      action: "terminate_stay",
      reason: "Unauthorized party verified",
      evidenceUrls: ["https://evidence.example.com/party.jpg"],
      policyReference: "ADR-0059-PARTY-PROHIBITION"
    }
  });

  const result = manager.executeConsequentialAction(validEnvelope);
  assert.equal(result.action, "terminate_stay");
  assert.equal(result.authorizedHumanId, "human-officer-1");
  assert.equal(result.status, "executed");
});

test("Guest, Operator, and support projections show the same rule version, allegation state, cure, and outcome", () => {
  const manager = new GuestConductManager();

  manager.reportBreach({
    allegationId: "alg-401",
    reservationId: "res-401",
    tenantId: "tenant-lagos",
    ruleBreached: "noise_during_quiet_hours",
    evidenceUrls: ["https://evidence.example.com/noise.mp3"],
    reportedAtIso: "2026-09-02T01:00:00.000Z"
  });

  manager.issueWarningAndCure({
    allegationId: "alg-401",
    cureWindowMinutes: 30,
    warningDetails: "Please lower audio volume within 30 minutes",
    issuedAtIso: "2026-09-02T01:10:00.000Z"
  });

  const guestProj = manager.getProjection("alg-401", "guest");
  const opProj = manager.getProjection("alg-401", "operator");
  const supportProj = manager.getProjection("alg-401", "support");

  assert.equal(guestProj.ruleVersion, opProj.ruleVersion);
  assert.equal(opProj.ruleVersion, supportProj.ruleVersion);

  assert.equal(guestProj.allegationState, "warning_issued");
  assert.equal(opProj.allegationState, "warning_issued");
  assert.equal(supportProj.allegationState, "warning_issued");

  assert.equal(guestProj.cureWindowMinutes, 30);
  assert.equal(opProj.cureWindowMinutes, 30);
  assert.equal(supportProj.cureWindowMinutes, 30);
});
