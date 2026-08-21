import type { Message } from "@ag-ui/core";
import { GoogleGenAI } from "@google/genai";
import type { Stream } from "@google/genai";

/** Structural match of CopilotKit's `CopilotKitResponse` (not exported). */
interface CopilotKitResponse {
  stream: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
}

/**
 * Adapter that talks to Google's Gemini Interactions API through the official
 * `@google/genai` SDK and presents the response to CopilotKit as an
 * OpenAI-format SSE stream.
 *
 * The Interactions API is the current recommended interface for Gemini models
 * (generally available June 2026) and supports the `gemini-3.5-flash` model.
 * We use the SDK rather than raw REST so that authorization (auth) keys are
 * handled by the SDK's supported authentication path.
 *
 * Stateless by design (store:false): every CopilotKit turn already carries the
 * full message history, and per ADR 0070 each turn is a fresh run. No
 * interaction data is retained server-side (ADR 0075).
 */

export interface GeminiInteractionsAdapterOptions {
  /** Gemini model id, defaults to the GA `gemini-3.5-flash`. */
  model?: string;
  /** API key. Defaults to `process.env.GEMINI_API_KEY`. */
  apiKey?: string;
  /**
   * Whether the Interactions API should store the interaction server-side.
   * Defaults to false (stateless; data minimization per ADR 0075).
   */
  store?: boolean;
}

/**
 * Minimal structural views of the SDK's interaction types.
 *
 * The `@google/genai` package does not export its `interactions.*` type
 * namespace from the main entry, so we model just the fields we consume.
 * These mirror the SDK's documented wire shapes (see the Interactions API
 * streaming reference).
 */

/** A text content block (`{type:"text", text}`). */
export interface GeminiTextContent {
  type: "text";
  text: string;
}

/** A `Turn` in the input: role (user/model) + text content. */
export interface GeminiTurn {
  role: string;
  content: Array<GeminiTextContent>;
}

/** A function-call step in the input (assistant tool call). */
export interface GeminiFunctionCallStep {
  type: "function_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A function-result step in the input (tool result). */
export interface GeminiFunctionResultStep {
  type: "function_result";
  call_id: string;
  name: string;
  result: Record<string, unknown>;
}

/** Input accepted by `interactions.create`: turns and/or steps. */
export type GeminiInputItem = GeminiTurn | GeminiFunctionCallStep | GeminiFunctionResultStep;

/** SDK tool declaration (`FunctionT` shape). */
export interface GeminiFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: unknown;
}

/** A streamed interaction event from the SDK. */
export interface GeminiSdkStreamEvent {
  event_type: string;
  index?: number;
  step?: {
    type?: string;
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
  delta?: {
    type?: string;
    text?: string;
    arguments?: string;
    [key: string]: unknown;
  };
  interaction?: { id?: string; status?: string };
}

interface OpenAIChoiceDelta {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    index: number;
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAIChunk {
  choices: Array<{ delta: OpenAIChoiceDelta }>;
}

const encoder = new TextEncoder();

function writeChunk(controller: ReadableStreamDefaultController<Uint8Array>, chunk: OpenAIChunk): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

function writeDone(controller: ReadableStreamDefaultController<Uint8Array>): void {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
}

/**
 * Build the Gemini `input` (array of `Turn`s / steps) from AG-UI / CopilotKit
 * messages. System messages are surfaced separately via `system_instruction`.
 */
export function transformMessagesToGeminiInput(messages: Message[]): {
  systemInstruction: string | undefined;
  input: Array<GeminiInputItem>;
} {
  let systemInstruction: string | undefined;
  const input: Array<GeminiInputItem> = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (systemInstruction === undefined && typeof message.content === "string") {
        systemInstruction = message.content;
      }
      continue;
    }
    if (message.role === "user") {
      const content: Array<GeminiTextContent> = [];
      if (typeof message.content === "string" && message.content.length > 0) {
        content.push({ type: "text", text: message.content });
      }
      // AG-UI multimodal content: array of text/image/audio/video/document parts.
      if (Array.isArray(message.content)) {
        for (const part of message.content as Array<{ type?: string; text?: string }>) {
          if (part?.type === "text" && typeof part.text === "string") {
            content.push({ type: "text", text: part.text });
          }
          // Other modalities are intentionally not mapped: the launch profile
          // (ADR 0069) only contracts text for the web agent.
        }
      }
      input.push({ role: "user", content });
      continue;
    }
    if (message.role === "assistant") {
      if (typeof message.content === "string" && message.content.length > 0) {
        input.push({ role: "model", content: [{ type: "text", text: message.content }] });
      }
      const toolCalls = (message as {
        toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      }).toolCalls;
      if (toolCalls) {
        for (const call of toolCalls) {
          input.push({
            type: "function_call",
            id: call.id,
            name: call.function.name,
            arguments: safeParseArguments(call.function.arguments)
          });
        }
      }
      continue;
    }
    if (message.role === "tool") {
      const toolMessage = message as {
        toolCallId: string;
        name?: string;
        toolName?: string;
        content: string;
        error?: string;
      };
      const result = toolMessage.error
        ? { error: toolMessage.error }
        : safeParseResponse(toolMessage.content);
      input.push({
        type: "function_result",
        call_id: toolMessage.toolCallId,
        name: toolMessage.name ?? toolMessage.toolName ?? "unknown",
        result
      });
      continue;
    }
    // activity/reasoning/developer messages carry no model-visible content for
    // this profile; skip them.
  }

  return { systemInstruction, input };
}

