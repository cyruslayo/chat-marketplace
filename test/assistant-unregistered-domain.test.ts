import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import type { AssistantModelResponse, AssistantToolDefinition } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { PendingAssistantAction } from "../apps/local-guest/src/assistant/pending-actions.js";
import { ASSISTANT_CANCEL_ACTION_EVENT, ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { RecordingTurnModel, STAGING_LIKE_START, SteppedClock, threadSnapshot } from "./helpers/assistant-turn-model.js";

/**
 * Fail closed on an unregistered task domain (issue 04 follow-up). A task whose pack is not registered on this runtime, for
 * example a persisted Shortlet task served by a runtime without the Shortlet pack, is refused: no other pack answers for it.
 * A new thread with no active task yet keeps working on the first registered pack.
 */

const THREAD = "thread-unregistered-domain";
const SHOP_SEARCH: AssistantToolDefinition = {
  name: "shop_search", description: "Search products.", category: "read",
  parametersSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};
const SEARCH_CALL: AssistantModelResponse = { toolCalls: [{ id: "call-shop", name: "shop_search", args: {} }] };
const REPLY: AssistantModelResponse = { text: JSON.stringify({ kind: "show_results", references: [] }) };

/** A shop pack that counts how often its rules run, so a fallback to it is visible. */
function countingShopPack(counter: { executions: number }): AssistantDomainPack {
  return {
    ...createFakeShopPack(),
    toolNames: ["shop_search"],
    toolIntentMap: { search: ["shop_search"] },
    toolsForState: () => [SHOP_SEARCH],
    toolDefinition: (name) => name === "shop_search" ? SHOP_SEARCH : undefined,
    validateToolCall: () => undefined,
    executeTool: (_name, _args, context) => {
      counter.executions += 1;
      return { result: { resultCount: 1, shopResultId: "r1" }, updatedTaskState: context.taskState };
    },
    stageHandlers: [],
  };
}

function open(packs: readonly AssistantDomainPack[], model: RecordingTurnModel) {
  const environment = LocalGuestEnvironment.openNode({
    databasePath: ":memory:",
    clock: new SteppedClock(STAGING_LIKE_START).now,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
  });
  const runtime = new AssistantRuntime(environment, model, { packs, scopeClassifier: approvedTestScope });
  return { environment, runtime };
}

/** Makes the thread's only task a Shortlet task, the way a persisted Shortlet thread looks to a runtime without that pack. */
function persistedShortletThread(runtime: AssistantRuntime): void {
  const thread = runtime.getThread(THREAD);
  thread.tasks = [{ ...thread.tasks[0]!, taskId: "task-persisted-shortlet", domain: "shortlet" }];
  thread.activeTaskId = "task-persisted-shortlet";
}

test("a turn on a task whose pack is not registered is refused, and no other pack runs its tools", async () => {
  const counter = { executions: 0 };
  let plannerCalls = 0;
  const model = new RecordingTurnModel(() => { plannerCalls += 1; return SEARCH_CALL; });
  const { environment, runtime } = open([countingShopPack(counter)], model);
  try {
    persistedShortletThread(runtime);
    const output = await runtime.handleTurn(THREAD, "Find a stay in Old Ikoyi");
    assert.equal(output.modelHandled, false);
    assert.equal(output.controlOutcome, "tool_denial");
    assert.equal(plannerCalls, 0, "the planner is never asked for a task whose pack is not registered");
    assert.equal(counter.executions, 0, "the registered shop pack's tool does not run for a shortlet task");
    assert.notEqual(output.code, "CONCIERGE_UNAVAILABLE", "a refusal is a closed outcome, not an unavailable concierge");
  } finally { environment.close(); }
});

test("a confirmation on a task whose pack is not registered is refused with a closed code, and the proposal is kept", () => {
  const counter = { executions: 0 };
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => REPLY));
  try {
    persistedShortletThread(runtime);
    const thread = runtime.getThread(THREAD);
    const action: PendingAssistantAction = {
      id: "pa-unregistered", threadId: THREAD, guestActorId: environment.config.guestId, tenantId: environment.config.tenantId,
      type: "request_to_book", authoritativeReferences: {}, summary: "Request this stay.",
      createdAt: "2026-10-27T08:30:00Z", expiresAt: "2026-10-27T12:00:00Z", executed: false,
    };
    thread.taskState.pendingAction = action;
    thread.activeSurfaces.set("pending_action", `thread-${THREAD}:pending-action:pa-unregistered`);
    const output = runtime.handleAssistantEvent(THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, {
      surfaceId: `thread-${THREAD}:pending-action:pa-unregistered`, actionId: "pa-unregistered",
    });
    assert.equal(output.ok, false);
    assert.equal(output.code, "UNKNOWN_DOMAIN");
    assert.equal(runtime.getThread(THREAD).taskState.pendingAction?.id, "pa-unregistered", "nothing is confirmed or cleared");
  } finally { environment.close(); }
});

test("a new thread with no active task yet still works on the first registered pack", async () => {
  const counter = { executions: 0 };
  const model = new RecordingTurnModel((_request, index) => index === 0 ? SEARCH_CALL : REPLY);
  const { environment, runtime } = open([countingShopPack(counter)], model);
  try {
    const output = await runtime.handleTurn("thread-fresh-shop", "Show me a kettle");
    assert.equal(output.ok, true);
    assert.equal(counter.executions, 1, "the first registered pack serves a thread that has no task yet");
  } finally { environment.close(); }
});

