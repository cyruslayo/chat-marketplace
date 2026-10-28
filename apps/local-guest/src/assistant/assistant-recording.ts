/**
 * Recorded assistant model exchanges (issue 03 of the assistant-runtime-hardening effort).
 *
 * `RecordingModelClient` wraps any `AssistantModelClient` and keeps each request and response in provider-neutral fields
 * only: the tool names offered, the history (roles, text, tool-call and tool-result names and arguments), the response
 * text, tool calls, finish reason and token usage. It never keeps `rawStep`, the system instruction, keys or headers
 * (ADR 0075). `ReplayModelClient` answers from such a recording in order and fails loudly, naming the step, when the
 * runtime's request diverges from the recorded one. Like `FallbackModelClient` (ADR 0070), replay never reuses an opaque
 * provider step: the runtime rebuilds every request from neutral fields.
 */
import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantModelRequest,
  AssistantModelResponse,
  AssistantToolCall,
} from "./assistant-model.js";

export const ASSISTANT_RECORDING_FORMAT = "assistant-recording/v1";

export type RecordedStep =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string }
  | { readonly role: "tool_calls"; readonly calls: readonly { readonly id: string; readonly name: string; readonly args: Record<string, unknown> }[] }
  | { readonly role: "tool_results"; readonly results: readonly { readonly callId: string; readonly name: string; readonly isError: boolean; readonly result: Record<string, unknown> }[] };

export interface RecordedRequest {
  readonly toolNames: readonly string[];
  readonly structuredOutputName?: string;
  readonly history: readonly RecordedStep[];
}

export interface RecordedResponse {
  readonly text?: string;
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: Record<string, unknown> }[];
  readonly finishReason?: AssistantModelResponse["finishReason"];
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

export interface RecordedExchange {
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
}

/** Thrown by `ReplayModelClient` when the runtime asks for a model call the recording does not match. Names the step. */
export class AssistantReplayDivergenceError extends Error {
  readonly step: number;

  constructor(step: number, reason: string) {
    super(`Assistant replay diverged at recorded step ${step + 1}: ${reason}`);
    this.name = "AssistantReplayDivergenceError";
    this.step = step;
  }
}

/** Projects a runtime request onto the neutral fields a recording keeps. Drops `rawStep` and the system instruction. */
export function neutralRequest(request: AssistantModelRequest): RecordedRequest {
  return {
    toolNames: request.tools.map((tool) => tool.name),
    ...(request.structuredOutput ? { structuredOutputName: request.structuredOutput.name } : {}),
    history: request.history.map(neutralStep),
  };
}

function neutralStep(step: AssistantConversationStep): RecordedStep {
  switch (step.role) {
    case "user":
      return { role: "user", text: step.text };
    case "assistant":
      return { role: "assistant", text: step.text };
    case "tool_calls":
      return { role: "tool_calls", calls: step.calls.map((call) => ({ id: call.id, name: call.name, args: call.args })) };
    case "tool_results":
      return {
        role: "tool_results",
        results: step.results.map((result) => ({ callId: result.callId, name: result.name, isError: result.isError === true, result: result.result })),
      };
  }
}

export function neutralResponse(response: AssistantModelResponse): RecordedResponse {
  return {
    ...(response.text !== undefined ? { text: response.text } : {}),
    ...(response.toolCalls ? { toolCalls: response.toolCalls.map((call: AssistantToolCall) => ({ id: call.id, name: call.name, args: call.args })) } : {}),
    ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
    ...(response.usage ? { usage: { promptTokens: response.usage.promptTokens, completionTokens: response.usage.completionTokens } } : {}),
  };
}

/** Rebuilds a provider-neutral response. A replayed response never carries `rawStep` (ADR 0070). */
function responseFrom(recorded: RecordedResponse): AssistantModelResponse {
  return {
    ...(recorded.text !== undefined ? { text: recorded.text } : {}),
    ...(recorded.toolCalls ? { toolCalls: recorded.toolCalls.map((call) => ({ id: call.id, name: call.name, args: { ...call.args } })) } : {}),
    ...(recorded.finishReason !== undefined ? { finishReason: recorded.finishReason } : {}),
    ...(recorded.usage ? { usage: { ...recorded.usage } } : {}),
  };
}

/**
 * Wraps a real or scripted client and appends every successful exchange to `exchanges`. Errors from the inner client
 * propagate unrecorded, so a recording only ever holds answers the runtime received.
 */
export class RecordingModelClient implements AssistantModelClient {
  readonly supportsProviderAttemptReservation: true | undefined;
  readonly #inner: AssistantModelClient;
  readonly #exchanges: RecordedExchange[] = [];

