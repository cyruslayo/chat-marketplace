import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent, type AssistantTurnOutput } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelResponse, AssistantToolDefinition } from "../apps/local-guest/src/assistant/assistant-model.js";
import {
  TASK_START_EVENT,
  type AssistantDomainPack,
  type AssistantToolExecutionResult,
} from "../apps/local-guest/src/assistant/assistant-platform.js";
import {
  PENDING_ACTION_STAGE,
  retireOwnStages,
  type AssistantStageHandler,
} from "../apps/local-guest/src/assistant/assistant-stage-handler.js";
import { SHORTLET_STAGE_HANDLERS } from "../apps/local-guest/src/assistant/shortlet-stage-handlers.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import type { PendingAssistantAction } from "../apps/local-guest/src/assistant/pending-actions.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock, threadSnapshot } from "./helpers/assistant-turn-model.js";

/**
 * Issue 04 tests. A second domain pack ("shop") stands in for a new domain: it declares its own stage and supersede rule and
 * is driven through the real runtime, so the runtime is exercised without any edit to it.
 */

const SHOP_THREAD = "thread-stage-handlers";
const SHOP_STAGE = "shop_results";
const SHOP_FALLBACK = "Shop results are ready below.";
const EFFECT_CODE = "request_draft_created_availability_checked_not_reserved";
const SHOP_SEARCH: AssistantToolDefinition = {
  name: "shop_search", description: "Search products.", category: "read",
  parametersSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};
const SHOP_BREAK: AssistantToolDefinition = { ...SHOP_SEARCH, name: "shop_break", description: "Fails." };
const PLAN_REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "show_results", references: [] }) };
const CALL_SEARCH = (id: string): AssistantModelResponse => ({ toolCalls: [{ id, name: "shop_search", args: {} }] });
const CALL_BREAK = (id: string): AssistantModelResponse => ({ toolCalls: [{ id, name: "shop_break", args: {} }] });

/** The shop handler: claims `shop_search`, places its surface under its own stage, and retires the earlier shop surface. */
const shopResultsHandler: AssistantStageHandler = {
  stage: SHOP_STAGE,
  supersedes: [SHOP_STAGE],
  project({ toolName, execution }, turn) {
    if (toolName !== "shop_search") return undefined;
    retireOwnStages(shopResultsHandler, turn);
    const surfaceId = `thread-${turn.threadId}:shop:${String(execution.result.shopResultId)}`;
    turn.tx.place(SHOP_STAGE, surfaceId);
    return { surface: { surfaceId, a2uiMessages: [] }, fallbackMessage: SHOP_FALLBACK };
  },
};

/** A confirmation of the `request_to_book` kind, used to observe whether the platform reaches a handler's `confirm`. */
function observedConfirmHandler(confirmed: string[]): AssistantStageHandler {
  return {
    stage: "shop_checkout",
    supersedes: [],
    confirms: "request_to_book",
    confirm(action, turn) {
      confirmed.push(action.id);
      turn.tx.clearPendingAction();
      return { ok: true, message: "Confirmed.", surfaces: [] };
    },
  };
}

/** A shop pack with the fake tools; `executeTool` fails for `shop_break` and reports the effect code of a search. */
function shopPack(extra: Partial<AssistantDomainPack> = {}): AssistantDomainPack {
  let searches = 0;
  const tools = [SHOP_SEARCH, SHOP_BREAK];
  return {
    ...createFakeShopPack(),
    toolNames: tools.map((tool) => tool.name),
    toolIntentMap: { search: tools.map((tool) => tool.name) },
    toolsForState: () => tools,
    toolDefinition: (name) => tools.find((tool) => tool.name === name),
    validateToolCall: () => undefined,
    executeTool: (name, _args, context): AssistantToolExecutionResult => {
      if (name === "shop_break") throw new Error("The shop provider is unavailable.");
      searches += 1;
      return {
        result: { resultCount: 1, shopResultId: `r${searches}` },
        updatedTaskState: context.taskState,
        effectCode: EFFECT_CODE,
      };
    },
    stageHandlers: [shopResultsHandler],
    ...extra,
  };
}

