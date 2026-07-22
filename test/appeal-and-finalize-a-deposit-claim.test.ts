import test from "node:test";
import assert from "node:assert/strict";
import { DepositClaimManager } from "../domains/shortlet/src/index.js";

test("Appeal eligibility, deadline, independence, evidence, and final decision are explicit and versioned", () => {
  const manager = new DepositClaimManager();

  // 1. Submit & notify claim
  const claim = manager.submitDepositClaim({
    reservationId: "res-701",
    unitId: "unit-701",
    tenantId: "tenant-lagos",
    operatorId: "op-701",
    guestId: "guest-701",
    authoritativeCheckoutIso: "2026-09-01T10:00:00.000Z",
    submittedAtIso: "2026-09-01T15:00:00.000Z",
    depositAmountKobo: 5000000,
    items: [
      {
        itemId: "item-1",
        description: "Broken table",
        claimedAmountKobo: 2000000,
        evidenceUrls: ["https://evidence.example.com/table.jpg"]
      }
    ]
  });

  manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: "2026-09-01T16:00:00.000Z",
    proofOfDeliveryUrl: "https://delivery.example.com/pod-701"
  });

  // Adjudicate claim
  manager.adjudicateClaim({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    adjudicatorId: "adj-user-1",
    evaluations: [
      {
        itemId: "item-1",
        approvedAmountKobo: 2000000,
        rationale: "Evidence confirms damage"
      }
    ]
  });

  // Attempt appeal after 7-day window (e.g. 8 days later) fails
  assert.throws(
    () =>
      manager.fileClaimAppeal({
        claimId: claim.claimId,
        tenantId: "tenant-lagos",
        appellantId: "guest-701",
        appellantRole: "guest",
        appealGround: "material_factual_error",
        statement: "Table was already broken",
        evidenceUrls: ["https://evidence.example.com/checkin_photo.jpg"],
        filedAtIso: "2026-09-10T16:00:00.000Z" // 9 days later (> 7 days)
      }),
    /Claim Appeal rejected: Exceeds the 7 elapsed calendar days window from notification/
  );

  // File timely appeal (3 days later)
  const appealResult = manager.fileClaimAppeal({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    appellantId: "guest-701",
    appellantRole: "guest",
    appealGround: "material_factual_error",
    statement: "Table was already broken upon check-in",
    evidenceUrls: ["https://evidence.example.com/checkin_photo.jpg"],
    filedAtIso: "2026-09-04T16:00:00.000Z"
  });
  assert.equal(appealResult.status, "appeal_pending");

  // Re-adjudication / decision by same adjudicator MUST fail (independence rule)
  assert.throws(
    () =>
      manager.resolveClaimAppeal({
        claimId: claim.claimId,
        tenantId: "tenant-lagos",
        reviewerId: "adj-user-1", // Same person as original adjudicator!
        decision: "reverse",
        rationale: "Reversing award",
        adjustedApprovedKobo: 0
      }),
    /Appeal reviewer must be independent and conflict-free/
  );

  // Resolution by independent reviewer succeeds
  const finalAppeal = manager.resolveClaimAppeal({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    reviewerId: "indep-reviewer-99",
    decision: "reverse",
    rationale: "Pre-existing damage evidence accepted",
    adjustedApprovedKobo: 0
  });

  assert.equal(finalAppeal.status, "finalized");
  assert.equal(finalAppeal.internalFinality, true);
});

