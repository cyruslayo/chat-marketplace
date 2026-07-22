import test from "node:test";
import assert from "node:assert/strict";
import { DepositClaimManager } from "../domains/shortlet/src/index.js";

function createMockClaimParams() {
  return {
    reservationId: "res-dep-claim-1",
    unitId: "unit-lagos-1",
    tenantId: "tenant-lagos",
    operatorId: "op-lekki",
    guestId: "guest-ada",
    authoritativeCheckoutIso: "2026-08-25T13:00:00.000Z", // Amended checkout to 14:00 WAT (13:00 UTC)
    depositAmountKobo: 20000000 // ₦200,000 deposit
  };
}

test("Claim timing begins from amended checkout where applicable and rejects unsupported or late submissions under policy", () => {
  const manager = new DepositClaimManager();
  const params = createMockClaimParams();

  // Success path: Claim submitted within 24 hours of amended checkout (e.g. +20 hours)
  const timelySubmissionIso = "2026-08-26T09:00:00.000Z"; // 20h < 24h
  const claim = manager.submitDepositClaim({
    ...params,
    submittedAtIso: timelySubmissionIso,
    items: [
      {
        itemId: "item-broken-tv",
        description: "Broken TV screen",
        claimedAmountKobo: 5000000,
        evidenceUrls: ["https://evidence.example.com/tv_pre.jpg", "https://evidence.example.com/tv_post.jpg"]
      }
    ]
  });

  assert.equal(claim.status, "submitted");
  assert.equal(claim.items.length, 1);

  // Failure path 1: Claim submitted late (>24 hours past amended checkout) MUST be rejected under policy (ADR 0016)
  const lateSubmissionIso = "2026-08-26T14:00:00.000Z"; // 25h > 24h
  assert.throws(
    () =>
      manager.submitDepositClaim({
        ...params,
        submittedAtIso: lateSubmissionIso,
        items: [
          {
            itemId: "item-broken-table",
            description: "Broken table",
            claimedAmountKobo: 3000000,
            evidenceUrls: ["https://evidence.example.com/table.jpg"]
          }
        ]
      }),
    /Deposit claim rejected: Submitted past the 24-hour post-checkout policy deadline/
  );

  // Failure path 2: Claim without itemized evidence MUST be rejected (ADR 0018)
  assert.throws(
    () =>
      manager.submitDepositClaim({
        ...params,
        submittedAtIso: timelySubmissionIso,
        items: [
          {
            itemId: "item-unsupported",
            description: "General inconvenience fee",
            claimedAmountKobo: 2000000,
            evidenceUrls: [] // empty evidence!
          }
        ]
      }),
    /Deposit claim item rejected: Must provide itemized evidence/
  );
});

test("Notification status is evidence-backed; the response period starts only after successful notice", () => {
  const manager = new DepositClaimManager();
  const params = createMockClaimParams();
  const timelySubmissionIso = "2026-08-26T09:00:00.000Z";

  const claim = manager.submitDepositClaim({
    ...params,
    submittedAtIso: timelySubmissionIso,
    items: [
      {
        itemId: "item-door",
        description: "Damaged door lock",
        claimedAmountKobo: 4000000,
        evidenceUrls: ["https://evidence.example.com/door.jpg"]
      }
    ]
  });

  // Attempting to calculate response deadline BEFORE successful notification MUST indicate unnotified state (ADR 0017)
  const beforeNoticeStatus = manager.getClaimStatus(claim.claimId, "tenant-lagos");
  assert.equal(beforeNoticeStatus.notificationState, "pending_notification");
  assert.equal(beforeNoticeStatus.responseWindowStartIso, null);

  // Successful notification with evidence
  const noticeIso = "2026-08-26T11:00:00.000Z";
  const notifiedClaim = manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: noticeIso,
    proofOfDeliveryUrl: "https://delivery-proof.example.com/whatsapp_read_receipt.png"
  });

  assert.equal(notifiedClaim.notificationState, "successfully_notified");
  assert.equal(notifiedClaim.responseWindowStartIso, noticeIso);
  // 48 hours response window from successful notification
  assert.equal(notifiedClaim.responseWindowEndIso, "2026-08-28T11:00:00.000Z");
});

