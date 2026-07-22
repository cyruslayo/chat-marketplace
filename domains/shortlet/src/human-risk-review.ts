import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

/**
 * ADR 0051, 0052, 0053, 0076 & Issue 33: Explicit reason codes for risk review.
 */
export const HumanRiskReasonCodes = Object.freeze({
  AUTO_PROGRESSION: "AUTO_PROGRESSION",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  HUMAN_APPROVED: "HUMAN_APPROVED",
  HUMAN_RISK_REJECTED: "HUMAN_RISK_REJECTED",
  EXPIRED_UNRESOLVED: "EXPIRED_UNRESOLVED",
  GUEST_CANCELLED_DRAFT: "GUEST_CANCELLED_DRAFT"
} as const);

export type HumanRiskReasonCode = typeof HumanRiskReasonCodes[keyof typeof HumanRiskReasonCodes];

export interface RequestDraftData {
  readonly draftId: string;
  readonly primaryGuestId: string;
  readonly unitId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly tenantId?: string;
  readonly riskTriggers?: readonly string[];
  readonly internalRiskScore?: number;
  readonly internalEvidence?: readonly string[];
}

export interface HumanRiskReviewItem {
  readonly reviewId: string;
  readonly draftId: string;
  readonly tenantId?: string;
  readonly primaryGuestId: string;
  readonly unitId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  status: "pending_review" | "approved" | "rejected" | "expired_unresolved" | "cancelled";
  readonly riskTriggers: readonly string[];
  readonly internalRiskScore: number;
  readonly internalEvidence: readonly string[];
  readonly openedAt: string;
  readonly deadlineAt: string;
  reasonCode: HumanRiskReasonCode;
  decision?: {
    readonly reviewerId: string;
    readonly decision: "approve" | "reject";
    readonly reasonCode: HumanRiskReasonCode;
    readonly notes?: string;
    readonly decidedAt: string;
  };
}

export interface HumanRiskReviewManagerOptions {
  readonly riskScoreThreshold?: number;
  readonly audit?: {
    record(entry: Record<string, unknown>): void;
  };
}

/**
 * ADR 0052 & 0053: Bounded deadline calculation.
 * Earlier of:
 * 1) 24 hours after opening
 * 2) Latest Disclosure Cutoff (3 hours before check-in)
 */
export function calculateReviewDeadline(openedAt: Date, checkInIso: string): Date {
  const checkInDate = new Date(checkInIso);
  const latestDisclosureCutoff = new Date(checkInDate.getTime() - 3 * 3600 * 1000);
  const max24hDeadline = new Date(openedAt.getTime() + 24 * 3600 * 1000);

  return latestDisclosureCutoff.getTime() < max24hDeadline.getTime()
    ? latestDisclosureCutoff
    : max24hDeadline;
}

export class HumanRiskReviewManager {
  readonly #riskScoreThreshold: number;
  readonly #audit?: HumanRiskReviewManagerOptions["audit"];
  readonly #reviews = new Map<string, HumanRiskReviewItem>();
  readonly #draftReviews = new Map<string, string>(); // draftId -> reviewId

  constructor(options: HumanRiskReviewManagerOptions = {}) {
    this.#riskScoreThreshold = options.riskScoreThreshold ?? 50;
    this.#audit = options.audit;
  }

