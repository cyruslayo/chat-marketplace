import test from "node:test";
import assert from "node:assert/strict";
import { calculateAuthoritativeRemedy } from "../domains/shortlet/src/index.js";

test("Issue 22 authoritative cure boundaries use exact millisecond transitions", () => {
  const base = { reservationId: "r", evidenceSetId: "e", contractVersion: 3, assessmentVersion: "a", causationVersion: "c", causationStatus: "established" as const, affectedNightDates: ["2026-09-02"], unusedNightDates: [], materiallyUnusableNightDates: [], overnightImpact: false, materialIncident: false, currentImpact: "ongoing" as const, repeatedOrMaterialMinor: false, category: "essential_amenity" as const, failureStartedAt: "2026-09-01T00:00:00.000Z", reportingDelayExcused: false };
  const economics = { economicsVersion: "ec-1", currency: "NGN" as const, nightlyLineItems: [{ nightDateIso: "2026-09-02", rateKobo: 15000000 }], attributableUndeliveredChargesKobo: 100, attributableRefundableTaxKobo: 50 };
  const remedy = (hours: number) => calculateAuthoritativeRemedy({ assessment: base, cure: { cureVersion: `c-${hours}`, status: "cured", curedAt: new Date(Date.parse(base.failureStartedAt) + hours * 3600000).toISOString() }, economics, now: new Date(Date.parse(base.failureStartedAt) + hours * 3600000) });
  assert.equal(remedy(2).percentage, 25); assert.equal(remedy(6).percentage, 25); assert.equal(remedy(6 + 1 / 3600000).percentage, 50);
});

test("Issue 22 authoritative remedy uses only affected contracted line items and no Issue 23 choice", () => {
  const assessment = { reservationId: "r", evidenceSetId: "e", contractVersion: 1, assessmentVersion: "a", causationVersion: "c", causationStatus: "established" as const, affectedNightDates: ["2026-09-02"], unusedNightDates: [], materiallyUnusableNightDates: [], overnightImpact: false, materialIncident: true, currentImpact: "ongoing" as const, repeatedOrMaterialMinor: false, category: "essential_amenity" as const, failureStartedAt: "2026-09-01T00:00:00.000Z", reportingDelayExcused: false };
  const result = calculateAuthoritativeRemedy({ assessment, cure: { cureVersion: "c", status: "cured", curedAt: "2026-09-01T08:00:00.001Z" }, economics: { economicsVersion: "e", currency: "NGN", nightlyLineItems: [{ nightDateIso: "2026-09-01", rateKobo: 10000000 }, { nightDateIso: "2026-09-02", rateKobo: 15000000 }], attributableUndeliveredChargesKobo: 200, attributableRefundableTaxKobo: 300 }, now: new Date("2026-09-01T08:00:00.001Z") });
  assert.equal(result.nightlyRefundKobo, 7500000); assert.equal(result.totalRefundKobo, 7500500); assert.equal("resolutionChoice" in result, false);
});
