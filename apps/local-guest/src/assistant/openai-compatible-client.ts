import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantModelRequest,
  AssistantModelResponse,
  AssistantToolCall,
  AssistantToolDefinition,
} from "./assistant-model.js";

/**
 * Adapter for providers that speak the OpenAI Chat Completions protocol
 * (DeepSeek at https://api.deepseek.com, OpenAI at https://api.openai.com/v1).
 *
 * ADR-0068: raw fetch, no vendor SDK or vendor types behind the neutral port.
 * ADR-0069: the key stays server-side.
 * ADR-0075: keys, prompts and replies never enter error messages or logs.
 */

export const DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS = 20_000;

const MAX_CONNECTION_RETRIES = 1;
const CONNECTION_RETRY_DELAY_MS = 100;

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleClientConfig {
  readonly apiKey: string;
  /** Provider base URL, e.g. https://api.deepseek.com; `/chat/completions` is appended. */
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Optional transport injector for testing without network. */
  readonly fetch?: FetchFunction;
}

/** Network-level failure before an HTTP response arrived (including timeouts). */
export class APIConnectionError extends Error {
  readonly code: string;
  constructor(code: "connection_failed" | "timeout") {
    super(code === "timeout" ? "LLM provider request timed out" : "LLM provider connection failed");
    this.code = code;
  }
}

/** The provider answered with an HTTP error status. */
export class APIError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, code?: string) {
    super(`LLM provider returned HTTP ${status}`);
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export class RateLimitError extends APIError {}

interface ChatToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

type ChatMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls?: readonly ChatToolCall[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export class OpenAiCompatibleClient implements AssistantModelClient {
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchFunction;

  constructor(config: OpenAiCompatibleClientConfig) {
    if (!config.apiKey?.trim()) throw new Error("LLM_API_KEY is required for OpenAiCompatibleClient");
    if (!config.model?.trim()) throw new Error("LLM_MODEL is required for OpenAiCompatibleClient");
    this.#apiKey = config.apiKey.trim();
    this.#endpoint = `${httpsBaseUrl(config.baseUrl)}/chat/completions`;
    this.#model = config.model.trim();
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const body = JSON.stringify({
      model: this.#model,
      messages: mapHistoryToMessages(request.systemInstruction, request.history),
      ...(request.tools.length > 0 ? { tools: request.tools.map(mapTool) } : {}),
      stream: false,
    });
    const response = await this.#postWithBoundedConnectionRetry(body, request.timeoutMs ?? this.#timeoutMs);
    if (!response.ok) throw await providerError(response);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("LLM provider returned a response that is not JSON");
    }
    return parseCompletion(payload);
  }

  async #postWithBoundedConnectionRetry(body: string, timeoutMs: number): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#post(body, timeoutMs);
      } catch (error) {
        const retryable = error instanceof APIConnectionError && error.code === "connection_failed";
        if (attempt >= MAX_CONNECTION_RETRIES || !retryable) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, CONNECTION_RETRY_DELAY_MS));
      }
    }
  }

  async #post(body: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
        body,
        signal: controller.signal,
      });
    } catch {
      // The underlying error may echo request details; replace it with a sanitised class (ADR-0075).
      throw new APIConnectionError(controller.signal.aborted ? "timeout" : "connection_failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

function httpsBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("LLM_BASE_URL must be an absolute HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("LLM_BASE_URL must be an absolute HTTPS URL without credentials, query or fragment");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * Rebuilds provider messages from the neutral fields only. `rawStep` is ignored, so a thread that
 * started on another provider is never replayed with that provider's opaque steps (ADR-0070).
 */
function mapHistoryToMessages(systemInstruction: string, history: readonly AssistantConversationStep[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemInstruction }];
  for (const item of history) {
    switch (item.role) {
      case "user":
        messages.push({ role: "user", content: item.text });
        break;
      case "assistant":
        messages.push({ role: "assistant", content: item.text });
        break;
      case "tool_calls":
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: item.calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        });
        break;
      case "tool_results":
        for (const result of item.results) {
          messages.push({ role: "tool", tool_call_id: result.callId, content: JSON.stringify(result.result) });
        }
        break;
    }
  }
  return messages;
}

function mapTool(tool: AssistantToolDefinition): { readonly type: "function"; readonly function: Record<string, unknown> } {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parametersSchema },
  };
}

async function providerError(response: Response): Promise<APIError> {
  let code: string | undefined;
  try {
    const payload: unknown = await response.json();
    const error = isPlainRecord(payload) && isPlainRecord(payload.error) ? payload.error : undefined;
    const candidate = error?.code ?? error?.type;
    if (typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)) code = candidate;
  } catch {
    // The status alone is enough; provider error prose is never surfaced (ADR-0075).
  }
  return response.status === 429 ? new RateLimitError(429, code) : new APIError(response.status, code);
}

function parseCompletion(payload: unknown): AssistantModelResponse {
  const choices = isPlainRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const choice: unknown = choices[0];
  const message = isPlainRecord(choice) && isPlainRecord(choice.message) ? choice.message : undefined;
  if (!message) throw new Error("LLM provider returned no completion message");

  const text = typeof message.content === "string" && message.content.trim() !== "" ? message.content.trim() : undefined;
  const rawCalls = message.tool_calls;
  if (rawCalls !== undefined && rawCalls !== null && !Array.isArray(rawCalls)) {
    throw new Error("LLM provider tool_calls is structurally invalid");
  }
  const toolCalls: AssistantToolCall[] = (rawCalls ?? []).map(parseToolCall);
  return {
    ...(text !== undefined ? { text } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function parseToolCall(value: unknown): AssistantToolCall {
  // ADR-0070/ADR-0075: never fabricate provider identity or echo untrusted arguments.
  const fn = isPlainRecord(value) && isPlainRecord(value.function) ? value.function : undefined;
  if (!isPlainRecord(value) || !fn
    || typeof value.id !== "string" || value.id.trim() === ""
    || typeof fn.name !== "string" || fn.name.trim() === ""
    || typeof fn.arguments !== "string") {
    throw new Error("LLM provider tool call is structurally invalid");
  }
  let args: unknown;
  try {
    args = fn.arguments.trim() === "" ? {} : JSON.parse(fn.arguments);
  } catch {
    throw new Error("LLM provider tool call arguments are not valid JSON");
  }
  if (!isPlainRecord(args)) throw new Error("LLM provider tool call arguments are not an object");
  return { id: value.id, name: fn.name, args };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
