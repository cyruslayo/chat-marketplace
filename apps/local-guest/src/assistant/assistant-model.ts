/**
 * Provider-neutral Assistant Model interface and conversation representations.
 *
 * Domain and application modules depend on this abstraction, NEVER on
 * @google/genai or any specific LLM provider.
 */

export interface AssistantToolParameterProperty {
  readonly type: string | readonly string[];
  readonly description?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly enum?: readonly unknown[];
  readonly items?: AssistantToolParameterProperty;
  readonly properties?: Readonly<Record<string, AssistantToolParameterProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AssistantToolParametersSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, AssistantToolParameterProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AssistantToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: AssistantToolParametersSchema;
  readonly category: "read" | "proposal" | "confirmation";
}

export interface AssistantToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface AssistantToolResult {
  readonly callId: string;
  readonly name: string;
  readonly result: Record<string, unknown>;
  readonly isError?: boolean;
}

export type AssistantConversationStep =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string; readonly rawStep?: unknown }
  | { readonly role: "tool_calls"; readonly calls: readonly AssistantToolCall[]; readonly rawStep?: unknown }
  | { readonly role: "tool_results"; readonly results: readonly AssistantToolResult[] };

export interface AssistantModelRequest {
  readonly systemInstruction: string;
  readonly tools: readonly AssistantToolDefinition[];
  readonly history: readonly AssistantConversationStep[];
  readonly timeoutMs?: number;
  /** Provider-neutral JSON schema request for a final typed reply plan. */
  readonly structuredOutput?: { readonly name: string; readonly schema: Readonly<Record<string, unknown>>; readonly strict?: boolean };
  /** Maximum generated tokens; this is an engineering bound, not a domain rule. */
  readonly maxOutputTokens?: number;
  /** Optional engineering preference for a closed, latency-bounded classification call. */
  readonly reasoningEffort?: "none";
  /** Internal server hook. Adapters call it immediately before every provider transport attempt. */
  readonly beforeProviderAttempt?: () => Promise<void>;
  /** Absolute server-owned deadline in Unix milliseconds for the complete provider request. */
  readonly deadlineAt?: number;
}

/** A server-side request guard stopped work before provider transport began. */
export class ModelRequestGuardError extends Error {
  constructor(readonly code: "quota_denied" | "quota_unavailable" | "deadline_exceeded") {
    super(code);
    this.name = "ModelRequestGuardError";
  }
}

export interface AssistantModelResponse {
  readonly text?: string;
  readonly toolCalls?: readonly AssistantToolCall[];
  /** Optional opaque provider-specific representation preserved across tool turns. */
  readonly rawStep?: unknown;
  /** Provider-neutral token counts; absent means the provider supplied no valid usage. */
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

export interface AssistantModelClient {
  /** True only when the adapter calls the request's attempt hook before each provider transport. */
  readonly supportsProviderAttemptReservation?: true;
  generate(request: AssistantModelRequest): Promise<AssistantModelResponse>;
  /** Optional provider seam: retain only validated opaque continuity metadata for accepted calls. */
  projectProviderContinuation?(response: AssistantModelResponse, acceptedCalls: readonly AssistantToolCall[]): unknown;
}

