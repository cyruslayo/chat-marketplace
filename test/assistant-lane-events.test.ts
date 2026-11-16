import assert from "node:assert/strict";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { SCRIPT, STAY_TEXT } from "./helpers/assistant-cold-journey-harness.js";
import { scriptedPlanner, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { coldModeApp, type ColdModeApp } from "./helpers/mode-follows-task-harness.js";
import { readLaneRows } from "./helpers/lane-event-fixtures.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { GuestTimelineEntry, GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";

// Issue 03e (ADR 0107 decision 11, ADR 0106 cold restore, ADR 0075). Every event runs on a NEW application over the same store
// (a cold restore) on a fresh thread, with the assistant runtime enabled, the staging-like clock (27 Oct 2026) and a guest with
// no seeded phone or email. The shop lane is the fake shop pack. The rows are checked against the lanes the projection holds.

const SHOP_TEXT = "Show me the products";
const LANE_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...SCRIPT,
  [SHOP_TEXT]: { slots: {}, intents: ["search"], reply: "support_guidance" },
};

function laneModel(): AssistantModelClient {
  return scriptedPlanner(LANE_SCRIPT).client;
}

function taskEvent(threadId: string, name: string, context: Readonly<Record<string, unknown>>) {
  return { name, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: "2026-10-27T10:00:00.000Z", context: { ...context } };
}

interface StoredLane {
  readonly taskId: string;
  readonly domain: string;
  readonly timeline: readonly GuestTimelineEntry[];
}

/** One cold request: a new application over the same store, the state read a page load makes, then the step. */
async function cold<T>(path: string, threadId: string, step: (app: ColdModeApp) => Promise<T> | T): Promise<T> {
  const app = coldModeApp(path, laneModel());
  try {
    app.app.getState(threadId);
    return await step(app);
  } finally {
    app.close();
  }
}

function successOf(result: GuestTurnResult, label: string): void {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
}

/** The lanes the stored projection holds, read from the thread row (the projection is the authority the rows must match). */
function storedLanes(path: string, threadId: string): { readonly lanes: readonly StoredLane[]; readonly raw: string } {
  const database = openNodeSqliteDatabase(path);
  try {
    const row = database.prepare("SELECT thread_json FROM guest_threads WHERE thread_id = $threadId").get({ $threadId: threadId });
    assert.ok(row && typeof row.thread_json === "string", "the thread is stored");
    const raw = row.thread_json;
    const projection = JSON.parse(raw) as {
      readonly timeline: readonly GuestTimelineEntry[];
      readonly activeTaskId?: string;
      readonly tasks?: readonly { readonly taskId: string; readonly domain: string }[];
      readonly lanes?: readonly StoredLane[];
    };
    if (projection.lanes !== undefined) return { lanes: projection.lanes, raw };
    const task = projection.tasks?.[0];
    const taskId = projection.activeTaskId ?? task?.taskId ?? "task-1";
    return { lanes: [{ taskId, domain: task?.domain ?? "shortlet", timeline: projection.timeline }], raw };
  } finally {
    database.close();
  }
}

/** Every lane entry has exactly one row with its task id, domain, role and copy, and each lane's sequence runs 1..n. */
function assertOneRowPerEntry(path: string, threadId: string, label: string): void {
  const { lanes } = storedLanes(path, threadId);
  const rows = readLaneRows(path, threadId);
  assert.equal(rows.length, lanes.reduce((total, lane) => total + lane.timeline.length, 0), `${label}: one row for each lane entry`);
  for (const lane of lanes) {
    const laneRows = rows.filter((row) => row.taskId === lane.taskId);
    assert.deepEqual(laneRows.map((row) => row.seq), lane.timeline.map((_, index) => index + 1), `${label}: lane ${lane.taskId} sequence runs 1..n`);
    assert.ok(laneRows.every((row) => row.domain === lane.domain), `${label}: lane ${lane.taskId} rows carry its domain`);
    assert.deepEqual(laneRows.map((row) => row.role), lane.timeline.map((entry) => entry.role), `${label}: lane ${lane.taskId} rows keep the entry roles`);
    assert.deepEqual(laneRows.map((row) => row.textRedacted), lane.timeline.map((entry) => entry.text), `${label}: lane ${lane.taskId} rows keep the entry copy`);
    assert.ok(laneRows.every((row) => row.createdAt.length > 0), `${label}: lane ${lane.taskId} rows carry a timestamp`);
  }
}

test("AC1: Each new active-lane timeline entry writes exactly one row with its task_id, domain and a sequence number", async () => {
  const path = temporaryDatabasePath("lane-events-ac1.sqlite");
  const threadId = "g-03e00001";

  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, STAY_TEXT)), "stays search");
  assertOneRowPerEntry(path, threadId, "after the stays search");

  successOf(await cold(path, threadId, (app) => app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_START_EVENT, { domain: "shop" }))), "start the shop task");
  assertOneRowPerEntry(path, threadId, "after the shop start");

  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, SHOP_TEXT)), "shop turn");
  assertOneRowPerEntry(path, threadId, "after the shop turn");

  successOf(await cold(path, threadId, (app) => {
    const stays = app.runtime.getTaskRail(threadId).find((entry) => entry.domain === "shortlet");
    assert.ok(stays, "the stays task is on the rail");
    return app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId: stays.taskId }));
  }), "switch back to stays");
  assertOneRowPerEntry(path, threadId, "after the switch back");

  const { lanes } = storedLanes(path, threadId);
  const domains = lanes.map((lane) => lane.domain).sort();
  assert.deepEqual(domains, ["shop", "shortlet"], "the two lanes carry their own domains");
  assert.ok(lanes.every((lane) => lane.timeline.length > 0), "both lanes wrote entries");
});
