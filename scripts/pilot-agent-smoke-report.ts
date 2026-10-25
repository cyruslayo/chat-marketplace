import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PerformanceReport, JourneyPerformance } from "./pilot-agent-smoke-metrics.js";
import { MAX_PILOT_AGENT_SMOKE_RUNS } from "./pilot-agent-smoke-budget.js";
import { SMOKE_GRADING_PROFILE } from "./pilot-agent-smoke-grading.js";
import { ASSISTANT_CONTROL_OUTCOMES, type AssistantControlOutcome } from "../apps/local-guest/src/assistant/assistant-runtime.js";

export interface SmokeScenarioReport {
  readonly scenario: string;
  readonly selectedApplicationOperation: string | null;
  readonly surfaceSelected: string | null;
  readonly authoritativeEntities: readonly string[];
  readonly semanticResult: "PASS" | "FAIL" | "NOT_RUN";
  readonly failureClassification?: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | "PROVIDER_TRANSPORT_FAILURE" | "MODEL_SELECTION_FAILURE" | "INVALID_TOOL_FOR_STATE" | "APPLICATION_OPERATION_FAILURE" | "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE" | "FABRICATION_FAILURE" | "AUTHORITY_FAILURE" | "QUOTA_REFUSED";
  readonly note?: string;
  /** Number of prohibited state transitions observed for this scenario. */
  readonly prohibitedEffects?: number;
  readonly falseRefusal?: boolean;
}

export interface SmokeEvaluationMetrics {
  readonly guardFailures: number;
  readonly falseRefusals: number;
  readonly taskCompletions: number;
  readonly prohibitedEffects: number;
}

export interface SmokeResult {
  /** Absent on historical runs; they cannot establish a verdict under a newer grader. */
  readonly gradingProfile?: string;
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly result: "NOT_RUN" | "PASS" | "FAIL";
  /** True only when the run called a real provider. Gates the benchmark document. */
  readonly liveRun: boolean;
  readonly credentialConfigured: boolean;
  readonly configuredJourneyCount: number;
  readonly journeysActuallyAttempted: number;
  /** Capacity claimed from the smoke budget before provider transports. */
  readonly totalReservedRequests: number;
  readonly totalProviderRequests: number;
  readonly controlOutcomeCounts: Readonly<Record<AssistantControlOutcome, number>>;
  readonly evaluationMetrics: SmokeEvaluationMetrics;
  readonly providerReservationsPerTurn: readonly { readonly journey: number; readonly turn: string; readonly providerRequests: number }[];
  readonly providerRequestsPerTurn: readonly { readonly journey: number; readonly turn: string; readonly providerRequests: number }[];
  readonly providerRequestBudget: { readonly perJourney: number; readonly total: number };
  readonly providerRequestBudgetExceeded: boolean;
  readonly rateLimitOccurred: boolean;
  readonly providerStopClassification: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | null;
  readonly scenarios: readonly SmokeScenarioReport[];
  readonly note: string;
  /** Optional: absent on older results; providers without usage yield "unavailable" fields, never zero. */
  readonly performance?: PerformanceReport;
}

export const SMOKE_RESULT_FILE = "agent-smoke-result.json";
export const SMOKE_REPORT_FILE = "agent-smoke-report.md";
export const BENCHMARK_DOCUMENT_PATH = "docs/testing/openrouter-gpt6-luna-benchmark.md";
const REQUIRED_LIVE_JOURNEYS = 3;
const SCENARIO_NAMES = ["discovery", "refinement", "unit inspection", "booking intent"] as const;

