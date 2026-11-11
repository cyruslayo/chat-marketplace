import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderBenchmarkDocument, validateLiveBenchmarkResult, type SmokeResult } from "../scripts/pilot-agent-smoke-report.js";
import { buildPerformanceReport } from "../scripts/pilot-agent-smoke-metrics.js";
import { SMOKE_GRADING_PROFILE } from "../scripts/pilot-agent-smoke-grading.js";
import { ASSISTANT_CONTROL_OUTCOMES } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { evaluateTerseFollowUps, renderTerseFollowUpReport, scoreTerseCase } from "../scripts/pilot-agent-smoke-terse.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";

// The preserved live result is the golden complete report fixture.
const recorded = JSON.parse(readFileSync(new URL("../docs/testing/openrouter-gpt6-luna-benchmark-result.json", import.meta.url), "utf8")) as SmokeResult;
const fixture = (): SmokeResult => ({
  ...structuredClone(recorded),
  gradingProfile: SMOKE_GRADING_PROFILE,
  // The archived smoke increments its request budget immediately before every transport start.
  totalReservedRequests: recorded.totalProviderRequests,
  providerReservationsPerTurn: recorded.providerRequestsPerTurn,
  controlOutcomeCounts: Object.fromEntries(ASSISTANT_CONTROL_OUTCOMES.map((outcome) => [outcome, 0])) as Record<typeof ASSISTANT_CONTROL_OUTCOMES[number], number>,
  evaluationMetrics: {
    guardFailures: 0,
    falseRefusals: recorded.scenarios.filter((entry) => entry.falseRefusal === true).length,
    taskCompletions: recorded.scenarios.filter((entry) => entry.semanticResult === "PASS").length,
    prohibitedEffects: recorded.scenarios.reduce((sum, entry) => sum + (entry.prohibitedEffects ?? 0), 0),
  },
});

test("Finding 2: complete consistent live evidence produces GO", () => {
  assert.equal(validateLiveBenchmarkResult(fixture()), null);
  assert.match(renderBenchmarkDocument(fixture()), /\*\*GO\*\*/);
});

test("AC6: reserved capacity and actual transport starts are reported and validated separately", () => {
  const value = fixture();
  const turn = value.providerReservationsPerTurn[0]!;
  const reservedOnly = {
    ...value,
    totalReservedRequests: value.totalReservedRequests + 1,
    providerReservationsPerTurn: [{ ...turn, providerRequests: turn.providerRequests + 1 }, ...value.providerReservationsPerTurn.slice(1)],
  };
  assert.equal(validateLiveBenchmarkResult(reservedOnly), null);
  assert.match(renderBenchmarkDocument(reservedOnly), /Reserved provider-request capacity/);
  assert.match(renderBenchmarkDocument(reservedOnly), /Actual provider transport starts/);
  const impossible = { ...reservedOnly, totalReservedRequests: reservedOnly.totalProviderRequests - 1 };
  assert.match(validateLiveBenchmarkResult(impossible) ?? "", /budget|reservation|count/i);
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
    evaluationMetrics: { ...value.evaluationMetrics, taskCompletions: 4 },
    scenarios: value.scenarios.slice(0, 4), providerRequestsPerTurn: value.providerRequestsPerTurn.slice(0, 4),
    providerReservationsPerTurn: value.providerReservationsPerTurn.slice(0, 4),
    totalProviderRequests: value.providerRequestsPerTurn.slice(0, 4).reduce((sum, turn) => sum + turn.providerRequests, 0),
    totalReservedRequests: value.providerReservationsPerTurn.slice(0, 4).reduce((sum, turn) => sum + turn.providerRequests, 0),
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
  const failed: SmokeResult = { ...value, result: "FAIL", evaluationMetrics: { ...value.evaluationMetrics, taskCompletions: value.evaluationMetrics.taskCompletions - 1 }, scenarios: [
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

test("AC6: failed task selection does not become a false refusal without refusal evidence", () => {
  const value = fixture();
  const failed: SmokeResult = { ...value, result: "FAIL",
    evaluationMetrics: { ...value.evaluationMetrics, taskCompletions: value.evaluationMetrics.taskCompletions - 1, falseRefusals: 0 },
    scenarios: [{ ...value.scenarios[0]!, semanticResult: "FAIL", failureClassification: "MODEL_SELECTION_FAILURE", falseRefusal: false }, ...value.scenarios.slice(1)],
  };
  assert.equal(validateLiveBenchmarkResult(failed), null);
  const refusal = { ...failed, scenarios: [{ ...failed.scenarios[0]!, falseRefusal: true }, ...failed.scenarios.slice(1)] };
  assert.match(validateLiveBenchmarkResult(refusal) ?? "", /false refusal count/);
  assert.equal(validateLiveBenchmarkResult({ ...refusal, evaluationMetrics: { ...refusal.evaluationMetrics, falseRefusals: 1 } }), null);
});

// Issue 61: the live terse-follow-up eval, checked offline with a fake model client. A fake that refuses one case gives the expected
// rate; a fake that answers every case gives 0; the rendered report carries closed codes only (no guest or model text).

const EMPTY_SLOTS = { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } as const;

function fakeTerseModel(refuse: (message: string) => "unclear" | "out_of_scope" | null): AssistantModelClient {
  return {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const user = [...request.history].reverse().find((step) => step.role === "user");
        const message = user && "text" in user ? (JSON.parse(user.text) as { readonly message: string }).message : "";
        const refused = refuse(message);
        const scope = refused ?? "in_scope";
        return { text: JSON.stringify({ scope, risk: "ordinary", intents: scope === "in_scope" ? ["search"] : [], reasonCode: scope === "in_scope" ? "supported" : scope === "unclear" ? "unclear" : "outside", slots: EMPTY_SLOTS }) };
      }
      // A planner reply: a benign discovery search so the turn completes.
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
}

test("Issue 61: a fake client that answers every case gives a false-refusal rate of 0", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel(() => null));
  assert.equal(report.cases.length, 10);
  assert.equal(report.failedCases, 0);
  assert.equal(report.falseRefusalRate, 0);
  assert.ok(report.cases.every((entry) => entry.pass && !entry.falseRefusal));
});

test("Issue 61: a fake client that refuses one case gives the expected false-refusal rate", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel((message) => message === "just me" ? "unclear" : null));
  assert.equal(report.cases.length, 10);
  assert.equal(report.failedCases, 0);
  assert.equal(report.falseRefusalRate, 1 / 10);
  const refused = report.cases.filter((entry) => entry.falseRefusal);
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.id, "party_size:solo");
  assert.equal(refused[0]!.scope, "unclear");
  assert.equal(refused[0]!.pass, false);
});

