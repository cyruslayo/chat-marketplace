import test from "node:test";
import assert from "node:assert/strict";
import { VerifiedStayReviewManager, BookingStateForReview } from "../domains/shortlet/src/verified-stay-review.js";
import { InMemoryAuditLog, createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

test("Imported, incentivized, duplicate, ineligible, and out-of-window reviews are rejected.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new VerifiedStayReviewManager({ audit });
  const now = new Date("2026-06-01T12:00:00Z");

  const validBookingState: BookingStateForReview = {
    bookingId: "bk-101",
    guestId: "gst-001",
    operatorId: "op-001",
    unitId: "unit-lagos-01",
    isPaid: true,
    isCompleted: true,
    checkoutDate: "2026-05-25T10:00:00Z",
    verifiedAccessStatus: "verified_access"
  };

  // 1. Imported reviews are rejected
  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-001", role: "guest" },
        payload: {
          bookingId: "bk-101",
          guestId: "gst-001",
          rating: 5,
          comment: "Great stay!",
          isImported: true
        }
      }),
      validBookingState,
      () => now
    ),
    /Imported reviews are rejected/
  );

  // 2. Incentivized reviews are rejected
  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-001", role: "guest" },
        payload: {
          bookingId: "bk-101",
          guestId: "gst-001",
          rating: 5,
          comment: "Paid review",
          isIncentivized: true
        }
      }),
      validBookingState,
      () => now
    ),
    /Incentivized reviews are prohibited/
  );

  // Submit valid review first
  const review = manager.submitReview(
    createPlatformCommandEnvelope({
      commandName: "review.submit",
      principal: { id: "gst-001", role: "guest" },
      payload: {
        bookingId: "bk-101",
        guestId: "gst-001",
        rating: 5,
        comment: "Wonderful apartment!"
      }
    }),
    validBookingState,
    () => now
  );

  assert.equal(review.status, "pending_operator_response");

  // 3. Duplicate review for same booking is rejected
  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-001", role: "guest" },
        payload: {
          bookingId: "bk-101",
          guestId: "gst-001",
          rating: 4,
          comment: "Second attempt"
        }
      }),
      validBookingState,
      () => now
    ),
    /Duplicate review rejected/
  );

  // 4. Ineligible review (unpaid/uncompleted) is rejected
  const unpaidState: BookingStateForReview = {
    ...validBookingState,
    bookingId: "bk-102",
    isPaid: false
  };

  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-001", role: "guest" },
        payload: {
          bookingId: "bk-102",
          guestId: "gst-001",
          rating: 5,
          comment: "Unpaid stay"
        }
      }),
      unpaidState,
      () => now
    ),
    /Review eligibility requires a paid and completed stay/
  );

  // 5. Out-of-window review (> 14 days after checkout) is rejected
  const oldCheckoutState: BookingStateForReview = {
    ...validBookingState,
    bookingId: "bk-103",
    checkoutDate: "2026-05-01T10:00:00Z"
  };

  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-001", role: "guest" },
        payload: {
          bookingId: "bk-103",
          guestId: "gst-001",
          rating: 5,
          comment: "Late submission"
        }
      }),
      oldCheckoutState,
      () => now
    ),
    /Out-of-window review rejected/
  );
});

test("Review eligibility derives from authoritative booking and Verified Access state.", () => {
  const manager = new VerifiedStayReviewManager();
  const now = new Date("2026-06-01T12:00:00Z");

  // Case A: Unverified access state -> rejected
  const failedAccessState: BookingStateForReview = {
    bookingId: "bk-201",
    guestId: "gst-002",
    operatorId: "op-001",
    unitId: "unit-lagos-01",
    isPaid: true,
    isCompleted: true,
    checkoutDate: "2026-05-28T10:00:00Z",
    verifiedAccessStatus: "failed_access"
  };

  assert.throws(
    () => manager.submitReview(
      createPlatformCommandEnvelope({
        commandName: "review.submit",
        principal: { id: "gst-002", role: "guest" },
        payload: {
          bookingId: "bk-201",
          guestId: "gst-002",
          rating: 4,
          comment: "Failed access test"
        }
      }),
      failedAccessState,
      () => now
    ),
    /Review eligibility requires verified access state/
  );

  // Case B: Verified Access state -> succeeds
  const verifiedState: BookingStateForReview = {
    ...failedAccessState,
    verifiedAccessStatus: "verified_access"
  };

  const review = manager.submitReview(
    createPlatformCommandEnvelope({
      commandName: "review.submit",
      principal: { id: "gst-002", role: "guest" },
      payload: {
        bookingId: "bk-201",
        guestId: "gst-002",
        rating: 5,
        comment: "Verified stay review"
      }
    }),
    verifiedState,
    () => now
  );

  assert.equal(review.bookingId, "bk-201");
  assert.equal(review.rating, 5);
});

