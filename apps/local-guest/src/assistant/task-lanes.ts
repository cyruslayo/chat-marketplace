/**
 * Issue 03d (ADR 0107 decision 11, ADR 0106 resource controls, ADR 0075): the per-task lane timeline cap.
 *
 * A lane is one task's guest-visible transcript. Model history is never part of a lane and is never persisted (owner decision O1).
 * The cap is an injectable host option (owner decision O3, 11 Nov 2026); this module only holds its default and the rule that
 * keeps a lane within it.
 */

/** One guest-visible transcript entry. The same shape the shell's timeline has always used. */
export interface GuestLaneEntry {
  readonly role: "assistant" | "user" | "receipt";
  readonly text: string;
}

/** Owner decision O3: the default per-lane timeline cap, in entries. A host injects another value through `laneTimelineCap`. */
export const DEFAULT_LANE_TIMELINE_CAP = 100;
/** Engineering bounds on the injected cap: one summary and one entry at the least; a bounded projection at the most. */
const MIN_LANE_TIMELINE_CAP = 2;
const MAX_LANE_TIMELINE_CAP = 1000;

/**
 * The receipt that replaces the entries a capped lane no longer keeps. A closed, fixed string: it is not model text and carries no
 * guest data. Its copy is for the owner to confirm.
 */
export const LANE_SUMMARY_TEXT = "Earlier messages in this task are not shown.";

/** Validates an injected cap; anything outside the engineering bounds is refused before the host starts. */
export function validateLaneTimelineCap(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_LANE_TIMELINE_CAP || value > MAX_LANE_TIMELINE_CAP) {
    throw new Error(`laneTimelineCap must be an integer between ${MIN_LANE_TIMELINE_CAP} and ${MAX_LANE_TIMELINE_CAP}`);
  }
  return value;
}

/**
 * Keeps a lane within its cap. A lane at or under the cap is returned as a copy. A longer lane keeps its newest entries, and its
 * oldest entries are replaced by one receipt summary; the result has exactly `cap` entries. A summary already at the head is
 * reused, so the summary never repeats.
 */
export function capLaneTimeline(lane: readonly GuestLaneEntry[], cap: number): GuestLaneEntry[] {
  if (lane.length <= cap) return [...lane];
  const head = lane[0];
  const hasSummary = head?.role === "receipt" && head.text === LANE_SUMMARY_TEXT;
  const body = hasSummary ? lane.slice(1) : lane;
  return [{ role: "receipt", text: LANE_SUMMARY_TEXT }, ...body.slice(body.length - (cap - 1))];
}
