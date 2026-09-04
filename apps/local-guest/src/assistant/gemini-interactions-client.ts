import {
  GoogleGenAI,
  type Interactions,
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

interface InteractionRequestOptions {
  readonly timeout?: number;
}

interface InteractionTransport {
  create(
    params: Interactions.CreateModelInteractionParamsNonStreaming,
    options?: InteractionRequestOptions,
  ): Promise<Interactions.Interaction>;
}

export type AssistantThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface GeminiInteractionsClientConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly thinkingLevel?: AssistantThinkingLevel;
  /** Optional custom transport injector for testing without network. */
  readonly customAi?: {
    readonly interactions: InteractionTransport;
  };
}

function mapToInteractionsThinkingLevel(level: string | undefined): Interactions.ThinkingLevel | undefined {
  if (!level) return undefined;
  const normalized = level.trim().toLowerCase();
  switch (normalized) {
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return undefined;
  }
}

/**
 * Adapter migrating the Gemini integration to the official Interactions API (Item 2).
 * Uses store: false for platform-owned statelessness (Item 3).
 * Keeps API key strictly server-side (Item 5).
 */
export class GeminiInteractionsClient implements AssistantModelClient {
  readonly #interactions: InteractionTransport;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #thinkingLevel?: string;

  constructor(config: GeminiInteractionsClientConfig) {
    if (!config.apiKey && !config.customAi) {
      throw new Error("GEMINI_API_KEY is required for GeminiInteractionsClient");
    }
    if (config.customAi) {
      this.#interactions = config.customAi.interactions;
    } else {
      const ai = new GoogleGenAI({ apiKey: config.apiKey });
      this.#interactions = {
        create: (params, options) => ai.interactions.create({ ...params, stream: false }, options),
      };
    }
    this.#model = config.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
    this.#thinkingLevel = config.thinkingLevel ?? process.env.GEMINI_THINKING_LEVEL;
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    const inputSteps = this.#mapHistoryToInteractionsInput(request.history);
    const tools = this.#mapToolsToInteractionsTools(request.tools);

    let generation_config: Interactions.GenerationConfig | undefined;
    const thinking_level = mapToInteractionsThinkingLevel(this.#thinkingLevel);
    if (thinking_level) {
      generation_config = {
        thinking_level,
      };
    }

    const params: Interactions.CreateModelInteractionParamsNonStreaming = {
      model: this.#model,
      input: inputSteps,
      store: false, // Item 3: platform-owned statelessness
      system_instruction: request.systemInstruction,
      ...(tools.length > 0 ? { tools } : {}),
      ...(generation_config ? { generation_config } : {}),
    };

    const options: InteractionRequestOptions = {
      timeout: request.timeoutMs ?? this.#timeoutMs,
    };

    const interaction = await this.#interactions.create(params, options);
    return this.#parseInteractionResponse(interaction);
  }

  #mapHistoryToInteractionsInput(history: readonly AssistantConversationStep[]): Interactions.Step[] {
    const steps: Interactions.Step[] = [];

    for (const item of history) {
      switch (item.role) {
        case "user":
          steps.push({
            type: "user_input",
            content: [{ type: "text", text: item.text }],
          });
          break;

        case "assistant":
          if (item.rawStep !== undefined) {
            const providerSteps = Array.isArray(item.rawStep) ? item.rawStep : [item.rawStep];
            if (!providerSteps.every(isInteractionStep)) {
              throw new Error("Stored Gemini interaction steps are structurally invalid");
            }
            steps.push(...providerSteps);
            break;
          }
          steps.push({
            type: "model_output",
            content: [{ type: "text", text: item.text }],
          });
          break;

        case "tool_calls":
          // ADR-0070: provider interaction identities and payloads remain opaque.
          if (item.rawStep !== undefined) {
            const providerSteps = Array.isArray(item.rawStep) ? item.rawStep : [item.rawStep];
            if (!providerSteps.every(isInteractionStep)) {
              throw new Error("Stored Gemini interaction steps are structurally invalid");
            }
            steps.push(...providerSteps);
            break;
          }
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
            const resultContent: Interactions.TextContent = {
              type: "text",
              text: JSON.stringify(res.result),
            };
            const functionResult: Interactions.FunctionResultStep = {
              type: "function_result",
              call_id: res.callId,
              name: res.name,
              result: [resultContent],
              ...(res.isError ? { is_error: true } : {}),
            };
            steps.push(functionResult);
          }
          break;
      }
    }

    return steps;
  }

  #mapToolsToInteractionsTools(tools: readonly AssistantToolDefinition[]): Interactions.Tool[] {
    return tools.map((tool): Interactions.Function => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }));
  }

  #parseInteractionResponse(interaction: Interactions.Interaction): AssistantModelResponse {
    if (!interaction) {
      throw new Error("Gemini Interactions API returned an empty interaction");
    }

    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    const toolCalls: AssistantToolCall[] = [];
    let text = typeof interaction.output_text === "string" && interaction.output_text.trim() !== ""
      ? interaction.output_text.trim()
      : undefined;

    for (const step of steps) {
      if (step.type === "function_call") {
        // ADR-0070/ADR-0075: never fabricate provider identity or echo untrusted arguments.
        if (!isValidFunctionCallStep(step)) {
          throw new Error("Gemini function_call step is structurally invalid");
        }
        toolCalls.push({
          id: step.id,
          name: step.name,
          args: step.arguments,
        });
      } else if (step.type === "model_output" && text === undefined) {
        if (Array.isArray(step.content)) {
          for (const content of step.content) {
            if (content.type === "text" && content.text.trim() !== "") {
              text = (text ? `${text}\n` : "") + content.text.trim();
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidFunctionCallStep(step: Interactions.FunctionCallStep): step is Interactions.FunctionCallStep & { readonly arguments: Record<string, unknown> } {
  return typeof step.id === "string"
    && step.id.trim() !== ""
    && typeof step.name === "string"
    && step.name.trim() !== ""
    && isPlainRecord(step.arguments);
}

function isInteractionStep(value: unknown): value is Interactions.Step {
  return isPlainRecord(value) && typeof value.type === "string" && value.type.trim() !== "";
}
