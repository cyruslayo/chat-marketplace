import test from "node:test";
import assert from "node:assert/strict";
import type { AIMessage, Message, ToolResult } from "@copilotkit/shared";
import {
  GeminiInteractionsAdapter,
  transformMessagesToGeminiInput,
  transformToolsToGemini,
  textDeltaToOpenAIChunk,
  functionCallToOpenAIChunk
} from "../apps/web-agent/src/index.js";

function userMessage(id: string, content: string): Message {
  return { id, role: "user", content };
}
function systemMessage(id: string, content: string): Message {
  return { id, role: "system", content };
}
function assistantMessage(id: string, content: string | undefined, toolCalls?: AIMessage["toolCalls"]): Message {
  return { id, role: "assistant", content, toolCalls } as Message;
}
function toolMessage(id: string, toolCallId: string, content: string, name?: string): ToolResult {
  return { id, role: "tool", toolCallId, content, ...(name ? { toolName: name } : {}) };
}

test("transforms user/system/assistant/tool messages into Gemini input turns with system_instruction", () => {
  const { systemInstruction, input } = transformMessagesToGeminiInput([
    systemMessage("s1", "You are the Shortlet Concierge."),
    userMessage("u1", "Find a unit in Lagos"),
    assistantMessage("a1", "Let me look.", [
      { id: "c1", type: "function", function: { name: "browseEligibleUnits", arguments: JSON.stringify({ location: "Lagos", nights: 2 }) } }
    ]),
    toolMessage("t1", "c1", JSON.stringify({ results: [] }), "browseEligibleUnits"),
    userMessage("u2", "Show me the price")
  ]);

  assert.equal(systemInstruction, "You are the Shortlet Concierge.");
  assert.deepEqual(input, [
    { role: "user", content: [{ type: "text", text: "Find a unit in Lagos" }] },
    { role: "model", content: [{ type: "text", text: "Let me look." }] },
    {
      type: "function_call",
      id: "c1",
      name: "browseEligibleUnits",
      arguments: { location: "Lagos", nights: 2 }
    },
    {
      type: "function_result",
      call_id: "c1",
      name: "browseEligibleUnits",
      result: { results: [] }
    },
    { role: "user", content: [{ type: "text", text: "Show me the price" }] }
  ]);
});

test("assistant message with only tool calls and no text maps to function_call steps only", () => {
  const { input } = transformMessagesToGeminiInput([
    assistantMessage("a1", undefined, [
      { id: "c1", type: "function", function: { name: "browseEligibleUnits", arguments: "{}" } }
    ])
  ]);
  assert.deepEqual(input, [
    { type: "function_call", id: "c1", name: "browseEligibleUnits", arguments: {} }
  ]);
});

test("malformed function arguments fall back to an empty object instead of throwing", () => {
  const { input } = transformMessagesToGeminiInput([
    assistantMessage("a1", undefined, [{ id: "c1", type: "function", function: { name: "browseEligibleUnits", arguments: "not-json" } }])
  ]);
  assert.deepEqual((input[0] as { arguments: unknown }).arguments, {});
});

test("tool error surfaces as a function_result error instead of parsing content", () => {
  const { input } = transformMessagesToGeminiInput([
    { ...toolMessage("t1", "c1", "oops", "browseEligibleUnits"), error: "boom" }
  ]);
  assert.deepEqual(input, [
    { type: "function_result", call_id: "c1", name: "browseEligibleUnits", result: { error: "boom" } }
  ]);
});

test("system messages after the first are ignored for system_instruction", () => {
  const { systemInstruction } = transformMessagesToGeminiInput([
    systemMessage("s1", "first"),
    systemMessage("s2", "second")
  ]);
  assert.equal(systemInstruction, "first");
});

test("transforms CopilotKit tools into SDK FunctionT declarations", () => {
  const geminiTools = transformToolsToGemini([
    {
      type: "function",
      function: { name: "browseEligibleUnits", description: "Search units", parameters: { type: "object" } }
    },
    { type: "function", function: { name: "noParams" } },
    { notAFunction: true }
  ]);
  assert.deepEqual(geminiTools, [
    { type: "function", name: "browseEligibleUnits", description: "Search units", parameters: { type: "object" } },
    { type: "function", name: "noParams" }
  ]);
});

test("empty or malformed tool list produces no SDK tools", () => {
  assert.deepEqual(transformToolsToGemini([]), []);
  assert.deepEqual(transformToolsToGemini([{}]), []);
});

test("text delta produces an OpenAI-format text chunk", () => {
  const chunk = textDeltaToOpenAIChunk({
    event_type: "step.delta",
    index: 0,
    delta: { type: "text", text: "Hello" }
  } as never);
  assert.deepEqual(chunk, { choices: [{ delta: { role: "assistant", content: "Hello" } }] });
});

test("function call produces an OpenAI tool_calls chunk with accumulated arguments", () => {
  const chunk = functionCallToOpenAIChunk(
    { id: "fn-1", name: "browseEligibleUnits", arguments: '{"location":"Lagos"}' },
    2
  );
  assert.deepEqual(chunk, {
    choices: [
      {
        delta: {
          role: "assistant",
          content: "",
          tool_calls: [
            { index: 2, id: "fn-1", type: "function", function: { name: "browseEligibleUnits", arguments: '{"location":"Lagos"}' } }
          ]
        }
      }
    ]
  });
});

function makeSdkEvent(type: string, extra: Record<string, unknown> = {}): never {
  return { event_type: type, ...extra } as never;
}

