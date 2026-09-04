import { test } from "node:test";
import assert from "node:assert/strict";
import { type Interactions } from "@google/genai";
import {
  GeminiInteractionsClient,
  DEFAULT_GEMINI_MODEL,
} from "../apps/local-guest/src/assistant/gemini-interactions-client.js";
import { ASSISTANT_TOOL_DEFINITIONS } from "../apps/local-guest/src/assistant/assistant-tools.js";
import type { AssistantConversationStep } from "../apps/local-guest/src/assistant/assistant-model.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";

test("GeminiInteractionsClient maps request to Interactions API shape without live network", async () => {
  let capturedParams:
    | (Interactions.CreateModelInteractionParamsNonStreaming & {
        readonly generationConfig?: unknown;
      })
    | undefined;
  let capturedOptions: { readonly timeout?: number } | undefined;

  const mockAi = {
    interactions: {
      async create(
        params: Interactions.CreateModelInteractionParamsNonStreaming,
        options?: { readonly timeout?: number },
      ): Promise<Interactions.Interaction> {
        capturedParams = params as typeof capturedParams;
        capturedOptions = options;
        return {
          id: "int-mock-123",
          steps: [
            {
              type: "function_call",
              id: "call-xyz",
              name: "search_stays",
              arguments: {
                city: "Lagos",
                neighbourhood: "Old Ikoyi",
                checkIn: null,
                nights: 3,
                guests: 2,
              },
            },
          ],
          status: "completed",
        } as Interactions.Interaction;
      },
    },
  };

  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: mockAi,
    thinkingLevel: "low",
  });

  const response = await client.generate({
    systemInstruction: "You are the assistant.",
    tools: ASSISTANT_TOOL_DEFINITIONS,
    history: [
      { role: "user", text: "I need a place in Ikoyi for 3 nights for 2 guests" },
    ],
    timeoutMs: 15_000,
  });

  assert.ok(capturedParams, "Interactions create called");
  assert.equal(capturedParams.model, DEFAULT_GEMINI_MODEL);
  assert.equal(capturedParams.store, false, "store: false enforced (ADR-0004)");
  assert.equal(capturedParams.system_instruction, "You are the assistant.");
  assert.equal(capturedParams.generation_config?.thinking_level, "low");
  assert.equal(capturedParams.generationConfig, undefined, "Proves no generationConfig property is emitted");
  assert.equal(capturedOptions?.timeout, 15_000);

  // Input mapping assertions
  const input = capturedParams.input;
  assert.ok(Array.isArray(input));
  assert.equal(input.length, 1);
  assert.equal(input[0].type, "user_input");
  const userInput = input[0] as Interactions.UserInputStep;
  assert.deepEqual(userInput.content, [{ type: "text", text: "I need a place in Ikoyi for 3 nights for 2 guests" }]);

  // Tools mapping assertions
  const tools = capturedParams.tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools.length, ASSISTANT_TOOL_DEFINITIONS.length);
  const searchTool = tools.find((tool) => tool.type === "function" && tool.name === "search_stays");
  assert.ok(searchTool, "search_stays tool mapped");
  assert.equal(searchTool.type, "function");

  // Output response parsing
  assert.equal(response.toolCalls?.length, 1);
  assert.equal(response.toolCalls?.[0]?.id, "call-xyz");
  assert.equal(response.toolCalls?.[0]?.name, "search_stays");
  assert.equal(response.toolCalls?.[0]?.args.city, "Lagos");
});