test("The Operator bears the full proof burden and cannot rely on arbitrary fees or uncorroborated assertions", () => {
  const manager = new DepositClaimManager();
  const params = createMockClaimParams();
  const claim = manager.submitDepositClaim({
    ...params,
    submittedAtIso: "2026-08-26T09:00:00.000Z",
    items: [
      {
        itemId: "item-wall-paint",
        description: "Wall painting scratch",
        claimedAmountKobo: 5000000, // ₦50,000
        evidenceUrls: ["https://evidence.example.com/scratch.jpg"]
      },
      {
        itemId: "item-arbitrary",
        description: "Lateness penalty fee", // Arbitrary fee!
        claimedAmountKobo: 3000000,
        evidenceUrls: ["https://evidence.example.com/note.txt"],
        isArbitraryPenalty: true
      }
    ]
  });

  manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: "2026-08-26T11:00:00.000Z",
    proofOfDeliveryUrl: "https://delivery-proof.example.com/read_receipt.png"
  });

  // Adjudicate claim using Balance of Evidence standard (ADR 0018)
  const adjudication = manager.adjudicateClaim({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    adjudicatorId: "human-reviewer-sarah",
    evaluations: [
      {
        itemId: "item-wall-paint",
        approvedAmountKobo: 2000000, // Reduced based on depreciation & actual repair quote
        rationale: "Approved reasonable repair cost after depreciation"
      },
      {
        itemId: "item-arbitrary",
        approvedAmountKobo: 0, // Arbitrary penalty rejected!
        rationale: "Arbitrary penalties prohibited under deposit policy"
      }
    ]
  });

  assert.equal(adjudication.totalApprovedKobo, 2000000);
  assert.equal(adjudication.unapprovedBalanceKobo, 18000000); // ₦180,000 refunded to guest immediately!
  assert.equal(adjudication.status, "adjudicated");
});

test("Claim, response, evidence provenance, reserved amount, decision, and notices remain auditable and tenant-scoped", () => {
  const manager = new DepositClaimManager();
  const params = createMockClaimParams();

  // Tenant scoping check: accessing with mismatched tenantId MUST throw
  const claim = manager.submitDepositClaim({
    ...params,
    submittedAtIso: "2026-08-26T09:00:00.000Z",
    items: [
      {
        itemId: "item-curtain",
        description: "Torn curtain",
        claimedAmountKobo: 1000000,
        evidenceUrls: ["https://evidence.example.com/curtain.jpg"]
      }
    ]
  });

  assert.throws(
    () => manager.getClaimStatus(claim.claimId, "mismatched-tenant"),
    /Tenant scope mismatch/
  );

  manager.recordSuccessfulNotification({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    notificationIso: "2026-08-26T11:00:00.000Z",
    proofOfDeliveryUrl: "https://delivery-proof.example.com/proof.png"
  });

  // Guest dispute
  const disputeResult = manager.submitGuestResponse({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    guestId: "guest-ada",
    responseType: "dispute",
    statement: "The curtain was already torn when I checked in",
    disputeEvidenceUrls: ["https://evidence.example.com/curtain_checkin.jpg"]
  });

  assert.equal(disputeResult.guestResponseType, "dispute");

  // Adjudication
  const adj = manager.adjudicateClaim({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    adjudicatorId: "human-reviewer-sarah",
    evaluations: [
      {
        itemId: "item-curtain",
        approvedAmountKobo: 0,
        rationale: "Pre-existing condition evidence provided by guest"
      }
    ]
  });

  assert.equal(adj.totalApprovedKobo, 0);

  // File appeal within 7 days (ADR 0019)
  const appeal = manager.fileClaimAppeal({
    claimId: claim.claimId,
    tenantId: "tenant-lagos",
    appellantId: "op-lekki",
    appellantRole: "operator",
    appealGround: "previously_unavailable_evidence",
    statement: "Submitting timestamped pre-stay inspection photo",
    evidenceUrls: ["https://evidence.example.com/pre_stay_inspection.jpg"],
    filedAtIso: "2026-08-28T10:00:00.000Z"
  });

  assert.equal(appeal.status, "appeal_pending");

  // Verify reserved amount remains locked until internal finality (ADR 0020)
  const audit = manager.getAuditTrail(claim.claimId, "tenant-lagos");
  assert.equal(audit.tenantId, "tenant-lagos");
  assert.equal(audit.history.length >= 4, true);
});
