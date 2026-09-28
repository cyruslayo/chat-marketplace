import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interactions } from "@google/genai";
import {
  conciergeStartupFields,
  createConciergeModelClient,
  loadConciergeConfiguration,
  type ConciergeEnvironmentSource,
} from "../apps/local-guest/src/assistant/concierge-configuration.js";
import { FallbackModelClient } from "../apps/local-guest/src/assistant/fallback-model-client.js";
import { GeminiInteractionsClient } from "../apps/local-guest/src/assistant/gemini-interactions-client.js";
import { OpenAiCompatibleClient, APIConnectionError, APIError, RateLimitError } from "../apps/local-guest/src/assistant/openai-compatible-client.js";
import type { AssistantConversationStep, AssistantModelClient, AssistantModelRequest } from "../apps/local-guest/src/assistant/assistant-model.js";
import { productionPilotStartupLines } from "../apps/pilot/src/startup-banner.js";

const DEEPSEEK: ConciergeEnvironmentSource = {
  LLM_API_KEY: "sk-deepseek-offline",
  LLM_BASE_URL: "https://api.deepseek.com",
  LLM_MODEL: "deepseek-chat",
  LLM_PROVIDER_LABEL: "deepseek",
};

const request: AssistantModelRequest = { systemInstruction: "You are the assistant.", tools: [], history: [{ role: "user", text: "Hello" }] };

function recordingClient(respond: () => Promise<{ readonly text: string }>): AssistantModelClient & { calls: number } {
  const client = {
    calls: 0,
    async generate() { client.calls++; return respond(); },
  };
  return client;
}

// Shapes of the Gemini SDK errors, which the fallback classifies by status or class name.
class InternalServerError extends Error { readonly status = 500; }
class BadRequestError extends Error { readonly status = 400; }
class APIConnectionTimeoutError extends Error {}

test("CONCIERGE_MODE must be deterministic, gemini or openai-compatible; any other value fails startup", () => {
  assert.equal(loadConciergeConfiguration({}).mode, "deterministic");
  assert.equal(loadConciergeConfiguration({ CONCIERGE_MODE: "deterministic" }).primary, null);
  assert.equal(loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k" }).mode, "gemini");
  assert.equal(loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", ...DEEPSEEK }).mode, "openai-compatible");
  for (const mode of ["Gemini", "gemni", "openai", "deepseek", "assistant-offline"]) {
    assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: mode, GEMINI_API_KEY: "k", ...DEEPSEEK }), /CONCIERGE_MODE must be/);
  }
  assert.equal(createConciergeModelClient(loadConciergeConfiguration({})), undefined);
});

test("gemini requires GEMINI_API_KEY; openai-compatible requires LLM_API_KEY, an HTTPS LLM_BASE_URL and LLM_MODEL", () => {
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "gemini" }), /GEMINI_API_KEY/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "  " }), /GEMINI_API_KEY/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k", GEMINI_THINKING_LEVEL: "extreme" }), /GEMINI_THINKING_LEVEL/);
  const gemini = loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k" });
  assert.ok(createConciergeModelClient(gemini) instanceof GeminiInteractionsClient);

  for (const missing of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"] as const) {
    assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", ...DEEPSEEK, [missing]: "" }), /LLM_API_KEY, LLM_BASE_URL and LLM_MODEL/);
  }
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", ...DEEPSEEK, LLM_BASE_URL: "http://api.deepseek.com" }), /HTTPS/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", ...DEEPSEEK, LLM_PROVIDER_LABEL: "Deep Seek!" }), /LLM_PROVIDER_LABEL/);
  const deepseek = loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", ...DEEPSEEK });
  assert.ok(createConciergeModelClient(deepseek) instanceof OpenAiCompatibleClient);
});

test("CONCIERGE_FALLBACK=openai-compatible is accepted only with a gemini primary and requires the LLM_* settings", () => {
  const withFallback = loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k", CONCIERGE_FALLBACK: "openai-compatible", ...DEEPSEEK });
  assert.equal(withFallback.fallback?.label, "deepseek");
  assert.ok(createConciergeModelClient(withFallback) instanceof FallbackModelClient);

  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k", CONCIERGE_FALLBACK: "openai-compatible" }), /LLM_API_KEY, LLM_BASE_URL and LLM_MODEL/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "k", CONCIERGE_FALLBACK: "deepseek", ...DEEPSEEK }), /CONCIERGE_FALLBACK must be/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_FALLBACK: "openai-compatible", ...DEEPSEEK }), /only supported with CONCIERGE_MODE=gemini/);
  assert.throws(() => loadConciergeConfiguration({ CONCIERGE_MODE: "openai-compatible", CONCIERGE_FALLBACK: "openai-compatible", ...DEEPSEEK }), /only supported with CONCIERGE_MODE=gemini/);
});

