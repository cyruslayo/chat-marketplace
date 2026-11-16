import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";
const handlesAt = (label: string) => process.stderr.write(`TRACE ${label}: handles=${(process as unknown as { _getActiveHandles(): { constructor: { name: string } }[] })._getActiveHandles().map((handle) => handle.constructor.name).join(",")} requests=${(process as unknown as { _getActiveRequests(): { constructor: { name: string } }[] })._getActiveRequests().map((request) => request.constructor.name).join(",")}\n`);
setTimeout(() => handlesAt("at 6s"), 6000).unref();
import { renderBenchmarkDocument, validateLiveBenchmarkResult, type SmokeResult } from "../scripts/pilot-agent-smoke-report.js";
import { buildPerformanceReport } from "../scripts/pilot-agent-smoke-metrics.js";
import { SMOKE_GRADING_PROFILE } from "../scripts/pilot-agent-smoke-grading.js";
import { ASSISTANT_CONTROL_OUTCOMES } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { evaluateTerseFollowUps, holdsAnsweredSlot, renderTerseFollowUpReport, scoreTerseCase, TERSE_FOLLOW_UP_CASES } from "../scripts/pilot-agent-smoke-terse.js";
import { REFERENCE_TERSE_ACTIONS } from "../scripts/pilot-agent-smoke-reference.js";
import { createInitialTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
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
const FALLBACK_SEARCH = { id: "terse-search", name: "search_stays", args: { city: "Lagos" } } as const;

/** The guest message a request carries: the classifier envelope's `message`, or the last user step's text. */
function requestMessage(request: AssistantModelRequest): string {
  const user = [...request.history].reverse().find((step) => step.role === "user");
  if (!user || !("text" in user)) return "";
  try {
    const envelope = JSON.parse(user.text) as { readonly message?: unknown };
    return typeof envelope.message === "string" ? envelope.message : user.text;
  } catch {
    return user.text;
  }
}

/**
 * Issue 63: what a correct planner does with each terse answer, on the journey the set-up reached. The scripted reference holds the
 * same fixed actions; without them the fake leaves the slot empty and the honest pass rule fails the case, which is the behaviour
 * under test.
 */
function tersePlan(message: string): AssistantModelResponse {
  return { toolCalls: [...(REFERENCE_TERSE_ACTIONS[message] ?? [FALLBACK_SEARCH])] };
}

/** The three pick cases: their answer is a details request, which authorizes opening a shown result. */
const PICK_MESSAGES = new Set(["the first one", "the second", "the last one"]);

function fakeTerseModel(refuse: (message: string) => "unclear" | "out_of_scope" | null): AssistantModelClient {
  return {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const message = requestMessage(request);
        const refused = refuse(message);
        const scope = refused ?? "in_scope";
        const intents = scope !== "in_scope" ? [] : PICK_MESSAGES.has(message) ? ["details"] : ["search"];
        return { text: JSON.stringify({ scope, risk: "ordinary", intents, reasonCode: scope === "in_scope" ? "supported" : scope === "unclear" ? "unclear" : "outside", slots: EMPTY_SLOTS }) };
      }
      if (request.history.at(-1)?.role === "tool_results") return { text: JSON.stringify({ kind: "show_results", references: [] }) };
      // The correct planner action for the case's terse answer, so the answered slot can land.
      return tersePlan(requestMessage(request));
    },
  };
}

test("Issue 61: a fake client that answers every case gives a false-refusal rate of 0", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel(() => null));
  assert.equal(report.cases.length, 13);
  assert.equal(report.failedCases, 0);
  assert.equal(report.falseRefusalRate, 0);
  assert.ok(report.cases.every((entry) => entry.pass && !entry.falseRefusal));
});

test("Issue 61: a fake client that refuses one case gives the expected false-refusal rate", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel((message) => message === "just me" ? "unclear" : null));
  assert.equal(report.cases.length, 13);
  assert.equal(report.failedCases, 0);
  assert.equal(report.falseRefusalRate, 1 / 13);
  const refused = report.cases.filter((entry) => entry.falseRefusal);
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.id, "party_size:solo");
  assert.equal(refused[0]!.scope, "unclear");
  assert.equal(refused[0]!.pass, false);
});

