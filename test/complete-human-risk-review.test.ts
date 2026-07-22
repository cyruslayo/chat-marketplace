import test from "node:test";
import assert from "node:assert/strict";
import {
  HumanRiskReviewManager,
  HumanRiskReasonCodes,
  calculateReviewDeadline
} from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";


function createMockAudit() {
  const records: Record<string, unknown>[] = [];
  return {
    record(entry: Record<string, unknown>) {
      records.push(entry);
    },
    records
  };
}

function createEnvelope<T>(
  commandName: string,
  payload: T,
  { actorId = "guest-100", role = "guest", tenantId = "tenant-lagos", isHumanReviewer = false } = {}
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd-${Math.random().toString(36).slice(2)}`,
    commandName,
    timestamp: "2026-08-01T08:00:00.000Z",
    principal: {
      id: actorId,
      tenantId,
      role,
      isHumanReviewer
    } as any,
    payload
  };
}

test("Automatic progression, human review, rejection, expiry, and cancellation use explicit reason codes and deadlines", () => {
  const audit = createMockAudit();
  const manager = new HumanRiskReviewManager({ audit });
  const clock = () => new Date("2026-08-01T08:00:00.000Z");

  // 1. Automatic progression
  const lowRiskEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-low-risk",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: [],
    internalRiskScore: 10
  });

  const autoResult = manager.routeRequestDraft(lowRiskEnv, { clock });
  assert.equal(autoResult.requiresHumanReview, false);
  assert.equal(autoResult.reasonCode, HumanRiskReasonCodes.AUTO_PROGRESSION);

  // 2. Human review required
  const highRiskEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-high-risk",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: ["HIGH_VALUE_STAY", "PAYER_MISMATCH_SUSPECT"],
    internalRiskScore: 85,
    internalEvidence: ["High transaction value mismatch with account history"]
  });

  const reviewResult = manager.routeRequestDraft(highRiskEnv, { clock });
  assert.equal(reviewResult.requiresHumanReview, true);
  assert.equal(reviewResult.reasonCode, HumanRiskReasonCodes.HUMAN_REVIEW_REQUIRED);
  assert.ok(reviewResult.reviewItem);

  const reviewId = reviewResult.reviewItem.reviewId;
  const reviewItem = manager.getReview(reviewId);
  assert.equal(reviewItem.status, "pending_review");
  // Deadline calculation: min(openedAt + 24h, checkIn - 3h)
  // openedAt = Aug 1 08:00, checkIn = Aug 10 14:00. 24h is Aug 2 08:00
  assert.equal(reviewItem.deadlineAt, "2026-08-02T08:00:00.000Z");

  // 3. Human rejection with explicit reason code
  const reviewerEnv = createEnvelope(
    "risk_review.submit_decision",
    {
      reviewId,
      decision: "reject" as const,
      notes: "Identity verification mismatched cardholder name",
      isHumanReviewer: true
    },
    { actorId: "staff-999", role: "human_reviewer", isHumanReviewer: true }
  );

  const rejectedReview = manager.submitReviewDecision(reviewerEnv, { clock });
  assert.equal(rejectedReview.status, "rejected");
  assert.equal(rejectedReview.reasonCode, HumanRiskReasonCodes.HUMAN_RISK_REJECTED);
  assert.equal(rejectedReview.decision?.reasonCode, HumanRiskReasonCodes.HUMAN_RISK_REJECTED);

  // 4. Expiry evaluation
  const expDraftEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-expiry-test",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: ["NEW_GUEST_HIGH_VELOCITY"]
  });
  const expRouteResult = manager.routeRequestDraft(expDraftEnv, { clock });
  const expReviewId = expRouteResult.reviewItem!.reviewId;

  // Advance clock beyond 24h deadline
  const expiredClock = () => new Date("2026-08-02T08:00:01.000Z");
  const expiredItem = manager.evaluateExpiry(expReviewId, { clock: expiredClock });
  assert.equal(expiredItem.status, "expired_unresolved");
  assert.equal(expiredItem.reasonCode, HumanRiskReasonCodes.EXPIRED_UNRESOLVED);

  // 5. Guest cancellation with explicit reason code
  const cancelDraftEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-cancel-test",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: ["UNVERIFIED_PARTY_HISTORY"]
  });
  const cancelRouteResult = manager.routeRequestDraft(cancelDraftEnv, { clock });
  const cancelReviewId = cancelRouteResult.reviewItem!.reviewId;

  const cancelEnv = createEnvelope("risk_review.cancel_review", { reviewId: cancelReviewId }, { actorId: "guest-100" });
  const cancelledItem = manager.cancelReview(cancelEnv, { clock });
  assert.equal(cancelledItem.status, "cancelled");
  assert.equal(cancelledItem.reasonCode, HumanRiskReasonCodes.GUEST_CANCELLED_DRAFT);
});

test("Review never consumes the protected Operator response and payment lifecycle or creates an indefinite hold", () => {
  const audit = createMockAudit();
  const manager = new HumanRiskReviewManager({ audit });

  // Check-in in 4 hours -> latest disclosure cutoff is in 1 hour (3h before check-in)
  const openedAt = new Date("2026-08-01T10:00:00.000Z");
  const checkInIso = "2026-08-01T14:00:00.000Z";
  const deadline = calculateReviewDeadline(openedAt, checkInIso);

  // Deadline is 11:00:00.000Z (3h before check-in 14:00:00) which is 1 hour, not 24h!
  assert.equal(deadline.toISOString(), "2026-08-01T11:00:00.000Z");

  const clock = () => openedAt;
  const draftEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-urgent",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: checkInIso,
    checkOut: "2026-08-03T11:00:00.000Z",
    riskTriggers: ["HIGH_VALUE_STAY"]
  });

  const routeResult = manager.routeRequestDraft(draftEnv, { clock });
  assert.equal(routeResult.reviewItem?.deadlineAt, "2026-08-01T11:00:00.000Z");

  // Operator interaction projection MUST be null (operator sees NOTHING while under review, no 30-min window started)
  const operatorProj = manager.projectOperatorInteractionState(routeResult.reviewItem!.reviewId);
  assert.equal(operatorProj, null);

  // Advance clock past 11:00:00 cutoff -> expires immediately without holding inventory or affecting operator
  const pastCutoffClock = () => new Date("2026-08-01T11:00:01.000Z");
  const expiredReview = manager.evaluateExpiry(routeResult.reviewItem!.reviewId, { clock: pastCutoffClock });
  assert.equal(expiredReview.status, "expired_unresolved");
  assert.equal(expiredReview.reasonCode, HumanRiskReasonCodes.EXPIRED_UNRESOLVED);
});

test("Internal risk scores and restricted evidence remain outside guest and Operator interaction projections", () => {
  const audit = createMockAudit();
  const manager = new HumanRiskReviewManager({ audit });
  const clock = () => new Date("2026-08-01T08:00:00.000Z");

  const draftEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-secret-risk",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: ["HIGH_VALUE_STAY"],
    internalRiskScore: 92,
    internalEvidence: ["Flagged by automated fraud model sub-agent with 92% confidence"]
  });

  const routeResult = manager.routeRequestDraft(draftEnv, { clock });
  const reviewId = routeResult.reviewItem!.reviewId;

  // Guest interaction projection MUST NOT expose internalRiskScore or internalEvidence
  const guestProjection = manager.projectGuestInteractionState(reviewId);
  assert.equal(guestProjection.reviewId, reviewId);
  assert.equal((guestProjection as any).internalRiskScore, undefined);
  assert.equal((guestProjection as any).internalEvidence, undefined);

  // Operator interaction projection MUST be null (operator sees no internal risk data or draft)
  const operatorProjection = manager.projectOperatorInteractionState(reviewId);
  assert.equal(operatorProjection, null);

  // Authorized staff view retains internal risk scores and evidence within tenant scope
  const staffEnv = createEnvelope("risk_review.staff_view", { reviewId }, { actorId: "staff-1", role: "staff" });
  const staffView = manager.projectStaffView(staffEnv, reviewId);
  assert.equal(staffView.internalRiskScore, 92);
  assert.equal(staffView.internalEvidence.length, 1);
});

test("Solely automated adverse final decisions are impossible, and authorized review is auditable and tenant-scoped", () => {
  const audit = createMockAudit();
  const manager = new HumanRiskReviewManager({ audit });
  const clock = () => new Date("2026-08-01T08:00:00.000Z");

  const draftEnv = createEnvelope("risk_review.route_draft", {
    draftId: "draft-tenant-a",
    primaryGuestId: "guest-100",
    unitId: "unit-1",
    checkIn: "2026-08-10T14:00:00.000Z",
    checkOut: "2026-08-12T11:00:00.000Z",
    riskTriggers: ["PAYER_MISMATCH_SUSPECT"]
  }, { tenantId: "tenant-lagos" });

  const routeResult = manager.routeRequestDraft(draftEnv, { clock });
  const reviewId = routeResult.reviewItem!.reviewId;

  // 1. Failure path: Solely automated adverse decision attempt (isHumanReviewer: false) MUST throw an error
  const automatedRejectEnv = createEnvelope(
    "risk_review.submit_decision",
    {
      reviewId,
      decision: "reject" as const,
      isHumanReviewer: false
    },
    { actorId: "ai-agent-bot", role: "automation_agent", isHumanReviewer: false }
  );

  assert.throws(
    () => manager.submitReviewDecision(automatedRejectEnv, { clock }),
    /Solely automated adverse final decisions are impossible/
  );

  // 2. Failure path: Cross-tenant human decision attempt MUST be denied
  const crossTenantEnv = createEnvelope(
    "risk_review.submit_decision",
    {
      reviewId,
      decision: "reject" as const,
      isHumanReviewer: true
    },
    { actorId: "staff-abuja", role: "human_reviewer", tenantId: "tenant-abuja", isHumanReviewer: true }
  );

  assert.throws(
    () => manager.submitReviewDecision(crossTenantEnv, { clock }),
    /Cross-tenant risk review decision denied/
  );

  // 3. Success path: Authorized human reviewer in same tenant can decide, creating audit trail
  const validStaffEnv = createEnvelope(
    "risk_review.submit_decision",
    {
      reviewId,
      decision: "approve" as const,
      notes: "Verified identity document matches booking details",
      isHumanReviewer: true
    },
    { actorId: "staff-lagos", role: "human_reviewer", tenantId: "tenant-lagos", isHumanReviewer: true }
  );

  const approvedReview = manager.submitReviewDecision(validStaffEnv, { clock });
  assert.equal(approvedReview.status, "approved");
  assert.equal(approvedReview.decision?.reviewerId, "staff-lagos");

  // Verify audit trail
  const recordedTypes = audit.records.map((r) => r.type);
  assert.ok(recordedTypes.includes("risk_review.opened"));
  assert.ok(recordedTypes.includes("risk_review.approved"));
});
