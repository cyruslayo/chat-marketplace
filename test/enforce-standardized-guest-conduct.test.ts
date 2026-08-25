import test from "node:test";
import assert from "node:assert/strict";
import { createGuestConductPolicySnapshot, GuestConductManager } from "../domains/shortlet/src/index.js";

test("launch conduct policy is structured, versioned, and uses the safe defaults", () => {
  const policy = createGuestConductPolicySnapshot({ unitId: "unit-1", capacity: 4 });
  assert.equal(policy.visitorMode, "prohibited");
  assert.equal(policy.petsAllowed, false);
  assert.equal(policy.children.allowed, true);
  assert.equal(policy.quietHours.start, "22:00");
  assert.equal(policy.quietHours.end, "08:00");
  assert.equal(policy.quietHours.timezone, "Africa/Lagos");
  assert.match(policy.ruleVersion, /^guest-conduct\/v1:[0-9a-f]{16}$/);
  assert.equal(policy.occupancyLimit, 4);
  assert.equal(policy.overnightOccupantsNamed, true);
});

test("unit-specific choices are catalogue-bound and disclosed", () => {
  const policy = createGuestConductPolicySnapshot({ unitId: "unit-2", capacity: 2, policy: { unitId: "unit-2", visitorsMode: "registered_8am_10pm", petsAllowed: true, petTermsDisclosed: true } });
  assert.equal(policy.visitorMode, "registered_8am_10pm");
  assert.equal(policy.petFriendlyTerms, "Disclosed Pet Friendly terms apply.");
  assert.throws(() => createGuestConductPolicySnapshot({ unitId: "unit-2", capacity: 2, policy: { unitId: "unit-2", visitorsMode: "prohibited", petsAllowed: true } }), /Pet Friendly terms/);
  assert.throws(() => createGuestConductPolicySnapshot({ unitId: "unit-2", capacity: 2, policy: { unitId: "unit-2", visitorsMode: "unrestricted" as never, petsAllowed: false } }), /catalogue/);
  assert.throws(() => createGuestConductPolicySnapshot({ unitId: "unit-2", capacity: 2, policy: { unitId: "unit-2", visitorsMode: "prohibited", petsAllowed: false, quietHours: "20:00-08:00" } }), /quiet hours/);
});

test("trusted allegation and policy warning are monotonic and idempotent", () => {
  const manager = new GuestConductManager(); const policy = createGuestConductPolicySnapshot({ unitId: "unit-3", capacity: 3 });
  const evidence = { evidenceSetId: "evidence-1", version: "1", status: "accepted" as const, count: 1, category: "conduct" as const, assessment: "remediable" as const };
  const allegation = manager.reportTrusted({ commandId: "cmd-1", reservationId: "res-1", ruleId: "quiet_hours", contract: policy, evidence, safeSummary: "Noise was assessed during contracted quiet hours." });
  assert.equal(allegation.ruleVersion, policy.ruleVersion);
  const warning = manager.issuePolicyWarning(allegation.allegationId, "warning-1", new Date("2026-01-01T00:00:00Z"));
  assert.equal(warning.state, "cure_pending"); assert.equal(warning.cureWindowMinutes, 30);
  assert.deepEqual(manager.issuePolicyWarning(allegation.allegationId, "warning-1"), warning);
  assert.throws(() => manager.reportTrusted({ commandId: "cmd-2", reservationId: "res-1", ruleId: "quiet_hours", contract: policy, evidence: { ...evidence, count: 0 }, safeSummary: "x" }), /evidence/);
});
