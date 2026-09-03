import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GeminiInteractionsClient,
  DEFAULT_GEMINI_MODEL,
} from "../apps/local-guest/src/assistant/gemini-interactions-client.js";
import { ASSISTANT_TOOL_DEFINITIONS } from "../apps/local-guest/src/assistant/assistant-tools.js";

test("GeminiInteractionsClient maps request to Interactions API shape without live network", async () => {
  let capturedParams: any = null;
  let capturedOptions: any = null;

  const mockAi = {
    interactions: {
      async create(params: any, options?: any) {
        capturedParams = params;
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
        };
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
  assert.equal(capturedOptions?.timeout, 15_000);

  // Input mapping assertions
  assert.equal(Array.isArray(capturedParams.input), true);
  assert.equal(capturedParams.input.length, 1);
  assert.equal(capturedParams.input[0].type, "user_input");
  assert.equal(capturedParams.input[0].content[0].parts[0].text, "I need a place in Ikoyi for 3 nights for 2 guests");

  // Tools mapping assertions
  assert.equal(Array.isArray(capturedParams.tools), true);
  assert.equal(capturedParams.tools.length, ASSISTANT_TOOL_DEFINITIONS.length);
  const searchTool = capturedParams.tools.find((t: any) => t.name === "search_stays");
  assert.ok(searchTool, "search_stays tool mapped");
  assert.equal(searchTool.type, "function");

  // Output response parsing
  assert.equal(response.toolCalls?.length, 1);
  assert.equal(response.toolCalls?.[0]?.id, "call-xyz");
  assert.equal(response.toolCalls?.[0]?.name, "search_stays");
  assert.equal(response.toolCalls?.[0]?.args.city, "Lagos");
});

test("GeminiInteractionsClient maps tool results and model outputs accurately", async () => {
  let capturedParams: any = null;

  const mockAi = {
    interactions: {
      async create(params: any) {
        capturedParams = params;
        return {
          id: "int-mock-456",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  role: "model",
                  parts: [{ text: "I found 1 matching stay in Old Ikoyi." }],
                },
              ],
            },
          ],
        };
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

  assert.equal(capturedParams.input.length, 3);
  assert.equal(capturedParams.input[0].type, "user_input");
  assert.equal(capturedParams.input[1].type, "function_call");
  assert.equal(capturedParams.input[1].name, "search_stays");
  assert.equal(capturedParams.input[2].type, "function_result");
  assert.equal(capturedParams.input[2].call_id, "call-1");
  assert.ok(capturedParams.input[2].result.includes("Luxury 2-Bed Ikoyi"));

  assert.equal(response.text, "I found 1 matching stay in Old Ikoyi.");
  assert.equal(response.toolCalls, undefined);
});

test("GeminiInteractionsClient fails closed when apiKey and customAi are missing", () => {
  assert.throws(
    () => new GeminiInteractionsClient({ apiKey: "" }),
    /GEMINI_API_KEY is required/,
  );
});

