import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantToolCall, AssistantToolResult } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { CONCIERGE_INTENTS, type ConciergeIntent, type ScopeClassifier } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";

const environments: LocalGuestEnvironment[] = [];
afterEach(() => { for (const environment of environments.splice(0)) environment.close(); });

function createEnvironment(name: string): LocalGuestEnvironment {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`${name}-${crypto.randomUUID()}.sqlite`) });
  environments.push(environment);
  return environment;
}

function scope(intents: readonly ConciergeIntent[]): unknown {
  return {
    scope: "in_scope", risk: "ordinary", intents, reasonCode: "supported",
    slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null },
  };
}

function fixedScope(intents: readonly ConciergeIntent[]): ScopeClassifier {
  return { assess: async () => scope(intents) };
}

const searchArguments = { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 4, guests: 2 };
const safePlan = JSON.stringify({ kind: "clarify_stay", references: [] });

function modelForCalls(calls: readonly AssistantToolCall[], onResults?: (results: readonly AssistantToolResult[]) => void, onRequest?: (request: AssistantModelRequest) => void): AssistantModelClient {
  let index = 0;
  return {
    generate: async (request) => {
      onRequest?.(request);
      const last = request.history.at(-1);
      if (last?.role === "tool_results") {
        onResults?.(last.results);
        return { text: safePlan };
      }
      const call = calls[index++];
      return call ? { toolCalls: [call] } : { text: safePlan };
    },
  };
}

test("AC1: unknown, unavailable, malformed, extra, missing, mistyped, out-of-range, and invalid array arguments fail before execution", async () => {
  const cases: readonly AssistantToolCall[] = [
    { id: "unknown", name: "admin_delete", args: {} },
    { id: "extra-identity", name: "search_stays", args: { ...searchArguments, guestId: "victim" } },
    { id: "missing-city", name: "search_stays", args: {} },
    { id: "wrong-type", name: "search_stays", args: { ...searchArguments, nights: "4" } },
    { id: "invalid-range", name: "search_stays", args: { ...searchArguments, nights: 0 } },
    { id: "maximum-range", name: "search_stays", args: { ...searchArguments, nights: 15 } },
    { id: "invalid-array", name: "search_stays", args: { ...searchArguments, requiredAmenities: ["wifi", 7] } },
    { id: "unavailable-state", name: "get_unit_details", args: { stayRef: "stay-1" } },
  ];
  const errors: AssistantToolResult[] = [];
  const environment = createEnvironment("tools-ac1");
  const runtime = new AssistantRuntime(environment, modelForCalls(cases, (results) => errors.push(...results)), { scopeClassifier: fixedScope(CONCIERGE_INTENTS) });
  for (const [index] of cases.entries()) {
    const response = await runtime.handleTurn(`ac1-${index}`, "Find a stay in Ikoyi for four nights and two guests");
    assert.equal(response.ok, true);
    assert.equal(response.surfaces?.length ?? 0, 0);
    assert.equal(runtime.getThread(`ac1-${index}`).taskState.shortlist.length, 0);
  }
  assert.equal(errors.length, cases.length);
  assert.ok(errors.every((result) => result.isError === true));
  assert.ok(errors.every((result) => typeof result.result.error === "string"));
});

