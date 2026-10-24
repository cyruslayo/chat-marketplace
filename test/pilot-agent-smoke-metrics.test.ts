import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSISTANT_CONTROL_OUTCOMES } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  TurnUsageAccumulator,
  buildPerformanceReport,
  createOpenRouterPriceFetcher,
  estimateCostUsd,
  observeModelClient,
  parseOpenRouterModelPrice,
  percentile,
  type TurnPerformance,
} from "../scripts/pilot-agent-smoke-metrics.js";
import {
  buildSmokeResult,
  renderBenchmarkDocument,
  renderSmokeMarkdown,
  validateLiveBenchmarkResult,
  writeSmokeArtifacts,
  type SmokeScenarioReport,
} from "../scripts/pilot-agent-smoke-report.js";

const SYNTHETIC_PROMPT = "SYNTHETIC-PROMPT-MARKER-7431";
const SYNTHETIC_REPLY = "SYNTHETIC-REPLY-MARKER-9082";
const SYNTHETIC_KEY = "synthetic-test-key-0000";
const SLUG = "openai/gpt-6-luna";
const PRICE = { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 };

function turn(name: string, latencyMs: number, promptTokens: number | null, completionTokens: number | null, modelCalls = 1): TurnPerformance {
  return {
    turn: name,
    latencyMs,
    modelCalls,
    promptTokens,
    completionTokens,
    tokenUsage: promptTokens === null || completionTokens === null ? "unavailable" : "reported",
  };
}

function scenario(name: string, result: SmokeScenarioReport["semanticResult"] = "PASS"): SmokeScenarioReport {
  return {
    scenario: name,
    selectedApplicationOperation: "search_stays",
    surfaceSelected: "surface-1",
    authoritativeEntities: ["unit-1"],
    semanticResult: result,
    note: "Wuse 2 filters=true; authoritative units=1; render=PASS",
  };
}

function zeroControlOutcomes(): Record<typeof ASSISTANT_CONTROL_OUTCOMES[number], number> {
  return Object.fromEntries(ASSISTANT_CONTROL_OUTCOMES.map((outcome) => [outcome, 0])) as Record<typeof ASSISTANT_CONTROL_OUTCOMES[number], number>;
}

test("AC1: the smoke result JSON includes per-turn latency, model-call count and token usage when the provider returns usage", () => {
  const accumulator = new TurnUsageAccumulator();
  accumulator.record({ promptTokens: 120, completionTokens: 30 });
  accumulator.record({ promptTokens: 200, completionTokens: 40 });
  const snapshot = accumulator.snapshot();
  assert.deepEqual(snapshot, { modelCalls: 2, promptTokens: 320, completionTokens: 70 });

  const performance = buildPerformanceReport({
    journeys: [{ journey: 1, turns: [turn("discovery", 1200, 320, 70, 2), turn("refinement", 800, 100, 20, 1)] }],
    slug: SLUG,
    price: PRICE,
  });
  const result = buildSmokeResult({
    provider: "openrouter",
    model: SLUG,
    result: "PASS",
    liveRun: true,
    credentialConfigured: true,
    configuredJourneyCount: 1,
    journeysActuallyAttempted: 1,
    totalReservedRequests: 3,
    totalProviderRequests: 3,
    controlOutcomeCounts: zeroControlOutcomes(),
    evaluationMetrics: { guardFailures: 0, falseRefusals: 0, taskCompletions: 1, prohibitedEffects: 0 },
    providerReservationsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 2 }],
    providerRequestsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 2 }],
    providerRequestBudget: { perJourney: 10, total: 10 },
    providerRequestBudgetExceeded: false,
    rateLimitOccurred: false,
    providerStopClassification: null,
    scenarios: [scenario("run 1 discovery")],
    note: "All semantic assertions passed.",
    performance,
    generatedAt: "2026-10-22T00:00:00.000Z",
  });
  const firstTurn = result.performance?.journeys[0]?.turns[0];
  assert.equal(firstTurn?.latencyMs, 1200);
  assert.equal(firstTurn?.modelCalls, 2);
  assert.equal(firstTurn?.promptTokens, 320);
  assert.equal(firstTurn?.completionTokens, 70);
  assert.equal(firstTurn?.tokenUsage, "reported");
  assert.equal(result.performance?.latency?.turnP50Ms, 800);
  assert.equal(result.performance?.latency?.turnP95Ms, 1200);
  assert.equal(result.performance?.journeys[0]?.latencyMs, 2000);
});