test("GeminiInteractionsClient maps tool results and model outputs accurately", async () => {
  let capturedParams: Interactions.CreateModelInteractionParamsNonStreaming | undefined;

  const mockAi = {
    interactions: {
      async create(params: Interactions.CreateModelInteractionParamsNonStreaming): Promise<Interactions.Interaction> {
        capturedParams = params;
        return {
          id: "int-mock-456",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: "I found 1 matching stay in Old Ikoyi." }],
            },
          ],
          status: "completed",
        } as Interactions.Interaction;
      },
    },
  };

  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: mockAi,
  });

  const response = await client.generate({
    systemInstruction: "You are the assistant.",
    tools: ASSISTANT_TOOL_DEFINITIONS,
    history: [
      { role: "user", text: "Find Ikoyi place" },
      {
        role: "tool_calls",
        calls: [{ id: "call-1", name: "search_stays", args: { city: "Lagos", nights: 3, guests: 2, checkIn: null } }],
      },
      {
        role: "tool_results",
        results: [
          {
            callId: "call-1",
            name: "search_stays",
            result: { resultCount: 1, stays: [{ stayRef: "stay-1", title: "Luxury 2-Bed Ikoyi" }] },
          },
        ],
      },
    ],
  });

  assert.ok(capturedParams);
  assert.ok(Array.isArray(capturedParams.input));
  assert.equal(capturedParams.input.length, 3);
  assert.equal(capturedParams.input[0].type, "user_input");
  assert.equal(capturedParams.input[1].type, "function_call");
  assert.equal(capturedParams.input[1].name, "search_stays");
  assert.equal(capturedParams.input[2].type, "function_result");
  const toolResult = capturedParams.input[2] as Interactions.FunctionResultStep;
  assert.equal(toolResult.call_id, "call-1");
  assert.equal(toolResult.name, "search_stays");
  assert.ok(Array.isArray(toolResult.result));
  assert.equal(toolResult.result.length, 1);
  const content = toolResult.result[0];
  assert.equal(content?.type, "text");
  assert.ok(content?.type === "text" && content.text.includes("Luxury 2-Bed Ikoyi"));

  assert.equal(response.text, "I found 1 matching stay in Old Ikoyi.");
  assert.equal(response.toolCalls, undefined);
});

test("GeminiInteractionsClient always disables provider storage", async () => {
  let store: boolean | undefined;
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(params: Interactions.CreateModelInteractionParamsNonStreaming): Promise<Interactions.Interaction> {
      store = params.store;
      return { id: "int-store", status: "completed", steps: [] } as Interactions.Interaction;
    } } },
  });

  await client.generate({ systemInstruction: "System", tools: [], history: [] });

  assert.equal(store, false);
});

test("GeminiInteractionsClient rejects a provider function call without an id", async () => {
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(): Promise<Interactions.Interaction> {
      return {
        id: "int-invalid-call",
        status: "completed",
        steps: [{ type: "function_call", name: "search_stays", arguments: {} }],
      } as unknown as Interactions.Interaction;
    } } },
  });

  await assert.rejects(
    client.generate({ systemInstruction: "System", tools: [], history: [] }),
    /function_call step is structurally invalid/,
  );
});

test("GeminiInteractionsClient preserves provider function-call steps across stateless tool turns", async () => {
  const providerStep: Interactions.FunctionCallStep = {
    type: "function_call",
    id: "provider-call-1",
    name: "search_stays",
    arguments: { city: "Lagos" },
  };
  let capturedInput: Interactions.CreateModelInteractionParamsNonStreaming["input"] | undefined;
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(params: Interactions.CreateModelInteractionParamsNonStreaming): Promise<Interactions.Interaction> {
      capturedInput = params.input;
      return { id: "int-raw-step", status: "completed", steps: [] } as Interactions.Interaction;
    } } },
  });

  await client.generate({
    systemInstruction: "System",
    tools: [],
    history: [{
      role: "tool_calls",
      calls: [{ id: "normalized-call", name: "search_stays", args: { city: "Abuja" } }],
      rawStep: [providerStep],
    }],
  });

  assert.ok(Array.isArray(capturedInput));
  assert.equal(capturedInput[0], providerStep);
});

