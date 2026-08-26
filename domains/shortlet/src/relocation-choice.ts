import { PlatformCommandEnvelope, InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";

export interface OriginalBooking {
  reservationId: string;
  tenantId: string;
  primaryGuestId: string;
  operatorId: string;
  unitId: string;
  city: string;
  neighborhood: string;
  entirePlace: boolean;
  guestCount: number;
  bedrooms: number;
  beds: number;
  qualityRating: number;
  datesIso: string[];
  essentialAmenities: string[];
  originalPriceKobo: number;
  securityDepositKobo: number;
  feesKobo: number;
  taxesKobo: number;
}

export interface ReplacementCandidate {
  candidateUnitId: string;
  operatorId: string;
  city: string;
  neighborhood: string;
  locationDistanceMeters: number;
  entirePlace: boolean;
  capacity: number;
  bedrooms: number;
  beds: number;
  safetyPassed: boolean;
  qualityRating: number;
  datesIso: string[];
  essentialAmenities: string[];
  operatorTrustScore: number;
  totalPriceKobo: number;
  transportCostKobo: number;
  materialDisclosures: string[];
}

export interface RelocationApproval {
  userId: string;
  role: string;
}

export interface ComparabilityResult {
  comparable: boolean;
  reasons: string[];
}

export interface ApprovalValidationResult {
  valid: boolean;
  tier: "routine" | "senior" | "executive";
  error?: string;
}

export interface RelocationCommitRecord {
  commitId: string;
  reservationId: string;
  tenantId: string;
  primaryGuestId: string;
  choice: "relocation" | "refund" | "refund_fallback";
  fundingSource: "guest_protection_fund" | "original_payment_source";
  replacementUnitId?: string;
  priceDiffKobo: number;
  transportCostKobo: number;
  refundTotalKobo: number;
  operatorLiabilityKobo: number;
  originalBookingStatus: "relocated" | "refunded";
  committedAtIso: string;
}

/**
 * ADR 0027, ADR 0028, ADR 0029, ADR 0063, ADR 0072:
 * Manages relocation comparability, bounded human spending limits, guest choice,
 * explicit consent, atomic commitment, and Refund Fallback guarantee.
 */
/**
 * Historical pure-policy compatibility surface. Production authority lives in
 * apps/web/relocation-application.ts and its injected trusted providers; this
 * legacy command method is retained only for pre-Issue-23 callers/tests.
 */
export class RelocationManager {
  readonly #commits = new Map<string, RelocationCommitRecord>();

  /**
   * ADR 0028 & ADR 0029:
   * Evaluates comparability of replacement candidate against original booking.
   */
  evaluateReplacementComparability(original: OriginalBooking, candidate: ReplacementCandidate): ComparabilityResult {
    const reasons: string[] = [];

    // 1. Entire Place status
    if (!candidate.entirePlace) {
      reasons.push("Replacement must be an Entire Place");
    }

    // 2. Capacity, bedrooms, beds
    if (candidate.capacity < original.guestCount) {
      reasons.push(`Insufficient capacity: replacement has ${candidate.capacity}, expected at least ${original.guestCount}`);
    }
    if (candidate.bedrooms < original.bedrooms) {
      reasons.push(`Insufficient bedrooms: replacement has ${candidate.bedrooms}, expected at least ${original.bedrooms}`);
    }
    if (candidate.beds < original.beds) {
      reasons.push(`Insufficient beds: replacement has ${candidate.beds}, expected at least ${original.beds}`);
    }

    // 3. Location & City
    if (candidate.city.toLowerCase() !== original.city.toLowerCase()) {
      reasons.push(`City mismatch: replacement is in ${candidate.city}, original in ${original.city}`);
    }
    if (candidate.locationDistanceMeters > 5000) {
      reasons.push(`Location too far: replacement is ${candidate.locationDistanceMeters}m away from original neighborhood`);
    }

    // 4. Safety & Quality
    if (!candidate.safetyPassed) {
      reasons.push("Replacement unit has not passed physical safety inspection");
    }
    if (candidate.qualityRating < original.qualityRating - 0.5) {
      reasons.push(`Material quality deterioration: candidate rating ${candidate.qualityRating} vs original ${original.qualityRating}`);
    }

    // 5. Dates matching
    const originalDatesStr = [...original.datesIso].sort().join(",");
    const candidateDatesStr = [...candidate.datesIso].sort().join(",");
    if (originalDatesStr !== candidateDatesStr) {
      reasons.push("Stay dates do not match original reservation dates");
    }

    // 6. Essential Disclosed Amenities
    for (const amenity of original.essentialAmenities) {
      if (!candidate.essentialAmenities.includes(amenity)) {
        reasons.push(`Missing essential disclosed amenity: ${amenity}`);
      }
    }

    // 7. Operator trust status
    if (candidate.operatorTrustScore < 0.5) {
      reasons.push("Replacement operator fails trust threshold");
    }

    return {
      comparable: reasons.length === 0,
      reasons
    };
  }

  /**
   * ADR 0063:
   * Enforces routine, senior, and executive relocation limits and required human roles.
   */
  validateRelocationApprovals({
    originalPriceKobo,
    priceDiffKobo,
    transportCostKobo,
    approvals
  }: {
    originalPriceKobo: number;
    priceDiffKobo: number;
    transportCostKobo: number;
    approvals: RelocationApproval[];
  }): ApprovalValidationResult {
    const priceDiffRatio = originalPriceKobo > 0 ? priceDiffKobo / originalPriceKobo : 0;
    const totalExposureKobo = priceDiffKobo + transportCostKobo;

    // Thresholds (ADR 0063)
    // Routine: priceDiff <= 25%, totalExposure <= ₦150k (15m kobo), transport <= ₦50k (5m kobo)
    // Senior: priceDiff <= 50%, totalExposure <= ₦500k (50m kobo), transport <= ₦100k (10m kobo)
    // Executive: higher

    let requiredTier: "routine" | "senior" | "executive" = "routine";

    if (priceDiffRatio > 0.5 || totalExposureKobo > 50000000 || transportCostKobo > 10000000) {
      requiredTier = "executive";
    } else if (priceDiffRatio > 0.25 || totalExposureKobo > 15000000 || transportCostKobo > 5000000) {
      requiredTier = "senior";
    }

    if (requiredTier === "routine") {
      const hasRoutineRole = approvals.some((a) =>
        ["support_agent", "routine_operations", "admin", "operator_support", "senior_operations", "finance", "executive_1", "executive_2"].includes(a.role)
      );
      if (!hasRoutineRole) {
        return {
          valid: false,
          tier: "routine",
          error: "Routine relocation requires approval from authorized support or operations role"
        };
      }
      return { valid: true, tier: "routine" };
    }

    if (requiredTier === "senior") {
      const hasSeniorOps = approvals.some((a) => ["senior_operations", "admin", "executive_1", "executive_2"].includes(a.role));
      const hasFinance = approvals.some((a) => ["finance", "admin", "executive_1", "executive_2"].includes(a.role));

      if (!hasSeniorOps || !hasFinance) {
        return {
          valid: false,
          tier: "senior",
          error: "Senior relocation requires both senior operations and finance approvals"
        };
      }
      return { valid: true, tier: "senior" };
    }

    // Executive tier
    const execApprovals = approvals.filter((a) => a.role.includes("executive") || a.role === "admin");
    if (execApprovals.length < 2) {
      return {
        valid: false,
        tier: "executive",
        error: "Executive relocation requires 2 executive approvals"
      };
    }

    return { valid: true, tier: "executive" };
  }

  /**
   * ADR 0027, ADR 0028, ADR 0029, ADR 0072:
   * Commits guest choice (relocation vs full refund) or guarantees Refund Fallback atomically.
   */
  commitRelocationOrRefund({
    envelope,
    originalBooking,
    auditLog
  }: {
    envelope: PlatformCommandEnvelope<any>;
    originalBooking: OriginalBooking;
    auditLog?: InMemoryAuditLog;
  }): RelocationCommitRecord {
    if (envelope.commandName !== "relocation.submit_choice") {
      throw new Error(`Invalid command for relocation choice: ${envelope.commandName}`);
    }

    const { choice, candidate, approvals, explicitConsent } = envelope.payload;

    if (envelope.principal.id !== originalBooking.primaryGuestId && envelope.principal.role !== "admin") {
      throw new Error("Only the Primary Guest or admin may choose relocation or refund");
    }

    const commitId = `rel_commit_${originalBooking.reservationId}_${Date.now()}`;
    const totalCollectedKobo =
      originalBooking.originalPriceKobo +
      originalBooking.securityDepositKobo +
      originalBooking.feesKobo +
      originalBooking.taxesKobo;

    // Case 1: Guest chooses explicit Refund
    if (choice === "refund") {
      const record: RelocationCommitRecord = {
        commitId,
        reservationId: originalBooking.reservationId,
        tenantId: originalBooking.tenantId,
        primaryGuestId: originalBooking.primaryGuestId,
        choice: "refund",
        fundingSource: "original_payment_source",
        priceDiffKobo: 0,
        transportCostKobo: 0,
        refundTotalKobo: totalCollectedKobo,
        operatorLiabilityKobo: totalCollectedKobo,
        originalBookingStatus: "refunded",
        committedAtIso: new Date().toISOString()
      };

      this.#commits.set(originalBooking.reservationId, record);
      auditLog?.record({
        action: "relocation_choice_committed",
        reservationId: originalBooking.reservationId,
        choice: "refund",
        fundingSource: "original_payment_source",
        refundTotalKobo: totalCollectedKobo
      });
      return { ...record };
    }

    // Case 2: Guest chooses Relocation
    if (!explicitConsent) {
      throw new Error("Explicit guest consent is required for relocation substitution");
    }

    if (!candidate) {
      throw new Error("Relocation candidate details missing");
    }

    // Evaluate comparability
    const compEval = this.evaluateReplacementComparability(originalBooking, candidate);
    const priceDiffKobo = Math.max(0, candidate.totalPriceKobo - originalBooking.originalPriceKobo);
    const transportCostKobo = candidate.transportCostKobo || 0;

    // Evaluate approvals
    const approvalEval = this.validateRelocationApprovals({
      originalPriceKobo: originalBooking.originalPriceKobo,
      priceDiffKobo,
      transportCostKobo,
      approvals: approvals || []
    });

    // ADR 0029: If candidate is not comparable or approvals fail, guarantee Refund Fallback!
    if (!compEval.comparable || !approvalEval.valid) {
      const fallbackRecord: RelocationCommitRecord = {
        commitId,
        reservationId: originalBooking.reservationId,
        tenantId: originalBooking.tenantId,
        primaryGuestId: originalBooking.primaryGuestId,
        choice: "refund_fallback",
        fundingSource: "original_payment_source",
        priceDiffKobo: 0,
        transportCostKobo: 0,
        refundTotalKobo: totalCollectedKobo,
        operatorLiabilityKobo: totalCollectedKobo,
        originalBookingStatus: "refunded",
        committedAtIso: new Date().toISOString()
      };

      this.#commits.set(originalBooking.reservationId, fallbackRecord);
      auditLog?.record({
        action: "refund_fallback_guaranteed",
        reservationId: originalBooking.reservationId,
        reasons: compEval.reasons.concat(approvalEval.error ? [approvalEval.error] : []),
        fundingSource: "original_payment_source",
        refundTotalKobo: totalCollectedKobo
      });
      return { ...fallbackRecord };
    }

    // Success path: Relocation approved and committed
    const operatorLiabilityKobo = priceDiffKobo + transportCostKobo;
    const relocationRecord: RelocationCommitRecord = {
      commitId,
      reservationId: originalBooking.reservationId,
      tenantId: originalBooking.tenantId,
      primaryGuestId: originalBooking.primaryGuestId,
      choice: "relocation",
      fundingSource: "guest_protection_fund",
      replacementUnitId: candidate.candidateUnitId,
      priceDiffKobo,
      transportCostKobo,
      refundTotalKobo: 0,
      operatorLiabilityKobo,
      originalBookingStatus: "relocated",
      committedAtIso: new Date().toISOString()
    };

    this.#commits.set(originalBooking.reservationId, relocationRecord);
    auditLog?.record({
      action: "relocation_committed",
      reservationId: originalBooking.reservationId,
      choice: "relocation",
      replacementUnitId: candidate.candidateUnitId,
      fundingSource: "guest_protection_fund",
      operatorLiabilityKobo
    });
    return { ...relocationRecord };
  }
}
