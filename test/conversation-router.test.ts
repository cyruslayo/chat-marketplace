import assert from "node:assert/strict";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

let testDbIndex = 0;
function createTestRuntime(model: ScriptedAssistantModel) {
  testDbIndex++;
  const databasePath = temporaryDatabasePath(`router_test_${testDbIndex}_${Date.now()}.sqlite`);
  const env = LocalGuestEnvironment.openNode({ databasePath });
  const runtime = new AssistantRuntime(env, model, { additionalPacks: [createFakeShopPack()] });
  return { env, runtime };
}

test("AC2: an intent for another registered domain produces a confirmation, never a silent task switch", async () => {
  const runtime = new AssistantRuntime(
    LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`router_confirm_${Date.now()}.sqlite`) }),
    new ScriptedAssistantModel([]),
    { additionalPacks: [createFakeShopPack()] },
  );

  const response = await runtime.handleTurn("g-router", "I want to buy a product in a store");

  assert.equal(response.ok, true);
  assert.match(response.messages?.[0] ?? "", /Start a Shop search\? Your shortlet search is saved\./);
  assert.equal(response.surfaces?.length, 0);
  const thread = runtime.getThread("g-router");
  assert.equal(thread.tasks.find((task) => task.taskId === thread.activeTaskId)?.domain, "shortlet");
});

test("AC3: switching tasks restores the previous task's state and tool set", async () => {
  let offeredTools: readonly string[] = [];
  const model = new ScriptedAssistantModel([
    (request) => {
      const last = request.history.at(-1);
      if (last?.role === "user" && /ikoyi/i.test(last.text)) {
        return { toolCalls: [{ id: "search", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 4, guests: 2 } }] };
      }
      if (last?.role === "user" && /new task/i.test(last.text)) {
        return { toolCalls: [{ id: "start", name: "start_task", args: { domain: "shop" } }] };
      }
      if (last?.role === "user" && /go back/i.test(last.text)) {
        return { toolCalls: [{ id: "switch", name: "switch_task", args: { taskId: "task-1" } }] };
      }
      if (last?.role === "tool_results") {
        offeredTools = request.tools.map((tool) => tool.name);
        return { text: "Done." };
      }
      return null;
    },
  ]);
  const { runtime } = createTestRuntime(model);

  await runtime.handleTurn("g-switch", "I need a place in Ikoyi for 4 nights for 2 guests");
  const beforeSwitch = runtime.getThread("g-switch");
  assert.ok(beforeSwitch.taskState.shortlist.length >= 1);
  assert.equal(beforeSwitch.tasks.find((task) => task.taskId === beforeSwitch.activeTaskId)?.domain, "shortlet");

  await runtime.handleTurn("g-switch", "start a new task");
  const afterStart = runtime.getThread("g-switch");
  assert.equal(afterStart.tasks.length, 2);
  assert.equal(afterStart.tasks.find((task) => task.taskId === afterStart.activeTaskId)?.domain, "shop");
  assert.equal(afterStart.taskState.shortlist.length, 0);
  assert.equal(offeredTools.includes("shop_search"), true);
  assert.equal(offeredTools.includes("search_stays"), false);

  await runtime.handleTurn("g-switch", "go back please");
  const afterSwitch = runtime.getThread("g-switch");
  assert.equal(afterSwitch.tasks.find((task) => task.taskId === afterSwitch.activeTaskId)?.domain, "shortlet");
  assert.equal(afterSwitch.taskState.shortlist.length, beforeSwitch.taskState.shortlist.length);
  assert.equal(offeredTools.includes("search_stays"), true);
});

test("AC4: a tool from a non-active task's domain is rejected", async () => {
  let continuationResults: readonly { readonly result: Record<string, unknown>; readonly isError?: boolean }[] = [];
  const model = new ScriptedAssistantModel([
    (request) => {
      if (request.history.at(-1)?.role === "user") {
        return { toolCalls: [{ id: "foreign", name: "shop_search", args: {} }] };
      }
      const last = request.history.at(-1);
      if (last?.role === "tool_results") {
        continuationResults = last.results;
        return { text: "That is not available here." };
      }
      return null;
    },
  ]);
  const { runtime } = createTestRuntime(model);

  const response = await runtime.handleTurn("g-foreign-tool", "What can you do?");

  assert.equal(response.ok, true);
  assert.equal(response.surfaces?.length, 0);
  assert.equal(continuationResults[0]?.isError, true);
  assert.equal(continuationResults[0]?.result.error, "invalid_tool_for_state");
});
