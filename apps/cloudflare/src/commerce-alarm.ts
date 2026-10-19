/**
 * The commerce object's daily alarm decision (final review F5). A failed object (its start-up migration or shape check
 * failed) must not export: it logs the fixed code and does nothing else. A healthy object exports once per day.
 */
export interface CommerceAlarmInput {
  /** The object's fixed failure code, or null when it started cleanly. */
  readonly failure: string | null;
  /** The day of the last export (YYYY-MM-DD), or null when none has run. */
  readonly lastExportDate: string | null;
  /** Today's export day (YYYY-MM-DD). */
  readonly today: string;
}

export type CommerceAlarmPlan = { readonly runExport: true } | { readonly runExport: false; readonly logCode: string | null };

export function commerceAlarmPlan(input: CommerceAlarmInput): CommerceAlarmPlan {
  if (input.failure !== null) return { runExport: false, logCode: input.failure };
  if (input.lastExportDate === input.today) return { runExport: false, logCode: null };
  return { runExport: true };
}