export function buildSmokeResult(input: SmokeResult): SmokeResult {
  return { ...input };
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function journeyLine(journey: JourneyPerformance): string {
  const tokens = journey.tokenUsage === "reported"
    ? `Token usage: prompt ${journey.promptTokens}, completion ${journey.completionTokens}`
    : "Token usage: unavailable";
  const cost = journey.costStatus === "estimated" && journey.costUsd !== null
    ? `Cost: ${formatUsd(journey.costUsd)} (estimated from OpenRouter price)`
    : "Cost: unavailable";
  return `- Journey ${journey.journey}: latency ${journey.latencyMs} ms; model calls ${journey.modelCalls}; ${tokens}; ${cost}`;
}

function performanceLines(performance: PerformanceReport): string[] {
  const latency = performance.latency
    ? `- Latency: turn p50 ${performance.latency.turnP50Ms} ms, p95 ${performance.latency.turnP95Ms} ms (${performance.latency.turnSamples} turns); journey p50 ${performance.latency.journeyP50Ms} ms, p95 ${performance.latency.journeyP95Ms} ms (${performance.latency.journeySamples} journeys)`
    : "- Latency: unavailable (no turns recorded)";
  const pricing = performance.pricing.status === "reported"
    ? `- Pricing: OpenRouter-reported per-token price for ${performance.pricing.slug} (prompt ${performance.pricing.promptUsdPerToken}, completion ${performance.pricing.completionUsdPerToken} USD)`
    : `- Pricing: unavailable for ${performance.pricing.slug} (${performance.pricing.reason})`;
  return [
    "## Performance",
    "",
    latency,
    pricing,
    ...performance.journeys.map(journeyLine),
    "",
  ];
}

export function renderSmokeMarkdown(result: SmokeResult): string {
  const lines = [
    "# Local pilot live-agent smoke",
    "",
    `- Provider: ${result.provider}`,
    `- Model: ${result.model}`,
    `- Result: ${result.result}`,
    `- Live run: ${result.liveRun}`,
    `- Credential configured: ${result.credentialConfigured}`,
    `- Configured journeys: ${result.configuredJourneyCount}`,
    `- Journeys actually attempted: ${result.journeysActuallyAttempted}`,
    `- Reserved provider-request capacity: ${result.totalReservedRequests}`,
    `- Actual provider transport starts: ${result.totalProviderRequests}`,
    `- Reserved capacity per turn: ${result.providerReservationsPerTurn.map((usage) => `journey ${usage.journey} ${usage.turn}=${usage.providerRequests}`).join(", ") || "none"}`,
    `- Transport starts per turn: ${result.providerRequestsPerTurn.map((usage) => `journey ${usage.journey} ${usage.turn}=${usage.providerRequests}`).join(", ") || "none"}`,
    `- Provider request budget: ${result.providerRequestBudget.total} total (${result.providerRequestBudget.perJourney} per journey)`,
    `- Provider request budget exceeded: ${result.providerRequestBudgetExceeded}`,
    `- HTTP 429 occurred: ${result.rateLimitOccurred}`,
    `- Provider stop classification: ${result.providerStopClassification ?? "none"}`,
    `- Guard failures: ${result.evaluationMetrics.guardFailures}`,
    `- False refusals: ${result.evaluationMetrics.falseRefusals}`,
    `- Completed tasks: ${result.evaluationMetrics.taskCompletions}`,
    `- Prohibited effects: ${result.evaluationMetrics.prohibitedEffects}`,
    `- Control outcomes: ${ASSISTANT_CONTROL_OUTCOMES.map((outcome) => `${outcome}=${result.controlOutcomeCounts[outcome]}`).join(", ")}`,
    `- Note: ${result.note}`,
    "",
    "| Scenario | Operation | Surface | Authoritative entities | Result | Classification |",
    "|---|---|---|---|---|---|",
    ...result.scenarios.map((entry) => `| ${entry.scenario} | ${entry.selectedApplicationOperation ?? "—"} | ${entry.surfaceSelected ?? "—"} | ${entry.authoritativeEntities.join(", ") || "—"} | ${entry.semanticResult} | ${entry.failureClassification ?? "—"} |`),
    "",
    ...(result.performance ? performanceLines(result.performance) : []),
    "No prompts, model prose, or credentials are recorded in this report.",
    "",
  ];
  return lines.join("\n");
}

export async function writeSmokeArtifacts(directory: string, result: SmokeResult): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, SMOKE_RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(join(directory, SMOKE_REPORT_FILE), renderSmokeMarkdown(result), "utf8");
}

