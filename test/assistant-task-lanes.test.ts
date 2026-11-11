import assert from "node:assert/strict";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { GuestTimelineEntry, GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { SCRIPT, STAY_TEXT } from "./helpers/assistant-cold-journey-harness.js";
import { scriptedPlanner, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import type { CapturedRequest } from "./helpers/openai-compatible-client.js";
import { coldModeApp, rewriteStoredProjection, type ColdModeApp } from "./helpers/mode-follows-task-harness.js";
import { definitionOf, journeyScriptedModel } from "./helpers/assistant-recordings.js";

// Issue 03d (ADR 0107 decision 11 and its corrections, ADR 0106 cold restore, ADR 0075 minimal projection, ADR 0074 proposal
// removal on a switch, ADR 0079 committed work stays visible). Every event runs on a NEW application over the same store (a cold
// restore), on a fresh thread, on the staging-like clock (27 Oct 2026), with the assistant runtime enabled and a guest with no
// seeded phone or email. The shop lane is the fake shop pack (test/helpers/fake-domain-pack.ts). The stays turns use the
// date-aware planner of the persistence tests (`scriptedPlanner`), so the stays search really runs.

/** Guest messages the fake shop task answers with fixed reply plans (no stays tool). Two replies differ, so a lane alternates copy. */
const SHOP_TEXT = "Show me the products";
const SHOP_PRICE_TEXT = "Show me the prices";

const LANE_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...SCRIPT,
  [SHOP_TEXT]: { slots: {}, intents: ["search"], reply: "support_guidance" },
  [SHOP_PRICE_TEXT]: { slots: {}, intents: ["price"], reply: "clarify_stay" },
};

/** A planner for the lane tests. `planner` collects each planner request, so tests can see what the planner was shown. */
function laneModel(planner: CapturedRequest[] = []): AssistantModelClient {
  return scriptedPlanner(LANE_SCRIPT, planner).client;
}

function taskEvent(threadId: string, name: string, context: Readonly<Record<string, unknown>>) {
  return { name, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: "2026-10-27T10:00:00.000Z", context: { ...context } };
}

function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

interface AppOptions { readonly laneTimelineCap?: number }

/** One cold request: a new application over the same store, the state read a page load makes, then the step. */
async function cold<T>(path: string, model: AssistantModelClient, threadId: string, step: (app: ColdModeApp) => Promise<T> | T, options: AppOptions = {}): Promise<T> {
  const app = coldModeApp(path, model, options);
  try {
    app.app.getState(threadId);
    return await step(app);
  } finally {
    app.close();
  }
}

/** The active lane's timeline as a cold page load reads it. */
function coldTimeline(path: string, model: AssistantModelClient, threadId: string, options: AppOptions = {}): Promise<readonly GuestTimelineEntry[]> {
  return cold(path, model, threadId, (app) => app.app.getState(threadId)?.timeline ?? [], options);
}

function coldStaysSearch(path: string, model: AssistantModelClient, threadId: string, text = STAY_TEXT): Promise<GuestTurnResult> {
  return cold(path, model, threadId, (app) => app.app.handleTurn(threadId, text));
}

function coldShopTurn(path: string, model: AssistantModelClient, threadId: string): Promise<GuestTurnResult> {
  return cold(path, model, threadId, (app) => app.app.handleTurn(threadId, SHOP_TEXT));
}

function coldStartShop(path: string, model: AssistantModelClient, threadId: string): Promise<GuestTurnResult> {
  return cold(path, model, threadId, (app) => app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_START_EVENT, { domain: "shop" })));
}

/** Switches to the task of the given domain, found on the cold restored rail (the id is the one the guest holds). */
function coldSwitchTo(path: string, model: AssistantModelClient, threadId: string, domain: "shop" | "shortlet"): Promise<GuestTurnResult> {
  return cold(path, model, threadId, (app) => {
    const target = app.runtime.getTaskRail(threadId).find((entry) => entry.domain === domain);
    assert.ok(target, `the ${domain} task is on the rail`);
    return app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId: target.taskId }));
  });
}

function storedProjection(path: string, threadId: string): { readonly raw: string; readonly value: Record<string, unknown> } {
  const app = coldModeApp(path, laneModel());
  try {
    const record = app.environment.interactionStore.findThread(threadId);
    assert.ok(record, "the thread is stored");
    return { raw: record.threadJson, value: JSON.parse(record.threadJson) as Record<string, unknown> };
  } finally {
    app.close();
  }
}