/** Build Gemini `tools` (SDK `FunctionT[]`) from CopilotKit chat-completion tool definitions. */
export function transformToolsToGemini(tools: unknown[]): GeminiFunctionTool[] {
  const declarations: GeminiFunctionTool[] = [];
  for (const tool of tools) {
    const fn = (tool as { function?: { name?: string; description?: string; parameters?: unknown } })?.function;
    if (fn && typeof fn.name === "string") {
      declarations.push({
        type: "function",
        name: fn.name,
        ...(typeof fn.description === "string" ? { description: fn.description } : {}),
        ...(fn.parameters !== undefined ? { parameters: fn.parameters } : {})
      });
    }
  }
  return declarations;
}

/** Convert an SDK `step.delta` text event into an OpenAI-format chunk. */
export function textDeltaToOpenAIChunk(event: GeminiSdkStreamEvent): OpenAIChunk | null {
  if (event.delta?.type === "text" && typeof event.delta.text === "string") {
    return {
      choices: [{ delta: { role: "assistant", content: event.delta.text } }]
    };
  }
  return null;
}

/**
 * Convert accumulated function-call information (name + id from step.start,
 * arguments accumulated from arguments_delta deltas) into an OpenAI tool_calls
 * chunk. The runtime interceptor executes server actions from these.
 */
export function functionCallToOpenAIChunk(
  call: { id: string; name: string; arguments: string },
  index: number
): OpenAIChunk {
  return {
    choices: [
      {
        delta: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              index,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments || "{}" }
            }
          ]
        }
      }
    ]
  };
}

function safeParseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeParseResponse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: raw };
  } catch {
    return { value: raw };
  }
}

interface GeminiForwardedProps {
  messages?: Message[];
  tools?: unknown[];
}

export class GeminiInteractionsAdapter {
  private readonly model: string;
  private readonly store: boolean;
  private readonly ai: GoogleGenAI;

  constructor(options: GeminiInteractionsAdapterOptions = {}) {
    this.model = options.model ?? "gemini-3.5-flash";
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required. Set it in the environment or pass `apiKey` to GeminiInteractionsAdapter.");
    }
    this.store = options.store ?? false;
    this.ai = new GoogleGenAI({ apiKey });
  }

  async getResponse(forwardedProps: unknown, abortSignal?: AbortSignal): Promise<CopilotKitResponse> {
    const props = isGeminiForwardedProps(forwardedProps) ? forwardedProps : {};
    const messages: Message[] = props.messages ?? [];
    const tools: unknown[] = props.tools ?? [];

    const { systemInstruction, input } = transformMessagesToGeminiInput(messages);
    const geminiTools = transformToolsToGemini(tools);

    const params: {
      model: string;
      input: Array<GeminiInputItem>;
      stream: true;
      store: boolean;
      system_instruction?: string;
      tools?: GeminiFunctionTool[];
    } = {
      model: this.model,
      input,
      stream: true,
      store: this.store
    };
    if (systemInstruction !== undefined) {
      params.system_instruction = systemInstruction;
    }
    if (geminiTools.length > 0) {
      params.tools = geminiTools;
    }

    let stream: Stream<unknown>;
    try {
      // `create` is overloaded on `stream`; with stream:true it returns a
      // Stream<InteractionSSEEvent>. Type the call result loosely and narrow.
      const result: unknown = await this.ai.interactions.create(params as never);
      if (!(result instanceof ReadableStream)) {
        throw new Error("Gemini Interactions API did not return a stream (is `stream: true` being honored?)");
      }
      stream = result as Stream<unknown>;
    } catch (error) {
      throw new Error("Gemini Interactions API request failed");
    }

    const reader = stream.getReader();
    const stepIndexRef = { current: -1 };
    const currentCall = { id: "", name: "", arguments: "" };

    const abort = () => { void reader.cancel(); };
    abortSignal?.addEventListener("abort", abort, { once: true });
    const outStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const event = value as GeminiSdkStreamEvent;
            if (event.event_type === "step.start") {
              const step = event.step;
              if (step?.type === "function_call") {
                stepIndexRef.current += 1;
                currentCall.id = step.id ?? stepIndexRef.current.toString();
                currentCall.name = step.name ?? "";
                currentCall.arguments = "";
              }
              continue;
            }
            if (event.event_type === "step.delta") {
              const delta = event.delta;
              if (delta?.type === "text") {
                const chunk = textDeltaToOpenAIChunk(event);
                if (chunk) writeChunk(controller, chunk);
              } else if (delta?.type === "arguments_delta" && typeof delta.arguments === "string") {
                currentCall.arguments += delta.arguments;
              }
              continue;
            }
            if (event.event_type === "step.stop" && currentCall.name) {
              writeChunk(controller, functionCallToOpenAIChunk(currentCall, stepIndexRef.current));
              currentCall.id = "";
              currentCall.name = "";
              currentCall.arguments = "";
            }
          }
          writeDone(controller);
          controller.close();
          abortSignal?.removeEventListener("abort", abort);
        } catch (error) {
          controller.error(new Error("Gemini Interactions API stream failed"));
          abortSignal?.removeEventListener("abort", abort);
        }
      },
      cancel: abort
    });

    return { stream: outStream };
  }
}

function isGeminiForwardedProps(value: unknown): value is GeminiForwardedProps {
  if (typeof value !== "object" || value === null) return false;
  const props = value as { messages?: unknown; tools?: unknown };
  return (props.messages === undefined || Array.isArray(props.messages))
    && (props.tools === undefined || Array.isArray(props.tools));
}