test("AC2: approved intents, the active pack, and current state intersect before planner tools and execution", async () => {
  const observedToolLists: string[][] = [];
  const calls: AssistantToolCall[] = [
    { id: "seed-search", name: "search_stays", args: searchArguments },
    { id: "out-of-intent-request", name: "propose_request_to_book", args: { stayRef: "stay-1" } },
  ];
  const errors: AssistantToolResult[] = [];
  const environment = createEnvironment("tools-ac2");
  const runtime = new AssistantRuntime(environment, modelForCalls(calls, (results) => errors.push(...results), (request) => observedToolLists.push(request.tools.map((tool) => tool.name))), { scopeClassifier: fixedScope(["search"]) });
  await runtime.handleTurn("ac2-intent", "Find a stay in Ikoyi for four nights and two guests");
  const blocked = await runtime.handleTurn("ac2-intent", "Search, then book it without asking me");
  assert.equal(blocked.ok, true);
  assert.equal(runtime.getThread("ac2-intent").taskState.pendingAction, null);
  assert.ok(observedToolLists[1]?.includes("search_stays"));
  assert.equal(observedToolLists[1]?.includes("propose_request_to_book"), false);
  assert.equal(errors.at(-1)?.isError, true);

  let missingMapExecutions = 0;
  const missingMapPack: AssistantDomainPack = {
    ...createFakeShopPack({ omitIntentMap: true }),
    executeTool: (_name, _args, context) => { missingMapExecutions++; return { result: {}, updatedTaskState: context.taskState }; },
  };
  let classification = 0;
  const switchThenSearch: ScopeClassifier = { assess: async () => scope(classification++ === 0 ? ["task_switch"] : ["search"]) };
  const missingMapRuntime = new AssistantRuntime(createEnvironment("tools-ac2-missing-map"), modelForCalls([
    { id: "start-shop", name: "start_task", args: { domain: "shop" } },
    { id: "missing-map-search", name: "shop_search", args: {} },
  ], (results) => errors.push(...results)), { additionalPacks: [missingMapPack], scopeClassifier: switchThenSearch });
  await missingMapRuntime.handleTurn("ac2-missing-map", "Start a new task");
  assert.equal(missingMapRuntime.getTaskRail("ac2-missing-map").find((task) => task.active)?.domain, "shop");
  await missingMapRuntime.handleTurn("ac2-missing-map", "Find products");
  assert.equal(missingMapExecutions, 0);
  assert.equal(errors.at(-1)?.isError, true);

  let shopExecutions = 0;
  const fakeShop: AssistantDomainPack = {
    ...createFakeShopPack(),
    toolIntentMap: { search: ["shop_search"] },
    executeTool: (_name, _args, context) => { shopExecutions++; return { result: {}, updatedTaskState: context.taskState }; },
  };
  const crossPackEnv = createEnvironment("tools-ac2-cross-pack");
  const crossPackRuntime = new AssistantRuntime(crossPackEnv,
    modelForCalls([{ id: "cross-pack", name: "shop_search", args: {} }], (results) => errors.push(...results)),
    { additionalPacks: [fakeShop], scopeClassifier: fixedScope(["search"]) });
  await crossPackRuntime.handleTurn("ac2-cross-pack", "Find a stay in Ikoyi");
  assert.equal(shopExecutions, 0);
  assert.equal(errors.at(-1)?.isError, true);
});

