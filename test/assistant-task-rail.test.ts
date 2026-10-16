import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

let testDbIndex = 0;
function createTestRuntime(model: ScriptedAssistantModel) {
  testDbIndex++;
  const databasePath = `.scratch/local-guest/taskrail_test_${testDbIndex}_${Date.now()}.sqlite`;
  const env = LocalGuestEnvironment.openNode({ databasePath });
  const runtime = new AssistantRuntime(env, model, { additionalPacks: [createFakeShopPack()] });
  return { env, runtime };
}

function searchThenStartShopModel(): ScriptedAssistantModel {
  return new ScriptedAssistantModel([
    (request) => {
      const last = request.history.at(-1);
      if (last?.role === "user" && /ikoyi/i.test(last.text)) {
        return { toolCalls: [{ id: "search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 4, guests: 2 } }] };
      }
      if (last?.role === "user" && /new task/i.test(last.text)) {
        return { toolCalls: [{ id: "start", name: "start_task", args: { domain: "shop" } }] };
      }
      if (last?.role === "tool_results") return { text: "Done." };
      return null;
    },
  ]);
}

test("AC1: the rail lists each task with its domain and status; selecting one restores its workspace", async () => {
  const { runtime } = createTestRuntime(searchThenStartShopModel());

  await runtime.handleTurn("g-rail", "I need a place in Ikoyi for 4 nights for 2 guests");
  const searched = runtime.getThread("g-rail");
  const discoverySurfaceId = searched.lastSurfaces.at(-1)?.surfaceId;
  assert.ok(discoverySurfaceId?.includes(":discovery:"));

  await runtime.handleTurn("g-rail", "start a new task");
  const rail = runtime.getTaskRail("g-rail");
  assert.equal(rail.length, 2);
  assert.deepEqual(rail.map((task) => task.domain), ["shortlet", "shop"]);
  assert.equal(rail.find((task) => task.domain === "shortlet")?.status, "Stay");
  assert.equal(rail.find((task) => task.domain === "shop")?.status, "Browse");
  assert.equal(rail.find((task) => task.active)?.domain, "shop");

  const switched = runtime.handleAssistantEvent("g-rail", TASK_SWITCH_EVENT, { taskId: "task-1" });
  assert.equal(switched.ok, true);
  assert.equal(runtime.getThread("g-rail").activeTaskId, "task-1");
  assert.ok(switched.surfaces?.some((surface) => surface.surfaceId === discoverySurfaceId));
  assert.equal(runtime.getTaskRail("g-rail").find((task) => task.active)?.domain, "shortlet");
});

test("AC2: an event for a background task badges that task and does not change the open conversation", async () => {
  const { runtime } = createTestRuntime(searchThenStartShopModel());

  await runtime.handleTurn("g-badge", "I need a place in Ikoyi for 4 nights for 2 guests");
  await runtime.handleTurn("g-badge", "start a new task");

  const before = runtime.getThread("g-badge");
  const activeTaskId = before.activeTaskId;
  const activeLastSurfaces = before.lastSurfaces;
  const historyLength = before.conversationHistory.length;

  const recorded = runtime.recordTaskEvent("g-badge", "task-1");
  assert.equal(recorded.ok, true);

  const after = runtime.getThread("g-badge");
  const rail = runtime.getTaskRail("g-badge");
  assert.equal(rail.find((task) => task.taskId === "task-1")?.badge, 1);
  assert.equal(rail.find((task) => task.active)?.taskId, activeTaskId);
  assert.deepEqual(after.lastSurfaces, activeLastSurfaces);
  assert.equal(after.conversationHistory.length, historyLength);
  assert.equal(after.activeTaskId, activeTaskId);
});
