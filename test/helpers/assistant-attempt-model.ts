import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";

/**
 * Presents an offline model as a provider adapter (issue 03 follow-up, shared by the recorded journeys and the protocol tests).
 * It claims per-attempt reservation and calls the request's attempt hook before each answer, as a real adapter does before
 * each transport. The quota guard requires both (ADR 0106: reserve model-request capacity before each provider request).
 */
export function withProviderAttemptHook(inner: AssistantModelClient): AssistantModelClient {
  return {
    supportsProviderAttemptReservation: true,
    async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
      await request.beforeProviderAttempt?.();
      return inner.generate(request);
    },
  };
}