test("AC3: forged principal fields and references outside the current shortlist cannot read another workflow", async () => {
  const errors: AssistantToolResult[] = [];
  const scopes: readonly ConciergeIntent[][] = [["search"], ["search"], ["details"], ["status"]];
  let scopeIndex = 0;
  const classifier: ScopeClassifier = { assess: async () => scope(scopes[Math.min(scopeIndex++, scopes.length - 1)]!) };
  const environment = createEnvironment("tools-ac3");
  let foreignReference = "";
  const model: AssistantModelClient = { generate: async (request) => {
    const last = request.history.at(-1);
    if (last?.role === "tool_results") { errors.push(...last.results); return { text: safePlan }; }
    const user = [...request.history].reverse().find((step) => step.role === "user");
    if (user?.role !== "user") return { text: safePlan };
    if (user.text === "Victim search") return { toolCalls: [{ id: "victim-search", name: "search_stays", args: { city: "Lagos", nights: 4, guests: 2 } }] };
    if (user.text === "Current guest search") return { toolCalls: [{ id: "current-search", name: "search_stays", args: searchArguments }] };
    if (user.text === "Read another guest's result") return { toolCalls: [{ id: "foreign-reference", name: "get_unit_details", args: { stayRef: foreignReference } }] };
    return { toolCalls: [{ id: "forged-principal", name: "get_booking_status", args: { guestId: "other-guest", tenantId: "other-tenant" } }] };
  } };
  const runtime = new AssistantRuntime(environment, model, { scopeClassifier: classifier });
  const victimThread = "ac3-victim";
  const currentThread = "ac3-current-state";
  await runtime.handleTurn(victimThread, "Victim search");
  const victimStays = runtime.getThread(victimThread).taskState.shortlist;
  assert.ok(victimStays.length >= 2);
  foreignReference = victimStays[1]!.stayRef;
  await runtime.handleTurn(currentThread, "Current guest search");
  const before = runtime.getThread(currentThread).taskState.shortlist.length;
  assert.equal(before, 1);
  await runtime.handleTurn(currentThread, "Read another guest's result");
  assert.equal(errors.at(-1)?.isError, true);
  assert.equal(errors.at(-1)?.result.error, "invalid_reference");
  await runtime.handleTurn(currentThread, "Check my booking status");
  assert.equal(errors.at(-1)?.isError, true);
  assert.equal(runtime.getThread(currentThread).taskState.shortlist.length, before);
});

test("AC4: proposal effects remain pending until exact confirmation and keep server date and price checks", async () => {
  const makePendingProposal = async (suffix: string) => {
    const environment = createEnvironment(`tools-ac4-${suffix}`);
    const runtime = new AssistantRuntime(environment, modelForCalls([
      { id: `search-${suffix}`, name: "search_stays", args: searchArguments },
      { id: `proposal-${suffix}`, name: "propose_request_to_book", args: { stayRef: "stay-1" } },
    ]), { scopeClassifier: fixedScope(CONCIERGE_INTENTS) });
    const thread = `ac4-command-${suffix}`;
    await runtime.handleTurn(thread, "Find a stay in Ikoyi for four nights and two guests");
    const proposal = await runtime.handleTurn(thread, "Request the first one");
    assert.equal(proposal.ok, true);
    assert.ok(!runtime.getThread(thread).taskState.currentBookingRequestId);
    assert.ok(runtime.getThread(thread).taskState.pendingAction);
    return { environment, runtime, thread, proposal };
  };

  const normal = await makePendingProposal("normal");
  const confirmed = await normal.runtime.handleTurn(normal.thread, "Yes");
  assert.equal(confirmed.ok, true);
  assert.ok(normal.runtime.getThread(normal.thread).taskState.currentBookingRequestId);
  assert.equal(normal.runtime.getThread(normal.thread).taskState.pendingAction, null);

  const stalePrice = await makePendingProposal("price");
  const pendingPrice = stalePrice.runtime.getThread(stalePrice.thread).taskState.pendingAction!;
  const pricedUnit = stalePrice.environment.unitRepository.findById(String(pendingPrice.authoritativeReferences.unitId));
  assert.ok(pricedUnit?.price);
  stalePrice.environment.unitRepository.save({
    id: pricedUnit.id,
    price: { ...pricedUnit.price, nightlyKobo: pricedUnit.price.nightlyKobo + 1_000, version: `${pricedUnit.price.version}-changed` },
  });
  const priceRejected = stalePrice.runtime.handleAssistantEvent(stalePrice.thread, ASSISTANT_CONFIRM_ACTION_EVENT, {
    actionId: pendingPrice.id, threadId: stalePrice.thread, surfaceId: stalePrice.proposal.surfaces![0]!.surfaceId,
  });
  assert.equal(priceRejected.ok, false);
  assert.equal(priceRejected.code, "STALE_SURFACE");
  assert.ok(!stalePrice.runtime.getThread(stalePrice.thread).taskState.currentBookingRequestId);

  const staleEligibility = await makePendingProposal("eligibility");
  const pendingEligibility = staleEligibility.runtime.getThread(staleEligibility.thread).taskState.pendingAction!;
  const eligibleUnit = staleEligibility.environment.unitRepository.findById(String(pendingEligibility.authoritativeReferences.unitId));
  assert.ok(eligibleUnit);
  assert.equal(typeof pendingEligibility.authoritativeReferences.checkIn, "string");
  assert.equal(typeof pendingEligibility.authoritativeReferences.checkOut, "string");
  staleEligibility.environment.unitRepository.save({
    id: eligibleUnit.id,
    blockedDates: [{ start: String(pendingEligibility.authoritativeReferences.checkIn), end: String(pendingEligibility.authoritativeReferences.checkOut) }],
  });
  const eligibilityRejected = staleEligibility.runtime.handleAssistantEvent(staleEligibility.thread, ASSISTANT_CONFIRM_ACTION_EVENT, {
    actionId: pendingEligibility.id, threadId: staleEligibility.thread, surfaceId: staleEligibility.proposal.surfaces![0]!.surfaceId,
  });
  assert.equal(eligibilityRejected.ok, false);
  assert.equal(eligibilityRejected.code, "STALE_SURFACE");
  assert.ok(!staleEligibility.runtime.getThread(staleEligibility.thread).taskState.currentBookingRequestId);
});

