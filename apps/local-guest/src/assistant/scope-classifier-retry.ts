import { ModelRequestGuardError, type AssistantFinishReason } from "./assistant-model.js";
import { ScopeClassificationError, type ScopeClassifier, type ScopeContext, type ScopeFailureReason } from "./scope-classifier.js";
import { SCOPE_CLASSIFIER_BUDGET_MS } from "../turn-budget.js";

/**
 * ADR 0106 amendment (26 Oct 2026): one bounded retry of the default scope classifier.
 * Only these closed JSON-shape codes are retried. A parsed verdict the server rejects, prose, truncation, tool calls,
 * missing text, timeouts, transport failures and guard refusals are never retried, and a valid verdict is never re-asked.
 */
export const SCOPE_RETRY_ELIGIBLE_REASONS: readonly ScopeFailureReason[] = [
  "invalid_json_trailing_text", "invalid_json_multiple_values", "invalid_json_syntax", "invalid_json_unterminated", "invalid_json_fenced", "invalid_json_wrapped",
];

/** ADR 0106 amendment: the first attempt keeps its 5 s cap; the retry is capped at 3 s; the whole classifier stage gets 8 s. */
export const SCOPE_FIRST_ATTEMPT_TIMEOUT_MS = 5_000;
export const SCOPE_RETRY_TIMEOUT_MS = 3_000;
export const SCOPE_TOTAL_BUDGET_MS = SCOPE_CLASSIFIER_BUDGET_MS;
/** ADR 0106 amendment: a retry starts only when at least this much of the total budget remains. */
export const SCOPE_MIN_RETRY_BUDGET_MS = 2_000;

/** Closed results of the classifier stage. Recorded as metadata only (ADR 0075). */
export type ScopeClassifierRetryResult = "recovered" | "not_eligible" | "budget_skipped" | "quota_denied" | "second_guard_refused" | "second_failed" | "second_transport_failed";

/** One classifier stage that failed its first attempt with a closed code. Carries codes and counts only. */
export interface ScopeClassifierRetryEvent {
  readonly recovered: boolean;
  readonly classifierAttempts: 1 | 2;
  readonly firstAttemptScopeFailureReason: ScopeFailureReason;
  readonly classifierRetryResult: ScopeClassifierRetryResult;
  /** Metadata only: the closed finish reason of the first failed attempt, when the provider reported one. Never changes eligibility. */
  readonly firstAttemptFinishReason?: AssistantFinishReason | undefined;
}

/**
 * The stage failure the runtime maps to its fixed outcome. `failure` is the error that decides the outcome: the final
 * failure, or the first failure when a retry was skipped or refused by quota or the guard (the first failure's outcome stands).
 */
export class ScopeClassifierRetryError extends Error {
  readonly failure: unknown;
  readonly classifierAttempts: 1 | 2;
  readonly firstAttemptScopeFailureReason: ScopeFailureReason;
  readonly classifierRetryResult: ScopeClassifierRetryResult;
  readonly firstAttemptFinishReason?: AssistantFinishReason | undefined;
  constructor(failure: unknown, event: ScopeClassifierRetryEvent) {
    super("scope_classifier_failed");
    this.name = "ScopeClassifierRetryError";
    this.failure = failure;
    this.classifierAttempts = event.classifierAttempts;
    this.firstAttemptScopeFailureReason = event.firstAttemptScopeFailureReason;
    this.classifierRetryResult = event.classifierRetryResult;
    this.firstAttemptFinishReason = event.firstAttemptFinishReason;
  }
}

export interface RetryingScopeClassifierOptions {
  /** Builds one attempt with the given request timeout. Only the timeout differs between attempts; the request is identical. */
  readonly createAttempt: (timeoutMs: number) => ScopeClassifier;
  readonly firstAttemptTimeoutMs?: number;
  readonly retryTimeoutMs?: number;
  readonly totalBudgetMs?: number;
  readonly minRetryBudgetMs?: number;
  readonly now?: () => number;
  /** Observational. Receives only closed codes and counts; errors thrown here never change the verdict. */
  readonly onAttempt?: (event: ScopeClassifierRetryEvent) => void;
}

/**
 * Wraps the default scope classifier. Each attempt reserves model capacity inside its own provider request (via the guard),
 * so a retry is a new, separately counted attempt. The verdict stays advisory: an accepted retry verdict passes the same checks.
 */
