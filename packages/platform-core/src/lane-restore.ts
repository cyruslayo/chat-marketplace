import type { SqlDatabase, SqlValue } from "./sql-database.js";

/**
 * Issue 03h (ADR 0107 decision 11, ADR 0106 cold restore, ADR 0075, ADR 0079): the single reader of `guest_thread_lane_events`.
 * A cold restore reads one lane here: the active lane, or a lane the guest switches to. The writer (`saveThreadRecord`) and the
 * daily export do not read through this module. No other production module selects from the table (test/assistant-lane-read-path).
 *
 * A lane is refused alone, and then restores empty, when its rows are not one run of sequence numbers from 1 with each pair once,
 * or when a row's role or text is outside the closed shape. The diagnostic is a closed code and names no id or text. A refusal never
 * falls back to any other stored text.
 */

export const LANE_RESTORE_ROLES = ["user", "assistant", "receipt"] as const;
export type LaneRestoreRole = (typeof LANE_RESTORE_ROLES)[number];

/** The closed reasons a lane read is refused. */
export type LaneRestoreRefusal = "LANE_SEQUENCE_GAP" | "LANE_SEQUENCE_DUPLICATE" | "LANE_ROW_INVALID";

export interface LaneRestoreEntry {
  readonly role: LaneRestoreRole;
  readonly text: string;
}

export interface LaneRestoreResult {
  /** The lane's newest rows, oldest first, at most `cap` of them. Empty when the lane is refused. */
  readonly entries: readonly LaneRestoreEntry[];
  /** Every row the lane holds, before the cap. Zero when the lane is empty or refused. */
  readonly total: number;
  /** True when the lane holds more rows than `cap`; `entries` are then its newest `cap` rows. */
  readonly truncated: boolean;
  readonly refusal?: LaneRestoreRefusal;
}

export interface LaneRestoreInput {
  readonly threadId: string;
  readonly tenantId: string;
  readonly taskId: string;
  /** The injected lane cap (owner decision O3). */
  readonly cap: number;
}

const EMPTY: LaneRestoreResult = Object.freeze({ entries: Object.freeze([]), total: 0, truncated: false });

function refused(refusal: LaneRestoreRefusal): LaneRestoreResult {
  return Object.freeze({ entries: Object.freeze([]), total: 0, truncated: false, refusal });
}

function numberOf(value: SqlValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * Reads one lane for a thread, scoped by thread, tenant and task id. A task id that belongs to another thread matches no row.
 * Two statements: one summary (count, distinct sequences, the first and last sequence) to check the lane's whole run, then the
 * newest `cap` rows. The summary touches no text column, so a check never reads a lane's text.
 */
export function readLaneTimeline(database: SqlDatabase, input: LaneRestoreInput): LaneRestoreResult {
  if (!Number.isSafeInteger(input.cap) || input.cap < 1) throw new Error("the lane cap must be a positive integer");
  const scope = { $threadId: input.threadId, $tenantId: input.tenantId, $taskId: input.taskId };
  const summary = database
    .prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT seq) AS d, MIN(seq) AS lo, MAX(seq) AS hi
      FROM guest_thread_lane_events WHERE thread_id = $threadId AND tenant_id = $tenantId AND task_id = $taskId`)
    .get(scope);
  const count = numberOf(summary?.n) ?? 0;
  if (count === 0) return EMPTY;
  const distinct = numberOf(summary?.d);
  const first = numberOf(summary?.lo);
  const last = numberOf(summary?.hi);
  // Duplicates first: a repeated (task, seq) pair is refused alone. The run must then start at 1 with no hole up to its last row.
  if (distinct !== count) return refused("LANE_SEQUENCE_DUPLICATE");
  if (first !== 1 || last !== count) return refused("LANE_SEQUENCE_GAP");

  const newest = database
    .prepare(`SELECT seq, role, text_redacted FROM guest_thread_lane_events
      WHERE thread_id = $threadId AND tenant_id = $tenantId AND task_id = $taskId ORDER BY seq DESC LIMIT $limit`)
    .all({ ...scope, $limit: input.cap });
  const entries: LaneRestoreEntry[] = [];
  for (const row of newest.reverse()) {
    const role = row.role;
    const text = row.text_redacted;
    // Closed shape: a role outside the timeline roles or a non-text value refuses the whole lane.
    if (typeof role !== "string" || !(LANE_RESTORE_ROLES as readonly string[]).includes(role) || typeof text !== "string" || numberOf(row.seq) === null) {
      return refused("LANE_ROW_INVALID");
    }
    entries.push({ role: role as LaneRestoreRole, text });
  }
  return Object.freeze({ entries: Object.freeze(entries), total: count, truncated: count > input.cap });
}
