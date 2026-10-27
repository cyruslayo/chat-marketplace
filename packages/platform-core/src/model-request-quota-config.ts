import { DEFAULT_MODEL_REQUEST_QUOTA_LIMITS } from "./model-request-quota.js";

export interface ModelRequestQuotaEnvironment {
  readonly CONCIERGE_DAILY_MODEL_CALL_CAP?: string;
  readonly SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR?: string;
}

export interface ModelRequestQuotaLimits {
  readonly dailyTenantLimit: number;
  readonly hourlyGuestLimit: number;
}

/** Reads the existing validated pilot settings; the quota does not add a second operator-facing limit. */
export function modelRequestQuotaLimitsFromEnvironment(source: ModelRequestQuotaEnvironment): ModelRequestQuotaLimits {
  return Object.freeze({
    dailyTenantLimit: positiveLimit(source.CONCIERGE_DAILY_MODEL_CALL_CAP, "CONCIERGE_DAILY_MODEL_CALL_CAP", DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.tenantDaily),
    hourlyGuestLimit: positiveLimit(source.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR, "SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR", DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.guestHourly),
  });
}

function positiveLimit(value: string | undefined, key: string, fallback: number): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return fallback;
  if (!/^\d+$/.test(setting)) throw new Error(`${key} must be a positive whole number from 1 to 1000000`);
  const parsed = Number(setting);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new Error(`${key} must be a positive whole number from 1 to 1000000`);
  return parsed;
}