test("AC1 percentiles: p50 and p95 are nearest-rank over the recorded samples and null when empty", () => {
  const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(percentile(twenty, 50), 10);
  assert.equal(percentile(twenty, 95), 19);
  assert.equal(percentile([], 50), null);
});

test("AC1 failure path: when the provider returns no usage, the report still writes and token and cost fields are unavailable instead of zero", async () => {
  const accumulator = new TurnUsageAccumulator();
  accumulator.record(undefined);
  const snapshot = accumulator.snapshot();
  assert.deepEqual(snapshot, { modelCalls: 1, promptTokens: null, completionTokens: null });

  const performance = buildPerformanceReport({
    journeys: [{ journey: 1, turns: [turn("discovery", 900, null, null, 1)] }],
    slug: "google/gemini",
    price: PRICE,
  });
  assert.equal(performance.journeys[0]?.promptTokens, null);
  assert.equal(performance.journeys[0]?.tokenUsage, "unavailable");
  assert.equal(performance.journeys[0]?.costUsd, null);
  assert.equal(performance.journeys[0]?.costStatus, "unavailable");

  const result = buildSmokeResult({
    provider: "Google Gemini",
    model: "gemini-3.8-flash",
    result: "PASS",
    liveRun: true,
    credentialConfigured: true,
    configuredJourneyCount: 1,
    journeysActuallyAttempted: 1,
    totalReservedRequests: 1,
    totalProviderRequests: 1,
    controlOutcomeCounts: zeroControlOutcomes(),
    evaluationMetrics: { guardFailures: 0, falseRefusals: 0, taskCompletions: 1, prohibitedEffects: 0 },
    providerReservationsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 1 }],
    providerRequestsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 1 }],
    providerRequestBudget: { perJourney: 10, total: 10 },
    providerRequestBudgetExceeded: false,
    rateLimitOccurred: false,
    providerStopClassification: null,
    scenarios: [scenario("run 1 discovery")],
    note: "All semantic assertions passed.",
    performance,
    generatedAt: "2026-10-22T00:00:00.000Z",
  });
  const directory = await mkdtemp(join(tmpdir(), "smoke-metrics-"));
  try {
    await writeSmokeArtifacts(directory, result);
    const written = JSON.parse(await readFile(join(directory, "agent-smoke-result.json"), "utf8")) as typeof result;
    assert.equal(written.performance?.journeys[0]?.promptTokens, null);
    assert.equal(written.performance?.journeys[0]?.costUsd, null);
    const markdown = await readFile(join(directory, "agent-smoke-report.md"), "utf8");
    assert.match(markdown, /Token usage: unavailable/);
    assert.match(markdown, /Cost: unavailable/);
    assert.doesNotMatch(markdown, /Cost: \$0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC2: the cost estimate comes from the OpenRouter-reported price for the model slug", async () => {
  assert.equal(estimateCostUsd({ promptTokens: 1000, completionTokens: 500 }, PRICE), 1000 * 0.000002 + 500 * 0.00001);

  const requested: string[] = [];
  const fetcher = createOpenRouterPriceFetcher({
    fetch: async (url: string) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "openai/other", pricing: { prompt: "0.1", completion: "0.2" } },
            { id: SLUG, pricing: { prompt: "0.000002", completion: "0.00001" } },
          ],
        }),
      };
    },
  });
  const price = await fetcher(SLUG);
  assert.deepEqual(price, PRICE);
  assert.deepEqual(requested, ["https://openrouter.ai/api/v1/models"]);
  assert.equal(parseOpenRouterModelPrice({ data: [{ id: SLUG, pricing: { prompt: "-1", completion: "0.1" } }] }, SLUG), null);
});

