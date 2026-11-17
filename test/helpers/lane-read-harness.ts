import assert from "node:assert/strict";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { LANE_EVENT_SCHEMA } from "../../packages/platform-core/src/thread-schema.js";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { TASK_START_EVENT } from "../../apps/local-guest/src/assistant/assistant-platform.js";
import type { GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import { SCRIPT } from "./assistant-cold-journey-harness.js";
import { scriptedPlanner, type ScriptedTurn } from "./guest-date-fixtures.js";
import { coldModeApp, type ColdModeApp } from "./mode-follows-task-harness.js";

// Issue 03h: shared by the lane read-path tests. The fake shop pack is the second lane; the stays lane is the shortlet pack. Every
// step runs on a NEW application over the same store (a cold restore, ADR 0106), on a fresh thread, with the staging-like clock.

export const SHOP_TEXT = "Show me the products";
export const SHOP_PRICE_TEXT = "Show me the prices";

const LANE_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...SCRIPT,
  [SHOP_TEXT]: { slots: {}, intents: ["search"], reply: "support_guidance" },
  [SHOP_PRICE_TEXT]: { slots: {}, intents: ["price"], reply: "clarify_stay" },
};

export function laneModel(): AssistantModelClient {
  return scriptedPlanner(LANE_SCRIPT).client;
}

export function taskEvent(threadId: string, name: string, context: Readonly<Record<string, unknown>>) {
  return { name, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: "2026-10-27T10:00:00.000Z", context: { ...context } };
}

export function startShopEvent(threadId: string) {
  return taskEvent(threadId, TASK_START_EVENT, { domain: "shop" });
}

export function successOf(result: GuestTurnResult, label: string): void {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
}

/** One cold request: a new application over the same store, the state read a page load makes, then the step. */
export async function cold<T>(path: string, threadId: string, step: (app: ColdModeApp) => Promise<T> | T, options: { readonly laneTimelineCap?: number } = {}): Promise<T> {
  const app = coldModeApp(path, laneModel(), options);
  try {
    app.app.getState(threadId);
    return await step(app);
  } finally {
    app.close();
  }
}

/** Records every diagnostic the application emits from now on (closed codes; the tests check they carry no ids or text). */
export function recordDiagnostics(app: ColdModeApp): object[] {
  const events: object[] = [];
  const telemetry = app.environment.telemetry as { track(event: object): void };
  const originalTrack = telemetry.track.bind(telemetry);
  telemetry.track = (event: object) => {
    events.push(event);
    originalTrack(event);
  };
  return events;
}

/** The closed reasons of the restore-refused diagnostics recorded. */
export function refusalReasons(events: readonly object[]): string[] {
  return events
    .filter((event) => (event as { type?: unknown }).type === "assistant.task.restore.refused.v1")
    .map((event) => String((event as { reason?: unknown }).reason));
}

/**
 * Runs raw SQL against the thread database file, for the rows and the projection only the tests touch (the application reads the
 * rows through its one reader). `action` gets the connection, which is closed afterwards.
 */
export function withRawDatabase<T>(path: string, action: (database: SqlDatabase) => T): T {
  const database = openNodeSqliteDatabase(path);
  try {
    return action(database);
  } finally {
    database.close();
  }
}

/**
 * Replaces the lane table with a copy that lacks the named constraint(s), so a test can store the malformed rows the constraint
 * would refuse (a repeated (task, seq) pair, or a role outside the closed set). Every existing row is copied across.
 */
export function relaxLaneTable(path: string, relax: { readonly unique?: boolean; readonly roleCheck?: boolean }): void {
  let ddl = LANE_EVENT_SCHEMA;
  if (relax.unique) ddl = ddl.replace(/,\s*UNIQUE \(thread_id, task_id, seq\)/, "");
  if (relax.roleCheck) ddl = ddl.replace(/ CHECK \(role IN \('user', 'assistant', 'receipt'\)\)/, "");
  withRawDatabase(path, (database) => {
    database.exec("ALTER TABLE guest_thread_lane_events RENAME TO guest_thread_lane_events_before_relax");
    database.exec(ddl);
    database.exec("INSERT INTO guest_thread_lane_events SELECT * FROM guest_thread_lane_events_before_relax");
    database.exec("DROP TABLE guest_thread_lane_events_before_relax");
  });
}

/** Adds one lane row through the raw connection (after `relaxLaneTable` when the row breaks a constraint). */
export function insertLaneRow(path: string, row: { readonly threadId: string; readonly taskId: string; readonly seq: number; readonly role: string; readonly text: string; readonly domain?: string }): void {
  withRawDatabase(path, (database) => {
    const thread = database.prepare("SELECT tenant_id FROM guest_threads WHERE thread_id = $threadId").get({ $threadId: row.threadId });
    assert.ok(thread && typeof thread.tenant_id === "string", "the thread is stored before a row is added to it");
    database.prepare(`INSERT INTO guest_thread_lane_events (event_id, thread_id, tenant_id, task_id, domain, seq, role, text_redacted, created_at)
      VALUES ($eventId, $threadId, $tenantId, $taskId, $domain, $seq, $role, $text, $createdAt)`).run({
      $eventId: `${row.threadId}:${row.taskId}:${row.seq}:injected:${row.text.length}:${row.role}`,
      $threadId: row.threadId,
      $tenantId: thread.tenant_id,
      $taskId: row.taskId,
      $domain: row.domain ?? "shop",
      $seq: row.seq,
      $role: row.role,
      $text: row.text,
      $createdAt: "2026-10-27T10:00:00.000Z",
    });
  });
}

/** Deletes the lane rows of one thread's task through the raw connection (a legacy thread holds none). */
export function deleteLaneRows(path: string, threadId: string): void {
  withRawDatabase(path, (database) => {
    database.prepare("DELETE FROM guest_thread_lane_events WHERE thread_id = $threadId").run({ $threadId: threadId });
  });
}
