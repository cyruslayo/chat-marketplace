import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APIConnectionError,
  APIError,
  DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS,
  OpenAiCompatibleClient,
  RateLimitError,
  type OpenAiCompatibleClientConfig,
} from "../apps/local-guest/src/assistant/openai-compatible-client.js";
import { DEFAULT_GEMINI_TIMEOUT_MS } from "../apps/local-guest/src/assistant/gemini-interactions-client.js";
import { ASSISTANT_TOOL_DEFINITIONS } from "../apps/local-guest/src/assistant/assistant-tools.js";
import type { AssistantModelRequest } from "../apps/local-guest/src/assistant/assistant-model.js";

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function completion(message: Record<string, unknown>): Response {
  return jsonResponse(200, { id: "cmpl-1", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }] });
}

function clientWith(
  respond: (captured: CapturedRequest, attempt: number) => Promise<Response> | Response,
  overrides: Partial<OpenAiCompatibleClientConfig> = {},
): { readonly client: OpenAiCompatibleClient; readonly requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const client = new OpenAiCompatibleClient({
    apiKey: "sk-offline-test",
    baseUrl: "https://api.deepseek.com/",
    model: "deepseek-chat",
    fetch: async (url, init) => {
      const captured = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      requests.push(captured);
      return respond(captured, requests.length);
    },
    ...overrides,
  });
  return { client, requests };
}

const request: AssistantModelRequest = {
  systemInstruction: "You are the assistant.",
  tools: ASSISTANT_TOOL_DEFINITIONS.filter((tool) => tool.name === "search_stays"),
  history: [
    { role: "user", text: "Lagos for 2 nights" },
    { role: "tool_calls", calls: [{ id: "call-1", name: "search_stays", args: { city: "Lagos", nights: 2 } }], rawStep: [{ type: "function_call", id: "gemini-only" }] },
    { role: "tool_results", results: [{ callId: "call-1", name: "search_stays", result: { resultCount: 2 } }] },
    { role: "assistant", text: "I found 2 places.", rawStep: [{ type: "model_output" }] },
    { role: "user", text: "Show me the first one" },
  ],
};

test("The request maps the system instruction, user and assistant turns, tool calls and tool results onto Chat Completions messages, and tool definitions onto tools[].function", async () => {
  const { client, requests } = clientWith(() => completion({ content: "Here it is." }));
  await client.generate(request);

  assert.equal(requests.length, 1);
  const [captured] = requests;
  assert.equal(captured!.url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured!.init.method, "POST");
  assert.equal((captured!.init.headers as Record<string, string>).Authorization, "Bearer sk-offline-test");
  assert.equal(captured!.body.model, "deepseek-chat");
  assert.deepEqual(captured!.body.messages, [
    { role: "system", content: "You are the assistant." },
    { role: "user", content: "Lagos for 2 nights" },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_stays", arguments: JSON.stringify({ city: "Lagos", nights: 2 }) } }] },
    { role: "tool", tool_call_id: "call-1", content: JSON.stringify({ resultCount: 2 }) },
    { role: "assistant", content: "I found 2 places." },
    { role: "user", content: "Show me the first one" },
  ]);
  const searchStays = ASSISTANT_TOOL_DEFINITIONS.find((tool) => tool.name === "search_stays")!;
  assert.deepEqual(captured!.body.tools, [{ type: "function", function: { name: "search_stays", description: searchStays.description, parameters: searchStays.parametersSchema } }]);
  // ADR-0070: another provider's opaque steps are never replayed.
  assert.doesNotMatch(String(captured!.init.body), /gemini-only|model_output/);

  const noTools = clientWith(() => completion({ content: "Hello" }));
  await noTools.client.generate({ ...request, tools: [] });
  assert.equal("tools" in noTools.requests[0]!.body, false);
});

test("Tool calls in the response become AssistantToolCalls; a tool call with a missing id or name, or arguments that are not a JSON object, fails closed", async () => {
  const valid = clientWith(() => completion({
    content: null,
    tool_calls: [{ id: "call-9", type: "function", function: { name: "get_unit_details", arguments: "{\"unitId\":\"unit-1\"}" } }],
  }));
  const response = await valid.client.generate(request);
  assert.deepEqual(response.toolCalls, [{ id: "call-9", name: "get_unit_details", args: { unitId: "unit-1" } }]);
  assert.equal(response.text, undefined);
  assert.equal(response.rawStep, undefined);

  const text = await clientWith(() => completion({ content: "  Plain reply  " })).client.generate(request);
  assert.equal(text.text, "Plain reply");
  assert.equal(text.toolCalls, undefined);

  const invalidCalls: readonly unknown[] = [
    { type: "function", function: { name: "search_stays", arguments: "{}" } },
    { id: "", type: "function", function: { name: "search_stays", arguments: "{}" } },
    { id: "call-1", type: "function", function: { arguments: "{}" } },
    { id: "call-1", type: "function", function: { name: "search_stays", arguments: "{not json" } },
    { id: "call-1", type: "function", function: { name: "search_stays", arguments: "[1,2]" } },
    { id: "call-1", type: "function", function: { name: "search_stays", arguments: "\"text\"" } },
  ];
  for (const call of invalidCalls) {
    const { client } = clientWith(() => completion({ content: null, tool_calls: [call] }));
    await assert.rejects(client.generate(request), /tool call/);
  }
  await assert.rejects(clientWith(() => jsonResponse(200, { choices: [] })).client.generate(request), /no completion message/);
  await assert.rejects(clientWith(() => completion({ content: null, tool_calls: "bad" })).client.generate(request), /structurally invalid/);
});

