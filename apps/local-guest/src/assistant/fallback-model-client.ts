import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "./assistant-model.js";

/**
 * Uses the secondary provider only when the primary is unavailable: a connection failure or
 * timeout, a rate limit (429) or a server error (5xx). Any other failure, including a malformed
 * model response or a rejected request, is rethrown so the runtime fails closed as before.
 *
 * ADR-0070: switching providers never replays opaque provider steps; each adapter rebuilds
 * messages from the neutral history fields, and the OpenAI-compatible adapter emits no rawStep.
 */
export class FallbackModelClient implements AssistantModelClient {
  readonly #primary: AssistantModelClient;
  readonly #secondary: AssistantModelClient;
  readonly #responseProviders = new WeakMap<object, AssistantModelClient>();

  constructor(primary: AssistantModelClient, secondary: AssistantModelClient) {
    this.#primary = primary;
    this.#secondary = secondary;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    try {
      const response = await this.#primary.generate(request);
      this.#responseProviders.set(response, this.#primary);
      return response;
    } catch (error) {
      if (!isProviderUnavailable(error)) throw error;
      const response = await this.#secondary.generate(request);
      this.#responseProviders.set(response, this.#secondary);
      return response;
    }
  }

  projectProviderContinuation(response: AssistantModelResponse, acceptedCalls: readonly import("./assistant-model.js").AssistantToolCall[]): unknown {
    const selected = this.#responseProviders.get(response);
    if (selected) return selected.projectProviderContinuation?.(response, acceptedCalls);
    // After persistence or neutral-history reconstruction, response object identity is gone.
    // Each adapter must still sanitize its own closed continuity format without trusting prose.
    return this.#primary.projectProviderContinuation?.(response, acceptedCalls)
      ?? this.#secondary.projectProviderContinuation?.(response, acceptedCalls);
  }
}

export function isProviderUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { readonly status?: unknown }).status;
  if (typeof status === "number") return status === 429 || (status >= 500 && status <= 599);
  return /^APIConnection(Timeout)?Error$/.test(error.constructor.name);
}
