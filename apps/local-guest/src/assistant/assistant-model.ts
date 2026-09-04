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
  readonly items?: { readonly type: string };
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
}

export interface AssistantModelResponse {
  readonly text?: string;
  readonly toolCalls?: readonly AssistantToolCall[];
  /** Optional opaque provider-specific representation preserved across tool turns. */
  readonly rawStep?: unknown;
}

export interface AssistantModelClient {
  generate(request: AssistantModelRequest): Promise<AssistantModelResponse>;
}