test("GeminiInteractionsClient uses output_text as the primary response text", async () => {
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(): Promise<Interactions.Interaction> {
      return {
        id: "int-output-text",
        status: "completed",
        output_text: "Primary SDK text",
        steps: [{ type: "model_output", content: [{ type: "text", text: "Fallback step text" }] }],
      } as Interactions.Interaction;
    } } },
  });

  const response = await client.generate({ systemInstruction: "System", tools: [], history: [] });

  assert.equal(response.text, "Primary SDK text");
});

test("GeminiInteractionsClient fails closed when apiKey and customAi are missing", () => {
  assert.throws(
    () => new GeminiInteractionsClient({ apiKey: "" }),
    /GEMINI_API_KEY is required/,
  );
});

test("GeminiInteractionsClient preserves thought steps with signatures and model_output across stateless turns", async () => {
  const thoughtStep: Interactions.ThoughtStep = {
    type: "thought",
    signature: "sig-thought-turn-1-alpha",
  };
  const modelOutputStep: Interactions.ModelOutputStep = {
    type: "model_output",
    content: [{ type: "text", text: "How many nights and guests?" }],
  };

  let capturedInputTurn2: Interactions.CreateModelInteractionParamsNonStreaming["input"] | undefined;

  const mockAi = {
    interactions: {
      async create(params: Interactions.CreateModelInteractionParamsNonStreaming): Promise<Interactions.Interaction> {
        capturedInputTurn2 = params.input;
        return {
          id: "int-turn-2",
          status: "completed",
          steps: [
            {
              type: "function_call",
              id: "call-turn-2",
              name: "search_stays",
              arguments: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 },
            },
          ],
        } as Interactions.Interaction;
      },
    },
  };

  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: mockAi,
  });

  // Turn 1 stored in conversation history with rawStep holding exact thought and model_output steps
  const turn1AssistantHistoryStep: AssistantConversationStep = {
    role: "assistant",
    text: "How many nights and guests?",
    rawStep: [thoughtStep, modelOutputStep],
  };

  // Turn 2 request
  await client.generate({
    systemInstruction: "You are the assistant.",
    tools: ASSISTANT_TOOL_DEFINITIONS,
    history: [
      { role: "user", text: "I need somewhere in Ikoyi." },
      turn1AssistantHistoryStep,
      { role: "user", text: "Four nights for two people." },
    ],
  });

  assert.ok(Array.isArray(capturedInputTurn2), "Turn 2 input is an array");
  assert.equal(capturedInputTurn2.length, 4, "user_input -> thought -> model_output -> user_input");

  // Verify user turn 1
  assert.equal(capturedInputTurn2[0].type, "user_input");

  // Verify exact thought step preserved with signature
  assert.equal(capturedInputTurn2[1], thoughtStep, "Exact thought step with signature is preserved without reconstruction");
  assert.equal(capturedInputTurn2[1].type, "thought");
  assert.equal((capturedInputTurn2[1] as Interactions.ThoughtStep).signature, "sig-thought-turn-1-alpha");

  // Verify exact model_output step preserved
  assert.equal(capturedInputTurn2[2], modelOutputStep, "Exact model_output step is preserved without reconstruction");
  assert.equal(capturedInputTurn2[2].type, "model_output");

  // Verify user turn 2
  assert.equal(capturedInputTurn2[3].type, "user_input");
});

