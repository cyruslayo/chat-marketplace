import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderBenchmarkDocument, validateLiveBenchmarkResult, type SmokeResult } from "../scripts/pilot-agent-smoke-report.js";
import { buildPerformanceReport } from "../scripts/pilot-agent-smoke-metrics.js";
import { SMOKE_GRADING_PROFILE } from "../scripts/pilot-agent-smoke-grading.js";

// The preserved live result is the golden complete report fixture.
const recorded = JSON.parse(readFileSync(new URL("../docs/testing/openrouter-gpt6-luna-benchmark-result.json", import.meta.url), "utf8")) as SmokeResult;
const fixture = (): SmokeResult => ({ ...structuredClone(recorded), gradingProfile: SMOKE_GRADING_PROFILE });

test("Finding 2: complete consistent live evidence produces GO", () => {
  assert.equal(validateLiveBenchmarkResult(fixture()), null);
  assert.match(renderBenchmarkDocument(fixture()), /\*\*GO\*\*/);
});

test("Finding 2: empty, missing, duplicate and unknown journey stages cannot produce GO", () => {
  const mutations: ((value: SmokeResult) => SmokeResult)[] = [
    (value) => ({ ...value, result: "FAIL", scenarios: [] }),
    (value) => ({ ...value, scenarios: value.scenarios.slice(1) }),
    (value) => ({ ...value, scenarios: [value.scenarios[0]!, ...value.scenarios.slice(0, -1)] }),
    (value) => ({ ...value, scenarios: [{ ...value.scenarios[0]!, scenario: "run 1 invented stage" }, ...value.scenarios.slice(1)] }),
    (value) => ({ ...value, scenarios: [{ ...value.scenarios[0]!, semanticResult: "UNKNOWN" } as unknown as SmokeResult["scenarios"][number], ...value.scenarios.slice(1)] }),
  ];
  for (const mutate of mutations) {
    const invalid = mutate(fixture());
    assert.notEqual(validateLiveBenchmarkResult(invalid), null);
    assert.throws(() => renderBenchmarkDocument(invalid), /refused/i);
  }
});

test("Finding 2: contradictory verdicts and journey or request counts are refused", () => {
  const value = fixture();
  const mutations: Partial<SmokeResult>[] = [
    { result: "FAIL" }, { journeysActuallyAttempted: 4 }, { journeysActuallyAttempted: 1.5 },
    { configuredJourneyCount: 0 }, { totalProviderRequests: 0 }, { totalProviderRequests: value.totalProviderRequests + 1 },
    { providerRequestsPerTurn: value.providerRequestsPerTurn.slice(1) },
    { providerRequestsPerTurn: [value.providerRequestsPerTurn[0]!, ...value.providerRequestsPerTurn.slice(0, -1)] },
    { performance: { ...value.performance!, journeys: [] } },
    { performance: { ...value.performance!, journeys: [value.performance!.journeys[0]!, ...value.performance!.journeys.slice(0, -1)] } },
    { rateLimitOccurred: true }, { providerRequestBudgetExceeded: true },
    { scenarios: [{ ...value.scenarios[0]!, semanticResult: "FAIL", failureClassification: "FABRICATION_FAILURE" }, ...value.scenarios.slice(1)] },
  ];
  for (const mutation of mutations) {
    const invalid = { ...fixture(), ...mutation };
    assert.notEqual(validateLiveBenchmarkResult(invalid), null, JSON.stringify(mutation));
    assert.throws(() => renderBenchmarkDocument(invalid), /refused/i);
  }
});

test("Finding 2: a complete single journey remains INCOMPLETE for the three-journey benchmark", () => {
  const value = fixture();
  const performance = value.performance!;
  const pricing = performance.pricing;
  const single: SmokeResult = {
    ...value, configuredJourneyCount: 1, journeysActuallyAttempted: 1,
    scenarios: value.scenarios.slice(0, 4), providerRequestsPerTurn: value.providerRequestsPerTurn.slice(0, 4),
    totalProviderRequests: value.providerRequestsPerTurn.slice(0, 4).reduce((sum, turn) => sum + turn.providerRequests, 0),
    providerRequestBudget: { perJourney: 10, total: 10 },
    performance: buildPerformanceReport({ journeys: performance.journeys.slice(0, 1), slug: value.model,
      price: pricing.status === "reported" ? pricing : null }),
  };
  assert.equal(validateLiveBenchmarkResult(single), null);
  assert.match(renderBenchmarkDocument(single), /\*\*INCOMPLETE\*\*/);
  assert.doesNotMatch(renderBenchmarkDocument(single), /\*\*GO\*\*/);
});

test("Finding 2: a complete failed run preserves its NO-GO evidence", () => {
  const value = fixture();
  const failed: SmokeResult = { ...value, result: "FAIL", scenarios: [
    { ...value.scenarios[0]!, semanticResult: "FAIL", failureClassification: "FABRICATION_FAILURE" }, ...value.scenarios.slice(1),
  ] };
  assert.equal(validateLiveBenchmarkResult(failed), null);
  assert.match(renderBenchmarkDocument(failed), /\*\*NO-GO\*\*/);
  assert.doesNotMatch(renderBenchmarkDocument(failed), /\*\*GO\*\*/);
});

test("Finding 2: legacy grading and malformed nested evidence cannot produce a new GO", () => {
  const mutations: ((value: SmokeResult) => unknown)[] = [
    (value) => ({ ...value, gradingProfile: undefined }),
    (value) => ({ ...value, gradingProfile: "unknown-grader" }),
    (value) => ({ ...value, performance: { ...value.performance, pricing: null } }),
    (value) => ({ ...value, performance: { ...value.performance, latency: null } }),
    (value) => ({ ...value, performance: { ...value.performance, journeys: [null, null, null] } }),
    (value) => ({ ...value, providerRequestsPerTurn: [null, ...value.providerRequestsPerTurn.slice(1)] }),
    (value) => ({ ...value, providerRequestBudget: null }),
    (value) => ({ ...value, scenarios: [null, ...value.scenarios.slice(1)] }),
  ];
  for (const mutate of mutations) {
    const invalid = mutate(fixture());
    assert.notEqual(validateLiveBenchmarkResult(invalid), null);
    assert.throws(() => renderBenchmarkDocument(invalid), /refused/i);
  }
});