test("Issue 61: the rendered terse report carries closed codes only, never guest or model text", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel(() => null));
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.doesNotMatch(rendered, /just me|two of us|me and my wife|a week|Wuse 2|the first one|the second/i, "no guest text");
  assert.match(rendered, /in_scope/);
  assert.match(rendered, /party_size/);
});

test("Issue 61: cases run through an active provider turn reach the classifier; without it, every case fails", async () => {
  // A fake that behaves like the guarded provider: it refuses to run outside an active smoke turn, and reserves per attempt.
  const storage = new AsyncLocalStorage<{ readonly turn: string }>();
  const base = fakeTerseModel(() => null);
  let reserved = 0;
  const guarded: AssistantModelClient = {
    generate: async (request) => {
      if (!storage.getStore()) throw new Error("Provider transport started outside an active smoke turn");
      reserved += 1;
      return base.generate(request);
    },
  };
  const run = await evaluateTerseFollowUps(guarded, {
    requestBudget: 40,
    requestsUsed: () => reserved,
    runCase: (_id, inner) => storage.run({ turn: "terse" }, inner),
    skipReason: () => undefined,
  });
  assert.equal(run.status, "run");
  assert.equal(run.cases.length, 10);
  assert.ok(run.cases.every((entry) => entry.scope !== "failed"), "every case reaches the classifier through the guard");
  assert.ok(run.requestsUsed > 0, "the guarded requests are counted");

  // Without the wrapper the guarded fake throws, so the suite stops with a provider failure instead of running: the bug the wiring fixes.
  const unguarded = await evaluateTerseFollowUps(guarded, { requestBudget: 40 });
  assert.equal(unguarded.status, "skipped");
  assert.equal(unguarded.skipReason, "provider_failure");
});

test("Issue 61: a case with no verdict is excluded from the false-refusal denominator and counted as failed", async () => {
  // One case returns invalid JSON (no verdict); another is refused. The rate is 1 of the 9 cases that returned a verdict.
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const user = [...request.history].reverse().find((step) => step.role === "user");
        const message = user && "text" in user ? (JSON.parse(user.text) as { readonly message: string }).message : "";
        if (message === "just me") return { text: "{not json}" };
        const scope = message === "2" ? "unclear" : "in_scope";
        return { text: JSON.stringify({ scope, risk: "ordinary", intents: scope === "in_scope" ? ["search"] : [], reasonCode: scope === "in_scope" ? "supported" : "unclear", slots: EMPTY_SLOTS }) };
      }
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  assert.equal(report.cases.length, 10);
  assert.equal(report.failedCases, 1);
  assert.equal(report.falseRefusalRate, 1 / 9, "the failed case is excluded from the denominator");
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.match(rendered, /Failed cases: 1/);
  assert.match(rendered, /Valid for acceptance: no/);
});

test("Issue 61: a provider rate limit inside the suite stops it with the rate_limited reason", async () => {
  const storage = new AsyncLocalStorage<{ readonly turn: string }>();
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const error = Object.assign(new Error("rate limited"), { status: 429 });
        throw error;
      }
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model, { runCase: (_id, inner) => storage.run({ turn: "terse" }, inner) });
  assert.equal(report.status, "skipped");
  assert.equal(report.skipReason, "rate_limited");
});