test("Publication, response, moderation, appealable reason, and ranking effects remain auditable.", () => {
  const audit = new InMemoryAuditLog();
  const manager = new VerifiedStayReviewManager({ audit });
  const now = new Date("2026-06-01T12:00:00Z");

  const bookingState: BookingStateForReview = {
    bookingId: "bk-301",
    guestId: "gst-003",
    operatorId: "op-002",
    unitId: "unit-abuja-01",
    isPaid: true,
    isCompleted: true,
    checkoutDate: "2026-05-28T10:00:00Z",
    verifiedAccessStatus: "verified_access"
  };

  const review = manager.submitReview(
    createPlatformCommandEnvelope({
      commandName: "review.submit",
      principal: { id: "gst-003", role: "guest" },
      payload: {
        bookingId: "bk-301",
        guestId: "gst-003",
        rating: 5,
        comment: "Excellent host and space."
      }
    }),
    bookingState,
    () => now
  );

  // Submit operator response
  const responded = manager.submitOperatorResponse(
    createPlatformCommandEnvelope({
      commandName: "review.respond",
      principal: { id: "op-002", role: "operator" },
      payload: {
        reviewId: review.reviewId,
        operatorId: "op-002",
        responseText: "Thank you for staying with us!"
      }
    }),
    () => now
  );

  assert.equal(responded.status, "published");
  assert.equal(responded.operatorResponse?.responseText, "Thank you for staying with us!");

  // Moderate with appealable reason
  const moderated = manager.moderateReview(
    createPlatformCommandEnvelope({
      commandName: "review.moderate",
      principal: { id: "mod-001", role: "admin" },
      payload: {
        reviewId: review.reviewId,
        moderatorId: "mod-001",
        action: "moderate",
        reason: "privacy_violation",
        notes: "Contains private phone number"
      }
    }),
    () => now
  );

  assert.equal(moderated.status, "moderated");
  assert.equal(moderated.moderationDetails?.reason, "privacy_violation");

  // Check audit events
  const entries = audit.entries();
  assert.ok(entries.some(e => e.type === "review.submitted"));
  assert.ok(entries.some(e => e.type === "review.operator_responded"));
  assert.ok(entries.some(e => e.type === "review.moderated"));

  const metrics = manager.getUnitReviewMetrics("unit-abuja-01");
  assert.equal(typeof metrics.averageRating, "number");
});

test("Guests and Operators see the same published content and status without exposure of private evidence.", () => {
  const manager = new VerifiedStayReviewManager();
  const now = new Date("2026-06-01T12:00:00Z");

  const bookingState: BookingStateForReview = {
    bookingId: "bk-401",
    guestId: "gst-004",
    operatorId: "op-003",
    unitId: "unit-lagos-02",
    isPaid: true,
    isCompleted: true,
    checkoutDate: "2026-05-28T10:00:00Z",
    verifiedAccessStatus: "verified_access"
  };

  const review = manager.submitReview(
    createPlatformCommandEnvelope({
      commandName: "review.submit",
      principal: { id: "gst-004", role: "guest" },
      payload: {
        bookingId: "bk-401",
        guestId: "gst-004",
        rating: 4,
        comment: "Very clean apartment."
      }
    }),
    bookingState,
    () => now
  );

  manager.submitOperatorResponse(
    createPlatformCommandEnvelope({
      commandName: "review.respond",
      principal: { id: "op-003", role: "operator" },
      payload: {
        reviewId: review.reviewId,
        operatorId: "op-003",
        responseText: "Thanks for visiting!"
      }
    }),
    () => now
  );

  const publicProjection = manager.getPublicReview(review.reviewId);

  assert.equal(publicProjection.reviewId, review.reviewId);
  assert.equal(publicProjection.rating, 4);
  assert.equal(publicProjection.comment, "Very clean apartment.");
  assert.equal(publicProjection.operatorResponse?.responseText, "Thanks for visiting!");
  assert.equal(publicProjection.status, "published");

  assert.equal("guestId" in publicProjection, false);
  assert.equal("auditEvents" in publicProjection, false);
  assert.equal("moderationDetails" in publicProjection, false);
});