interface Opened {
  readonly environment: LocalGuestEnvironment;
  readonly runtime: AssistantRuntime;
  readonly diagnostics: AssistantDiagnosticEvent[];
}

/** Opens the runtime over a staging-like guest, with the injected scope fixture and the given extra packs. */
function open(model: RecordingTurnModel, packs: readonly AssistantDomainPack[], clock = new SteppedClock(STAGING_LIKE_START)): Opened {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: clock.now,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new AssistantRuntime(environment, model, {
    additionalPacks: packs,
    scopeClassifier: approvedTestScope,
    onDiagnostic: (event) => diagnostics.push(event),
  });
  return { environment, runtime, diagnostics };
}

/** Starts the shop task, the same way the shell does, so the next turn runs on the shop pack. */
function startShopTask(runtime: AssistantRuntime): void {
  runtime.handleAssistantEvent(SHOP_THREAD, TASK_START_EVENT, { domain: "shop" });
}

test("criterion 3: a new domain pack adds a stage with its own surface and supersede rule without editing the runtime", async () => {
  // Planner requests alternate: a search, then a reply, for each turn.
  const model = new RecordingTurnModel((_request, index) => index % 2 === 0 ? CALL_SEARCH(`call-${index}`) : PLAN_REPLY);
  const { environment, runtime } = open(model, [shopPack()]);
  try {
    startShopTask(runtime);
    const first: AssistantTurnOutput = await runtime.handleTurn(SHOP_THREAD, "shop for a kettle");
    assert.equal(first.ok, true);
    assert.equal(first.surfaces?.length, 1);
    const firstSurfaceId = first.surfaces?.[0]?.surfaceId ?? "";
    assert.match(firstSurfaceId, /:shop:r1$/);

    const second: AssistantTurnOutput = await runtime.handleTurn(SHOP_THREAD, "shop for a kettle again");
    const secondSurfaceId = second.surfaces?.[0]?.surfaceId ?? "";
    assert.match(secondSurfaceId, /:shop:r2$/);
    const thread = runtime.getThread(SHOP_THREAD);
    assert.equal(thread.activeSurfaces.get(SHOP_STAGE), secondSurfaceId);
    assert.equal(thread.supersededSurfaces.has(firstSurfaceId), true);
  } finally { environment.close(); }
});

test("criterion 4: a pending action whose thread, actor, tenant or expiry does not match is refused before any stage handler's confirm runs", () => {
  const cases: readonly { readonly name: string; readonly overrides: Partial<PendingAssistantAction> }[] = [
    { name: "tenant", overrides: { tenantId: "another-tenant" } },
    { name: "thread", overrides: { threadId: "another-thread" } },
    { name: "actor", overrides: { guestActorId: "another-guest" } },
    { name: "expiry", overrides: { expiresAt: "2026-10-27T08:00:00Z" } },
    { name: "already executed", overrides: { executed: true } },
  ];
  for (const { name, overrides } of cases) {
    const confirmed: string[] = [];
    const model = new RecordingTurnModel(() => PLAN_REPLY);
    const { environment, runtime } = open(model, [shopPack({ stageHandlers: [observedConfirmHandler(confirmed)] })]);
    try {
      startShopTask(runtime);
      const thread = runtime.getThread(SHOP_THREAD);
      const base: PendingAssistantAction = {
        id: "pa-stage-1", threadId: SHOP_THREAD, guestActorId: environment.config.guestId, tenantId: environment.config.tenantId,
        type: "request_to_book", authoritativeReferences: {}, summary: "Request this stay.",
        createdAt: "2026-10-27T08:30:00Z", expiresAt: "2026-10-27T12:00:00Z", executed: false,
      };
      thread.taskState.pendingAction = { ...base, ...overrides };
      thread.activeSurfaces.set(PENDING_ACTION_STAGE, `thread-${SHOP_THREAD}:pending-action:pa-stage-1`);
      const output = runtime.handleAssistantEvent(SHOP_THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, {
        surfaceId: `thread-${SHOP_THREAD}:pending-action:pa-stage-1`, actionId: "pa-stage-1",
      });
      assert.equal(output.ok, false, `a ${name} mismatch must not confirm`);
      assert.equal(output.code, "STALE_SURFACE", `a ${name} mismatch returns a closed code`);
      assert.deepEqual(confirmed, [], `no stage handler confirm may run for a ${name} mismatch`);
      assert.notEqual(runtime.getThread(SHOP_THREAD).taskState.pendingAction, null, `the ${name} mismatch leaves the proposal in place`);
    } finally { environment.close(); }
  }

  // The same action with every authority matching reaches the handler exactly once.
  const confirmed: string[] = [];
  const { environment, runtime } = open(new RecordingTurnModel(() => PLAN_REPLY), [shopPack({ stageHandlers: [observedConfirmHandler(confirmed)] })]);
  try {
    startShopTask(runtime);
    const thread = runtime.getThread(SHOP_THREAD);
    thread.taskState.pendingAction = {
      id: "pa-stage-1", threadId: SHOP_THREAD, guestActorId: environment.config.guestId, tenantId: environment.config.tenantId,
      type: "request_to_book", authoritativeReferences: {}, summary: "Request this stay.",
      createdAt: "2026-10-27T08:30:00Z", expiresAt: "2026-10-27T12:00:00Z", executed: false,
    };
    thread.activeSurfaces.set(PENDING_ACTION_STAGE, `thread-${SHOP_THREAD}:pending-action:pa-stage-1`);
    const output = runtime.handleAssistantEvent(SHOP_THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, {
      surfaceId: `thread-${SHOP_THREAD}:pending-action:pa-stage-1`, actionId: "pa-stage-1",
    });
    assert.equal(output.ok, true);
    assert.deepEqual(confirmed, ["pa-stage-1"]);
  } finally { environment.close(); }
});

