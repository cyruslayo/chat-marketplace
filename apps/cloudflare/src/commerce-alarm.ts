/**
 * The commerce object's daily alarm decision (final review F5, and the review of 8febb76). A failed object (its start-up migration,
 * shape check or payment reference key failed) does not export: it logs the fixed code. It still runs its own retention sweep, so its
 * expired personal-data exports do not outlive retention (ADR 0075, ADR 0095, ADR 0101). A healthy object exports once a day, and that
 * export runs the sweep too.
 */
export interface CommerceAlarmInput {
  /** The object's fixed failure code, or null when it started cleanly. */
  readonly failure: string | null;
  /** The day of the last export (YYYY-MM-DD), or null when none has run. */
  readonly lastExportDate: string | null;
  /** Today's export day (YYYY-MM-DD). */
  readonly today: string;
}

export interface CommerceAlarmPlan {
  /** Write today's export objects (the export also runs the retention sweep). */
  readonly runExport: boolean;
  /** Run the owner-scoped retention sweep without exporting. */
  readonly runRetentionSweep: boolean;
  /** A fixed code to log, or null. Never a payload. */
  readonly logCode: string | null;
}

export function commerceAlarmPlan(input: CommerceAlarmInput): CommerceAlarmPlan {
  if (input.failure !== null) return { runExport: false, runRetentionSweep: true, logCode: input.failure };
  if (input.lastExportDate === input.today) return { runExport: false, runRetentionSweep: false, logCode: null };
  return { runExport: true, runRetentionSweep: true, logCode: null };
}