test("GeminiInteractionsClient replays signed thought and function-call steps with documented function-result content before the next model output", async () => {
  const thoughtStep: Interactions.ThoughtStep = { type: "thought", signature: "signed-search-thought" };
  const functionCallStep: Interactions.FunctionCallStep = {
    type: "function_call",
    id: "provider-call-search-1",
    name: "search_stays",
    arguments: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 },
  };
  const requests: Interactions.CreateModelInteractionParamsNonStreaming[] = [];
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(params): Promise<Interactions.Interaction> {
      requests.push(params);
      if (requests.length === 1) {
        return { id: "interaction-tool-call", status: "completed", steps: [thoughtStep, functionCallStep] } as Interactions.Interaction;
      }
      return {
        id: "interaction-model-output",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "I found one matching stay." }] }],
      } as Interactions.Interaction;
    } } },
  });

  const first = await client.generate({
    systemInstruction: "System",
    tools: ASSISTANT_TOOL_DEFINITIONS,
    history: [{ role: "user", text: "Ikoyi for four nights and two guests" }],
  });
  const second = await client.generate({
    systemInstruction: "System",
    tools: ASSISTANT_TOOL_DEFINITIONS,
    history: [
      { role: "user", text: "Ikoyi for four nights and two guests" },
      { role: "tool_calls", calls: first.toolCalls!, rawStep: first.rawStep },
      {
        role: "tool_results",
        results: [{ callId: "provider-call-search-1", name: "search_stays", result: { resultCount: 1, authoritative: true } }],
      },
    ],
  });

  assert.equal(requests.length, 2);
  const continuation = requests[1]!.input;
  assert.ok(Array.isArray(continuation));
  assert.equal(continuation[0]?.type, "user_input");
  assert.equal(continuation[1], thoughtStep, "exact signed thought step is replayed");
  assert.equal(continuation[2], functionCallStep, "exact provider function_call is replayed");
  const resultStep = continuation[3] as Interactions.FunctionResultStep;
  assert.equal(resultStep.type, "function_result");
  assert.equal(resultStep.call_id, functionCallStep.id);
  assert.equal(resultStep.name, functionCallStep.name);
  assert.deepEqual(resultStep.result, [{ type: "text", text: JSON.stringify({ resultCount: 1, authoritative: true }) }]);
  assert.equal(second.text, "I found one matching stay.");
});

test("AssistantRuntime executes the full stateless user-to-tool-to-function-result-to-model-output Interactions sequence", async () => {
  const thoughtStep: Interactions.ThoughtStep = { type: "thought", signature: "runtime-signed-thought" };
  const functionCallStep: Interactions.FunctionCallStep = {
    type: "function_call",
    id: "runtime-provider-call",
    name: "search_stays",
    arguments: { city: "LAGOS", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 },
  };
  const requests: Interactions.CreateModelInteractionParamsNonStreaming[] = [];
  const client = new GeminiInteractionsClient({
    apiKey: "fake-key-offline",
    customAi: { interactions: { async create(params): Promise<Interactions.Interaction> {
      requests.push(params);
      return requests.length === 1
        ? { id: "runtime-tool", status: "completed", steps: [thoughtStep, functionCallStep] } as Interactions.Interaction
        : { id: "runtime-output", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Authoritative search complete." }] }] } as Interactions.Interaction;
    } } },
  });
  const env = new LocalGuestEnvironment({ databasePath: `.scratch/eval-test/runtime_protocol_${Date.now()}.sqlite` });
  try {
    const response = await new AssistantRuntime(env, client).handleTurn("runtime-protocol", "Ikoyi for four nights and two guests");

    assert.equal(response.ok, true);
    assert.equal(response.messages?.[0], "Authoritative search complete.");
    assert.equal(requests.length, 2);
    const continuation = requests[1]!.input;
    assert.ok(Array.isArray(continuation));
    assert.equal(continuation[0]?.type, "user_input");
    assert.equal(continuation[1], thoughtStep);
    assert.equal(continuation[2], functionCallStep);
    const result = continuation[3] as Interactions.FunctionResultStep;
    assert.equal(result.call_id, functionCallStep.id);
    assert.equal(result.name, functionCallStep.name);
    assert.ok(Array.isArray(result.result));
    assert.equal(result.result.length, 1);
    assert.equal(result.result[0]?.type, "text");
    assert.match(result.result[0]?.type === "text" ? result.result[0].text : "", /"resultCount":1/);
  } finally {
    env.close();
  }
});