test("Issue 61: the rendered terse report carries closed codes only, never guest or model text", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel(() => null));
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.doesNotMatch(rendered, /just me|two of us|me and my wife|a week|Wuse 2|the first one|the second|my partner and I|two weeks|the last one/i, "no guest text");
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
  assert.equal(run.cases.length, 13);
  assert.ok(run.cases.every((entry) => entry.scope !== "failed"), "every case reaches the classifier through the guard");
  assert.ok(run.requestsUsed > 0, "the guarded requests are counted");

  // Without the wrapper the guarded fake throws, so the suite stops with a provider failure instead of running: the bug the wiring fixes.
  const unguarded = await evaluateTerseFollowUps(guarded, { requestBudget: 40 });
  assert.equal(unguarded.status, "skipped");
  assert.equal(unguarded.skipReason, "provider_failure");
});

test("Issue 61: a case with no verdict is excluded from the false-refusal denominator and counted as failed", async () => {
  // One case returns invalid JSON (no verdict); another is refused. The rate is 1 of the 12 cases that returned a verdict.
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
  assert.equal(report.cases.length, 13);
  assert.equal(report.failedCases, 1);
  assert.equal(report.falseRefusalRate, 1 / 12, "the failed case is excluded from the denominator");
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
  assert.equal(report.timeouts, 1, "a missing classifier response is counted separately as a timeout");
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.match(rendered, /nights:week/);
  assert.match(rendered, /no_response/);
  assert.match(rendered, /guard_failure/);
  assert.match(rendered, /Classifier timeouts: 1 \(no_response; 5 s first attempt, 3 s retry, 8 s stage\)/);
  assert.doesNotMatch(rendered, /Valid for acceptance: yes/);
});

test("Issue 61: a no-verdict case passes only on a model answer that left the answered slot in task state", () => {
  // The turn answered with the model and the slot is held: the only passing no-verdict path.
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: "nights", controlOutcome: "successful_model_handling", answeredSlotHeld: true }),
    { path: "answered_without_classifier", pass: true, falseRefusal: false },
  );
  // A model answer that left no slot is a failure, not a pass.
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: "nights", controlOutcome: "successful_model_handling", answeredSlotHeld: false }),
    { path: "classifier_failed", pass: false, falseRefusal: false },
  );
  // support_guidance is a FAIL even when a slot happens to be held.
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: null, controlOutcome: "support_guidance", answeredSlotHeld: true }),
    { path: "classifier_failed", pass: false, falseRefusal: false },
  );
  // A guard failure stays a failure.
  assert.deepEqual(
    scoreTerseCase({ expected: "nights", scope: "failed", openQuestionSent: null, controlOutcome: "guard_failure", answeredSlotHeld: false }),
    { path: "classifier_failed", pass: false, falseRefusal: false },
  );
  // A verdict-bearing refusal is still a false refusal.
  assert.deepEqual(
    scoreTerseCase({ expected: "pick_result", scope: "unclear", openQuestionSent: "pick_result", controlOutcome: "guard_failure", answeredSlotHeld: false }),
    { path: "classifier", pass: false, falseRefusal: true },
  );
});

test("Issue 61: the answered-slot check reads closed task-state values", () => {
  const state = createInitialTaskState();
  assert.equal(holdsAnsweredSlot(state, "party_size", 0), false);
  state.stayIntent.partySize = 2;
  assert.equal(holdsAnsweredSlot(state, "party_size", 0), true);
  assert.equal(holdsAnsweredSlot(state, "nights", 0), false);
  state.stayIntent.nights = 7;
  assert.equal(holdsAnsweredSlot(state, "nights", 0), true);
  assert.equal(holdsAnsweredSlot(state, "pick_result", 2), false);
  state.selectedStayRef = "stay-3";
  assert.equal(holdsAnsweredSlot(state, "pick_result", 2), false, "a result outside the shown list is not held");
  assert.equal(holdsAnsweredSlot(state, "pick_result", 3), true);
  assert.equal(holdsAnsweredSlot(state, "where", 0), false);
  state.stayIntent.location = "Abuja";
  assert.equal(holdsAnsweredSlot(state, "where", 0), true);
  assert.equal(holdsAnsweredSlot(state, "date_confirm", 0), false);
  // ADR 0092: a demo date is the server's, not the guest's, so it answers nothing.
  state.stayIntent.checkIn = "2026-11-12";
  state.stayIntent.isDemoDate = true;
  assert.equal(holdsAnsweredSlot(state, "date_confirm", 0), false, "a demo date is not a confirmed check-in");
  state.stayIntent.isDemoDate = false;
  assert.equal(holdsAnsweredSlot(state, "date_confirm", 0), true);
});