test("getResponse streams SDK events and emits OpenAI text chunks then [DONE]", async () => {
  const sdkEvents = [
    makeSdkEvent("interaction.created", { interaction: { id: "i1", status: "in_progress" } }),
    makeSdkEvent("step.start", { index: 0, step: { type: "model_output" } }),
    makeSdkEvent("step.delta", { index: 0, delta: { type: "text", text: "Hello" } }),
    makeSdkEvent("step.delta", { index: 0, delta: { type: "text", text: " world" } }),
    makeSdkEvent("step.stop", { index: 0 }),
    makeSdkEvent("interaction.completed", { interaction: { id: "i1", status: "completed" } })
  ];
  const stream = new ReadableStream<never>({
    start(controller) {
      for (const e of sdkEvents) controller.enqueue(e);
      controller.close();
    }
  });

  const originalCreate = (globalThis as unknown as Record<string, unknown>).__geminiCreate;
  const adapter = new GeminiInteractionsAdapter({ apiKey: "test-key" });
  // Stub the SDK's interactions.create on the adapter instance.
  (adapter as unknown as { ai: { interactions: { create: () => Promise<typeof stream> } } }).ai = {
    interactions: { create: async () => stream }
  } as never;

  try {
    const result = await adapter.getResponse({ messages: [userMessage("u1", "Hi")], tools: [] });
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let all = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      all += decoder.decode(value);
    }
    assert.match(all, /data: \{"choices":\[\{"delta":\{"role":"assistant","content":"Hello"\}\}\]\}/);
    assert.match(all, /data: \{"choices":\[\{"delta":\{"role":"assistant","content":" world"\}\}\]\}/);
    assert.match(all, /data: \[DONE\]/);
    void originalCreate;
  } finally {
    (adapter as unknown as { ai: unknown }).ai = undefined as never;
  }
});

test("getResponse accumulates arguments_delta and emits a tool_calls chunk on step.stop", async () => {
  const sdkEvents = [
    makeSdkEvent("step.start", { index: 0, step: { type: "function_call", id: "fn-1", name: "browseEligibleUnits", arguments: {} } }),
    makeSdkEvent("step.delta", { index: 0, delta: { type: "arguments_delta", arguments: '{"location"' } }),
    makeSdkEvent("step.delta", { index: 0, delta: { type: "arguments_delta", arguments: ':"Lagos"}' } }),
    makeSdkEvent("step.stop", { index: 0 }),
    makeSdkEvent("interaction.completed", { interaction: { id: "i1", status: "requires_action" } })
  ];
  const stream = new ReadableStream<never>({
    start(controller) {
      for (const e of sdkEvents) controller.enqueue(e);
      controller.close();
    }
  });

  const adapter = new GeminiInteractionsAdapter({ apiKey: "test-key" });
  (adapter as unknown as { ai: { interactions: { create: () => Promise<typeof stream> } } }).ai = {
    interactions: { create: async () => stream }
  } as never;

  try {
    const result = await adapter.getResponse({ messages: [userMessage("u1", "Hi")], tools: [] });
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    let all = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      all += decoder.decode(value);
    }
    assert.match(all, /browseEligibleUnits/);
    assert.match(all, /location/);
    assert.match(all, /Lagos/);
    assert.match(all, /data: \[DONE\]/);
  } finally {
    (adapter as unknown as { ai: unknown }).ai = undefined as never;
  }
});

test("getResponse fails cleanly when the API key is missing", () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.throws(() => new GeminiInteractionsAdapter(), /GEMINI_API_KEY is required/);
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
  }
});

test("getResponse surfaces an upstream SDK error as a thrown error", async () => {
  const adapter = new GeminiInteractionsAdapter({ apiKey: "test-key" });
  (adapter as unknown as { ai: { interactions: { create: () => Promise<never> } } }).ai = {
    interactions: {
      create: async () => {
        throw new Error("401 UNAUTHENTICATED");
      }
    }
  } as never;

  await assert.rejects(
    () => adapter.getResponse({ messages: [userMessage("u1", "Hi")], tools: [] }),
    /Gemini Interactions API request failed/
  );
});

test("getResponse passes model, stream, store, system_instruction, tools, and input to the SDK", async () => {
  let captured: Record<string, unknown> | undefined;
  const adapter = new GeminiInteractionsAdapter({ apiKey: "test-key" });
  (adapter as unknown as { ai: { interactions: { create: (params: Record<string, unknown>) => Promise<ReadableStream<never>> } } }).ai = {
    interactions: {
      create: async (params: Record<string, unknown>) => {
        captured = params;
        return new ReadableStream<never>({
          start(controller) {
            controller.close();
          }
        });
      }
    }
  } as never;

  await adapter.getResponse({
    messages: [systemMessage("s1", "Be concise."), userMessage("u1", "Hi")],
    tools: [{ type: "function", function: { name: "browseEligibleUnits", description: "Search", parameters: { type: "object" } } }]
  });
  assert.ok(captured);
  assert.equal(captured!.model, "gemini-3.5-flash");
  assert.equal(captured!.stream, true);
  assert.equal(captured!.store, false);
  assert.equal(captured!.system_instruction, "Be concise.");
  assert.deepEqual(captured!.tools, [
    { type: "function", name: "browseEligibleUnits", description: "Search", parameters: { type: "object" } }
  ]);
  assert.deepEqual(captured!.input, [{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
});