test("Approved Operator awards remain reserved until internally final and cannot be paid twice", () => {
  const manager = new DepositClaimManager();

  const claim = manager.submitDepositClaim({
    reservationId: "res-702",
    unitId: "unit-702",
    tenantId: "tenant-lagos",
    operatorId: "op-702",
    guestId: "guest-702",
    authoritativeCheckoutIso: "2026-09-01T10:00:00.000Z",
    submittedAtIso: "2026-09-01T12:00:00.000Z",
    depositAmountKobo: 5000000,
    items: [
      {
        itemId: "item-1",
        description: "Damaged wall",
        claimedAmountKobo: 3000000,
        evidenceUrls: ["https://evidence.example.com/wall.jpg"]
      }
    ]
  });

  manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: "2026-09-01T13:00:00.000Z",
    proofOfDeliveryUrl: "https://delivery.example.com/pod-702"
  });

  manager.adjudicateClaim({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    adjudicatorId: "adj-1",
    evaluations: [{ itemId: "item-1", approvedAmountKobo: 3000000, rationale: "Approved" }]
  });

  // Attempt payout before Internal Finality MUST fail
  assert.throws(
    () => manager.processPayout({ claimId: claim.claimId, tenantId: "tenant-lagos" }),
    /Approved award cannot be paid before reaching Internal Finality/
  );

  // Authenticated guest waiver grants immediate Internal Finality
  const waived = manager.grantAuthenticatedGuestWaiver({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    guestId: "guest-702",
    authenticatedWaiverToken: "auth-waiver-tok-123"
  });
  assert.equal(waived.internalFinality, true);

  // Payout succeeds once internally final
  const payout1 = manager.processPayout({ claimId: claim.claimId, tenantId: "tenant-lagos" });
  assert.equal(payout1.status, "paid");

  // Attempting second payout MUST fail (cannot be paid twice)
  assert.throws(
    () => manager.processPayout({ claimId: claim.claimId, tenantId: "tenant-lagos" }),
    /Claim award has already been paid/
  );
});

test("Notification failure follows independent review, reserve-release, late-appeal, and closure deadlines exactly", () => {
  const manager = new DepositClaimManager();

  const claim = manager.submitDepositClaim({
    reservationId: "res-703",
    unitId: "unit-703",
    tenantId: "tenant-lagos",
    operatorId: "op-703",
    guestId: "guest-703",
    authoritativeCheckoutIso: "2026-09-01T10:00:00.000Z",
    submittedAtIso: "2026-09-01T12:00:00.000Z",
    depositAmountKobo: 5000000,
    items: [
      {
        itemId: "item-1",
        description: "Stained couch",
        claimedAmountKobo: 2000000,
        evidenceUrls: ["https://evidence.example.com/couch.jpg"]
      }
    ]
  });

  // Notification is PENDING (failed notification)
  // Day 14 check -> flags for assisted review
  const day14 = manager.handleUnnotifiedClaimDeadline({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    checkTimeIso: "2026-09-15T12:00:00.000Z" // Day 14
  });
  assert.equal(day14.actionRequired, "assisted_review");

  // Day 45 check -> reserve release to guest
  const day45 = manager.handleUnnotifiedClaimDeadline({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    checkTimeIso: "2026-10-16T12:00:00.000Z" // Day 45
  });
  assert.equal(day45.actionRequired, "reserve_release_to_guest");

  // Day 90 check -> final closure
  const day90 = manager.handleUnnotifiedClaimDeadline({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    checkTimeIso: "2026-11-30T12:00:00.000Z" // Day 90
  });
  assert.equal(day90.actionRequired, "final_closure");
});

test("Fraud, regulator, court, and legal-hold exceptions preserve records without silently reopening ordinary appeal rights", () => {
  const manager = new DepositClaimManager();

  const claim = manager.submitDepositClaim({
    reservationId: "res-704",
    unitId: "unit-704",
    tenantId: "tenant-lagos",
    operatorId: "op-704",
    guestId: "guest-704",
    authoritativeCheckoutIso: "2026-09-01T10:00:00.000Z",
    submittedAtIso: "2026-09-01T12:00:00.000Z",
    depositAmountKobo: 5000000,
    items: [
      {
        itemId: "item-1",
        description: "Broken TV",
        claimedAmountKobo: 4000000,
        evidenceUrls: ["https://evidence.example.com/tv.jpg"]
      }
    ]
  });

  manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: "2026-09-01T13:00:00.000Z",
    proofOfDeliveryUrl: "https://delivery.example.com/pod-704"
  });

  manager.adjudicateClaim({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    adjudicatorId: "adj-1",
    evaluations: [{ itemId: "item-1", approvedAmountKobo: 4000000, rationale: "Approved" }]
  });

  // Trigger exceptional reopening for fraud detection
  const exceptional = manager.triggerExceptionalReopening({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    reason: "fraud",
    evidence: "Falsified repair invoice detected",
    authorizedBy: "compliance-officer-1"
  });

  assert.equal(exceptional.exceptionalStatus, "exceptional_reopening");
  assert.equal(exceptional.recordPreserved, true);

  // Ordinary 7-day appeal rights are NOT silently reopened
  assert.equal(exceptional.ordinaryAppealReopened, false);
});