  constructor(inner: AssistantModelClient) {
    this.#inner = inner;
    if (inner.supportsProviderAttemptReservation === true) this.supportsProviderAttemptReservation = true;
  }

  /** The recorded exchanges, in call order. Returned as a copy. */
  get exchanges(): readonly RecordedExchange[] {
    return [...this.#exchanges];
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const response = await this.#inner.generate(request);
    this.#exchanges.push({ request: neutralRequest(request), response: neutralResponse(response) });
    return response;
  }

  projectProviderContinuation(response: AssistantModelResponse, acceptedCalls: readonly AssistantToolCall[]): unknown {
    return this.#inner.projectProviderContinuation?.(response, acceptedCalls);
  }
}

/** The comparable projection of a request: the fields the issue fixes for divergence (tool names, roles, call names). */
function comparable(request: RecordedRequest | AssistantModelRequest): string {
  const source: RecordedRequest = "tools" in request ? neutralRequest(request) : request;
  return JSON.stringify({
    tools: source.toolNames,
    structured: source.structuredOutputName ?? null,
    history: source.history.map((step) => {
      switch (step.role) {
        case "user":
        case "assistant":
          return [step.role, step.text];
        case "tool_calls":
          return [step.role, step.calls.map((call) => call.name)];
        case "tool_results":
          return [step.role, step.results.map((result) => result.name)];
      }
    }),
  });
}

/** Returns why `actual` differs from `expected`, or undefined when they match. */
export function divergenceReason(expected: RecordedRequest, actual: AssistantModelRequest): string | undefined {
  const recorded = comparable(expected);
  const live = comparable(actual);
  if (recorded === live) return undefined;
  const recordedTools = expected.toolNames.join(",");
  const liveTools = actual.tools.map((tool) => tool.name).join(",");
  if (recordedTools !== liveTools) return `tools offered differ (recorded [${recordedTools}], runtime [${liveTools}])`;
  if (expected.history.length !== actual.history.length) return `history length differs (recorded ${expected.history.length}, runtime ${actual.history.length})`;
  return "history roles, text or tool-call names differ";
}

/**
 * Answers model calls from a recording, in order. Each call must match the next recorded request; a mismatch, or a call
 * after the recording ends, throws `AssistantReplayDivergenceError` naming the step.
 */
export class ReplayModelClient implements AssistantModelClient {
  /** A replay stands in for a provider adapter, so it calls the attempt hook before each answer, as a real adapter would. */
  readonly supportsProviderAttemptReservation = true as const;
  readonly #exchanges: readonly RecordedExchange[];
  #cursor = 0;
  #firstDivergence: AssistantReplayDivergenceError | undefined;

  constructor(exchanges: readonly RecordedExchange[]) {
    this.#exchanges = exchanges;
  }

  /** Recorded exchanges not yet answered. */
  get remaining(): number {
    return this.#exchanges.length - this.#cursor;
  }

  /**
   * Throws the first divergence the runtime hit, even if the runtime caught it, and otherwise throws unless every recorded
   * exchange was answered. A replay that diverged or stopped early therefore never passes silently.
   */
  assertFaithful(): void {
    if (this.#firstDivergence) throw this.#firstDivergence;
    if (this.remaining > 0) throw new AssistantReplayDivergenceError(this.#cursor, `${this.remaining} recorded step(s) were never requested`);
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const step = this.#cursor;
    const expected = this.#exchanges[step];
    if (!expected) return this.#diverge(new AssistantReplayDivergenceError(step, "the runtime asked for a model call after the recording ended"));
    const reason = divergenceReason(expected.request, request);
    if (reason) return this.#diverge(new AssistantReplayDivergenceError(step, reason));
    await request.beforeProviderAttempt?.();
    this.#cursor++;
    return responseFrom(expected.response);
  }

  #diverge(error: AssistantReplayDivergenceError): never {
    this.#firstDivergence ??= error;
    throw error;
  }
}

/**
 * The refusal the record script applies before it opens any database (issue 03 AC4). Only the local fixture database is
 * accepted: the in-memory store or the default local guest fixture file (`DEFAULT_LOCAL_GUEST_CONFIG.databasePath`).
 * Anything else, including a staging or production path, throws and names the path refused.
 */
export function assertLocalFixtureDatabase(databasePath: string, fixturePath: string): void {
  if (databasePath === ":memory:" || databasePath === fixturePath) return;
  throw new Error(`Recording refused: ${databasePath} is not the local fixture database (:memory: or ${fixturePath})`);
}
