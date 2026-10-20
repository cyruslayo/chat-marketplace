/**
 * The export settings of a Durable Object, read from the environment. This module imports nothing, so the commerce object can
 * use it without reaching the Shortlet domain or the pilot configuration (ADR 0099, ADR 0101; final review).
 */

export interface ExportConfiguration {
  readonly retentionDays: number;
  readonly orphanGraceHours: number;
}

/** 12a: the user-approved export retention (400 days) and orphaned-receipt grace (24 h), per deployment. */
const DEFAULT_EXPORT_RETENTION_DAYS = 400;
const DEFAULT_RECEIPT_ORPHAN_GRACE_HOURS = 24;

function positiveWholeNumber(value: string | undefined, key: string, fallback: number): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return fallback;
  if (!/^\d+$/.test(setting) || Number(setting) < 1 || !Number.isSafeInteger(Number(setting))) {
    throw new Error(`${key} must be a positive whole number`);
  }
  return Number(setting);
}

/** The settings this module reads. Any object carrying them satisfies it, so no Worker-wide env type is needed. */
export interface ExportConfigurationEnv {
  readonly SHORTLET_EXPORT_RETENTION_DAYS?: string;
  readonly SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS?: string;
}

/** Explicit source only: a typo fails startup rather than silently changing the retention. */
export function loadExportConfiguration(env: ExportConfigurationEnv): ExportConfiguration {
  return Object.freeze({
    retentionDays: positiveWholeNumber(env.SHORTLET_EXPORT_RETENTION_DAYS, "SHORTLET_EXPORT_RETENTION_DAYS", DEFAULT_EXPORT_RETENTION_DAYS),
    orphanGraceHours: positiveWholeNumber(env.SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS, "SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS", DEFAULT_RECEIPT_ORPHAN_GRACE_HOURS),
  });
}