test("A connection failure is retried exactly once; an HTTP error response is never retried", async () => {
  const recovers = clientWith((_captured, attempt) => {
    if (attempt === 1) throw new TypeError("fetch failed");
    return completion({ content: "Recovered" });
  });
  assert.equal((await recovers.client.generate(request)).text, "Recovered");
  assert.equal(recovers.requests.length, 2);

  const alwaysDown = clientWith(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(alwaysDown.client.generate(request), (error: unknown) => error instanceof APIConnectionError && error.code === "connection_failed");
  assert.equal(alwaysDown.requests.length, 2);

  const serverError = clientWith(() => jsonResponse(503, { error: { message: "overloaded" } }));
  await assert.rejects(serverError.client.generate(request), APIError);
  assert.equal(serverError.requests.length, 1);
});

test("HTTP 429 surfaces as RateLimitError and other HTTP errors as APIError, carrying only a sanitised status and code", async () => {
  const limited = clientWith(() => jsonResponse(429, { error: { message: "Rate limit for user@example.com", type: "rate_limit_exceeded" } }));
  await assert.rejects(limited.client.generate(request), (error: unknown) => {
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.constructor.name, "RateLimitError");
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limit_exceeded");
    assert.doesNotMatch(error.message, /user@example\.com/);
    return true;
  });

  const unauthorized = clientWith(() => jsonResponse(401, { error: { message: "Bad key sk-offline-test", code: "invalid key with spaces" } }));
  await assert.rejects(unauthorized.client.generate(request), (error: unknown) => {
    assert.ok(error instanceof APIError);
    assert.equal(error.constructor.name, "APIError");
    assert.equal(error.status, 401);
    assert.equal(error.code, undefined);
    assert.doesNotMatch(error.message, /sk-offline-test/);
    return true;
  });

  const notJson = clientWith(() => new Response("<html>bad gateway</html>", { status: 502 }));
  await assert.rejects(notJson.client.generate(request), (error: unknown) => error instanceof APIError && error.status === 502 && error.code === undefined);
});

test("Requests time out after the configured timeout (default matches DEFAULT_GEMINI_TIMEOUT_MS)", async () => {
  assert.equal(DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS, DEFAULT_GEMINI_TIMEOUT_MS);
  const hanging = clientWith((captured) => new Promise<Response>((_resolve, reject) => {
    captured.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), { timeoutMs: 20 });
  await assert.rejects(hanging.client.generate(request), (error: unknown) => error instanceof APIConnectionError && error.code === "timeout");
  // A timeout is not a connection failure; it is not retried, so latency stays bounded.
  assert.equal(hanging.requests.length, 1);

  const perRequest = clientWith((captured) => new Promise<Response>((_resolve, reject) => {
    captured.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }), { timeoutMs: 60_000 });
  await assert.rejects(perRequest.client.generate({ ...request, timeoutMs: 20 }), (error: unknown) => error instanceof APIConnectionError && error.code === "timeout");
});

test("The adapter refuses to construct without an API key, a model, or an HTTPS base URL", () => {
  const base = { apiKey: "sk-offline-test", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" };
  assert.doesNotThrow(() => new OpenAiCompatibleClient(base));
  assert.doesNotThrow(() => new OpenAiCompatibleClient({ ...base, baseUrl: "https://api.openai.com/v1" }));
  assert.throws(() => new OpenAiCompatibleClient({ ...base, apiKey: "" }), /LLM_API_KEY/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, apiKey: "   " }), /LLM_API_KEY/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, model: "" }), /LLM_MODEL/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, baseUrl: "http://api.deepseek.com" }), /LLM_BASE_URL/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, baseUrl: "api.deepseek.com" }), /LLM_BASE_URL/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, baseUrl: "https://user:pass@api.deepseek.com" }), /LLM_BASE_URL/);
  assert.throws(() => new OpenAiCompatibleClient({ ...base, baseUrl: "https://api.deepseek.com?key=1" }), /LLM_BASE_URL/);
});
