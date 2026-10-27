import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";

/** A fake monotonic clock for the classifier budget tests (design 14: fake clock). Advanced only by scripted steps. */
export class FakeClock {
  #now = 0;
  now(): number { return this.#now; }
  advance(ms: number): void { this.#now += ms; }
}

/**
 * One scripted classifier attempt. `response` is returned after the attempt reserves capacity, `error` is thrown after it,
 * and `hang` never settles. `advanceMs` moves the fake clock before the attempt returns.
 */
export type ScriptedClassifierStep =
  | { readonly response: Partial<AssistantModelResponse>; readonly advanceMs?: number }
  | { readonly error: unknown; readonly advanceMs?: number }
  | { readonly hang: true };

export interface ScriptedClassifierOptions {
  readonly clock?: FakeClock;
  /** Planner (non-classifier) replies. Defaults to a valid, empty clarification. */
  readonly planner?: (request: AssistantModelRequest) => Partial<AssistantModelResponse>;
}

/** A valid in-scope verdict. Tests build bad responses by appending text to it or changing one field. */
export const VALID_CLASSIFIER_TEXT = JSON.stringify({
  scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
  slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null },
});

/** Parses as JSON only after the first object: the scanner reports invalid_json_trailing_text (ADR 0106 eligible). */
export const TRAILING_TEXT_CLASSIFIER_TEXT = `${VALID_CLASSIFIER_TEXT} then {"note": 1}`;

/** Two complete objects: the scanner reports invalid_json_multiple_values (ADR 0106 eligible). */
export const MULTIPLE_VALUES_CLASSIFIER_TEXT = `${VALID_CLASSIFIER_TEXT}${VALID_CLASSIFIER_TEXT}`;

/**
 * A scripted classifier model. It implements the attempt-aware contract: a classifier attempt calls
 * `beforeProviderAttempt` before it counts as transported, as the real adapter does, so a quota guard in front of it reserves each attempt.
 * Planner calls (no `concierge_scope` schema) are counted separately so a test can prove a turn never reached the planner.
 */
export class ScriptedClassifierModel implements AssistantModelClient {
  readonly supportsProviderAttemptReservation = true as const;
  /** Every classifier request, in order. The retry must be identical to the first (design 6). */
  readonly classifierRequests: AssistantModelRequest[] = [];
  /** Classifier attempts that reached transport (after the reservation hook). */
  transports = 0;
  plannerCalls = 0;
  readonly #steps: ScriptedClassifierStep[];
  readonly #options: ScriptedClassifierOptions;

  constructor(steps: readonly ScriptedClassifierStep[], options: ScriptedClassifierOptions = {}) {
    this.#steps = [...steps];
    this.#options = options;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    if (request.structuredOutput?.name !== "concierge_scope") {
      this.plannerCalls++;
      return { text: "{}", ...(this.#options.planner?.(request) ?? { text: JSON.stringify({ kind: "clarify_stay", references: [] }) }) };
    }
    this.classifierRequests.push(request);
    const step = this.#steps.shift();
    if (!step) throw new Error("ScriptedClassifierModel has no scripted step left");
    await request.beforeProviderAttempt?.();
    this.transports++;
    if ("hang" in step) return new Promise<never>(() => undefined);
    if (step.advanceMs !== undefined) this.#options.clock?.advance(step.advanceMs);
    if ("error" in step) throw step.error;
    return { finishReason: "stop", ...step.response };
  }
}

/** The fields that must match between the first and the retried classifier request (design 6, ADR 0106 amendment). */
export function classifierRequestShape(request: AssistantModelRequest): string {
  return JSON.stringify({ systemInstruction: request.systemInstruction, history: request.history, tools: request.tools,
    structuredOutput: request.structuredOutput, maxOutputTokens: request.maxOutputTokens, reasoningEffort: request.reasoningEffort });
}

/** An in-memory quota port that allows or refuses each reservation in order, and counts every call. */
export class ScriptedQuotaPort {
  readonly reservations: boolean[] = [];
  readonly refunds: number[] = [];
  readonly #decisions: boolean[];
  constructor(decisions: readonly boolean[]) { this.#decisions = [...decisions]; }
  async reserve(): Promise<{ readonly reserved: true } | { readonly reserved: false; readonly reason: "guest_hour_limit" }> {
    const allowed = this.#decisions.shift() ?? true;
    this.reservations.push(allowed);
    return allowed ? { reserved: true } : { reserved: false, reason: "guest_hour_limit" };
  }
}