test("Issue 61: the terse suite is skipped, with a closed reason, after a rate-limit stop", async () => {
  const storage = new AsyncLocalStorage<{ readonly turn: string }>();
  const skipped = await evaluateTerseFollowUps(fakeTerseModel(() => null), {
    requestBudget: 40,
    requestsUsed: () => 0,
    runCase: (_id, inner) => storage.run({ turn: "terse" }, inner),
    skipReason: () => "rate_limited",
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.skipReason, "rate_limited");
  assert.equal(skipped.cases.length, 0);
});

function scopeMessage(request: AssistantModelRequest): string {
  const user = [...request.history].reverse().find((step) => step.role === "user");
  return user && "text" in user ? (JSON.parse(user.text) as { readonly message: string }).message : "";
}

const validVerdict = JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS });

test("Issue 61: every unreadable classifier response is reported with a closed parse-failure code, never model text", async () => {
  const byMessage: Readonly<Record<string, AssistantModelResponse>> = {
    "just me": { text: "not json" },
    "2": { text: JSON.stringify({ risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) },
    "two of us": { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], slots: EMPTY_SLOTS }) },
    "me and my wife": { text: JSON.stringify({ scope: "maybe", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) },
    "3": { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "perhaps", slots: EMPTY_SLOTS }) },
    "the first one": { toolCalls: [{ id: "terse-tool", name: "search_stays", args: { city: "Lagos" } }] },
    "the second": {},
  };
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") return byMessage[scopeMessage(request)] ?? { text: validVerdict };
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  const failureOf = (id: string) => report.cases.find((entry) => entry.id === id)?.scopeFailure;
  assert.equal(failureOf("party_size:solo"), "not_json");
  assert.equal(failureOf("party_size:numeral"), "scope_missing");
  assert.equal(failureOf("party_size:pair"), "reason_missing");
  assert.equal(failureOf("party_size:couple"), "scope_invalid");
  assert.equal(failureOf("nights:numeral"), "reason_invalid");
  assert.equal(failureOf("pick_result:first"), "tool_calls");
  assert.equal(failureOf("pick_result:second"), "text_missing");
  // None of the unreadable cases is a false refusal: the model never returned a refusal verdict, so the denominator is unaffected.
  assert.equal(report.falseRefusalRate, 0);
  assert.equal(report.failedCases, 7);
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.match(rendered, /not_json/);
  assert.match(rendered, /scope_invalid/);
  assert.doesNotMatch(rendered, /not json|maybe|perhaps/i, "no model text");
});

test("Issue 61: a classifier response that never arrives is a closed no_response, scored from the turn outcome", async () => {
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        // One case's classifier never answers; the stage caps its own attempt, exactly as a live slow response does.
        if (scopeMessage(request) === "a week") return await new Promise<never>(() => {});
        return { text: validVerdict };
      }
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  const week = report.cases.find((entry) => entry.id === "nights:week");
  assert.ok(week, "the case is reported");
  assert.equal(week.openQuestionSent, "nights", "the classifier request carried the open question");
  assert.equal(week.resultCountSent, 0);
  assert.equal(week.scopeFailure, "no_response", "the response never arrived; the request did");
  assert.equal(week.controlOutcome, "guard_failure", "the turn's closed outcome records the failed stage");
  assert.equal(week.path, "classifier_failed");
  assert.equal(week.falseRefusal, false, "a stage timeout is not a model refusal");
  assert.equal(report.failedCases, 1);
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.match(rendered, /nights:week/);
  assert.match(rendered, /no_response/);
  assert.match(rendered, /guard_failure/);
  assert.doesNotMatch(rendered, /Valid for acceptance: yes/);
});

test("Issue 61: a case with no verdict is scored from the turn's closed outcome, and an answering path passes", () => {
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: "nights", controlOutcome: "successful_model_handling" }),
    { path: "answered_without_classifier", pass: true, falseRefusal: false },
  );
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: null, controlOutcome: "guard_failure" }),
    { path: "classifier_failed", pass: false, falseRefusal: false },
  );
  assert.deepEqual(
    scoreTerseCase({ expected: "pick_result", scope: "unclear", openQuestionSent: "pick_result", controlOutcome: "guard_failure" }),
    { path: "classifier", pass: false, falseRefusal: true },
  );
});

test("Issue 61: the pick_result cases are evaluated against a shown result list, as a closed count only", async () => {
  const sent: { readonly message: string; readonly openQuestion: unknown; readonly resultCount: unknown }[] = [];
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const user = [...request.history].reverse().find((step) => step.role === "user");
        const envelope = user && "text" in user ? JSON.parse(user.text) as { readonly message: string; readonly context: Record<string, unknown> } : undefined;
        if (envelope) sent.push({ message: envelope.message, openQuestion: envelope.context.openQuestion, resultCount: envelope.context.resultCount });
        return { text: validVerdict };
      }
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  const picks = sent.filter((entry) => entry.message === "the first one" || entry.message === "the second");
  assert.equal(picks.length, 2, "both pick cases reach the classifier");
  for (const pick of picks) {
    assert.equal(pick.openQuestion, "pick_result");
    assert.equal(pick.resultCount, 2, "the classifier is told two results are shown");
  }
  assert.ok(report.cases.filter((entry) => entry.id.startsWith("pick_result:")).every((entry) => entry.pass));
});
