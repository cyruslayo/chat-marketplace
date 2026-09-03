import {
  GoogleGenAI,
  type Content,
} from "@google/genai";
import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantModelRequest,
  AssistantModelResponse,
  AssistantToolCall,
  AssistantToolDefinition,
} from "./assistant-model.js";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_TIMEOUT_MS = 20_000;

export interface GeminiInteractionsClientConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly thinkingLevel?: "minimal" | "low" | "medium" | "high";
  /** Optional custom transport injector for testing without network. */
  readonly customAi?: {
    interactions: {
      create(params: any, options?: any): Promise<any>;
    };
  };
}

/**
 * Adapter migrating the Gemini integration to the official Interactions API (Item 2).
 * Uses store: false for platform-owned statelessness (Item 3).
 * Keeps API key strictly server-side (Item 5).
 */
export class GeminiInteractionsClient implements AssistantModelClient {
  readonly #ai: {
    interactions: {
      create(params: any, options?: any): Promise<any>;
    };
  };
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #thinkingLevel?: string;

  constructor(config: GeminiInteractionsClientConfig) {
    if (!config.apiKey && !config.customAi) {
      throw new Error("GEMINI_API_KEY is required for GeminiInteractionsClient");
    }
    this.#ai = config.customAi ?? new GoogleGenAI({ apiKey: config.apiKey });
    this.#model = config.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
    this.#thinkingLevel = config.thinkingLevel ?? process.env.GEMINI_THINKING_LEVEL;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const inputSteps = this.#mapHistoryToInteractionsInput(request.history);
    const tools = this.#mapToolsToInteractionsTools(request.tools);

    const generationConfig: Record<string, unknown> = {};
    if (this.#thinkingLevel) {
      generationConfig.thinking_level = this.#thinkingLevel;
    }

    const params: Record<string, unknown> = {
      model: this.#model,
      input: inputSteps,
      store: false, // Item 3: platform-owned statelessness
      system_instruction: request.systemInstruction,
      ...(tools.length > 0 ? { tools } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generation_config: generationConfig } : {}),
    };

    const options: Record<string, unknown> = {
      timeout: request.timeoutMs ?? this.#timeoutMs,
    };

    const interaction = await this.#ai.interactions.create(params, options);
    return this.#parseInteractionResponse(interaction);
  }

  #mapHistoryToInteractionsInput(history: readonly AssistantConversationStep[]): any[] {
    const steps: any[] = [];

    for (const item of history) {
      switch (item.role) {
        case "user":
          steps.push({
            type: "user_input",
            content: [{ role: "user", parts: [{ text: item.text }] }],
          });
          break;

        case "assistant":
          steps.push({
            type: "model_output",
            content: [{ role: "model", parts: [{ text: item.text }] }],
          });
          break;

        case "tool_calls":
          for (const call of item.calls) {
            steps.push({
              type: "function_call",
              id: call.id,
              name: call.name,
              arguments: call.args,
            });
          }
          break;

        case "tool_results":
          for (const res of item.results) {
            steps.push({
              type: "function_result",
              call_id: res.callId,
              name: res.name,
              result: JSON.stringify(res.result),
              ...(res.isError ? { is_error: true } : {}),
            });
          }
          break;
      }
    }

    return steps;
  }

  #mapToolsToInteractionsTools(tools: readonly AssistantToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }));
  }

  #parseInteractionResponse(interaction: any): AssistantModelResponse {
    if (!interaction) {
      throw new Error("Gemini Interactions API returned an empty interaction");
    }

    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    const toolCalls: AssistantToolCall[] = [];
    let text: string | undefined;

    for (const step of steps) {
      if (step.type === "function_call") {
        toolCalls.push({
          id: step.id ?? `call-${crypto.randomUUID()}`,
          name: step.name,
          args: step.arguments ?? {},
        });
      } else if (step.type === "model_output") {
        if (Array.isArray(step.content)) {
          for (const content of step.content) {
            if (Array.isArray(content.parts)) {
              for (const part of content.parts) {
                if (typeof part.text === "string" && part.text.trim() !== "") {
                  text = (text ? `${text}\n` : "") + part.text.trim();
                }
                if (part.functionCall) {
                  toolCalls.push({
                    id: part.functionCall.id ?? `call-${crypto.randomUUID()}`,
                    name: part.functionCall.name,
                    args: part.functionCall.args ?? {},
                  });
                }
              }
            }
          }
        }
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      rawStep: steps,
    };
  }
}