function storedLanes(path: string, threadId: string): readonly { readonly taskId: string; readonly domain: string; readonly timeline: readonly GuestTimelineEntry[] }[] {
  const lanes = storedProjection(path, threadId).value.lanes;
  assert.ok(Array.isArray(lanes), "the stored projection carries the lanes");
  return lanes as { readonly taskId: string; readonly domain: string; readonly timeline: readonly GuestTimelineEntry[] }[];
}

function storedTaskIds(path: string, threadId: string): readonly string[] {
  const tasks = storedProjection(path, threadId).value.tasks as readonly { readonly taskId: string }[];
  return tasks.map((task) => task.taskId);
}

test("AC1: a switch from stays to the fake shop task saves the stays timeline and restores the shop timeline (empty on first visit); switching back restores the stays timeline; a pending proposal is still dropped on the switch (ADR 0074)", async () => {
  // The recorded journey gives a Booking Request proposal on the stays task (the same planner answers as the ADR 0074 journey).
  const journey = definitionOf("confirm-after-task-switch");
  const model = journeyScriptedModel(journey);
  const path = temporaryDatabasePath("task-lanes-ac1.sqlite");
  const threadId = "g-b03d0001";
  const [search, propose] = journey.guestTurns;

  successOf(await coldStaysSearch(path, model, threadId, search!.text), "stays search");
  successOf(await coldStaysSearch(path, model, threadId, propose!.text), "propose");
  const staysBeforeSwitch = await coldTimeline(path, model, threadId);
  const proposed = await cold(path, model, threadId, (app) => app.runtime.getThread(threadId).taskState.pendingAction ?? null);
  assert.ok(proposed, "the Booking Request proposal is open before the switch");

  // The start is one cold request. The proposal the switch removes is read on that same application, straight after the switch
  // (a non-active task's state is not persisted across a cold restore, as issue 03b records).
  const started = await cold(path, model, threadId, (app) => {
    const started = app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_START_EVENT, { domain: "shop" }));
    return started.then((result) => {
      const stays = app.runtime.getThread(threadId).tasks.find((task) => task.domain === "shortlet");
      return { result: successOf(result, "start the shop task"), notice: stays?.state.replacedPendingAction ?? null, pending: stays?.state.pendingAction ?? null };
    });
  });
  assert.ok(started.result.ok, "the shop task started");
  assert.ok(started.notice, "the proposal the switch removed leaves its notice on the stays task (ADR 0074)");
  assert.equal(started.pending, null, "the proposal is no longer open on the stays task");

  const shopFirstVisit = await coldTimeline(path, model, threadId);
  assert.ok(shopFirstVisit.every((entry) => entry.role === "assistant"), "the shop lane holds only assistant copy on first visit");
  assert.ok(shopFirstVisit.length <= 1, "the shop lane holds at most the switch reply on first visit");
  assert.equal(shopFirstVisit.some((entry) => entry.text.includes("matching stay")), false, "no stays copy is in the shop lane");

  successOf(await coldSwitchTo(path, model, threadId, "shortlet"), "switch back to stays");
  const staysAfterReturn = await coldTimeline(path, model, threadId);
  assert.deepEqual(staysAfterReturn.slice(0, staysBeforeSwitch.length), staysBeforeSwitch, "the stays timeline is restored as it was saved");
  assert.ok(staysAfterReturn.length - staysBeforeSwitch.length <= 1, "at most the switch reply is added to the stays lane");
  assert.equal(staysAfterReturn.some((entry) => entry.text.includes("matching stay")), true, "the stays copy is back in the stays lane");

  const afterReturn = await cold(path, model, threadId, (app) => app.runtime.getThread(threadId).taskState.pendingAction ?? null);
  assert.equal(afterReturn, null, "the proposal is no longer open after the switch back");
});

test("AC2: an entry written in the stays lane is absent from the shop lane's response; the shop planner context holds no stays text", async () => {
  const planner: CapturedRequest[] = [];
  const model = laneModel(planner);
  const path = temporaryDatabasePath("task-lanes-ac2.sqlite");
  const threadId = "g-b03d0002";

  successOf(await coldStaysSearch(path, model, threadId), "stays search");
  const stays = await coldTimeline(path, model, threadId);
  assert.ok(stays.some((entry) => entry.text.includes("Lekki")), "the stays lane holds the stays copy");

  successOf(await coldStartShop(path, model, threadId), "start the shop task");
  planner.length = 0;
  successOf(await coldShopTurn(path, model, threadId), "a shop turn");
  const shop = await coldTimeline(path, model, threadId);
  assert.ok(shop.some((entry) => entry.text === "General human support is available daily from 8:00 AM to 8:00 PM WAT. Use the existing support channel provided with your stay."), "the shop lane holds its own reply");
  assert.equal(shop.some((entry) => stays.some((stayEntry) => stayEntry.text === entry.text && entry.text.includes("Lekki"))), false, "no stays entry reaches the shop lane");
  assert.equal(shop.some((entry) => entry.text.includes("Lekki")), false, "the shop lane shows no stays location");

  assert.ok(planner.length > 0, "the shop turn made planner requests");
  for (const request of planner) {
    const serialised = JSON.stringify(request.body);
    assert.equal(serialised.includes(STAY_TEXT), false, "no planner request of the shop turn carries the stays message");
    assert.equal(serialised.includes("Lekki"), false, "no planner request of the shop turn carries a stays location");
  }
});

