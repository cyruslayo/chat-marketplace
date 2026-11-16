import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import type { SqlRow } from "../../packages/platform-core/src/sql-database.js";
import type { DurableGuestThreadRecord, DurableLaneEvent } from "../../domains/shortlet/src/index.js";

// Issue 03e (ADR 0107 decision 11, owner decision O4): shared fixtures for the lane event table. Rows are read here with a raw
// connection, because the application never reads the table (AC7). Only tests read it.

export interface StoredLaneRow {
  readonly eventId: string;
  readonly threadId: string;
  readonly tenantId: string;
  readonly taskId: string;
  readonly domain: string;
  readonly seq: number;
  readonly role: string;
  readonly textRedacted: string;
  readonly createdAt: string;
}

export const LANE_TEST_TENANT = "tenant-lane-fixture";
export const LANE_TEST_PRINCIPAL = "guest-lane-fixture";

/** One lane event, with fields the tests override. The defaults are a valid stays user row on the initial lane. */
export function laneEventFor(overrides: Partial<DurableLaneEvent> = {}): DurableLaneEvent {
  return {
    taskId: "task-1",
    domain: "shortlet",
    seq: 1,
    role: "user",
    text: "Two bedrooms in Lekki",
    createdAt: "2026-10-27T10:00:00.000Z",
    ...overrides,
  };
}

/** A thread record for the store, with an opaque projection and the lane events to write with it. */
export function laneThreadRecord(threadId: string, laneEvents?: readonly DurableLaneEvent[], threadJson = "{\"version\":1}"): DurableGuestThreadRecord {
  return {
    threadId,
    principalId: LANE_TEST_PRINCIPAL,
    tenantId: LANE_TEST_TENANT,
    threadJson,
    ...(laneEvents === undefined ? {} : { laneEvents }),
  };
}

function textOf(value: unknown): string {
  if (typeof value !== "string") throw new Error("the stored lane row has a non-text column");
  return value;
}

function numberOf(value: unknown): number {
  if (typeof value !== "number") throw new Error("the stored lane row has a non-number column");
  return value;
}

function toStoredRow(row: SqlRow): StoredLaneRow {
  return {
    eventId: textOf(row.event_id),
    threadId: textOf(row.thread_id),
    tenantId: textOf(row.tenant_id),
    taskId: textOf(row.task_id),
    domain: textOf(row.domain),
    seq: numberOf(row.seq),
    role: textOf(row.role),
    textRedacted: textOf(row.text_redacted),
    createdAt: textOf(row.created_at),
  };
}

/** Every stored lane row (optionally one thread's), in a stable order. Opens and closes its own connection. */
export function readLaneRows(databasePath: string, threadId?: string): StoredLaneRow[] {
  const database = openNodeSqliteDatabase(databasePath);
  try {
    const select = "SELECT * FROM guest_thread_lane_events";
    const rows = threadId === undefined
      ? database.prepare(`${select} ORDER BY thread_id, task_id, seq`).all()
      : database.prepare(`${select} WHERE thread_id = $threadId ORDER BY task_id, seq`).all({ $threadId: threadId });
    return rows.map(toStoredRow);
  } finally {
    database.close();
  }
}