test("Issue 61: the pick_result cases are evaluated against a shown result list, as a closed count only", async () => {
  const sent: { readonly message: string; readonly openQuestion: unknown; readonly resultCount: unknown }[] = [];
  const picks = new Set(["the first one", "the second", "the last one"]);
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const message = requestMessage(request);
        const envelope = [...request.history].reverse().find((step) => step.role === "user");
        if (envelope && "text" in envelope) {
          const parsed = JSON.parse(envelope.text) as { readonly context: Record<string, unknown> };
          sent.push({ message, openQuestion: parsed.context.openQuestion, resultCount: parsed.context.resultCount });
        }
        // A pick answers with the details intent, which authorizes opening a shown result.
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: picks.has(message) ? ["details"] : ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) };
      }
      if (request.history.at(-1)?.role === "tool_results") return { text: JSON.stringify({ kind: "show_details", references: [] }) };
      return tersePlan(requestMessage(request));
    },
  };
  const report = await evaluateTerseFollowUps(model);
  const pickRequests = sent.filter((entry) => picks.has(entry.message));
  assert.equal(pickRequests.length, 3, "all three pick cases reach the classifier");
  const counts = Object.fromEntries(pickRequests.map((pick) => [pick.message, pick.resultCount]));
  // The city-wide search shows two results, so the held-out "last" is the second of two — never a seeded count.
  assert.deepEqual(counts, { "the first one": 2, "the second": 2, "the last one": 2 });
  for (const pick of pickRequests) assert.equal(pick.openQuestion, "pick_result");
  assert.ok(report.cases.filter((entry) => entry.id.startsWith("pick_result:")).every((entry) => entry.pass), "a pick that opens a shown result passes");
});

// Issue 63 AC7: the pass rule is the verdict AND the answer. A model that classifies every reply correctly but never acts leaves
// tool-dependent answers unheld, so those cases must FAIL even though every verdict and code is right.
test("Issue 63: the terse eval's pass rule requires the answered slot, not only the classifier verdict", async () => {
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) };
      }
      // A typed reply and no operation: only facts read from the guest's own answer can land.
      return { text: JSON.stringify({ kind: "show_results", references: [] }) };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  assert.equal(report.cases.length, 13);
  assert.ok(report.cases.every((entry) => entry.scope === "in_scope"), "every verdict is in scope");
  assert.ok(report.cases.every((entry) => entry.openQuestionSent === entry.openQuestion), "every request carried the right code");
  assert.equal(report.falseRefusalRate, 0, "no case is a false refusal");
  // Some answers land without a planner action, all as guest-authored state: the shown-back date the server settles from the yes,
  // a typed stay length ("a week", "two weeks"), which ADR 0106 (8 Nov 2026) records as the stated stay at every turn start, and a
  // bare number or worded party-size answer to the open question (ADR 0106, 16 Nov 2026).
  const settled = report.cases.filter((entry) => entry.answeredSlotHeld).map((entry) => entry.id);
  assert.deepEqual(settled, ["party_size:solo", "party_size:numeral", "party_size:pair", "party_size:couple", "party_size:held-out-partner", "nights:week", "nights:numeral", "nights:held-out-fortnight", "date_confirm:affirm"], "only guest-authored answers land without a planner action");
  assert.ok(report.cases.filter((entry) => !settled.includes(entry.id)).every((entry) => entry.pass === false), "a verdict with no answer is not a pass");
  assert.ok(report.cases.filter((entry) => settled.includes(entry.id)).every((entry) => entry.pass === true), "the answers that did land pass");
});

