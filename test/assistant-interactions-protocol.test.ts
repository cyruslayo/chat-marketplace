import { test } from "node:test";
import assert from "node:assert/strict";
import { type Interactions, ThinkingLevel } from "@google/genai";
import {
  GeminiInteractionsClient,
  DEFAULT_GEMINI_MODEL,
} from "../apps/local-guest/src/assistant/gemini-interactions-client.js";
import { ASSISTANT_TOOL_DEFINITIONS } from "../apps/local-guest/src/assistant/assistant-tools.js";

test("GeminiInteractionsClient maps request to Interactions API shape without live network", async () => {
  let capturedParams:
    | (Interactions.CreateModelInteractionParamsNonStreaming & {
        readonly generationConfig?: { readonly thinkingConfig?: { readonly thinkingLevel?: ThinkingLevel } };
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
  assert.equal(capturedParams.generationConfig?.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
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
  assert.equal(capturedParams.input[2].call_id, "call-1");
  const toolResult = capturedParams.input[2] as Interactions.FunctionResultStep;
  assert.ok(typeof toolResult.result === "string");
  assert.ok(toolResult.result.includes("Luxury 2-Bed Ikoyi"));

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