test("criterion 5: a tool failure mid-turn leaves the thread unchanged when no application operation succeeded", async () => {
  const model = new RecordingTurnModel(() => CALL_BREAK("call-break"));
  const { environment, runtime } = open(model, [shopPack()]);
  try {
    startShopTask(runtime);
    const before = threadSnapshot(runtime.getThread(SHOP_THREAD));
    const historyBefore = runtime.getThread(SHOP_THREAD).conversationHistory.length;
    const output = await runtime.handleTurn(SHOP_THREAD, "shop for a broken item");
    assert.equal(output.ok, false);
    assert.equal(output.code, "CONCIERGE_UNAVAILABLE");
    assert.equal(threadSnapshot(runtime.getThread(SHOP_THREAD)), before);
    assert.equal(runtime.getThread(SHOP_THREAD).conversationHistory.length, historyBefore);
  } finally { environment.close(); }
});

test("criterion 5: a tool failure mid-turn keeps the projected state when an application operation succeeded", async () => {
  const model = new RecordingTurnModel(() => ({ toolCalls: [
    { id: "call-ok", name: "shop_search", args: {} },
    { id: "call-break", name: "shop_break", args: {} },
  ] }));
  const { environment, runtime } = open(model, [shopPack()]);
  try {
    startShopTask(runtime);
    const output = await runtime.handleTurn(SHOP_THREAD, "shop and then break");
    assert.equal(output.ok, true);
    assert.equal(output.controlOutcome, "rejected_plan_fallback");
    assert.equal(output.stopReason, "error");
    assert.deepEqual(output.messages, [SHOP_FALLBACK]);
    const surfaceId = output.surfaces?.[0]?.surfaceId ?? "";
    assert.match(surfaceId, /:shop:r1$/);
    assert.equal(runtime.getThread(SHOP_THREAD).activeSurfaces.get(SHOP_STAGE), surfaceId);
  } finally { environment.close(); }
});

test("criterion 6: each shortlet stage handler declares the supersede rule the shortlet pack had", () => {
  const summary = SHORTLET_STAGE_HANDLERS.map((handler) => ({
    stage: handler.stage,
    supersedes: [...handler.supersedes],
    confirms: handler.confirms ?? null,
  }));
  assert.deepEqual(summary, [
    { stage: "discovery", supersedes: ["discovery", "unit"], confirms: null },
    { stage: "unit", supersedes: ["discovery", "unit"], confirms: null },
    { stage: "request", supersedes: ["discovery", "unit", "request"], confirms: null },
    { stage: "request", supersedes: ["unit"], confirms: "request_to_book" },
    { stage: "payment", supersedes: ["offer"], confirms: "accept_offer" },
    { stage: "booking", supersedes: ["payment"], confirms: "start_checkout" },
  ]);
});