test("The fallback client uses the secondary provider only when the primary fails with a connection error, a rate limit or a server error", async () => {
  const unavailable: readonly Error[] = [
    new APIConnectionError("connection_failed"),
    new APIConnectionError("timeout"),
    new APIConnectionTimeoutError("timed out"),
    new RateLimitError(429),
    new APIError(503),
    new InternalServerError("overloaded"),
  ];
  for (const failure of unavailable) {
    const primary = recordingClient(async () => { throw failure; });
    const secondary = recordingClient(async () => ({ text: "From the fallback" }));
    const response = await new FallbackModelClient(primary, secondary).generate(request);
    assert.equal(response.text, "From the fallback", failure.constructor.name);
    assert.equal(secondary.calls, 1);
  }

  const failClosed: readonly Error[] = [
    new APIError(400),
    new APIError(401),
    new BadRequestError("bad request"),
    new Error("Gemini function_call step is structurally invalid"),
  ];
  for (const failure of failClosed) {
    const primary = recordingClient(async () => { throw failure; });
    const secondary = recordingClient(async () => ({ text: "From the fallback" }));
    await assert.rejects(new FallbackModelClient(primary, secondary).generate(request), (error: unknown) => error === failure);
    assert.equal(secondary.calls, 0, failure.message);
  }

  const healthy = recordingClient(async () => ({ text: "From the primary" }));
  const unused = recordingClient(async () => ({ text: "From the fallback" }));
  assert.equal((await new FallbackModelClient(healthy, unused).generate(request)).text, "From the primary");
  assert.equal(unused.calls, 0);
});

test("A provider never receives another provider's rawStep; history is rebuilt from the neutral fields", async () => {
  const geminiInputs: Interactions.Step[][] = [];
  let geminiDown = true;
  const gemini = new GeminiInteractionsClient({
    apiKey: "gemini-offline",
    customAi: {
      interactions: {
        async create(params) {
          geminiInputs.push(params.input as Interactions.Step[]);
          if (geminiDown) throw new InternalServerError("overloaded");
          return { id: "int-1", status: "completed", output_text: "Back on Gemini", steps: [] } as unknown as Interactions.Interaction;
        },
      },
    },
  });
  const deepseekBodies: string[] = [];
  const deepseek = new OpenAiCompatibleClient({
    apiKey: "sk-deepseek-offline",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    fetch: async (_url, init) => {
      deepseekBodies.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "ds-call-1", type: "function", function: { name: "search_stays", arguments: "{\"city\":\"Lagos\"}" } }] } }] }), { status: 200 });
    },
  });
  const client = new FallbackModelClient(gemini, deepseek);

  // A thread that already holds an opaque Gemini step, answered by DeepSeek while Gemini is down.
  const history: AssistantConversationStep[] = [
    { role: "user", text: "Lagos please" },
    { role: "assistant", text: "How many nights?", rawStep: [{ type: "model_output", content: [{ type: "text", text: "How many nights?" }], signature: "gemini-opaque-signature" }] },
    { role: "user", text: "Two nights" },
  ];
  const fallbackResponse = await client.generate({ systemInstruction: "sys", tools: [], history });
  assert.equal(deepseekBodies.length, 1);
  assert.doesNotMatch(deepseekBodies[0]!, /gemini-opaque-signature/);
  assert.equal(fallbackResponse.rawStep, undefined);

  // Gemini recovers and receives DeepSeek's tool call rebuilt from the neutral fields only.
  geminiDown = false;
  history.push({ role: "tool_calls", calls: fallbackResponse.toolCalls!, rawStep: fallbackResponse.rawStep });
  history.push({ role: "tool_results", results: [{ callId: "ds-call-1", name: "search_stays", result: { resultCount: 1 } }] });
  const recovered = await client.generate({ systemInstruction: "sys", tools: [], history });
  assert.equal(recovered.text, "Back on Gemini");
  const lastInput = geminiInputs.at(-1)!;
  assert.deepEqual(lastInput.find((step) => step.type === "function_call"), { type: "function_call", id: "ds-call-1", name: "search_stays", arguments: { city: "Lagos" } });
  assert.doesNotMatch(JSON.stringify(lastInput), /"choices"|"tool_calls"|"role"/);
});

test("The startup banner shows the concierge mode, model and fallback, and no key", () => {
  const configuration = loadConciergeConfiguration({
    CONCIERGE_MODE: "gemini",
    GEMINI_API_KEY: "gemini-secret-key",
    GEMINI_MODEL: "gemini-3.8-flash",
    CONCIERGE_FALLBACK: "openai-compatible",
    ...DEEPSEEK,
  });
  assert.deepEqual(conciergeStartupFields(configuration), ["concierge=gemini", "model=gemini:gemini-3.8-flash", "fallback=deepseek:deepseek-chat"]);
  assert.deepEqual(conciergeStartupFields(loadConciergeConfiguration({})), ["concierge=deterministic"]);

  const banner = productionPilotStartupLines({ publicOrigin: "https://stays.example", paystackEnvironment: "live", port: 8080, concierge: configuration }).join("\n");
  assert.match(banner, /concierge=gemini/);
  assert.match(banner, /fallback=deepseek:deepseek-chat/);
  assert.doesNotMatch(banner, /gemini-secret-key|sk-deepseek-offline|api\.deepseek\.com/);
});
