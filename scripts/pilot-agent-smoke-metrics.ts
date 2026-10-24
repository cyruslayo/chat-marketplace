import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";

/** Public OpenRouter catalogue; it reports per-token USD prices for each model slug. */
export const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const PRICE_FETCH_TIMEOUT_MS = 10_000;

export interface ModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface ModelPrice {
  readonly promptUsdPerToken: number;
  readonly completionUsdPerToken: number;
}

export interface TurnUsageSnapshot {
  readonly modelCalls: number;
  /** Null when any model call in the turn returned no valid usage. Never zero for missing usage. */
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

/** Sums provider-reported usage for one turn. A single call without usage makes the turn unavailable. */
export class TurnUsageAccumulator {
  #modelCalls = 0;
  #reportedCalls = 0;
  #promptTokens = 0;
  #completionTokens = 0;
  #pendingCalls = 0;

  record(usage: ModelUsage | undefined): void {
    this.startCall()(usage);
  }

  startCall(): (usage: ModelUsage | undefined) => void {
    this.#modelCalls++;
    this.#pendingCalls++;
    let completed = false;
    return (usage) => {
      if (completed) return;
      completed = true;
      this.#pendingCalls--;
      if (usage === undefined) return;
      this.#reportedCalls++;
      this.#promptTokens += usage.promptTokens;
      this.#completionTokens += usage.completionTokens;
    };
  }

  snapshot(): TurnUsageSnapshot {
    const complete = this.#pendingCalls === 0 && this.#reportedCalls === this.#modelCalls;
    return {
      modelCalls: this.#modelCalls,
      promptTokens: complete ? this.#promptTokens : null,
      completionTokens: complete ? this.#completionTokens : null,
    };
  }
}

/** Counts every model call (including failed ones) and forwards the response unchanged. */
export function observeModelClient(
  client: AssistantModelClient,
  recorder: {
    record(usage: ModelUsage | undefined): void;
    startCall?(): (usage: ModelUsage | undefined) => void;
    capture?(): { record(usage: ModelUsage | undefined): void; startCall?(): (usage: ModelUsage | undefined) => void } | null;
  },
): AssistantModelClient {
  return {
    ...(client.supportsProviderAttemptReservation === true ? { supportsProviderAttemptReservation: true as const } : {}),
    async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
      // Capture the active turn once; a late response cannot read a later turn's mutable pointer.
      const callRecorder = recorder.capture ? recorder.capture() : recorder;
      const complete = callRecorder?.startCall?.() ?? ((usage: ModelUsage | undefined) => callRecorder?.record(usage));
      let response: AssistantModelResponse;
      try {
        response = await client.generate(request);
      } catch (error) {
        complete(undefined);
        throw error;
      }
      complete(response.usage);
      return response;
    },
    projectProviderContinuation(response, acceptedCalls) {
      return client.projectProviderContinuation?.(response, acceptedCalls);
    },
  };
}

/** Nearest-rank percentile; returns null when there are no samples. */
export function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length, Math.max(1, Math.ceil((rank / 100) * sorted.length)));
  return sorted[index - 1] ?? null;
}

export function estimateCostUsd(usage: ModelUsage, price: ModelPrice): number {
  return usage.promptTokens * price.promptUsdPerToken + usage.completionTokens * price.completionUsdPerToken;
}

export function parseOpenRouterModelPrice(payload: unknown, slug: string): ModelPrice | null {
  if (typeof payload !== "object" || payload === null || !("data" in payload) || !Array.isArray(payload.data)) return null;
  const entry: unknown = payload.data.find((candidate: unknown) => typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === slug);
  if (typeof entry !== "object" || entry === null || !("pricing" in entry)) return null;
  const pricing: unknown = entry.pricing;
  if (typeof pricing !== "object" || pricing === null || !("prompt" in pricing) || !("completion" in pricing)) return null;
  const promptUsdPerToken = parsePerTokenPrice(pricing.prompt);
  const completionUsdPerToken = parsePerTokenPrice(pricing.completion);
  if (promptUsdPerToken === null || completionUsdPerToken === null) return null;
  return { promptUsdPerToken, completionUsdPerToken };
}

function parsePerTokenPrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export interface PriceFetchResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

/**
 * Reads the per-token price for a slug from the OpenRouter models endpoint at run time.
 * Any failure resolves to null so the caller marks cost unavailable. No credential is sent.
 */