test("A pack's effect code reaches the tool diagnostics and its reply control outcome is reported", async () => {
  const events: AssistantDiagnosticEvent[] = [];
  const model = new RecordingTurnModel((_request, index) => index % 2 === 0 ? CALL_SEARCH("call-effect") : PLAN_REPLY);
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: new SteppedClock(STAGING_LIKE_START).now, initialGuestPhoneNumber: null, initialGuestContactEmail: null });
  const runtime = new AssistantRuntime(environment, model, {
    additionalPacks: [shopPack({ replyControlOutcome: (results) => results.some((result) => result.name === "shop_search") ? "no_current_booking" : undefined })],
    scopeClassifier: approvedTestScope,
    onDiagnostic: (event) => events.push(event),
  });
  try {
    startShopTask(runtime);
    const output = await runtime.handleTurn(SHOP_THREAD, "shop for a kettle");
    assert.equal(output.controlOutcome, "no_current_booking");
    const toolEvent = events.find((event) => event.toolName === "shop_search" && event.succeeded === true && event.effectCode !== undefined);
    assert.equal(toolEvent?.effectCode, EFFECT_CODE);
  } finally { environment.close(); }
});

test("a projected surface is filed under <pack id>:<kind>, so the commerce pack's cart surface is commerce:cart", async () => {
  // The commerce key is the generic path (no commerce handler objects, issue 04 decision a). A pack with id "commerce" pins it.
  const commerce = shopPack({
    id: "commerce",
    label: "Shop",
    stageHandlers: [],
    executeTool: (name, _args, context): AssistantToolExecutionResult => {
      if (name === "shop_break") throw new Error("unused");
      return {
        result: { resultCount: 1 },
        updatedTaskState: context.taskState,
        projectedSurface: { kind: "cart", surfaceId: "task-stage-1:commerce-cart:1", a2uiMessages: [] },
      };
    },
  });
  const model = new RecordingTurnModel((_request, index) => index % 2 === 0 ? CALL_SEARCH("call-commerce") : PLAN_REPLY);
  const { environment, runtime } = open(model, [commerce]);
  try {
    runtime.handleAssistantEvent(SHOP_THREAD, TASK_START_EVENT, { domain: "commerce" });
    const output = await runtime.handleTurn(SHOP_THREAD, "shop for a kettle");
    assert.equal(output.surfaces?.[0]?.surfaceId, "task-stage-1:commerce-cart:1");
    assert.equal(runtime.getThread(SHOP_THREAD).activeSurfaces.get("commerce:cart"), "task-stage-1:commerce-cart:1");
  } finally { environment.close(); }
});

test("a failed turn's fallback copy is the handler's copy, not a lookup on the surface id (an intentional change)", async () => {
  // The surface id contains ':discovery:', which the old id-substring lookup would have answered with the discovery copy.
  // The copy now comes from the pack that filed the surface, so the generic copy is correct here.
  const pack = shopPack({
    stageHandlers: [],
    executeTool: (name, _args, context): AssistantToolExecutionResult => {
      if (name === "shop_break") throw new Error("The shop provider is unavailable.");
      return {
        result: { resultCount: 1 },
        updatedTaskState: context.taskState,
        projectedSurface: { kind: "cart", surfaceId: `thread-${SHOP_THREAD}:discovery:crafted`, a2uiMessages: [] },
      };
    },
  });
  const model = new RecordingTurnModel(() => ({ toolCalls: [
    { id: "call-ok", name: "shop_search", args: {} },
    { id: "call-break", name: "shop_break", args: {} },
  ] }));
  const { environment, runtime } = open(model, [pack]);
  try {
    startShopTask(runtime);
    const output = await runtime.handleTurn(SHOP_THREAD, "shop and then break");
    assert.equal(output.controlOutcome, "rejected_plan_fallback");
    assert.deepEqual(output.messages, ["The requested information is ready below."]);
  } finally { environment.close(); }
});