/** Returns the reason a parsed result file cannot back the benchmark document, or null when it can. */
export function validateLiveBenchmarkResult(value: unknown): string | null {
  if (!isRecord(value)) return "result file is not an object";
  const candidate = value as Partial<SmokeResult>;
  if (candidate.liveRun !== true) return "result is not a live run";
  if (candidate.gradingProfile !== SMOKE_GRADING_PROFILE) return "result uses an absent or unsupported grading profile";
  if (candidate.credentialConfigured !== true) return "result has no configured provider credential";
  if (candidate.result !== "PASS" && candidate.result !== "FAIL") return "result has no live verdict";
  if (!positiveInteger(candidate.configuredJourneyCount) || candidate.configuredJourneyCount > MAX_PILOT_AGENT_SMOKE_RUNS) return "configured journey count is invalid";
  if (!positiveInteger(candidate.journeysActuallyAttempted) || candidate.journeysActuallyAttempted > candidate.configuredJourneyCount) return "attempted journey count is invalid";
  if (typeof candidate.generatedAt !== "string" || !Number.isFinite(Date.parse(candidate.generatedAt))) return "result date is invalid";
  if (typeof candidate.provider !== "string" || !candidate.provider.trim() || typeof candidate.model !== "string" || !candidate.model.trim()) return "provider or model is missing";
  if (!Array.isArray(candidate.scenarios)) return "result has no scenarios";
  if (!isRecord(candidate.controlOutcomeCounts) || ASSISTANT_CONTROL_OUTCOMES.some((outcome) => !nonNegativeInteger(candidate.controlOutcomeCounts?.[outcome]))) return "control outcome counts are invalid";
  if (Object.keys(candidate.controlOutcomeCounts).some((outcome) => !ASSISTANT_CONTROL_OUTCOMES.includes(outcome as AssistantControlOutcome))) return "control outcome counts contain unknown values";
  if (!isRecord(candidate.evaluationMetrics)
    || !nonNegativeInteger(candidate.evaluationMetrics.guardFailures)
    || !nonNegativeInteger(candidate.evaluationMetrics.falseRefusals)
    || !nonNegativeInteger(candidate.evaluationMetrics.taskCompletions)
    || !nonNegativeInteger(candidate.evaluationMetrics.prohibitedEffects)) return "evaluation metrics are invalid";
  const count = candidate.journeysActuallyAttempted;
  if (candidate.scenarios.length !== count * SCENARIO_NAMES.length) return "result does not contain four stages per attempted journey";
  const stages = new Map<string, SmokeScenarioReport["semanticResult"]>();
  for (const entry of candidate.scenarios) {
    if (!isRecord(entry) || typeof entry.scenario !== "string") return "scenario entry is invalid";
    const match = /^run (\d+) (.+)$/i.exec(entry.scenario);
    const key = match ? stageKey(Number(match[1]), match[2], count) : null;
    if (!key || stages.has(key)) return "scenario stage is unknown or duplicated";
    if (entry.semanticResult !== "PASS" && entry.semanticResult !== "FAIL" && entry.semanticResult !== "NOT_RUN") return "scenario verdict is invalid";
    if (entry.prohibitedEffects !== undefined && !nonNegativeInteger(entry.prohibitedEffects)) return "scenario prohibited-effect count is invalid";
    if (entry.falseRefusal !== undefined && typeof entry.falseRefusal !== "boolean") return "scenario refusal flag is invalid";
    if (entry.semanticResult === "PASS" && (entry.falseRefusal === true || Number(entry.prohibitedEffects ?? 0) > 0)) return "passing stage has a refusal or prohibited effect";
    if (entry.semanticResult === "PASS" && entry.failureClassification !== undefined) return "passing stage has a failure classification";
    if (entry.semanticResult === "FAIL" && (typeof entry.failureClassification !== "string" || !FAILURE_CLASSES.has(entry.failureClassification))) return "failed stage lacks a valid failure classification";
    stages.set(key, entry.semanticResult);
  }
  const hasNonPassingStage = [...stages.values()].some((status) => status !== "PASS");
  if ((candidate.result === "PASS" && hasNonPassingStage) || (candidate.result === "FAIL" && !hasNonPassingStage)) return "overall verdict contradicts stage results";
  if (typeof candidate.providerRequestBudgetExceeded !== "boolean" || typeof candidate.rateLimitOccurred !== "boolean") return "provider flags are invalid";
  if (candidate.providerStopClassification !== null && candidate.providerStopClassification !== "PROVIDER_RATE_LIMITED" && candidate.providerStopClassification !== "PROVIDER_REQUEST_BUDGET_EXCEEDED") return "provider stop classification is invalid";
  if (candidate.result === "PASS" && (candidate.providerRequestBudgetExceeded || candidate.rateLimitOccurred || candidate.providerStopClassification !== null)) return "passing run has a provider failure flag";
  const scenarioMetrics = candidate.scenarios as readonly SmokeScenarioReport[];
  if (candidate.evaluationMetrics.taskCompletions !== scenarioMetrics.filter((entry) => entry.semanticResult === "PASS").length) return "task completion count contradicts scenario results";
  if (candidate.evaluationMetrics.falseRefusals !== scenarioMetrics.filter((entry) => entry.falseRefusal === true).length) return "false refusal count contradicts scenario results";
  if (candidate.evaluationMetrics.prohibitedEffects !== scenarioMetrics.reduce((sum, entry) => sum + (entry.prohibitedEffects ?? 0), 0)) return "prohibited-effect count contradicts scenario results";
  if (candidate.evaluationMetrics.guardFailures !== (candidate.controlOutcomeCounts.guard_failure + candidate.controlOutcomeCounts.quota_refusal)) return "guard failure count contradicts control outcomes";
  if (!nonNegativeInteger(candidate.totalReservedRequests) || !nonNegativeInteger(candidate.totalProviderRequests)) return "provider request counts are invalid";
  const budget = candidate.providerRequestBudget;
  if (!isRecord(budget) || !positiveInteger(budget.perJourney) || budget.total !== budget.perJourney * candidate.configuredJourneyCount || candidate.totalReservedRequests > budget.total || candidate.totalProviderRequests > candidate.totalReservedRequests) return "provider request budget is inconsistent";
  if (!Array.isArray(candidate.providerReservationsPerTurn) || candidate.providerReservationsPerTurn.length !== stages.size) return "provider reservation stages are incomplete";
  if (!Array.isArray(candidate.providerRequestsPerTurn) || candidate.providerRequestsPerTurn.length !== stages.size) return "provider request stages are incomplete";
  const reservations = new Map<string, number>();
  for (const turn of candidate.providerReservationsPerTurn) {
    if (!isRecord(turn)) return "provider reservation entry is invalid";
    const key = stageKey(turn.journey, turn.turn, count);
    if (!key || reservations.has(key) || !nonNegativeInteger(turn.providerRequests)) return "provider reservation stage is invalid or duplicated";
    if (stages.get(key) === "PASS" && turn.providerRequests === 0) return "passing stage has no provider reservation";
    if (stages.get(key) === "NOT_RUN" && turn.providerRequests !== 0) return "unrun stage has provider reservations";
    reservations.set(key, turn.providerRequests);
  }
  const requests = new Map<string, number>();
  for (const turn of candidate.providerRequestsPerTurn) {
    if (!isRecord(turn)) return "provider request entry is invalid";
    const key = stageKey(turn.journey, turn.turn, count);
    if (!key || requests.has(key) || !nonNegativeInteger(turn.providerRequests)) return "provider request stage is invalid or duplicated";
    if (stages.get(key) === "PASS" && turn.providerRequests === 0) return "passing stage has no provider transport start";
    if (stages.get(key) === "NOT_RUN" && turn.providerRequests !== 0) return "unrun stage has provider requests";
    if (turn.providerRequests > (reservations.get(key) ?? 0)) return "provider transports exceed reserved capacity";
    requests.set(key, turn.providerRequests);
  }
  if ([...requests.values()].reduce((sum, requests) => sum + requests, 0) !== candidate.totalProviderRequests) return "provider request total contradicts per-turn counts";
  if ([...reservations.values()].reduce((sum, requests) => sum + requests, 0) !== candidate.totalReservedRequests) return "reserved request total contradicts per-turn counts";
  for (let journey = 1; journey <= count; journey++) {
    const journeyReservations = SCENARIO_NAMES.reduce((sum, stage) => sum + (reservations.get(`${journey}:${stage}`) ?? 0), 0);
    if (journeyReservations > budget.perJourney) return "journey exceeds its provider request budget";
  }
  if (!isRecord(candidate.performance) || !Array.isArray(candidate.performance.journeys) || candidate.performance.journeys.length !== count) return "performance journeys are incomplete";
  const pricing = candidate.performance.pricing;
  if (!isRecord(pricing) || pricing.slug !== candidate.model) return "pricing identity is invalid";
  if (pricing.status === "reported") {
    if (pricing.source !== "openrouter-models" || !nonNegativeNumber(pricing.promptUsdPerToken) || !nonNegativeNumber(pricing.completionUsdPerToken)) return "reported pricing is invalid";
  } else if (pricing.status !== "unavailable" || typeof pricing.reason !== "string") return "pricing status is invalid";
  const performanceStages = new Set<string>();
  const performanceJourneys = new Set<number>();
  for (const journey of candidate.performance.journeys) {
    if (!isRecord(journey) || !positiveInteger(journey.journey) || journey.journey > count || performanceJourneys.has(journey.journey) || !Array.isArray(journey.turns)) return "performance journey is invalid or duplicated";
    performanceJourneys.add(journey.journey);
    let latencyMs = 0;
    let modelCalls = 0;
    for (const turn of journey.turns) {
      if (!isRecord(turn)) return "performance turn is invalid";
      const key = stageKey(journey.journey, turn.turn, count);
      if (!key || performanceStages.has(key) || stages.get(key) === "NOT_RUN") return "performance stage is invalid or duplicated";
      if (typeof turn.latencyMs !== "number" || !Number.isFinite(turn.latencyMs) || turn.latencyMs < 0 || !positiveInteger(turn.modelCalls)) return "performance timing or model-call count is invalid";
      if (turn.tokenUsage === "reported") {
        if (!nonNegativeInteger(turn.promptTokens) || !nonNegativeInteger(turn.completionTokens)) return "reported token usage is invalid";
      } else if (turn.tokenUsage !== "unavailable" || turn.promptTokens !== null || turn.completionTokens !== null) return "missing token usage is not marked unavailable";
      if (candidate.result === "PASS" && turn.modelCalls > (requests.get(key) ?? 0)) return "model calls exceed provider requests";
      performanceStages.add(key);
      latencyMs += turn.latencyMs;
      modelCalls += turn.modelCalls;
    }
    if (journey.latencyMs !== latencyMs || journey.modelCalls !== modelCalls) return "journey totals contradict per-turn performance";
    const completeTokens = journey.turns.every((turn) => turn.tokenUsage === "reported");
    if (completeTokens) {
      if (journey.tokenUsage !== "reported" || journey.promptTokens !== journey.turns.reduce((sum, turn) => sum + (turn.promptTokens ?? 0), 0)
        || journey.completionTokens !== journey.turns.reduce((sum, turn) => sum + (turn.completionTokens ?? 0), 0)) return "journey token totals contradict per-turn usage";
    } else if (journey.tokenUsage !== "unavailable" || journey.promptTokens !== null || journey.completionTokens !== null) return "journey token usage is inconsistent";
    if (pricing.status === "reported" && completeTokens) {
      if (journey.costStatus !== "estimated" || !nonNegativeNumber(journey.costUsd)) return "estimated cost is invalid";
    } else if (journey.costStatus !== "unavailable" || journey.costUsd !== null) return "missing cost is not marked unavailable";
  }
  if ([...stages].some(([key, status]) => status !== "NOT_RUN" && !performanceStages.has(key))) return "performance stages are incomplete";
  const latency = candidate.performance.latency;
  if (!isRecord(latency) || latency.turnSamples !== performanceStages.size || latency.journeySamples !== count
    || ![latency.turnP50Ms, latency.turnP95Ms, latency.journeyP50Ms, latency.journeyP95Ms].every(nonNegativeNumber)) return "latency summary is invalid";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function stageKey(journey: unknown, stage: unknown, count: number): string | null {
  if (!positiveInteger(journey) || journey > count || typeof stage !== "string") return null;
  const normalized = stage.trim().toLowerCase();
  return SCENARIO_NAMES.some((name) => name === normalized) ? `${journey}:${normalized}` : null;
}

const FAILURE_CLASSES: ReadonlySet<string> = new Set([
  "PROVIDER_RATE_LIMITED", "PROVIDER_REQUEST_BUDGET_EXCEEDED", "PROVIDER_TRANSPORT_FAILURE", "MODEL_SELECTION_FAILURE",
  "INVALID_TOOL_FOR_STATE", "APPLICATION_OPERATION_FAILURE", "PROJECTION_FAILURE", "A2UI_FAILURE", "WEAVER_FAILURE", "FABRICATION_FAILURE", "AUTHORITY_FAILURE", "QUOTA_REFUSED",
]);

function dimensionName(scenario: string): string {
  return scenario.replace(/^run \d+ /, "").trim().toLowerCase();
}

export function renderBenchmarkDocument(value: unknown): string {
  const reason = validateLiveBenchmarkResult(value);
  if (reason !== null) throw new Error(`Benchmark document refused: ${reason}.`);
  const result = value as SmokeResult;
  const performance = result.performance as PerformanceReport;
  const failures = new Map<string, number>();
  for (const entry of result.scenarios) {
    if (entry.failureClassification) failures.set(entry.failureClassification, (failures.get(entry.failureClassification) ?? 0) + 1);
  }
  const fabricated = failures.has("FABRICATION_FAILURE");
  const semanticFailures = result.scenarios.some((entry) => entry.semanticResult === "FAIL");
  const notAllRun = result.journeysActuallyAttempted < result.configuredJourneyCount || result.scenarios.some((entry) => entry.semanticResult === "NOT_RUN");
  const verdict = fabricated
    ? "**NO-GO**: at least one journey failed price or booking-status verification (ADR 0080). Recorded, not tuned away."
    : semanticFailures
      ? "**NO-GO**: semantic assertions failed in at least one journey (ADR 0079 evidence)."
      : notAllRun || result.journeysActuallyAttempted < REQUIRED_LIVE_JOURNEYS
        ? "**INCOMPLETE**: fewer than the required live journeys ran; no go/no-go verdict is given."
        : "**GO** for the evaluated local discovery-to-draft journey, subject to the owner's review.";
  const passRows = SCENARIO_NAMES.map((name) => {
    const entries = result.scenarios.filter((entry) => dimensionName(entry.scenario) === name);
    const passed = entries.filter((entry) => entry.semanticResult === "PASS").length;
    return `| ${name} | ${passed} / ${entries.length} |`;
  });
  const journeyRows = performance.journeys.map((journey) => {
    const tokens = journey.tokenUsage === "reported" ? `${journey.promptTokens} / ${journey.completionTokens}` : "unavailable";
    const cost = journey.costStatus === "estimated" && journey.costUsd !== null ? formatUsd(journey.costUsd) : "unavailable";
    return `| ${journey.journey} | ${journey.latencyMs} | ${journey.modelCalls} | ${tokens} | ${cost} |`;
  });
  const latency = performance.latency
    ? `| Turn | ${performance.latency.turnP50Ms} | ${performance.latency.turnP95Ms} |\n| Journey | ${performance.latency.journeyP50Ms} | ${performance.latency.journeyP95Ms} |`
    : "| Turn | unavailable | unavailable |\n| Journey | unavailable | unavailable |";
  const failureRows = failures.size === 0
    ? ["No failures recorded."]
    : [...failures.entries()].map(([name, count]) => `- ${name}: ${count}`);
  const date = result.generatedAt.slice(0, 10);
  return [
    "# OpenRouter GPT-6 Luna benchmark",
    "",
    `- Date: ${date}`,
    `- Provider: ${result.provider}`,
    `- Model slug: ${result.model}`,
    `- Grading profile: ${result.gradingProfile}`,
    `- Live journeys: ${result.journeysActuallyAttempted} of ${result.configuredJourneyCount} configured (${REQUIRED_LIVE_JOURNEYS} required for the benchmark)`,
    `- Reserved provider-request capacity: ${result.totalReservedRequests}`,
    `- Actual provider transport starts: ${result.totalProviderRequests}`,
    `- Offline reference: run separately with --scripted; see issue 03 Comments for its result`,
    "",
    "## Pass rate per grading dimension",
    "",
    "| Dimension | Pass |",
    "|---|---|",
    ...passRows,
    "",
    "## Latency (ms)",
    "",
    "| Measure | p50 | p95 |",
    "|---|---|---|",
    latency,
    "",
    "## Per journey",
    "",
    "| Journey | Latency ms | Model calls | Prompt / completion tokens | Cost (USD) |",
    "|---|---|---|---|---|",
    ...journeyRows,
    "",
    `Pricing: ${performance.pricing.status === "reported" ? `OpenRouter-reported per-token price for ${performance.pricing.slug}, read at run time` : `unavailable (${performance.pricing.reason})`}.`,
    "",
    "## Failures by AssistantFailureClass",
    "",
    ...failureRows,
    "",
    "## Go/no-go",
    "",
    verdict,
    "",
  ].join("\n");
}

export async function writeBenchmarkDocumentFromResult(resultPath: string, documentPath: string): Promise<void> {
  const value: unknown = JSON.parse(await readFile(resultPath, "utf8"));
  const document = renderBenchmarkDocument(value);
  await mkdir(dirname(documentPath), { recursive: true });
  await writeFile(documentPath, `${document}\n`, "utf8");
}