test("AC3: after a cold restore the active lane and every persisted lane are restored, with taskId values unchanged", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac3.sqlite");
  const threadId = "g-b03d0003";

  successOf(await coldStaysSearch(path, model, threadId), "stays search");
  successOf(await coldStartShop(path, model, threadId), "start the shop task");
  successOf(await coldShopTurn(path, model, threadId), "a shop turn");
  const shopLane = await coldTimeline(path, model, threadId);
  successOf(await coldSwitchTo(path, model, threadId, "shortlet"), "switch back to stays");
  const staysLane = await coldTimeline(path, model, threadId);
  const idsBefore = storedTaskIds(path, threadId);

  const lanes = storedLanes(path, threadId);
  assert.deepEqual(lanes.map((lane) => lane.taskId).sort(), [...idsBefore].sort(), "every persisted lane names a persisted task id");
  assert.deepEqual(lanes.find((lane) => lane.domain === "shop")?.timeline, shopLane, "the shop lane timeline is stored");

  assert.deepEqual(await coldTimeline(path, model, threadId), staysLane, "the active stays lane is restored after a cold restore");
  assert.deepEqual(await coldTimeline(path, model, threadId), staysLane, "a second cold restore restores the same active lane");
  assert.deepEqual(storedTaskIds(path, threadId), idsBefore, "the stored task ids are unchanged by the restores");

  const restoredShop = await cold(path, model, threadId, (app) => {
    const target = app.runtime.getTaskRail(threadId).find((entry) => entry.domain === "shop");
    assert.ok(target, "the shop task is restored on the rail");
    return app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId: target.taskId }));
  });
  successOf(restoredShop, "switch to the restored shop lane");
  const shopAfter = await coldTimeline(path, model, threadId);
  assert.deepEqual(shopAfter.slice(0, shopLane.length), shopLane, "the shop lane is restored with its own timeline");
});

test("AC4: after a cold restore each lane's conversationHistory is empty, and the stored projection has no conversationHistory or model text", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac4.sqlite");
  const threadId = "g-b03d0004";

  // Before the restore, the active lane holds model history in the same application (the planner context is kept there).
  const warm = coldModeApp(path, model);
  try {
    warm.app.getState(threadId);
    successOf(await warm.app.handleTurn(threadId, STAY_TEXT), "stays search");
    assert.ok(warm.runtime.getThread(threadId).conversationHistory.length > 0, "the active lane holds model history before the restore");
  } finally {
    warm.close();
  }

  const histories = await cold(path, model, threadId, (app) => app.runtime.getThread(threadId).tasks.map((task) => task.conversationHistory.length));
  assert.deepEqual(histories, histories.map(() => 0), "every lane's model history is empty after a cold restore");

  const raw = storedProjection(path, threadId).raw;
  assert.doesNotMatch(raw, /conversationHistory|tool_calls|tool_results|rawStep/, "the stored projection holds no model history or provider metadata");
});

test.skip("AC5: New conversation in the shop lane resets the shop lane only; the stays timeline is unchanged (BLOCKED: New conversation is a client thread switch with no server reset, ADR 0079 and issue 13a; owner to decide O5)", () => {
  // Intentionally skipped. See the issue Comments: the reset path does not exist on the server, so this criterion cannot be
  // verified as written. The behaviour that exists is tested below.
});

test("AC5 (current behaviour): a new conversation starts a new thread; the previous thread's stays and shop lanes are unchanged", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac5.sqlite");
  const threadId = "g-b03d0005";
  const fresh = "g-b03d0006";

  successOf(await coldStaysSearch(path, model, threadId), "stays search");
  successOf(await coldStartShop(path, model, threadId), "start the shop task");
  successOf(await coldShopTurn(path, model, threadId), "a shop turn");
  const lanesBefore = storedLanes(path, threadId);

  assert.deepEqual(await coldTimeline(path, model, fresh), [], "the new conversation's first lane is empty");
  assert.deepEqual(storedLanes(path, threadId), lanesBefore, "the previous thread's lanes are unchanged");
});