export function createOpenRouterPriceFetcher(options: {
  readonly fetch: (url: string, init?: { readonly signal?: AbortSignal }) => Promise<PriceFetchResponse>;
  readonly endpoint?: string;
}): (slug: string) => Promise<ModelPrice | null> {
  const endpoint = options.endpoint ?? OPENROUTER_MODELS_ENDPOINT;
  return async (slug: string) => {
    try {
      const response = await options.fetch(endpoint, { signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS) });
      if (!response.ok) return null;
      return parseOpenRouterModelPrice(await response.json(), slug);
    } catch {
      return null;
    }
  };
}

export interface LatencySummary {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly samples: number;
}

export interface TurnPerformance {
  readonly turn: string;
  readonly latencyMs: number;
  readonly modelCalls: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly tokenUsage: "reported" | "unavailable";
}

export interface JourneyPerformance {
  readonly journey: number;
  readonly latencyMs: number;
  readonly modelCalls: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly tokenUsage: "reported" | "unavailable";
  readonly costUsd: number | null;
  readonly costStatus: "estimated" | "unavailable";
  readonly turns: readonly TurnPerformance[];
}

export type PricingStatus =
  | { readonly status: "reported"; readonly source: "openrouter-models"; readonly slug: string; readonly promptUsdPerToken: number; readonly completionUsdPerToken: number }
  | { readonly status: "unavailable"; readonly slug: string; readonly reason: string };

export interface PerformanceReport {
  readonly latency: {
    readonly turnP50Ms: number | null;
    readonly turnP95Ms: number | null;
    readonly journeyP50Ms: number | null;
    readonly journeyP95Ms: number | null;
    readonly turnSamples: number;
    readonly journeySamples: number;
  } | null;
  readonly pricing: PricingStatus;
  readonly journeys: readonly JourneyPerformance[];
}

export function summarizeLatency(values: readonly number[]): LatencySummary | null {
  const p50Ms = percentile(values, 50);
  const p95Ms = percentile(values, 95);
  if (p50Ms === null || p95Ms === null) return null;
  return { p50Ms, p95Ms, samples: values.length };
}

export function buildPerformanceReport(input: {
  readonly journeys: readonly { readonly journey: number; readonly turns: readonly TurnPerformance[] }[];
  readonly slug: string;
  readonly price: ModelPrice | null;
}): PerformanceReport {
  const pricing: PricingStatus = input.price
    ? { status: "reported", source: "openrouter-models", slug: input.slug, promptUsdPerToken: input.price.promptUsdPerToken, completionUsdPerToken: input.price.completionUsdPerToken }
    : { status: "unavailable", slug: input.slug, reason: "No OpenRouter per-token price for this slug; cost is not estimated." };
  const journeys: JourneyPerformance[] = input.journeys.map(({ journey, turns }) => {
    const latencyMs = turns.reduce((total, current) => total + current.latencyMs, 0);
    const modelCalls = turns.reduce((total, current) => total + current.modelCalls, 0);
    const complete = turns.every((current) => current.promptTokens !== null && current.completionTokens !== null);
    const promptTokens = complete ? turns.reduce((total, current) => total + (current.promptTokens ?? 0), 0) : null;
    const completionTokens = complete ? turns.reduce((total, current) => total + (current.completionTokens ?? 0), 0) : null;
    const costUsd = input.price && promptTokens !== null && completionTokens !== null
      ? estimateCostUsd({ promptTokens, completionTokens }, input.price)
      : null;
    return {
      journey,
      latencyMs,
      modelCalls,
      promptTokens,
      completionTokens,
      tokenUsage: complete ? "reported" : "unavailable",
      costUsd,
      costStatus: costUsd === null ? "unavailable" : "estimated",
      turns,
    };
  });
  const turnLatencies = input.journeys.flatMap((journey) => journey.turns.map((current) => current.latencyMs));
  const turnSummary = summarizeLatency(turnLatencies);
  const journeySummary = summarizeLatency(journeys.map((journey) => journey.latencyMs));
  return {
    latency: turnSummary && journeySummary
      ? {
        turnP50Ms: turnSummary.p50Ms,
        turnP95Ms: turnSummary.p95Ms,
        journeyP50Ms: journeySummary.p50Ms,
        journeyP95Ms: journeySummary.p95Ms,
        turnSamples: turnSummary.samples,
        journeySamples: journeySummary.samples,
      }
      : null,
    pricing,
    journeys,
  };
}
