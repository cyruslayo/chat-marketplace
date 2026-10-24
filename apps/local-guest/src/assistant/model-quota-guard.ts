import type { ModelRequestQuotaPort } from "../../../../packages/platform-core/src/model-request-quota.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse, AssistantToolCall } from "./assistant-model.js";
import { ModelRequestGuardError } from "./assistant-model.js";

export type ModelQuotaGuardOutcome = "quota_refusal" | "guard_failure";

/** ADR 0079 standard-run deadline; this bounds a full provider request, not a booking rule. */
export const DEFAULT_MODEL_REQUEST_DEADLINE_MS = 120_000;

/** Adds server-owned identity, deadline, and per-transport reservation to an attempt-aware adapter. */
export class ModelQuotaGuardClient implements AssistantModelClient {
  readonly supportsProviderAttemptReservation = true as const;
  readonly #inner: AssistantModelClient;
  readonly #quota: ModelRequestQuotaPort;
  readonly #tenantId: string;
  readonly #guestId: string;
  readonly #deadlineMs: number;
  readonly #onOutcome?: (outcome: ModelQuotaGuardOutcome) => void;

  constructor(
    inner: AssistantModelClient,
    quota: ModelRequestQuotaPort,
    identity: { readonly tenantId: string; readonly guestId: string },
    deadlineMs = DEFAULT_MODEL_REQUEST_DEADLINE_MS,
    onOutcome?: (outcome: ModelQuotaGuardOutcome) => void,
  ) {
    if (inner.supportsProviderAttemptReservation !== true) throw new Error("The configured model adapter cannot reserve each provider attempt");
    if (!identity.tenantId.trim() || !identity.guestId.trim()) throw new Error("Model quota identity is incomplete");
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1_000 || deadlineMs > 300_000) throw new Error("Model request deadline is outside configured engineering bounds");
    this.#inner = inner;
    this.#quota = quota;
    this.#tenantId = identity.tenantId;
    this.#guestId = identity.guestId;
    this.#deadlineMs = deadlineMs;
    this.#onOutcome = onOutcome;
  }

  generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const now = Date.now();
    const requestTimeoutMs = Math.min(request.timeoutMs ?? this.#deadlineMs, this.#deadlineMs);
    const requestDeadlineAt = now + requestTimeoutMs;
    const deadlineAt = Math.min(request.deadlineAt ?? requestDeadlineAt, requestDeadlineAt);
    return this.#inner.generate({
      ...request,
      deadlineAt,
      beforeProviderAttempt: async () => {
        if (Date.now() >= deadlineAt) {
          this.#recordOutcome("guard_failure");
          throw new ModelRequestGuardError("deadline_exceeded");
        }
        let reservation;
        try {
          reservation = await untilDeadline(
            this.#quota.reserve({ tenantId: this.#tenantId, guestId: this.#guestId }),
            deadlineAt,
          );
        } catch {
          this.#recordOutcome("guard_failure");
          if (Date.now() >= deadlineAt) throw new ModelRequestGuardError("deadline_exceeded");
          throw new ModelRequestGuardError("quota_unavailable");
        }
        if (!reservation.reserved) {
          this.#recordOutcome("quota_refusal");
          throw new ModelRequestGuardError("quota_denied");
        }
        await request.beforeProviderAttempt?.();
        if (Date.now() >= deadlineAt) {
          this.#recordOutcome("guard_failure");
          throw new ModelRequestGuardError("deadline_exceeded");
        }
      },
    });
  }

  projectProviderContinuation(response: AssistantModelResponse, acceptedCalls: readonly AssistantToolCall[]): unknown {
    return this.#inner.projectProviderContinuation?.(response, acceptedCalls);
  }

  #recordOutcome(outcome: ModelQuotaGuardOutcome): void {
    try {
      this.#onOutcome?.(outcome);
    } catch {
      // Metrics remain observational and cannot alter quota enforcement.
    }
  }
}

function untilDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return Promise.reject(new ModelRequestGuardError("deadline_exceeded"));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModelRequestGuardError("deadline_exceeded")), remainingMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