test("AC6: a lane longer than the named cap keeps the cap; older entries are replaced by one receipt summary, and the stored projection stays under the cap", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac6.sqlite");
  const threadId = "g-b03d0007";
  const cap = 4;
  const options: AppOptions = { laneTimelineCap: cap };

  successOf(await cold(path, model, threadId, (app) => app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_START_EVENT, { domain: "shop" })), options), "start the shop task");
  // Alternating replies: the timeline drops an identical message that repeats the one before it, so the lane grows on every turn.
  const texts = [SHOP_TEXT, SHOP_PRICE_TEXT, SHOP_TEXT, SHOP_PRICE_TEXT];
  for (const [index, text] of texts.entries()) successOf(await cold(path, model, threadId, (app) => app.app.handleTurn(threadId, text), options), `shop turn ${index + 1}`);

  const timeline = await coldTimeline(path, model, threadId, options);
  assert.equal(timeline.length, cap, `the active lane keeps exactly the cap (saw ${timeline.length})`);
  assert.equal(timeline[0]?.role, "receipt", "the oldest entries are replaced by one receipt summary");
  assert.equal(timeline.filter((entry) => entry.role === "receipt").length, 1, "there is exactly one summary");
  assert.equal(timeline.at(-1)?.role, "assistant", "the newest entry is kept");

  const stored = storedLanes(path, threadId).find((lane) => lane.domain === "shop");
  assert.ok(stored && stored.timeline.length <= cap, "the stored shop lane stays under the cap");
});

test("AC7: a persisted lanes entry whose taskId is not in tasks rejects the lanes list only; the stays progress is kept and one closed diagnostic is recorded", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac7.sqlite");
  const threadId = "g-b03d0008";

  successOf(await coldStaysSearch(path, model, threadId), "stays search");
  successOf(await coldStartShop(path, model, threadId), "start the shop task");
  successOf(await coldShopTurn(path, model, threadId), "a shop turn");
  successOf(await coldSwitchTo(path, model, threadId, "shortlet"), "switch back to stays");
  const staysLane = await coldTimeline(path, model, threadId);

  const store = coldModeApp(path, model);
  try {
    rewriteStoredProjection(store.environment, threadId, (projection) => {
      const lanes = projection.lanes as { taskId: string; domain: string; timeline: unknown[] }[];
      projection.lanes = [...lanes, { taskId: "task-missing", domain: "shop", timeline: [{ role: "user", text: "ghost" }] }];
    });
  } finally {
    store.close();
  }

  const events: object[] = [];
  const restored = coldModeApp(path, model);
  try {
    const telemetry = restored.environment.telemetry as { track(event: object): void };
    const originalTrack = telemetry.track.bind(telemetry);
    telemetry.track = (event: object) => { events.push(event); originalTrack(event); };
    const timeline = restored.app.getState(threadId)?.timeline;
    assert.deepEqual(timeline, staysLane, "the active lane is the stays progress, unchanged");
    assert.equal(restored.runtime.getTaskRail(threadId).length, 2, "both tasks are still restored");
  } finally {
    restored.close();
  }

  const refusals = events.filter((event) => (event as { type?: unknown }).type === "assistant.task.restore.refused.v1");
  assert.deepEqual(refusals.map((event) => (event as { reason?: unknown }).reason), ["INVALID_TASK_LIST"], "one closed diagnostic with the closed reason");
  const diagnostic = JSON.stringify(refusals);
  assert.equal(diagnostic.includes("task-missing") || diagnostic.includes("ghost") || diagnostic.includes(threadId), false, "the diagnostic carries no ids or text");
});

test("AC8: a legacy blob with only the top-level timeline restores as the stays lane timeline, unchanged", async () => {
  const model = laneModel();
  const path = temporaryDatabasePath("task-lanes-ac8.sqlite");
  const threadId = "g-b03d0009";

  successOf(await coldStaysSearch(path, model, threadId), "stays search");
  const expected = await coldTimeline(path, model, threadId);
  assert.ok(expected.length > 0, "the stays lane holds entries before the legacy rewrite");

  const store = coldModeApp(path, model);
  try {
    rewriteStoredProjection(store.environment, threadId, (projection) => {
      delete projection.activeTaskId;
      delete projection.tasks;
      delete projection.lanes;
    });
  } finally {
    store.close();
  }
  assert.equal("lanes" in storedProjection(path, threadId).value, false, "the blob is a legacy blob with only the top-level timeline");

  assert.deepEqual(await coldTimeline(path, model, threadId), expected, "the legacy timeline restores as the stays lane, unchanged");
});