// Issue 63 AC8: every case starts from the journey that asks the question, so the code on the classifier request comes from the thread
// (a cold restore), not from a hand-set field. A pick also reaches a real discovery surface with a shown result count.
test("Issue 63: every terse eval case runs from a realistic cold journey, not an empty thread", async () => {
  const requests: { readonly message: string; readonly openQuestion: unknown; readonly resultCount: unknown }[] = [];
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        const envelope = [...request.history].reverse().find((step) => step.role === "user");
        if (envelope && "text" in envelope) {
          const parsed = JSON.parse(envelope.text) as { readonly message: string; readonly context: Record<string, unknown> };
          requests.push({ message: parsed.message, openQuestion: parsed.context.openQuestion, resultCount: parsed.context.resultCount });
        }
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) };
      }
      return { toolCalls: [{ id: "terse-search", name: "search_stays", args: { city: "Lagos" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  assert.equal(report.cases.length, 13);
  assert.equal(report.cases.filter((entry) => entry.scopeFailure === "setup_failed").length, 0, "every set-up journey reached the question");
  const caseRequests = new Map(requests.map((entry) => [entry.message, entry]));
  for (const testCase of TERSE_FOLLOW_UP_CASES) {
    assert.ok(testCase.setup.length > 0, `${testCase.id}: the case starts from a guest journey`);
    const request = caseRequests.get(testCase.text);
    assert.ok(request, `${testCase.id}: the measured reply reached the classifier`);
    assert.equal(request.openQuestion, testCase.openQuestion, `${testCase.id}: the code came from the journey's thread`);
    if (testCase.needsResults === true) assert.ok(Number(request.resultCount) >= 2, `${testCase.id}: a real discovery surface is shown`);
  }
});

// Issue 63 (12 Nov 2026 live run): three cases failed the pass rule yet the report read "Valid for acceptance: yes", because the flag
// only counted cases with no verdict. Acceptance needs every measured case to pass.
test("Issue 63: the terse report is valid for acceptance only when every measured case passes", async () => {
  const passing = await evaluateTerseFollowUps(fakeTerseModel(() => null));
  assert.match(renderTerseFollowUpReport(passing).join("\n"), /- Valid for acceptance: yes$/m);
  const silent: AssistantModelClient = {
    generate: async (request) => request.structuredOutput?.name === "concierge_scope"
      ? { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) }
      : { text: JSON.stringify({ kind: "show_results", references: [] }) },
  };
  const report = await evaluateTerseFollowUps(silent);
  assert.equal(report.failedCases, 0, "every case returned a verdict");
  const failing = report.cases.filter((entry) => !entry.pass).length;
  assert.ok(failing > 0);
  assert.ok(renderTerseFollowUpReport(report).includes(`- Valid for acceptance: no (${failing} cases failed the pass rule)`));
});

// Issue 63: the planner's action on the measured turn is reported as closed codes only: the tool name, the slot argument names it
// filled (never their values), the typed reply kind, and a denied tool with its closed code. Keys outside the tool schema are dropped.
test("Issue 63: the terse report names the planner's action on the measured turn as closed codes only", async () => {
  const model: AssistantModelClient = {
    generate: async (request) => {
      if (request.structuredOutput?.name === "concierge_scope") {
        return { text: JSON.stringify({ scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported", slots: EMPTY_SLOTS }) };
      }
      if (request.history.at(-1)?.role === "tool_results") return { text: JSON.stringify({ kind: "show_results", references: [] }) };
      return { toolCalls: [{ id: "planner-search", name: "search_stays", args: { city: "Lagos", guests: 2, nights: null, notInSchema: "Lekki secret" } }] };
    },
  };
  const report = await evaluateTerseFollowUps(model);
  const numeral = report.cases.find((entry) => entry.id === "party_size:numeral");
  assert.ok(numeral);
  assert.equal(numeral.plannerActions[0], "search_stays(city,guests)", "the tool and the filled schema keys, sorted, without values");
  assert.ok(numeral.plannerActions.some((action) => /^(reply:show_results|denied:search_stays(:[A-Z_]+)?)$/.test(action)), "the reply kind or the closed denial follows");
  const rendered = renderTerseFollowUpReport(report).join("\n");
  assert.match(rendered, /\| Planner \|/);
  assert.doesNotMatch(rendered, /notInSchema|Lekki secret|"guests"|: ?2\b/);
});

// Issue 63: one live sample cannot tell a flaky model from a broken path, so each case runs once per configured run, and the run is
// valid for acceptance only when every run of every case passes.
test("Issue 63: each terse case runs once per configured run, and acceptance needs every run to pass", async () => {
  const report = await evaluateTerseFollowUps(fakeTerseModel(() => null), { runs: 2 });
  assert.equal(report.cases.length, TERSE_FOLLOW_UP_CASES.length * 2);
  assert.deepEqual([...new Set(report.cases.map((entry) => entry.run))], [1, 2]);
  assert.equal(report.runs, 2);
  assert.match(renderTerseFollowUpReport(report).join("\n"), /- Runs per case: 2/);
  let seen = 0;
  const flaky = fakeTerseModel((message) => message === "2" && ++seen === 2 ? "unclear" : null);
  const mixed = await evaluateTerseFollowUps(flaky, { runs: 2 });
  const numeral = mixed.cases.filter((entry) => entry.id === "party_size:numeral").map((entry) => entry.pass);
  assert.deepEqual(numeral, [true, false], "the second run of the case fails");
  assert.match(renderTerseFollowUpReport(mixed).join("\n"), /- Valid for acceptance: no \(1 cases failed the pass rule\)/);
});
