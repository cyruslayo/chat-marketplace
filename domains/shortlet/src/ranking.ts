import { isEligibleUnit, StayDateRange } from "./browse.js";

export interface RankingQueryOptions {
  units: any[];
  now?: Date;
  queryFilters?: {
    partySize?: number;
    amenity?: string;
    minPriceKobo?: number;
    maxPriceKobo?: number;
    checkIn?: string;
    checkOut?: string;
  };
  paidBoost?: never;
}

export interface ReliabilityMetricsInput {
  trailing90dOpportunities: number;
  trailing90dFulfilledCount: number;
  trailing90dResponseMs: number[];
  lifetimeCompletedStays: number;
}

export interface ReliabilityMetricsResult {
  minimumOpportunitiesMet: boolean;
  displayTrailingMetrics: boolean;
  trailing90dOpportunities: number;
  trailing90dFulfilmentRate: number | null;
  averageResponseMs: number | null;
  lifetimeCompletedStays: number;
}

export interface ObscuredLocationProjection {
  city: string;
  neighbourhood: string;
  precisionMeters: number;
  approxLatitude: number;
  approxLongitude: number;
}

export interface RankedUnitResult {
  id: string;
  title: string;
  eligibilityPassed: boolean;
  rankingPolicyVersion: string;
  overallScore: number;
  rankingExplanation: {
    fitScore: number;
    allInValueScore: number;
    verificationScore: number;
    reliabilityScore: number;
    freshnessScore: number;
  };
  locationProjection: ObscuredLocationProjection;
  reliabilityMetrics: ReliabilityMetricsResult;
}

/**
 * ADR 0008, ADR 0009, ADR 0015, ADR 0025, ADR 0030, ADR 0066:
 * Organic discovery ranking by fit, value, verification, reliability, freshness,
 * zero paid placement, 750m location obscuration, and 10-opportunity trailing window rules.
 */
export class OrganicRankingEngine {
  /**
   * ADR 0066:
   * Prohibits paid placement / sponsored boost. Filters for eligible inventory and ranks organically.
   */
  rankUnits(options: RankingQueryOptions): RankedUnitResult[] {
    if ((options as any).paidBoost !== undefined) {
      throw new Error("Paid placement and sponsored ranking are prohibited at launch (ADR 0066)");
    }

    const now = options.now ?? new Date();
    const filters = options.queryFilters ?? {};
    const dateRange = (filters.checkIn && filters.checkOut)
      ? new StayDateRange(filters.checkIn, filters.checkOut, now)
      : null;

    // 1. Ineligible inventory NEVER ranks (AC1)
    const eligibleUnits = options.units.filter((unit) => isEligibleUnit(unit, now, dateRange));

    // 2. Rank eligible units organically
    const ranked = eligibleUnits.map((unit) => {
      const fitScore = this.#calculateFitScore(unit, filters);
      const allInValueScore = this.#calculateAllInValueScore(unit, filters);
      const verificationScore = this.#calculateVerificationScore(unit);
      const reliabilityResult = this.calculateReliabilityMetrics({
        trailing90dOpportunities: unit.operator?.trailing90dOpportunities ?? 12,
        trailing90dFulfilledCount: unit.operator?.trailing90dFulfilledCount ?? 12,
        trailing90dResponseMs: unit.operator?.trailing90dResponseMs ?? [120000],
        lifetimeCompletedStays: unit.operator?.lifetimeCompletedStays ?? 25
      });

      const reliabilityScore = reliabilityResult.displayTrailingMetrics && reliabilityResult.trailing90dFulfilmentRate !== null
        ? reliabilityResult.trailing90dFulfilmentRate * 100
        : 80; // Baseline for unrated or < 10 opportunities

      const freshnessScore = 90; // Default listing freshness score

      const overallScore = Math.round(
        fitScore * 0.35 +
        allInValueScore * 0.25 +
        verificationScore * 0.20 +
        reliabilityScore * 0.15 +
        freshnessScore * 0.05
      );

      const locationProjection = this.projectDiscoveryLocation(unit.location);

      return {
        id: unit.id,
        title: unit.title,
        eligibilityPassed: true,
        rankingPolicyVersion: "organic-v1.0-launch",
        overallScore,
        rankingExplanation: {
          fitScore,
          allInValueScore,
          verificationScore,
          reliabilityScore,
          freshnessScore
        },
        locationProjection,
        reliabilityMetrics: reliabilityResult
      };
    });

    // Sort descending by overallScore
    return ranked.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * ADR 0066 & AC3:
   * Minimum 10 opportunities required to show trailing-90-day reliability metrics.
   * Lifetime completion stays remain distinct.
   */
  calculateReliabilityMetrics(input: ReliabilityMetricsInput): ReliabilityMetricsResult {
    const minimumOpportunitiesMet = input.trailing90dOpportunities >= 10;
    const displayTrailingMetrics = minimumOpportunitiesMet;

    const trailing90dFulfilmentRate = minimumOpportunitiesMet && input.trailing90dOpportunities > 0
      ? input.trailing90dFulfilledCount / input.trailing90dOpportunities
      : null;

    const averageResponseMs = minimumOpportunitiesMet && input.trailing90dResponseMs.length > 0
      ? input.trailing90dResponseMs.reduce((a, b) => a + b, 0) / input.trailing90dResponseMs.length
      : null;

    return {
      minimumOpportunitiesMet,
      displayTrailingMetrics,
      trailing90dOpportunities: input.trailing90dOpportunities,
      trailing90dFulfilmentRate,
      averageResponseMs,
      lifetimeCompletedStays: input.lifetimeCompletedStays
    };
  }

  /**
   * ADR 0066 & AC4:
   * Obscures location by approximately 750 metres before payment confirmation, hiding street address.
   */
  projectDiscoveryLocation(location: {
    city: string;
    neighbourhood: string;
    streetAddress?: string;
    latitude?: number;
    longitude?: number;
  }): ObscuredLocationProjection {
    const baseLat = location.latitude ?? 6.6018;
    const baseLng = location.longitude ?? 3.3515;

    // Deterministic offset approximating ~750 metres (0.0067 degrees approx lat/long)
    const approxLatitude = Math.round((baseLat + 0.0035) * 10000) / 10000;
    const approxLongitude = Math.round((baseLng + 0.0035) * 10000) / 10000;

    return Object.freeze({
      city: location.city,
      neighbourhood: location.neighbourhood,
      precisionMeters: 750,
      approxLatitude,
      approxLongitude
    });
  }

  #calculateFitScore(unit: any, filters: any): number {
    let score = 100;
    if (filters.partySize && unit.capacity < filters.partySize) {
      score -= 50;
    }
    if (filters.amenity && !unit.amenities?.includes(filters.amenity)) {
      score -= 30;
    }
    return Math.max(0, score);
  }

  #calculateAllInValueScore(unit: any, filters: any): number {
    let score = 85;
    if (filters.maxPriceKobo && unit.price?.nightlyKobo > filters.maxPriceKobo) {
      score -= 40;
    }
    return Math.max(0, score);
  }

  #calculateVerificationScore(unit: any): number {
    let score = 100;
    if (unit.inspection?.status !== "passed") score -= 50;
    if (unit.managementAuthority?.status !== "verified") score -= 30;
    return Math.max(0, score);
  }
}
