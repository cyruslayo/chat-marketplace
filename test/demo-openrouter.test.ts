import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { loadConciergeConfiguration } from "../apps/local-guest/src/assistant/concierge-configuration.js";
import { BudgetedModelClient, ModelCallBudget } from "../apps/local-guest/src/assistant/model-call-budget.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { loadPilotCoreConfiguration } from "../apps/pilot/src/pilot-config-core.js";
import { clientWith, completion, jsonResponse } from "./helpers/openai-compatible-client.js";

const openRouter = { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" };
const prompt = "2-bed in Lekki for 3 months from 1 Nov";

function fixture(model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]) {
  const directory = mkdtempSync(join(tmpdir(), "demo-openrouter-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  const budget = new ModelCallBudget(10, () => environment.clock());
  const runtime = new AssistantRuntime(environment, new BudgetedModelClient(model, budget), {
    onDiagnostic: (event) => diagnostics?.push(event),
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, budget, runtime, app, close() { environment.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('AC1: With OpenRouter settings, a discovery turn calls the model and executes search_stays', async () => {
  const stub = clientWith((_request, attempt) => attempt === 1
    ? completion({ tool_calls: [{ id: "search-1", type: "function", function: { name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki", bedrooms: 2 }) } }] })
    : completion({ content: "Search complete." }), openRouter);
  const f = fixture(stub.client);
  try {
    const result = await f.app.handleTurn("g-deadbeef01", prompt);
    assert.ok(result.ok);
    assert.equal(stub.requests.length, 2);
    assert.equal(stub.requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(stub.requests[0]?.body.model, "openai/gpt-6-luna");
    assert.ok(JSON.stringify(stub.requests[0]?.body.messages).includes(prompt));
    assert.match(JSON.stringify(stub.requests[1]?.body.messages), /tool_call_id.*search-1/);
    assert.equal(result.surfaces.length, 1);
    assert.deepEqual(f.budget.turnCounts, { modelHandledTurns: 1, deterministicFallbackTurns: 0 });
    const source = readFileSync("apps/cloudflare/cloudflare.config.ts", "utf8");
    for (const name of ["LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDER_LABEL", "CONCIERGE_DAILY_MODEL_CALL_CAP"]) assert.ok(source.includes(`optionalText("${name}")`));
    assert.match(source, /LLM_API_KEY:\s*bindings.secret\(\)/);
  } finally { f.close(); }
});

test('AC2: Explicit confirmation or cancellation of a pending action never calls the model', async () => {
  for (const text of ["Yes", "No, cancel that."]) {
    const stub = clientWith(() => { throw new Error("The pending action must not call the provider"); }, openRouter);
    const scripted = new ScriptedAssistantModel();
    let providerEnabled = false;
    const f = fixture({ generate: (request) => providerEnabled ? stub.client.generate(request) : scripted.generate(request) });
    try {
      await f.runtime.handleTurn("g-deadbeef02", "I need a place in Ikoyi for 4 nights for 2 guests");
      await f.runtime.handleTurn("g-deadbeef02", "Request the first one.");
      assert.ok(f.runtime.getThread("g-deadbeef02").taskState.pendingAction);
      providerEnabled = true;
      while (f.budget.hasCapacity()) f.budget.record();
      const result = await f.app.handleTurn("g-deadbeef02", text);
      assert.ok(result.ok);
      assert.equal(f.runtime.getThread("g-deadbeef02").taskState.pendingAction, null);
      if (text === "Yes") assert.ok(f.runtime.getThread("g-deadbeef02").taskState.currentBookingRequestId);
      assert.equal(stub.requests.length, 0);
    } finally { f.close(); }
  }
});

test('AC3: A provider 429, a 5xx or a timeout falls back to the deterministic concierge, and the guest still gets a reply', { timeout: 10_000 }, async () => {
  for (const failure of [429, 503, "timeout", "body-timeout"] as const) {
    const stub = clientWith((request) => failure === "timeout"
      ? new Promise<Response>((_resolve, reject) => request.init.signal?.addEventListener("abort", () => reject(new Error("timeout"))))
      : failure === "body-timeout" ? new Response(new ReadableStream<Uint8Array>())
      : jsonResponse(failure, { error: { code: "unavailable" } }), { ...openRouter, timeoutMs: 10 });
    const f = fixture(typeof failure === "string" ? { generate: (request) => stub.client.generate({ ...request, timeoutMs: 10 }) } : stub.client);
    try {
      const result = await f.app.handleTurn("g-deadbeef03", "I need a place in Ikoyi for 4 nights for 2 guests");
      assert.ok(result.ok, String(failure));
      assert.ok(result.messages.length > 0);
      assert.equal(stub.requests.length, 1);
      assert.deepEqual(f.budget.turnCounts, { modelHandledTurns: 0, deterministicFallbackTurns: 1 });
    } finally { f.close(); }
  }
  const rejected = clientWith(() => jsonResponse(401, { error: { code: "unauthorized" } }), openRouter);
  const f = fixture(rejected.client);
  try {
    assert.equal((await f.app.handleTurn("g-deadbeef03", prompt)).ok, false);
    assert.deepEqual(f.budget.turnCounts, { modelHandledTurns: 0, deterministicFallbackTurns: 0 });
  } finally { f.close(); }
});

test('AC4: When the daily model-call budget is exhausted, the deterministic concierge answers', async () => {
  const stub = clientWith(() => { throw new Error("The spent budget must not call the provider"); }, openRouter);
  const f = fixture(stub.client);
  try {
    while (f.budget.hasCapacity()) f.budget.record();
    const result = await f.app.handleTurn("g-deadbeef04", "I need a place in Ikoyi for 4 nights for 2 guests");
    assert.ok(result.ok);
    assert.ok(result.messages.length > 0);
    assert.equal(stub.requests.length, 0);
    assert.deepEqual(f.budget.turnCounts, { modelHandledTurns: 0, deterministicFallbackTurns: 1 });
  } finally { f.close(); }
  let now = new Date("2026-10-22T10:00:00Z");
  const daily = new ModelCallBudget(1, () => now);
  daily.record();
  daily.recordTurn("fallback");
  assert.equal(daily.hasCapacity(), false);
  now = new Date("2026-10-22T23:00:00Z");
  assert.equal(daily.hasCapacity(), true);
  assert.deepEqual(daily.turnCounts, { modelHandledTurns: 0, deterministicFallbackTurns: 0 });
});

test('AC5: A missing or empty LLM_API_KEY, or a non-HTTPS LLM_BASE_URL, is a startup error', () => {
  const settings = { CONCIERGE_MODE: "openai-compatible", LLM_API_KEY: "synthetic-offline-key", LLM_BASE_URL: openRouter.baseUrl, LLM_MODEL: openRouter.model };
  for (const LLM_API_KEY of [undefined, "", " "]) assert.throws(() => loadConciergeConfiguration({ ...settings, LLM_API_KEY }), /LLM_API_KEY/);
  assert.throws(() => loadConciergeConfiguration({ ...settings, LLM_BASE_URL: "http://openrouter.ai/api/v1" }), /HTTPS/);
  assert.throws(() => loadPilotCoreConfiguration({ ...settings, SHORTLET_PUBLIC_ORIGIN: "https://demo.example.test", PAYSTACK_ENVIRONMENT: "live", PAYSTACK_SECRET_KEY: "sk_live_synthetic" }), /OpenRouter.*staging/i);
});

test('AC7: Token usage is returned from the client, and no prompt or reply text appears in diagnostics or logs', async (t) => {
  const stub = clientWith(() => jsonResponse(200, { choices: [{ message: { content: "private-reply-sentinel" } }], usage: { prompt_tokens: 17, completion_tokens: 9 } }), openRouter);
  const response = await stub.client.generate({ systemInstruction: "private-prompt-sentinel", tools: [], history: [] });
  assert.deepEqual(response.usage, { promptTokens: 17, completionTokens: 9 });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const logs: unknown[] = [];
  const f = fixture(stub.client, diagnostics);
  try {
    for (const method of ["log", "warn", "error", "info", "debug"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
    assert.equal((await f.app.handleTurn("g-deadbeef07", "private-prompt-sentinel")).ok, true);
  } finally { t.mock.restoreAll(); f.close(); }
  assert.deepEqual(logs, []);
  assert.doesNotMatch(JSON.stringify({ diagnostics, logs }), /private-prompt-sentinel|private-reply-sentinel|sk-offline-test/);
  for (const usage of [undefined, null, { prompt_tokens: -1, completion_tokens: 2 }, { prompt_tokens: "3", completion_tokens: 2 }]) {
    const missing = clientWith(() => jsonResponse(200, { choices: [{ message: { content: "ok" } }], usage }), openRouter);
    assert.equal((await missing.client.generate({ systemInstruction: "", tools: [], history: [] })).usage, undefined);
  }
});