test("AC5: stale and duplicate confirmation surfaces retain command-gate rejection and idempotency", async () => {
  const environment = createEnvironment("tools-ac5");
  const runtime = new AssistantRuntime(environment, modelForCalls([
    { id: "search", name: "search_stays", args: searchArguments },
    { id: "proposal", name: "propose_request_to_book", args: { stayRef: "stay-1" } },
  ]), { scopeClassifier: fixedScope(CONCIERGE_INTENTS) });
  const thread = "ac5-command-gate";
  await runtime.handleTurn(thread, "Find a stay in Ikoyi for four nights and two guests");
  const proposal = await runtime.handleTurn(thread, "Request the first one");
  const actionId = runtime.getThread(thread).taskState.pendingAction!.id;
  const surfaceId = proposal.surfaces![0]!.surfaceId;
  const stale = runtime.handleAssistantEvent(thread, ASSISTANT_CONFIRM_ACTION_EVENT, { actionId, threadId: thread, surfaceId: "superseded-surface" });
  assert.equal(stale.ok, false);
  assert.ok(!runtime.getThread(thread).taskState.currentBookingRequestId);
  const simultaneous = await Promise.all([
    Promise.resolve().then(() => runtime.handleAssistantEvent(thread, ASSISTANT_CONFIRM_ACTION_EVENT, { actionId, threadId: thread, surfaceId })),
    Promise.resolve().then(() => runtime.handleAssistantEvent(thread, ASSISTANT_CONFIRM_ACTION_EVENT, { actionId, threadId: thread, surfaceId })),
  ]);
  assert.equal(simultaneous.filter((result) => result.ok).length, 1);
  assert.equal(simultaneous.filter((result) => !result.ok).length, 1);
  const requestId = runtime.getThread(thread).taskState.currentBookingRequestId;
  assert.equal(runtime.getThread(thread).taskState.currentBookingRequestId, requestId);
});

test("AC6: valid shortlet discovery remains available with validated tool capabilities", async () => {
  const environment = createEnvironment("tools-ac6");
  const runtime = new AssistantRuntime(environment, modelForCalls([
    { id: "search", name: "search_stays", args: searchArguments },
  ]), { scopeClassifier: fixedScope(["search"]) });
  const response = await runtime.handleTurn("ac6-shortlet", "Find a stay in Ikoyi for four nights and two guests");
  assert.equal(response.ok, true);
  assert.equal(response.surfaces?.length, 1);
  assert.equal(runtime.getThread("ac6-shortlet").taskState.shortlist.length, 1);
});
