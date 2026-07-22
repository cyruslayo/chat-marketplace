import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

export interface BookingStateForReview {
  readonly bookingId: string;
  readonly guestId: string;
  readonly operatorId: string;
  readonly unitId: string;
  readonly isPaid: boolean;
  readonly isCompleted: boolean;
  readonly checkoutDate: string;
  readonly verifiedAccessStatus: "verified_access" | "late_voluntary_arrival" | "failed_access" | "pending_evidence";
}

export interface ReviewSubmissionInput {
  readonly bookingId: string;
  readonly guestId: string;
  readonly rating: number;
  readonly comment: string;
  readonly isImported?: boolean;
  readonly isIncentivized?: boolean;
}

export interface ModerationActionInput {
  readonly reviewId: string;
  readonly moderatorId: string;
  readonly action: "approve" | "moderate";
  readonly reason?: "privacy_violation" | "threats" | "extortion" | "irrelevance" | "fabrication";
  readonly notes?: string;
}

export interface VerifiedStayReviewRecord {
  readonly reviewId: string;
  readonly bookingId: string;
  readonly unitId: string;
  readonly guestId: string;
  readonly operatorId: string;
  readonly rating: number;
  readonly comment: string;
  readonly isImported: boolean;
  readonly isIncentivized: boolean;
  status: "pending_operator_response" | "published" | "moderated";
  readonly submittedAt: string;
  publishedAt?: string;
  operatorResponse?: {
    readonly responseText: string;
    readonly respondedAt: string;
  };
  moderationDetails?: {
    readonly moderatorId: string;
    readonly reason: "privacy_violation" | "threats" | "extortion" | "irrelevance" | "fabrication";
    readonly notes?: string;
    readonly moderatedAt: string;
  };
  readonly auditEvents: any[];
}

/**
 * ADR 0022, ADR 0066, ADR 0075 & Issue 32:
 * Manage Verified-Stay Reviews, operator response, policy moderation,
 * and audit tracing without exposing private evidence.
 */
export class VerifiedStayReviewManager {
  readonly #reviews = new Map<string, VerifiedStayReviewRecord>();
  readonly #bookingReviews = new Map<string, string>();
  readonly #audit?: { record(entry: Record<string, unknown>): void };

  constructor(options?: { audit?: { record(entry: Record<string, unknown>): void } }) {
    this.#audit = options?.audit;
  }

  /**
   * ADR 0022, ADR 0075 & AC 1, AC 2:
   * Primary Guest submits review within 14 days of paid completed stay with Verified Access.
   * Imported, incentivized, duplicate, ineligible, and out-of-window reviews are rejected.
   */
  submitReview(
    envelope: PlatformCommandEnvelope<ReviewSubmissionInput>,
    bookingState: BookingStateForReview,
    clock: () => Date = () => new Date()
  ): VerifiedStayReviewRecord {
    if (!envelope || envelope.commandName !== "review.submit") {
      throw new Error("Invalid envelope: commandName must be 'review.submit'");
    }

    const { bookingId, guestId, rating, comment, isImported, isIncentivized } = envelope.payload;
    const now = clock();

    if (isImported) {
      throw new Error("Imported reviews are rejected; only verified platform stays qualify");
    }

    if (isIncentivized) {
      throw new Error("Incentivized reviews are prohibited under platform policy");
    }

    if (this.#bookingReviews.has(bookingId)) {
      throw new Error(`Duplicate review rejected for booking '${bookingId}'`);
    }

    if (!bookingState.isPaid || !bookingState.isCompleted) {
      throw new Error("Review eligibility requires a paid and completed stay");
    }

    if (
      bookingState.verifiedAccessStatus !== "verified_access" &&
      bookingState.verifiedAccessStatus !== "late_voluntary_arrival"
    ) {
      throw new Error("Review eligibility requires verified access state");
    }

    if (bookingState.guestId !== guestId) {
      throw new Error("Only the verified Primary Guest may submit a review");
    }

    const checkoutTime = new Date(bookingState.checkoutDate).getTime();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    if (now.getTime() - checkoutTime > fourteenDaysMs) {
      throw new Error("Out-of-window review rejected; reviews must be submitted within 14 days of stay completion");
    }

    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      throw new Error("Rating must be an integer between 1 and 5");
    }

