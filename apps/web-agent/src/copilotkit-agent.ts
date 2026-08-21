import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import type { Message } from "@ag-ui/core";
import { GeminiInteractionsAdapter } from "./gemini-interactions-adapter.js";

const BROWSE_TOOL = {
  type: "function",
  function: {
    name: "browseEligibleUnits",
    description: "Search for eligible units based on location, dates, and party size.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "The city or neighborhood" },
        nights: { type: "number", description: "Number of nights for the stay" }
      },
      required: ["location", "nights"]
    }
  }
} as const;

interface AgentToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface BrowseEligibleUnitsRequest {
  location: string;
  nights: number;
}

export type BrowseEligibleUnitsPort = (request: BrowseEligibleUnitsRequest) => Promise<unknown>;

// Bound provider/tool turns to keep the development runner responsive (ADR 0079).
const MAX_TOOL_ITERATIONS = 2;

export function createGeminiAgent(options: { browseEligibleUnits: BrowseEligibleUnitsPort }): BuiltInAgent {
  const adapter = new GeminiInteractionsAdapter();
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input, abortSignal }) => streamGeminiAsAgUi(adapter, input, abortSignal, options.browseEligibleUnits)
  });
}

async function* streamGeminiAsAgUi(
  adapter: GeminiInteractionsAdapter,
  input: RunAgentInput,
  abortSignal: AbortSignal,
  browseEligibleUnits: BrowseEligibleUnitsPort
): AsyncIterable<BaseEvent> {
  const messageId = crypto.randomUUID();
  let started = false;
  let messages = [...(input.messages as Message[])];
  for (let step = 0; step < MAX_TOOL_ITERATIONS && !abortSignal.aborted; step += 1) {
    const response = await adapter.getResponse({
      messages,
      tools: [...input.tools, BROWSE_TOOL]
    }, abortSignal);
    const result = await readOpenAiStream(response.stream, abortSignal);
    if (result.text.length > 0) {
      if (!started) {
        started = true;
        yield { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent;
      }
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: result.text } as BaseEvent;
    }
    if (result.toolCalls.length === 0) break;
    const calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.function.name, arguments: call.function.arguments }
    }));
    const toolMessages: Message[] = [];
    for (const call of calls) {
      toolMessages.push({
        id: crypto.randomUUID(),
        role: "tool",
        toolCallId: call.id,
        toolName: call.function.name,
        content: JSON.stringify(await executeToolCall(call, browseEligibleUnits))
      } as unknown as Message);
    }
    messages = [
      ...messages,
      { id: crypto.randomUUID(), role: "assistant", content: undefined, toolCalls: calls } as unknown as Message,
      ...toolMessages
    ];
  }
  if (started) yield { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent;
}

async function readOpenAiStream(
  stream: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal
): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls: AgentToolCall[] = [];
  try {
    while (!abortSignal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split("\n\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        const line = record.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice("data: ".length);
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as { choices: Array<{ delta?: { content?: string; tool_calls?: AgentToolCall[] } }> };
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) text += delta.content;
          if (delta?.tool_calls) toolCalls.push(...delta.tool_calls);
        } catch {
          // Ignore malformed provider chunks; the provider adapter owns validation.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, toolCalls };
}

async function executeToolCall(call: AgentToolCall, browseEligibleUnits: BrowseEligibleUnitsPort): Promise<unknown> {
  if (call.function.name !== "browseEligibleUnits") return { error: "Unsupported tool" };
  let args: { location?: unknown; nights?: unknown } = {};
  try {
    args = JSON.parse(call.function.arguments) as typeof args;
  } catch {
    return { error: "Invalid tool arguments" };
  }
  if (typeof args.location !== "string" || args.location.length === 0 || typeof args.nights !== "number" || !Number.isFinite(args.nights)) {
    return { error: "Invalid tool arguments" };
  }
  return browseEligibleUnits({ location: args.location, nights: args.nights });
}
