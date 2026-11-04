/**
 * Issue 16 (AC4): the report of the owner-run parity live script. Pure formatting, so the offline suite can test it.
 * It prints row names and counts only. It never prints guest text, filters or replies (ADR 0075).
 */

export interface ParityRowResult {
  /** A row's label (its name in test/helpers/parity-rows.ts), never a guest message. */
  readonly name: string;
  /** How many of the k runs gave the same screen change and filters on both paths, with no failure outcome. */
  readonly passes: number;
  /** The closed control outcome codes seen in the row's runs, with counts. */
  readonly outcomes?: Readonly<Record<string, number>>;
}

/**
 * The closed control outcomes that make a run fail (ADR 0106): the model did not handle the turn, a guard or quota stopped it, or a
 * plan had to fall back. Benign outcomes (a successful reply, a scope redirect, a tool denial that was the right answer) do not.
 */
export const FAILURE_OUTCOMES: readonly string[] = ["model_handling_failure", "guard_failure", "scope_unavailable", "quota_refusal", "rejected_plan_fallback"];

/** True when a run's recorded control outcomes include a failure outcome. */
export function runHasFailureOutcome(outcomes: readonly string[]): boolean {
  return outcomes.some((outcome) => FAILURE_OUTCOMES.includes(outcome));
}

/** pass^k for one row: true only when every one of the k runs passed. */
export function passAllK(outcomes: readonly boolean[]): boolean {
  return outcomes.length > 0 && outcomes.every(Boolean);
}

/** One line per row (passes out of k, and pass^k), then the total pass^k over every row. */
export function formatParityReport(rows: readonly ParityRowResult[], k: number): string {
  const lines = rows.flatMap((row) => {
    const seen = Object.entries(row.outcomes ?? {}).map(([code, count]) => `${code}=${count}`).join(", ");
    return [`${row.name}: ${row.passes}/${k} passed, pass^${k} ${row.passes === k ? "yes" : "no"}`, `  outcomes: ${seen === "" ? "none" : seen}`];
  });
  const allRows = rows.length > 0 && rows.every((row) => row.passes === k);
  lines.push(`pass^${k} over all rows: ${allRows ? "yes" : "no"}`);
  return lines.join("\n");
}
