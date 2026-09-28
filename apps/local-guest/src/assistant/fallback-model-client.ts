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

  constructor(primary: AssistantModelClient, secondary: AssistantModelClient) {
    this.#primary = primary;
    this.#secondary = secondary;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    try {
      return await this.#primary.generate(request);
    } catch (error) {
      if (!isProviderUnavailable(error)) throw error;
      return this.#secondary.generate(request);
    }
  }
}

export function isProviderUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { readonly status?: unknown }).status;
  if (typeof status === "number") return status === 429 || (status >= 500 && status <= 599);
  return /^APIConnection(Timeout)?Error$/.test(error.constructor.name);
}