    const reviewId = `rev_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
    const record: VerifiedStayReviewRecord = {
      reviewId,
      bookingId,
      unitId: bookingState.unitId,
      guestId,
      operatorId: bookingState.operatorId,
      rating,
      comment,
      isImported: false,
      isIncentivized: false,
      status: "pending_operator_response",
      submittedAt: now.toISOString(),
      auditEvents: []
    };

    const auditEntry = {
      type: "review.submitted",
      reviewId,
      bookingId,
      unitId: bookingState.unitId,
      guestId,
      rating,
      submittedAt: now.toISOString()
    };
    record.auditEvents.push(auditEntry);
    if (this.#audit) this.#audit.record(auditEntry);

    this.#reviews.set(reviewId, record);
    this.#bookingReviews.set(bookingId, reviewId);

    return { ...record };
  }

  /**
   * AC 3: Operator response (1 response permitted).
   */
  submitOperatorResponse(
    envelope: PlatformCommandEnvelope<{ reviewId: string; operatorId: string; responseText: string }>,
    clock: () => Date = () => new Date()
  ): VerifiedStayReviewRecord {
    if (!envelope || envelope.commandName !== "review.respond") {
      throw new Error("Invalid envelope: commandName must be 'review.respond'");
    }

    const { reviewId, operatorId, responseText } = envelope.payload;
    const review = this.#reviews.get(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found`);

    if (review.operatorId !== operatorId) {
      throw new Error("Only the unit operator may submit a response");
    }

    if (review.operatorResponse) {
      throw new Error("Operator response already submitted; only one response is permitted");
    }

    const now = clock();
    review.operatorResponse = {
      responseText,
      respondedAt: now.toISOString()
    };
    review.status = "published";
    review.publishedAt = now.toISOString();

    const auditEntry = {
      type: "review.operator_responded",
      reviewId,
      operatorId,
      publishedAt: now.toISOString()
    };
    review.auditEvents.push(auditEntry);
    if (this.#audit) this.#audit.record(auditEntry);

    return { ...review };
  }

  /**
   * AC 1 & AC 3: Publish review automatically after operator response window expiry.
   */
  publishAfterExpiry(reviewId: string, clock: () => Date = () => new Date()): VerifiedStayReviewRecord {
    const review = this.#reviews.get(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found`);

    if (review.status === "pending_operator_response") {
      const now = clock();
      review.status = "published";
      review.publishedAt = now.toISOString();

      const auditEntry = {
        type: "review.published_after_expiry",
        reviewId,
        publishedAt: now.toISOString()
      };
      review.auditEvents.push(auditEntry);
      if (this.#audit) this.#audit.record(auditEntry);
    }

    return { ...review };
  }

  /**
   * AC 3: Moderate review for policy breach without suppressing negative opinion.
   */
  moderateReview(
    envelope: PlatformCommandEnvelope<ModerationActionInput>,
    clock: () => Date = () => new Date()
  ): VerifiedStayReviewRecord {
    if (!envelope || envelope.commandName !== "review.moderate") {
      throw new Error("Invalid envelope: commandName must be 'review.moderate'");
    }

    const { reviewId, moderatorId, action, reason, notes } = envelope.payload;
    const review = this.#reviews.get(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found`);

    const now = clock();

    if (action === "moderate") {
      if (!reason) {
        throw new Error("Moderation requires an appealable reason (privacy_violation, threats, extortion, irrelevance, fabrication)");
      }

      review.status = "moderated";
      review.moderationDetails = {
        moderatorId,
        reason,
        notes,
        moderatedAt: now.toISOString()
      };

      const auditEntry = {
        type: "review.moderated",
        reviewId,
        moderatorId,
        reason,
        moderatedAt: now.toISOString()
      };
      review.auditEvents.push(auditEntry);
      if (this.#audit) this.#audit.record(auditEntry);
    } else {
      review.status = "published";
      review.publishedAt = now.toISOString();

      const auditEntry = {
        type: "review.moderation_approved",
        reviewId,
        moderatorId,
        approvedAt: now.toISOString()
      };
      review.auditEvents.push(auditEntry);
      if (this.#audit) this.#audit.record(auditEntry);
    }

    return { ...review };
  }

  /**
   * AC 4: Public review projection visible to Guests and Operators without exposure of private evidence.
   */
  getPublicReview(reviewId: string): {
    readonly reviewId: string;
    readonly unitId: string;
    readonly rating: number;
    readonly comment: string;
    readonly status: string;
    readonly publishedAt?: string;
    readonly operatorResponse?: { readonly responseText: string; readonly respondedAt: string };
  } {
    const review = this.#reviews.get(reviewId);
    if (!review) throw new Error(`Review '${reviewId}' not found`);

    if (review.status !== "published") {
      throw new Error(`Review '${reviewId}' is not published`);
    }

    return Object.freeze({
      reviewId: review.reviewId,
      unitId: review.unitId,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      publishedAt: review.publishedAt,
      operatorResponse: review.operatorResponse ? { ...review.operatorResponse } : undefined
    });
  }

  /**
   * AC 3: Compute average review score for a unit to feed into ranking effects.
   */
  getUnitReviewMetrics(unitId: string): { averageRating: number; totalPublishedReviews: number } {
    const published = Array.from(this.#reviews.values()).filter(
      (r) => r.unitId === unitId && r.status === "published"
    );

    if (published.length === 0) {
      return { averageRating: 0, totalPublishedReviews: 0 };
    }

    const total = published.reduce((sum, r) => sum + r.rating, 0);
    return {
      averageRating: Math.round((total / published.length) * 10) / 10,
      totalPublishedReviews: published.length
    };
  }
}