test("AC2 failure path: an unknown slug, a failed price fetch or a missing price leaves the cost unavailable", async () => {
  const unknown = createOpenRouterPriceFetcher({
    fetch: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  assert.equal(await unknown(SLUG), null);

  const failed = createOpenRouterPriceFetcher({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(await failed(SLUG), null);

  const performance = buildPerformanceReport({
    journeys: [{ journey: 1, turns: [turn("discovery", 500, 10, 5)] }],
    slug: SLUG,
    price: null,
  });
  assert.equal(performance.pricing.status, "unavailable");
  assert.equal(performance.journeys[0]?.costUsd, null);
  assert.equal(performance.journeys[0]?.costStatus, "unavailable");
});

test("AC3: no prompt, reply or key text is written to the result or report files (ADR 0075)", async () => {
  const inner = {
    generate: async () => ({ text: SYNTHETIC_REPLY, usage: { promptTokens: 12, completionTokens: 6 } }),
  };
  const accumulator = new TurnUsageAccumulator();
  const observed = observeModelClient(inner, accumulator);
  await observed.generate({ systemInstruction: SYNTHETIC_PROMPT, tools: [], history: [{ role: "user", text: SYNTHETIC_PROMPT }] });
  const snapshot = accumulator.snapshot();
  assert.equal(snapshot.modelCalls, 1);
  assert.equal(snapshot.promptTokens, 12);

  const performance = buildPerformanceReport({
    journeys: [{ journey: 1, turns: [turn("discovery", 400, snapshot.promptTokens, snapshot.completionTokens, snapshot.modelCalls)] }],
    slug: SLUG,
    price: PRICE,
  });
  const result = buildSmokeResult({
    provider: "openrouter",
    model: SLUG,
    result: "PASS",
    liveRun: false,
    credentialConfigured: true,
    configuredJourneyCount: 1,
    journeysActuallyAttempted: 1,
    totalReservedRequests: 1,
    totalProviderRequests: 1,
    controlOutcomeCounts: zeroControlOutcomes(),
    evaluationMetrics: { guardFailures: 0, falseRefusals: 0, taskCompletions: 1, prohibitedEffects: 0 },
    providerReservationsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 1 }],
    providerRequestsPerTurn: [{ journey: 1, turn: "discovery", providerRequests: 1 }],
    providerRequestBudget: { perJourney: 10, total: 10 },
    providerRequestBudgetExceeded: false,
    rateLimitOccurred: false,
    providerStopClassification: null,
    scenarios: [scenario("run 1 discovery")],
    note: "All semantic assertions passed.",
    performance,
    generatedAt: "2026-10-22T00:00:00.000Z",
  });
  const directory = await mkdtemp(join(tmpdir(), "smoke-privacy-"));
  try {
    await writeSmokeArtifacts(directory, result);
    const json = await readFile(join(directory, "agent-smoke-result.json"), "utf8");
    const markdown = await readFile(join(directory, "agent-smoke-report.md"), "utf8");
    for (const written of [json, markdown]) {
      assert.doesNotMatch(written, new RegExp(SYNTHETIC_PROMPT));
      assert.doesNotMatch(written, new RegExp(SYNTHETIC_REPLY));
      assert.doesNotMatch(written, new RegExp(SYNTHETIC_KEY));
    }
    assert.match(renderSmokeMarkdown(result), /No prompts, model prose, or credentials are recorded/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC3: observation preserves guarded adapter capability, continuation projection, and per-call usage ownership", async () => {
  let resolveResponse: ((response: { readonly text: string; readonly usage: { readonly promptTokens: number; readonly completionTokens: number } }) => void) | undefined;
  const inner = {
    supportsProviderAttemptReservation: true as const,
    generate: async () => new Promise<{ readonly text: string; readonly usage: { readonly promptTokens: number; readonly completionTokens: number } }>((resolve) => { resolveResponse = resolve; }),
    projectProviderContinuation: () => ({ validated: true }),
  };
  const firstTurn = new TurnUsageAccumulator();
  const secondTurn = new TurnUsageAccumulator();
  let currentTurn = firstTurn;
  const observed = observeModelClient(inner, {
    record: () => assert.fail("capture should assign each model call to its starting turn"),
    capture: () => currentTurn,
  });
  const pending = observed.generate({ systemInstruction: "test", tools: [], history: [] });
  assert.deepEqual(firstTurn.snapshot(), { modelCalls: 1, promptTokens: null, completionTokens: null }, "An outstanding provider call cannot report complete zero usage");
  currentTurn = secondTurn;
  resolveResponse?.({ text: "safe", usage: { promptTokens: 7, completionTokens: 2 } });
  await pending;

  assert.equal(observed.supportsProviderAttemptReservation, true);
  assert.deepEqual(observed.projectProviderContinuation?.({ rawStep: {} }, []), { validated: true });
  assert.deepEqual(firstTurn.snapshot(), { modelCalls: 1, promptTokens: 7, completionTokens: 2 });
  assert.deepEqual(secondTurn.snapshot(), { modelCalls: 0, promptTokens: 0, completionTokens: 0 });
});

test("AC4 guard: the benchmark document is refused unless the result file holds real live results", () => {
  const offline = buildSmokeResult({
    provider: "Google Gemini",
    model: "gemini-3.8-flash",
    result: "NOT_RUN",
    liveRun: false,
    credentialConfigured: false,
    configuredJourneyCount: 3,
    journeysActuallyAttempted: 0,
    totalReservedRequests: 0,
    totalProviderRequests: 0,
    controlOutcomeCounts: zeroControlOutcomes(),
    evaluationMetrics: { guardFailures: 0, falseRefusals: 0, taskCompletions: 0, prohibitedEffects: 0 },
    providerReservationsPerTurn: [],
    providerRequestsPerTurn: [],
    providerRequestBudget: { perJourney: 10, total: 30 },
    providerRequestBudgetExceeded: false,
    rateLimitOccurred: false,
    providerStopClassification: null,
    scenarios: [],
    note: "Live-agent smoke not run — credentials unavailable",
    generatedAt: "2026-10-22T00:00:00.000Z",
  });
  assert.match(validateLiveBenchmarkResult(offline) ?? "", /not a live run/);
  assert.throws(() => renderBenchmarkDocument(offline));
});

test("A scope timeout before provider completion reports one pending call and unavailable usage", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:" });
  const usage = new TurnUsageAccumulator();
  let resolveResponse: ((response: { usage: { promptTokens: number; completionTokens: number } }) => void) | undefined;
  const observed = observeModelClient({ generate: async () => new Promise<{ usage: { promptTokens: number; completionTokens: number } }>((resolve) => { resolveResponse = resolve; }) }, usage);
  const runtime = new AssistantRuntime(environment, observed, { scopeTimeoutMs: 10, scopeClassifier: {
    assess: async () => { await observed.generate({ systemInstruction: "synthetic", tools: [], history: [] }); return undefined; },
  } });
  try {
    assert.equal((await runtime.handleTurn("pending-timeout", "Hello")).ok, true);
    assert.deepEqual(usage.snapshot(), { modelCalls: 1, promptTokens: null, completionTokens: null });
    resolveResponse?.({ usage: { promptTokens: 7, completionTokens: 2 } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(usage.snapshot(), { modelCalls: 1, promptTokens: 7, completionTokens: 2 });
  } finally { environment.close(); }
});