test("a task start from a task whose pack is not registered is allowed, so the guest can leave it", () => {
  const counter = { executions: 0 };
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => REPLY));
  try {
    persistedShortletThread(runtime);
    const output = runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    assert.equal(output.ok, true);
    const active = runtime.getThread(THREAD).tasks.find((task) => task.taskId === runtime.getThread(THREAD).activeTaskId);
    assert.equal(active?.domain, "shop");
  } finally { environment.close(); }
});

test("a switch to a task whose pack is not registered is refused, and the active task does not change", () => {
  const counter = { executions: 0 };
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => REPLY));
  try {
    runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    const thread = runtime.getThread(THREAD);
    const shop = thread.tasks[0]!.taskId;
    thread.tasks = [...thread.tasks, { ...thread.tasks[0]!, taskId: "task-persisted-shortlet", domain: "shortlet" }];
    const output = runtime.handleAssistantEvent(THREAD, TASK_SWITCH_EVENT, { taskId: "task-persisted-shortlet" });
    assert.equal(output.ok, false);
    assert.equal(output.code, "UNKNOWN_DOMAIN");
    assert.equal(runtime.getThread(THREAD).activeTaskId, shop, "the active task is unchanged");
  } finally { environment.close(); }
});

function pendingAction(environment: LocalGuestEnvironment, id: string): PendingAssistantAction {
  return {
    id, threadId: THREAD, guestActorId: environment.config.guestId, tenantId: environment.config.tenantId,
    type: "request_to_book", authoritativeReferences: {}, summary: "Request this stay.",
    createdAt: "2026-10-27T08:30:00Z", expiresAt: "2026-10-27T12:00:00Z", executed: false,
  };
}

test("a cancel on a persisted shortlet task served without the Shortlet pack is refused: UNKNOWN_DOMAIN, nothing changes, the proposal stays", () => {
  const counter = { executions: 0 };
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => REPLY));
  try {
    persistedShortletThread(runtime);
    const thread = runtime.getThread(THREAD);
    thread.taskState.pendingAction = pendingAction(environment, "pa-cancel");
    thread.activeSurfaces.set("pending_action", `thread-${THREAD}:pending-action:pa-cancel`);
    const before = threadSnapshot(thread);
    const output = runtime.handleAssistantEvent(THREAD, ASSISTANT_CANCEL_ACTION_EVENT, {
      surfaceId: `thread-${THREAD}:pending-action:pa-cancel`, actionId: "pa-cancel",
    });
    assert.equal(output.ok, false);
    assert.equal(output.code, "UNKNOWN_DOMAIN");
    assert.equal(threadSnapshot(runtime.getThread(THREAD)), before, "the thread is unchanged");
    assert.equal(runtime.getThread(THREAD).taskState.pendingAction?.id, "pa-cancel", "the pending action is NOT cleared");
  } finally { environment.close(); }
});

test("an unknown platform event on a persisted shortlet task served without the Shortlet pack is refused: UNKNOWN_DOMAIN, nothing changes", () => {
  const counter = { executions: 0 };
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => REPLY));
  try {
    persistedShortletThread(runtime);
    const thread = runtime.getThread(THREAD);
    thread.taskState.pendingAction = pendingAction(environment, "pa-unknown");
    thread.activeSurfaces.set("pending_action", `thread-${THREAD}:pending-action:pa-unknown`);
    const before = threadSnapshot(thread);
    const output = runtime.handleAssistantEvent(THREAD, "platform.unknown.event", { actionId: "pa-unknown" });
    assert.equal(output.ok, false);
    assert.equal(output.code, "UNKNOWN_DOMAIN", "refused before the event is looked up, not UNSUPPORTED_EVENT");
    assert.equal(threadSnapshot(runtime.getThread(THREAD)), before, "the thread is unchanged");
    assert.equal(runtime.getThread(THREAD).taskState.pendingAction?.id, "pa-unknown", "the pending action is NOT cleared");
  } finally { environment.close(); }
});

test("a dangling active task id is refused as a closed outcome, not a throw, and the guest is pointed to another task", async () => {
  const counter = { executions: 0 };
  let plannerCalls = 0;
  const { environment, runtime } = open([countingShopPack(counter)], new RecordingTurnModel(() => { plannerCalls += 1; return REPLY; }));
  try {
    runtime.handleAssistantEvent(THREAD, TASK_START_EVENT, { domain: "shop" });
    runtime.getThread(THREAD).activeTaskId = "task-no-such-task";
    const before = threadSnapshot(runtime.getThread(THREAD));
    const output = await runtime.handleTurn(THREAD, "Show me a kettle");
    assert.equal(output.ok, true);
    assert.equal(output.modelHandled, false);
    assert.equal(output.controlOutcome, "tool_denial");
    assert.equal(output.messages?.[0], ASSISTANT_CONTROL_COPY.unregisteredTask);
    assert.notEqual(output.messages?.[0], ASSISTANT_CONTROL_COPY.unavailable, "the copy is not the generic retry wording");
    assert.match(output.messages?.[0] ?? "", /task list/, "the guest is pointed to switching task");
    assert.equal(plannerCalls, 0);
    assert.equal(counter.executions, 0);
    assert.equal(threadSnapshot(runtime.getThread(THREAD)), before, "nothing is committed");
    const confirm = runtime.handleAssistantEvent(THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, { actionId: "pa-none", surfaceId: "none" });
    assert.equal(confirm.code, "UNKNOWN_DOMAIN");
  } finally { environment.close(); }
});
