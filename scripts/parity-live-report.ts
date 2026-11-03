/**
 * Issue 16 (AC4): the report of the owner-run parity live script. Pure formatting, so the offline suite can test it.
 * It prints row names and counts only. It never prints guest text, filters or replies (ADR 0075).
 */

export interface ParityRowResult {
  /** A row's label (its name in test/helpers/parity-rows.ts), never a guest message. */
  readonly name: string;
  /** How many of the k runs gave the same surface kinds and filters on both paths. */
  readonly passes: number;
}

/** pass^k for one row: true only when every one of the k runs passed. */
export function passAllK(outcomes: readonly boolean[]): boolean {
  return outcomes.length > 0 && outcomes.every(Boolean);
}

/** One line per row (passes out of k, and pass^k), then the total pass^k over every row. */
export function formatParityReport(rows: readonly ParityRowResult[], k: number): string {
  const lines = rows.map((row) => `${row.name}: ${row.passes}/${k} passed, pass^${k} ${row.passes === k ? "yes" : "no"}`);
  const allRows = rows.length > 0 && rows.every((row) => row.passes === k);
  lines.push(`pass^${k} over all rows: ${allRows ? "yes" : "no"}`);
  return lines.join("\n");
}
