import test from "node:test";
import assert from "node:assert/strict";
import { UnitDiscoveryQuery, seedIssue01Units, UnitRepository } from "../domains/shortlet/src/browse.js";
import { OrganicRankingEngine } from "../domains/shortlet/src/ranking.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";

test("Ineligible inventory never ranks and no launch input represents paid placement.", () => {
  const repo = new UnitRepository();
  seedIssue01Units(repo);

  const engine = new OrganicRankingEngine();
  const units = repo.findAll();

  // Unit with expired inspection should be excluded from ranking (ineligible)
  const ranked = engine.rankUnits({
    units,
    now: new Date("2026-02-01"),
    queryFilters: { partySize: 2 }
  });

  assert.equal(ranked.some(u => u.id === "unit-abuja-expired"), false);
  assert.equal(ranked.every(u => u.eligibilityPassed), true);

  // Attempting paid placement / sponsored boost must throw or be rejected (ADR 0066)
  assert.throws(
    () => engine.rankUnits({
      units,
      now: new Date("2026-02-01"),
      queryFilters: { partySize: 2 },
      paidBoost: 1.5 as any
    }),
    /Paid placement and sponsored ranking are prohibited at launch/
  );
});

test("Ranking inputs are versioned, explainable, current, and derived from authoritative projections.", () => {
  const repo = new UnitRepository();
  seedIssue01Units(repo);

  const engine = new OrganicRankingEngine();
  const units = repo.findAll();

  const ranked = engine.rankUnits({
    units,
    now: new Date("2026-02-01"),
    queryFilters: { partySize: 2, amenity: "generator" }
  });

  assert.ok(ranked.length > 0);
  const topResult = ranked[0];

  assert.equal(topResult.rankingPolicyVersion, "organic-v1.0-launch");
  assert.ok(topResult.rankingExplanation);
  assert.equal(typeof topResult.rankingExplanation.fitScore, "number");
  assert.equal(typeof topResult.rankingExplanation.allInValueScore, "number");
  assert.equal(typeof topResult.rankingExplanation.verificationScore, "number");
  assert.equal(typeof topResult.rankingExplanation.reliabilityScore, "number");
  assert.equal(typeof topResult.rankingExplanation.freshnessScore, "number");
});

test("Reliability metrics use the accepted trailing window and minimum opportunities while lifetime completion remains distinct.", () => {
  const engine = new OrganicRankingEngine();

  // Case A: Operator has < 10 opportunities in 90-day window -> trailing metrics unrated / default baseline
  const lowOpportunityMetrics = engine.calculateReliabilityMetrics({
    trailing90dOpportunities: 5,
    trailing90dFulfilledCount: 5,
    trailing90dResponseMs: [300000],
    lifetimeCompletedStays: 42
  });

  assert.equal(lowOpportunityMetrics.displayTrailingMetrics, false);
  assert.equal(lowOpportunityMetrics.minimumOpportunitiesMet, false);
  assert.equal(lowOpportunityMetrics.lifetimeCompletedStays, 42);

  // Case B: Operator has >= 10 opportunities in 90-day window -> trailing metrics displayed
  const highOpportunityMetrics = engine.calculateReliabilityMetrics({
    trailing90dOpportunities: 15,
    trailing90dFulfilledCount: 14,
    trailing90dResponseMs: [120000, 180000],
    lifetimeCompletedStays: 120
  });

  assert.equal(highOpportunityMetrics.displayTrailingMetrics, true);
  assert.equal(highOpportunityMetrics.minimumOpportunitiesMet, true);
  assert.equal(highOpportunityMetrics.trailing90dFulfilmentRate, 14 / 15);
  assert.equal(highOpportunityMetrics.lifetimeCompletedStays, 120);
});

test("Location projection preserves useful neighbourhood context without exposing precise address.", () => {
  const engine = new OrganicRankingEngine();

  const exactLocation = {
    city: "Lagos",
    neighbourhood: "Ikeja",
    streetAddress: "123 Admiralty Way, Flat 4B",
    latitude: 6.6018,
    longitude: 3.3515
  };

  const projection = engine.projectDiscoveryLocation(exactLocation);

  assert.equal(projection.city, "Lagos");
  assert.equal(projection.neighbourhood, "Ikeja");
  assert.equal(projection.precisionMeters, 750);
  assert.equal("streetAddress" in projection, false); // Exact address hidden before payment confirmation!
  assert.notEqual(projection.approxLatitude, exactLocation.latitude); // Coords obscured
  assert.notEqual(projection.approxLongitude, exactLocation.longitude);
});