export class RetryingScopeClassifier implements ScopeClassifier {
  readonly #createAttempt: (timeoutMs: number) => ScopeClassifier;
  readonly #firstAttemptTimeoutMs: number;
  readonly #retryTimeoutMs: number;
  readonly #totalBudgetMs: number;
  readonly #minRetryBudgetMs: number;
  readonly #now: () => number;
  readonly #onAttempt?: (event: ScopeClassifierRetryEvent) => void;

  constructor(options: RetryingScopeClassifierOptions) {
    this.#createAttempt = options.createAttempt;
    this.#firstAttemptTimeoutMs = options.firstAttemptTimeoutMs ?? SCOPE_FIRST_ATTEMPT_TIMEOUT_MS;
    this.#retryTimeoutMs = options.retryTimeoutMs ?? SCOPE_RETRY_TIMEOUT_MS;
    this.#totalBudgetMs = options.totalBudgetMs ?? SCOPE_TOTAL_BUDGET_MS;
    this.#minRetryBudgetMs = options.minRetryBudgetMs ?? SCOPE_MIN_RETRY_BUDGET_MS;
    this.#now = options.now ?? (() => performance.now());
    this.#onAttempt = options.onAttempt;
    const budgets = [this.#firstAttemptTimeoutMs, this.#retryTimeoutMs, this.#totalBudgetMs, this.#minRetryBudgetMs];
    if (!budgets.every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Scope classifier retry budgets must be positive integers");
    if (this.#totalBudgetMs < this.#firstAttemptTimeoutMs + this.#retryTimeoutMs) throw new Error("The scope classifier total budget must cover both attempts");
  }

  async assess(text: string, context: ScopeContext): Promise<unknown> {
    const startedAt = this.#now();
    let firstFailure: ScopeClassificationError;
    try {
      return await attemptWithin(this.#createAttempt(this.#firstAttemptTimeoutMs), text, context, this.#firstAttemptTimeoutMs);
    } catch (error) {
      // Only a closed validator failure can be retried. Timeouts, transport and guard errors keep their existing path.
      if (!(error instanceof ScopeClassificationError)) throw error;
      firstFailure = error;
    }
    const first = firstFailure.reason;
    const firstFinish = firstFailure.finishReason;
    const fail = (failure: unknown, classifierAttempts: 1 | 2, classifierRetryResult: ScopeClassifierRetryResult): never => {
      const event = { recovered: false, classifierAttempts, firstAttemptScopeFailureReason: first, classifierRetryResult, firstAttemptFinishReason: firstFinish } as const;
      this.#report(event);
      throw new ScopeClassifierRetryError(failure, event);
    };
    if (!SCOPE_RETRY_ELIGIBLE_REASONS.includes(first)) return fail(firstFailure, 1, "not_eligible");
    const remainingMs = this.#totalBudgetMs - (this.#now() - startedAt);
    if (remainingMs < this.#minRetryBudgetMs) return fail(firstFailure, 1, "budget_skipped");
    const retryTimeoutMs = Math.min(this.#retryTimeoutMs, remainingMs);
    let value: unknown;
    try {
      // The identical request: the attempt is rebuilt with a smaller timeout and nothing else changes (ADR 0106 amendment).
      value = await attemptWithin(this.#createAttempt(retryTimeoutMs), text, context, retryTimeoutMs);
    } catch (error) {
      // A refused reservation or a stopped deadline is the first failure's fail-closed outcome, not a new quota decision.
      if (error instanceof ModelRequestGuardError) return fail(firstFailure, 2, error.code === "quota_denied" ? "quota_denied" : "second_guard_refused");
      if (error instanceof ScopeClassificationError) return fail(error, 2, "second_failed");
      return fail(error, 2, "second_transport_failed");
    }
    this.#report({ recovered: true, classifierAttempts: 2, firstAttemptScopeFailureReason: first, classifierRetryResult: "recovered", firstAttemptFinishReason: firstFinish });
    return value;
  }

  #report(event: ScopeClassifierRetryEvent): void {
    try {
      this.#onAttempt?.(event);
    } catch {
      // Observation cannot alter the classifier decision.
    }
  }
}

/** Races one classifier attempt against its own timeout. A timeout names no rule and is never retried. */
async function attemptWithin(classifier: ScopeClassifier, text: string, context: ScopeContext, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      classifier.assess(text, context),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("scope_assessment_unavailable")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
