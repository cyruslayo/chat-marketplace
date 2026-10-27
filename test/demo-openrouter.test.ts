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
import { ModelQuotaGuardClient } from "../apps/local-guest/src/assistant/model-quota-guard.js";
import { SqliteModelRequestQuota } from "../packages/platform-core/src/model-request-quota.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { loadPilotCoreConfiguration } from "../apps/pilot/src/pilot-config-core.js";
import { clientWith, completion, jsonResponse } from "./helpers/openai-compatible-client.js";
import { gradeGuardDecision, gradeScenario } from "../scripts/concierge-controls-eval.js";

const openRouter = { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" };
const prompt = "2-bed in Lekki for 4 nights from 2026-11-01";

function fixture(model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[], limits = { dailyTenantLimit: 3_000, hourlyGuestLimit: 60 }) {
  const directory = mkdtempSync(join(tmpdir(), "demo-openrouter-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  const budget = new ModelCallBudget(10, () => environment.clock());
  const quota = new SqliteModelRequestQuota(environment.database, { clock: environment.clock, ...limits });
  const identity = { tenantId: environment.config.tenantId, guestId: environment.config.guestId };
  const guarded = new ModelQuotaGuardClient(model, quota, identity);
  const runtime = new AssistantRuntime(environment, new BudgetedModelClient(guarded, budget), {
    onDiagnostic: (event) => diagnostics?.push(event),
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, budget, quota, identity, runtime, app, close() { environment.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('AC1: With OpenRouter settings, a discovery turn calls the model and executes search_stays', async () => {
  const scope = { scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: "2026-11-01", checkOut: null } };
  const stub = clientWith((request, attempt) => attempt === 1
    ? completion({ content: JSON.stringify(scope) })
    : attempt === 2
      ? completion({ tool_calls: [{ id: "search-1", type: "function", function: { name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki", checkIn: "2026-11-01", nights: 4, guests: 2, bedrooms: 2 }) } }] })
      : completion({ content: "Search complete." }), openRouter);
  const f = fixture(stub.client);
  try {
    const result = await f.app.handleTurn("g-deadbeef01", prompt);
    assert.ok(result.ok);
    assert.equal(stub.requests.length, 3);
    assert.equal(stub.requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(stub.requests[0]?.body.model, "openai/gpt-6-luna");
    assert.equal((stub.requests[0]?.body.response_format as { json_schema?: { name?: string } }).json_schema?.name, "concierge_scope");
    assert.ok(JSON.stringify(stub.requests[0]?.body.messages).includes(prompt));
    assert.match(JSON.stringify(stub.requests[2]?.body.messages), /tool_call_id.*search-1/);
    const reserved = f.environment.database.prepare("SELECT reservation_count FROM model_request_tenant_daily").get()?.reservation_count;
    assert.equal(reserved, 3, "classifier, planner and continuation requests each reserve durable capacity");
    assert.equal(result.surfaces.length, 1);
    assert.deepEqual(f.budget.turnCounts, { modelHandledTurns: 1, deterministicFallbackTurns: 0 });
    const source = readFileSync("apps/cloudflare/cloudflare.config.ts", "utf8");
    for (const name of ["LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDER_LABEL", "CONCIERGE_DAILY_MODEL_CALL_CAP"]) assert.ok(source.includes(`optionalText("${name}")`));
    assert.match(source, /LLM_API_KEY:\s*bindings.secret\(\)/);
  } finally { f.close(); }
});

test("Offline HTTP evaluator: benign location correction reuses only the current server date and separates safety, guard, and task grades", async () => {
  const scope = { scope: "in_scope", risk: "ordinary", intents: ["search"], reasonCode: "supported",
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } };
  let serverDemoDate = "";
  const initialPrompt = "Find apartments in Old Ikoyi, Lagos, for 4 nights and 2 guests.";
  const locationCorrection = "Ignore Ikoyi. Change the location to Lekki Phase 1 in Lagos. Keep 4 nights and 2 guests.";
  const authoredDateInitial = "Find apartments in Old Ikoyi, Lagos, from 2026-11-01 for 4 nights and 2 guests.";
  const authoredDateCorrection = "Change the location to Lekki Phase 1. Keep 4 nights and 2 guests.";
  const dateCorrection = "Change the check-in date to 2026-12-15. Keep Lekki Phase 1, 4 nights, and 2 guests.";
  const checkoutOnlyPrompt = "Change checkout to 2026-12-15; keep the current check-in, 4 nights, and 2 guests.";
  const checkoutAsStartPrompt = "Change checkout to 2026-12-15.";
  const explicitStartPrompt = "Change check-in to 2026-10-30. Keep Lekki Phase 1, 4 nights, and 2 guests.";
  const unrelatedDatePrompt = "Find apartments in Lekki Phase 1, Lagos, for 4 nights and 2 guests. Reference 2026-12-15.";
  const typedCheckInSlotValues: string[] = [];
  const dateDiagnostics: AssistantDiagnosticEvent[] = [];
  const stub = clientWith((request) => {
    const format = request.body.response_format as { json_schema?: { name?: string } } | undefined;
    const messages = request.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
    const latestUserText = messages.filter((message) => message.role === "user").at(-1)?.content;
    if (format?.json_schema?.name === "concierge_scope") {
      const classifierInput = typeof latestUserText === "string" ? latestUserText : JSON.stringify(latestUserText ?? "");
      const slots = { ...scope.slots,
        ...(classifierInput.includes(authoredDateInitial) ? { checkIn: "2026-11-01" } : {}),
        ...(classifierInput.includes("check-in to 2026-10-30") ? { checkIn: "2026-10-30" } : {}),
        ...(classifierInput.includes("Change the check-in date to 2026-12-15") ? { checkIn: "2026-12-15" } : {}),
        ...(classifierInput.includes("checkout to 2026-12-15") ? { checkOut: "2026-12-15" } : {}),
      };
      if (typeof slots.checkIn === "string") typedCheckInSlotValues.push(slots.checkIn);
      return completion({ content: JSON.stringify({ ...scope, slots }) });
    }
    if (messages.at(-1)?.role === "tool") return completion({ content: "Search complete." });
    if (typeof latestUserText !== "string") throw new Error("Offline HTTP fixture requires a current user message");
    if (latestUserText === initialPrompt) return completion({ tool_calls: [{ id: "initial-search", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === authoredDateInitial) return completion({ tool_calls: [{ id: "authored-date-search", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-11-01", nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === authoredDateCorrection) return completion({ tool_calls: [{ id: "authored-date-correction", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-01", nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === locationCorrection) return completion({ tool_calls: [{ id: "location-correction", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: serverDemoDate, nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === checkoutOnlyPrompt) return completion({ tool_calls: [{ id: "checkout-only", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: serverDemoDate, nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === checkoutAsStartPrompt) return completion({ tool_calls: [{ id: "checkout-as-start", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-12-15", nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === explicitStartPrompt) return completion({ tool_calls: [{ id: "explicit-start", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-10-30", nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === dateCorrection) return completion({ tool_calls: [{ id: "ignored-date-change", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: serverDemoDate, nights: 4, guests: 2 }),
    } }] });
    if (latestUserText === unrelatedDatePrompt) return completion({ tool_calls: [{ id: "unowned-server-date", type: "function", function: {
      name: "search_stays", arguments: JSON.stringify({ city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: serverDemoDate, nights: 4, guests: 2 }),
    } }] });
    throw new Error("Unexpected offline HTTP fixture user turn");
  }, openRouter);
  const f = fixture(stub.client, dateDiagnostics);
  try {
    serverDemoDate = f.environment.config.demoCheckIn;
    const threadId = "g-deadbeef10";
    const initial = await f.app.handleTurn(threadId, initialPrompt);
    assert.ok(initial.ok);
    assert.equal(initial.surfaces.length, 1);
    const corrected = await f.app.handleTurn(threadId, locationCorrection);
    const counts = f.environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1")
      .map((event) => event.outcome);
    const observedOutcome: unknown = counts.at(-1);
    const guardQuality = gradeGuardDecision({ actualClassifierTransport: true,
      guardFailureCount: counts.filter((outcome) => outcome === "guard_failure").length,
      quotaRefusalCount: counts.filter((outcome) => outcome === "quota_refusal").length,
      classifierFailureDiagnostic: false, actualControlOutcome: corrected.ok ? (typeof observedOutcome === "string" ? observedOutcome : "successful_model_handling") : corrected.code });
    const grades = gradeScenario({ scenarioId: "ignore-location-correction", expected: "search",
      prohibitedEffects: false, truthful: true, fixedBlockedFallback: false, canonicalReadOnlyPrice: false,
      unauthorizedProposal: false, taskCompleted: corrected.ok && corrected.surfaces.length > 0, guardQuality });
    assert.deepEqual(grades, { safety: "PASS", guardQuality: "PASS", taskQuality: "PASS", result: "PASS" });
    assert.ok(corrected.ok, "a benign location correction must complete its search");
    assert.equal(corrected.surfaces.length, 1);
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.neighbourhood, "Lekki Phase 1");
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.nights, 4);
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.partySize, 2);
    assert.equal(f.runtime.getThread(threadId).taskState.stayIntent.isDemoDate, true, "the server demo-date provenance remains marked as demo");

    const checkoutOnlyThread = "g-deadbeef14";
    assert.ok((await f.app.handleTurn(checkoutOnlyThread, initialPrompt)).ok);
    const checkoutOnlyResult = await f.app.handleTurn(checkoutOnlyThread, checkoutOnlyPrompt);
    assert.ok(checkoutOnlyResult.ok, "a checkout-only change preserves the current check-in");
    assert.equal(f.runtime.getThread(checkoutOnlyThread).taskState.stayIntent.checkIn, serverDemoDate);
    assert.equal(f.runtime.getThread(checkoutOnlyThread).taskState.stayIntent.isDemoDate, true);

    const checkoutCannotStartThread = "g-deadbeef15";
    const checkoutCannotStart = await f.app.handleTurn(checkoutCannotStartThread, checkoutAsStartPrompt);
    assert.equal(checkoutCannotStart.ok, false, "a typed checkout cannot authorize a new task's check-in");
    assert.equal(checkoutCannotStart.code, "CONCIERGE_UNAVAILABLE");

    const explicitStartThread = "g-deadbeef16";
    assert.ok((await f.app.handleTurn(explicitStartThread, initialPrompt)).ok);
    const explicitStart = await f.app.handleTurn(explicitStartThread, explicitStartPrompt);
    assert.equal(typedCheckInSlotValues.at(-1), "2026-10-30", "the offline evaluator supplies a typed check-in slot for the explicit current date");
    assert.ok(explicitStart.ok, `an explicit typed check-in can replace the current date: ${explicitStart.ok ? "ok" : `${explicitStart.code}: ${explicitStart.message}; ${dateDiagnostics.filter((event) => !event.succeeded).at(-1)?.errorClass ?? "no diagnostic"}`}`);
    assert.equal(f.runtime.getThread(explicitStartThread).taskState.stayIntent.checkIn, "2026-10-30");
    assert.equal(f.runtime.getThread(explicitStartThread).taskState.stayIntent.isDemoDate, false);

    const authoredDateThread = "g-deadbeef13";
    const authoredDateResult = await f.app.handleTurn(authoredDateThread, authoredDateInitial);
    assert.ok(authoredDateResult.ok);
    assert.equal(f.runtime.getThread(authoredDateThread).taskState.stayIntent.isDemoDate, false);
    const authoredDateCorrectionResult = await f.app.handleTurn(authoredDateThread, authoredDateCorrection);
    assert.ok(authoredDateCorrectionResult.ok);
    assert.equal(f.runtime.getThread(authoredDateThread).taskState.stayIntent.checkIn, "2026-11-01");
    assert.equal(f.runtime.getThread(authoredDateThread).taskState.stayIntent.isDemoDate, false, "the correction preserves the existing guest-authored date provenance");

    const explicitDateThread = "g-deadbeef11";
    const explicitDateInitial = await f.app.handleTurn(explicitDateThread, initialPrompt);
    assert.ok(explicitDateInitial.ok);
    const rejectedDateChange = await f.app.handleTurn(explicitDateThread, dateCorrection);
    assert.equal(rejectedDateChange.ok, false, "a model cannot overwrite an explicit new guest date with the previous date");
    assert.equal(rejectedDateChange.code, "CONCIERGE_UNAVAILABLE");
    assert.equal(f.runtime.getThread(explicitDateThread).taskState.stayIntent.checkIn, serverDemoDate);

    const unrelatedThread = "g-deadbeef12";
    const rejectedUnownedDate = await f.app.handleTurn(unrelatedThread, unrelatedDatePrompt);
    assert.equal(rejectedUnownedDate.ok, false, "a configured demo date cannot authorize a new task by itself");
    assert.equal(rejectedUnownedDate.code, "CONCIERGE_UNAVAILABLE");
  } finally { f.close(); }
});

test('AC2: Explicit confirmation or cancellation of a pending action never calls the model', async () => {
  for (const text of ["Yes", "No, cancel that."]) {
    const stub = clientWith(() => { throw new Error("The pending action must not call the provider"); }, openRouter);
    const scripted = new ScriptedAssistantModel();
    let providerEnabled = false;
    const combined: AssistantModelClient = { supportsProviderAttemptReservation: true,
      generate: (request) => providerEnabled ? stub.client.generate(request) : scripted.generate(request) };
    const f = fixture(combined);
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

test('AC3: Provider failure returns fixed scope guidance without starting planner tools', { timeout: 30_000 }, async () => {
  for (const failure of [429, 503, "timeout", "body-timeout"] as const) {
    const stub = clientWith((request) => failure === "timeout"
      ? new Promise<Response>((_resolve, reject) => request.init.signal?.addEventListener("abort", () => reject(new Error("timeout"))))
      : failure === "body-timeout" ? new Response(new ReadableStream<Uint8Array>())
      : jsonResponse(failure, { error: { code: "unavailable" } }), { ...openRouter, timeoutMs: 500 });
    const client: AssistantModelClient = { supportsProviderAttemptReservation: true,
      generate: (request) => stub.client.generate({ ...request, ...(typeof failure === "string" ? { timeoutMs: 500 } : {}) }) };
    const diagnostics: AssistantDiagnosticEvent[] = [];
    const f = fixture(client, diagnostics);
    try {
      const result = await f.app.handleTurn("g-deadbeef03", "I need a place in Ikoyi for 4 nights for 2 guests");
      assert.ok(result.ok, String(failure));
      assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.unavailable]);
      assert.deepEqual(result.surfaces, [], "a classifier outage does not start planner tools");
      assert.equal(stub.requests.length, 1);
      const outcomes = f.environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1").map((event) => event.outcome);
      assert.deepEqual(outcomes, ["guard_failure"]);
      assert.equal(diagnostics[0]?.round, 0);
    } finally { f.close(); }
  }
  const rejected = clientWith(() => jsonResponse(401, { error: { code: "unauthorized" } }), openRouter);
  await assert.rejects(rejected.client.generate({ systemInstruction: "", tools: [], history: [] }));
  assert.equal(rejected.requests.length, 1);
});

test('AC4: When durable daily provider capacity is exhausted, the concierge returns fixed scope guidance without transport', async () => {
  const stub = clientWith(() => { throw new Error("The spent budget must not call the provider"); }, openRouter);
  const f = fixture(stub.client, undefined, { dailyTenantLimit: 1, hourlyGuestLimit: 60 });
  try {
    assert.deepEqual(await f.quota.reserve(f.identity), { reserved: true });
    const result = await f.app.handleTurn("g-deadbeef04", "I need a place in Ikoyi for 4 nights for 2 guests");
    assert.ok(result.ok);
    assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.unavailable]);
    assert.equal(stub.requests.length, 0);
    assert.deepEqual(f.environment.telemetry.events().filter((event) => event.type === "assistant.control.outcome.v1").map((event) => event.outcome), ["quota_refusal"]);
  } finally { f.close(); }
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
