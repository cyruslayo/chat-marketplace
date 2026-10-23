import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PerformanceReport, JourneyPerformance } from "./pilot-agent-smoke-metrics.js";

export interface SmokeScenarioReport {
  readonly scenario: string;
  readonly selectedApplicationOperation: string | null;
  readonly surfaceSelected: string | null;
  readonly authoritativeEntities: readonly string[];
  readonly semanticResult: "PASS" | "FAIL" | "NOT_RUN";
  readonly failureClassification?: "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED" | "PROVIDER_TRANSPORT_FAILURE" | "MODEL_SELECTION_FAILURE" | "INVALID_TOOL_FOR_STATE" | "APPLICATION_OPERATION_FAILURE" | "PROJECTION_FAILURE" | "A2UI_FAILURE" | "WEAVER_FAILURE" | "FABRICATION_FAILURE" | "AUTHORITY_FAILURE";
  readonly note?: string;
}

export interface SmokeResult {
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly result: "NOT_RUN" | "PASS" | "FAIL";
  /** True only when the run called a real provider. Gates the benchmark document. */
  readonly liveRun: boolean;
  readonly credentialConfigured: boolean;
  readonly configuredJourneyCount: number;
  readonly journeysActuallyAttempted: number;
  readonly totalProviderRequests: number;
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
    `- Total provider requests: ${result.totalProviderRequests}`,
    `- Provider requests per turn: ${result.providerRequestsPerTurn.map((usage) => `journey ${usage.journey} ${usage.turn}=${usage.providerRequests}`).join(", ") || "none"}`,
    `- Provider request budget: ${result.providerRequestBudget.total} total (${result.providerRequestBudget.perJourney} per journey)`,
    `- Provider request budget exceeded: ${result.providerRequestBudgetExceeded}`,
    `- HTTP 429 occurred: ${result.rateLimitOccurred}`,
    `- Provider stop classification: ${result.providerStopClassification ?? "none"}`,
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
  if (typeof value !== "object" || value === null) return "result file is not an object";
  const candidate = value as Partial<SmokeResult>;
  if (candidate.liveRun !== true) return "result is not a live run";
  if (candidate.credentialConfigured !== true) return "result has no configured provider credential";
  if (candidate.result !== "PASS" && candidate.result !== "FAIL") return "result has no live verdict";
  if (typeof candidate.journeysActuallyAttempted !== "number" || candidate.journeysActuallyAttempted < 1) return "no journeys were attempted";
  if (!Array.isArray(candidate.scenarios)) return "result has no scenarios";
  if (!candidate.performance) return "result has no performance block";
  return null;
}

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
    ? "**NO-GO**: at least one journey fabricated a price or a booking claim (ADR 0080). Recorded, not tuned away."
    : semanticFailures
      ? "**NO-GO**: semantic assertions failed in at least one journey (ADR 0079 evidence)."
      : notAllRun || result.journeysActuallyAttempted < REQUIRED_LIVE_JOURNEYS
        ? "**INCOMPLETE**: fewer than the required live journeys ran; no go/no-go verdict is given."
        : "**GO** for the demo, subject to the owner's review of this table.";
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
    `- Live journeys: ${result.journeysActuallyAttempted} of ${result.configuredJourneyCount} configured (${REQUIRED_LIVE_JOURNEYS} required for the benchmark)`,
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
