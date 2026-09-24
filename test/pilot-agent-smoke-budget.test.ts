import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PILOT_AGENT_SMOKE_RUNS,
  DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY,
  ProviderRequestBudget,
  parsePilotAgentSmokeRuns,
  providerStopReason,
} from "../scripts/pilot-agent-smoke-budget.js";

test("live smoke defaults to one journey and accepts an explicit three-run request", () => {
  assert.equal(parsePilotAgentSmokeRuns([]), DEFAULT_PILOT_AGENT_SMOKE_RUNS);
  assert.equal(parsePilotAgentSmokeRuns(["--runs", "3"]), 3);
  assert.equal(parsePilotAgentSmokeRuns(["--runs=3"]), 3);
  assert.equal(parsePilotAgentSmokeRuns([], "2"), 2);
  assert.equal(parsePilotAgentSmokeRuns(["--runs", "3"], "2"), 3);
});

test("live smoke run count rejects malformed or unbounded options", () => {
  for (const args of [["--runs", "0"], ["--runs", "4"], ["--runs", "one"], ["--other"]]) {
    assert.throws(() => parsePilotAgentSmokeRuns(args));
  }
  assert.throws(() => parsePilotAgentSmokeRuns([], "0"));
  assert.throws(() => parsePilotAgentSmokeRuns(["--runs", "1", "--runs", "2"]));
});

test("provider request budget counts only reserved provider attempts and hard-stops at its cap", () => {
  const budget = new ProviderRequestBudget(1);
  assert.equal(budget.maxRequestsPerJourney, DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY);
  assert.equal(budget.maxRequests, 10);
  for (let request = 0; request < 10; request++) assert.equal(budget.reserve(1), true);
  assert.equal(budget.totalRequests, 10);
  assert.equal(budget.reserve(1), false);
  assert.equal(budget.totalRequests, 10, "rejected reservation does not represent an API request");
  assert.equal(budget.exceeded, true);
});

test("explicit multi-run mode receives a fixed per-journey budget without unbounded growth", () => {
  const budget = new ProviderRequestBudget(3);
  for (let journey = 1; journey <= 3; journey++) {
    for (let request = 0; request < 10; request++) assert.equal(budget.reserve(journey), true);
  }
  assert.equal(budget.maxRequests, 30);
  assert.equal(budget.totalRequests, 30);
  assert.equal(budget.reserve(3), false);
  assert.equal(budget.totalRequests, 30);
});

test("provider stop reason treats HTTP 429 as terminal and budget exhaustion as its own classification", () => {
  assert.equal(providerStopReason({ providerStatusCode: 429, budgetExceeded: false }), "PROVIDER_RATE_LIMITED");
  assert.equal(providerStopReason({ providerErrorClass: "RateLimitError", budgetExceeded: false }), "PROVIDER_RATE_LIMITED");
  assert.equal(providerStopReason({ budgetExceeded: true }), "PROVIDER_REQUEST_BUDGET_EXCEEDED");
  assert.equal(providerStopReason({ providerStatusCode: 503, budgetExceeded: false }), undefined);
});