  /**
   * Route Request Draft before disclosure.
   * ADR 0051: Operator sees nothing and no inventory is held while under review.
   */
  routeRequestDraft(
    envelope: PlatformCommandEnvelope<RequestDraftData>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): { readonly requiresHumanReview: boolean; readonly reviewItem?: HumanRiskReviewItem; readonly reasonCode: HumanRiskReasonCode } {
    if (!envelope || envelope.commandName !== "risk_review.route_draft") {
      throw new Error("Invalid envelope: commandName must be 'risk_review.route_draft'");
    }

    const payload = envelope.payload;
    if (!payload || !payload.draftId || !payload.primaryGuestId || !payload.unitId || !payload.checkIn) {
      throw new Error("Invalid draft payload: draftId, primaryGuestId, unitId, checkIn are required");
    }

    const now = clock();
    const riskTriggers = payload.riskTriggers ?? [];
    const internalRiskScore = payload.internalRiskScore ?? 0;

    // Policy-defined automatic progression if no risk triggers and risk score below policy threshold
    if (riskTriggers.length === 0 && internalRiskScore < this.#riskScoreThreshold) {
      if (this.#audit) {
        this.#audit.record({
          type: "risk_review.auto_progression",
          draftId: payload.draftId,
          primaryGuestId: payload.primaryGuestId,
          unitId: payload.unitId,
          reasonCode: HumanRiskReasonCodes.AUTO_PROGRESSION,
          evaluatedAt: now.toISOString()
        });
      }
      return {
        requiresHumanReview: false,
        reasonCode: HumanRiskReasonCodes.AUTO_PROGRESSION
      };
    }

    // Flagged for Human Risk Review
    const reviewId = `hrr_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
    const deadlineDate = calculateReviewDeadline(now, payload.checkIn);

    if (now.getTime() >= deadlineDate.getTime()) {
      throw new Error("Cannot route draft for risk review: check-in disclosure deadline has already passed");
    }

    const reviewItem: HumanRiskReviewItem = {
      reviewId,
      draftId: payload.draftId,
      tenantId: envelope.principal.tenantId,
      primaryGuestId: payload.primaryGuestId,
      unitId: payload.unitId,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      status: "pending_review",
      riskTriggers: Object.freeze([...riskTriggers]),
      internalRiskScore,
      internalEvidence: Object.freeze([...(payload.internalEvidence ?? [])]),
      openedAt: now.toISOString(),
      deadlineAt: deadlineDate.toISOString(),
      reasonCode: HumanRiskReasonCodes.HUMAN_REVIEW_REQUIRED
    };

    this.#reviews.set(reviewId, reviewItem);
    this.#draftReviews.set(payload.draftId, reviewId);

    if (this.#audit) {
      this.#audit.record({
        type: "risk_review.opened",
        reviewId,
        draftId: payload.draftId,
        primaryGuestId: payload.primaryGuestId,
        unitId: payload.unitId,
        tenantId: envelope.principal.tenantId,
        reasonCode: HumanRiskReasonCodes.HUMAN_REVIEW_REQUIRED,
        deadlineAt: reviewItem.deadlineAt,
        openedAt: reviewItem.openedAt
      });
    }

    return {
      requiresHumanReview: true,
      reviewItem: { ...reviewItem },
      reasonCode: HumanRiskReasonCodes.HUMAN_REVIEW_REQUIRED
    };
  }

  getReview(reviewId: string): HumanRiskReviewItem {
    const item = this.#reviews.get(reviewId);
    if (!item) throw new Error(`Human risk review not found: ${reviewId}`);
    return item;
  }

  getReviewByDraft(draftId: string): HumanRiskReviewItem {
    const reviewId = this.#draftReviews.get(draftId);
    if (!reviewId) throw new Error(`No risk review found for draft: ${draftId}`);
    return this.getReview(reviewId);
  }

  /**
   * ADR 0076 & AC 4: Submit human review decision.
   * Solely automated adverse final decisions are IMPOSSIBLE!
   */
  submitReviewDecision(
    envelope: PlatformCommandEnvelope<{
      reviewId: string;
      decision: "approve" | "reject";
      notes?: string;
      isHumanReviewer?: boolean;
    }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): HumanRiskReviewItem {
    if (!envelope || envelope.commandName !== "risk_review.submit_decision") {
      throw new Error("Invalid envelope: commandName must be 'risk_review.submit_decision'");
    }

    const { reviewId, decision, notes, isHumanReviewer } = envelope.payload ?? {};
    if (!reviewId || !decision) {
      throw new Error("reviewId and decision are required");
    }

    // ADR 0076 & AC 4: Solely automated adverse final decisions are impossible!
    const principalRecord = envelope.principal as unknown as Record<string, unknown>;
    const isHuman =
      isHumanReviewer ??
      ((typeof principalRecord.isHumanReviewer === "boolean" ? principalRecord.isHumanReviewer : false) ||
        principalRecord.role === "human_reviewer");
    if (!isHuman) {
      throw new Error("Solely automated adverse final decisions are impossible; decision requires an authorized human reviewer");
    }

    const review = this.getReview(reviewId);

    // Tenant boundary check
    if (review.tenantId && envelope.principal.tenantId && review.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant risk review decision denied");
    }

    const now = clock();

    // Check expiry
    if (now.getTime() >= new Date(review.deadlineAt).getTime()) {
      this.evaluateExpiry(reviewId, { clock });
      throw new Error("Cannot submit review decision: review deadline has expired");
    }

    if (review.status !== "pending_review") {
      throw new Error(`Review in status '${review.status}' cannot accept a new decision`);
    }

    const reasonCode = decision === "approve" ? HumanRiskReasonCodes.HUMAN_APPROVED : HumanRiskReasonCodes.HUMAN_RISK_REJECTED;

    review.status = decision === "approve" ? "approved" : "rejected";
    review.reasonCode = reasonCode;
    review.decision = Object.freeze({
      reviewerId: envelope.principal.id,
      decision,
      reasonCode,
      notes,
      decidedAt: now.toISOString()
    });

    if (this.#audit) {
      this.#audit.record({
        type: `risk_review.${decision}d`,
        reviewId,
        draftId: review.draftId,
        reviewerId: envelope.principal.id,
        tenantId: review.tenantId,
        reasonCode,
        decidedAt: review.decision.decidedAt
      });
    }

    return { ...review };
  }

  /**
   * ADR 0052 & AC 1: Expire risk review at deadline.
   */
  evaluateExpiry(
    reviewId: string,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): HumanRiskReviewItem {
    const review = this.getReview(reviewId);
    const now = clock();

    if (review.status === "pending_review" && now.getTime() >= new Date(review.deadlineAt).getTime()) {
      review.status = "expired_unresolved";
      review.reasonCode = HumanRiskReasonCodes.EXPIRED_UNRESOLVED;

      if (this.#audit) {
        this.#audit.record({
          type: "risk_review.expired",
          reviewId,
          draftId: review.draftId,
          reasonCode: HumanRiskReasonCodes.EXPIRED_UNRESOLVED,
          expiredAt: now.toISOString()
        });
      }
    }

    return { ...review };
  }

  /**
   * AC 1: Guest cancellation during review.
   */
  cancelReview(
    envelope: PlatformCommandEnvelope<{ reviewId: string }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): HumanRiskReviewItem {
    if (!envelope || envelope.commandName !== "risk_review.cancel_review") {
      throw new Error("Invalid envelope: commandName must be 'risk_review.cancel_review'");
    }

    const { reviewId } = envelope.payload ?? {};
    if (!reviewId) throw new Error("reviewId is required to cancel review");

    const review = this.getReview(reviewId);

    // Check tenant boundary
    if (review.tenantId && envelope.principal.tenantId && review.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant risk review access denied");
    }

    if (envelope.principal.id !== review.primaryGuestId) {
      throw new Error("Only the primary guest can cancel a draft under review");
    }

    const now = clock();
    if (review.status === "pending_review") {
      review.status = "cancelled";
      review.reasonCode = HumanRiskReasonCodes.GUEST_CANCELLED_DRAFT;

      if (this.#audit) {
        this.#audit.record({
          type: "risk_review.cancelled",
          reviewId,
          draftId: review.draftId,
          primaryGuestId: review.primaryGuestId,
          reasonCode: HumanRiskReasonCodes.GUEST_CANCELLED_DRAFT,
          cancelledAt: now.toISOString()
        });
      }
    }

    return { ...review };
  }

  /**
   * AC 3 & ADR 0075: Guest Interaction Projection.
   * Internal risk scores and restricted evidence are REDACTED / OMITTED.
   */
  projectGuestInteractionState(
    reviewId: string,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): {
    readonly reviewId: string;
    readonly draftId: string;
    readonly status: string;
    readonly publicStatusMessage: string;
    readonly deadlineAt: string;
    readonly reasonCode: string;
  } {
    const review = this.evaluateExpiry(reviewId, { clock });
    let publicStatusMessage = "Draft is undergoing standard security review.";
    if (review.status === "approved") {
      publicStatusMessage = "Security review complete. Ready for request disclosure.";
    } else if (review.status === "rejected") {
      publicStatusMessage = "Request draft could not be approved for disclosure.";
    } else if (review.status === "expired_unresolved") {
      publicStatusMessage = "Security review expired unresolved before check-in deadline. No charges or holds were made.";
    } else if (review.status === "cancelled") {
      publicStatusMessage = "Draft review cancelled by guest.";
    }

    return Object.freeze({
      reviewId: review.reviewId,
      draftId: review.draftId,
      status: review.status,
      publicStatusMessage,
      deadlineAt: review.deadlineAt,
      reasonCode: review.reasonCode
    });
  }

  /**
   * AC 3 & ADR 0051: Operator Interaction Projection.
   * Returns NULL (Operator sees NOTHING while under review).
   */
  projectOperatorInteractionState(reviewId: string): null {
    const review = this.getReview(reviewId);
    // Even if approved/rejected, operator projection prior to disclosure remains null/empty
    if (review.status === "pending_review") {
      return null;
    }
    return null;
  }

  /**
   * AC 3 & AC 4: Authorized staff view (tenant-scoped).
   * Retains internal risk score and evidence for authorized staff.
   */
  projectStaffView(
    envelope: PlatformCommandEnvelope<{ reviewId: string }>,
    reviewId: string
  ): HumanRiskReviewItem {
    const review = this.getReview(reviewId);
    if (review.tenantId && envelope.principal.tenantId && review.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant staff view access denied");
    }
    return { ...review };
  }
}
