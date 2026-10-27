import { loadPaystackConfiguration, type PaystackConfiguration, type PaystackEnvironmentSource } from "../../../packages/platform-core/src/payments/index.js";
import { normalizeContactEmail } from "../../../domains/shortlet/src/index.js";
import type { ManualTransferAccount } from "../../../domains/shortlet/src/index.js";
import { loadConciergeConfiguration, type ConciergeConfiguration, type ConciergeEnvironmentSource } from "../../local-guest/src/assistant/concierge-configuration.js";
import { DEFAULT_MODEL_REQUEST_QUOTA_LIMITS } from "../../../packages/platform-core/src/model-request-quota.js";
import { modelRequestQuotaLimitsFromEnvironment } from "../../../packages/platform-core/src/model-request-quota-config.js";

export interface PilotEnvironmentSource extends PaystackEnvironmentSource, ConciergeEnvironmentSource {
  readonly SHORTLET_PUBLIC_ORIGIN?: string;
  readonly SHORTLET_DB_PATH?: string;
  readonly SHORTLET_INVENTORY_PATH?: string;
  readonly SHORTLET_OPERATORS_PATH?: string;
  readonly SHORTLET_TENANT_ID?: string;
  /** ADR 0088: enabled only after transfer capability certification. */
  readonly SHORTLET_PAYSTACK_TRANSFERS?: string;
  readonly SHORTLET_MANUAL_TRANSFER_BANK_NAME?: string;
  readonly SHORTLET_MANUAL_TRANSFER_ACCOUNT_NAME?: string;
  readonly SHORTLET_MANUAL_TRANSFER_ACCOUNT_NUMBER?: string;
  readonly SHORTLET_RECEIPT_MAX_BYTES?: string;
  readonly SHORTLET_DEPLOYMENT?: string;
  readonly SHORTLET_BETA_INVITE_CODE?: string;
  /** ADR 0105: the staging-only public demo switch. Refused in production; any other value fails closed. */
  readonly SHORTLET_DEMO?: string;
  /** ADR 0105: seconds between a submitted request's disclosure and its demo acceptance. Unset means zero. */
  readonly SHORTLET_DEMO_ACCEPT_DELAY_SECONDS?: string;
  readonly SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR?: string;
  readonly SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_GUEST_RUNTIME_IDLE_MINUTES?: string;
  readonly CONCIERGE_DAILY_MODEL_CALL_CAP?: string;
  readonly RESEND_API_KEY?: string;
  readonly SHORTLET_NOTIFICATION_FROM?: string;
  readonly SHORTLET_OPERATOR_ALERT_EMAILS?: string;
  readonly SHORTLET_NOTIFICATION_SWEEP_SECONDS?: string;
}

export interface PilotNotificationConfiguration {
  readonly resendApiKey: string;
  readonly from: string;
  readonly operatorAlertEmails: readonly string[];
  readonly sweepSeconds: number;
}

/** Existing notification cadence; well inside the first reminder (ADR 0041). */
export const DEFAULT_NOTIFICATION_SWEEP_SECONDS = 30;

/**
 * An operator alert recipient as configured: validated by the guest email rules, but only the domain is lowercased, so the
 * local part keeps its case as before the 10-11 Oct 2026 guest email decisions (those cover guest emails only).
 */
function operatorAlertAddress(entry: string): string {
  const normalised = normalizeContactEmail(entry);
  return `${entry.slice(0, entry.lastIndexOf("@"))}@${normalised.slice(normalised.lastIndexOf("@") + 1)}`;
}

export function notificationConfiguration(source: PilotEnvironmentSource): PilotNotificationConfiguration | null {
  const resendApiKey = source.RESEND_API_KEY?.trim() ?? "";
  const from = source.SHORTLET_NOTIFICATION_FROM?.trim() ?? "";
  const alertList = source.SHORTLET_OPERATOR_ALERT_EMAILS?.trim() ?? "";
  if (!resendApiKey && !from && !alertList) return null;
  if (!resendApiKey || !from || !alertList) throw new Error("RESEND_API_KEY, SHORTLET_NOTIFICATION_FROM and SHORTLET_OPERATOR_ALERT_EMAILS must all be set, or none");
  const fromAddress = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  try { normalizeContactEmail(fromAddress); } catch { throw new Error("SHORTLET_NOTIFICATION_FROM must be an email address or Name <address>"); }
  const operatorAlertEmails = alertList.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "").map((entry) => {
    try { return operatorAlertAddress(entry); } catch { throw new Error("SHORTLET_OPERATOR_ALERT_EMAILS must be a comma-separated list of email addresses"); }
  });
  if (operatorAlertEmails.length === 0) throw new Error("SHORTLET_OPERATOR_ALERT_EMAILS must name at least one address");
  return Object.freeze({ resendApiKey, from, operatorAlertEmails: Object.freeze(operatorAlertEmails), sweepSeconds: positiveWholeNumber(source.SHORTLET_NOTIFICATION_SWEEP_SECONDS, "SHORTLET_NOTIFICATION_SWEEP_SECONDS", DEFAULT_NOTIFICATION_SWEEP_SECONDS) });
}

/** Existing issue-19 operational guardrails; override per deployment. */
export const PILOT_LIMIT_DEFAULTS = Object.freeze({
  chatTurnsPerSessionPerHour: DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.guestHourly,
  chatTurnsPerAddressPerHour: 600,
  newSessionsPerAddressPerHour: 120,
  operatorLoginsPerAddressPerHour: 10,
  sessionRuntimeIdleMinutes: 30,
  dailyModelCallCap: DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.tenantDaily,
});
export type PilotLimits = { readonly [Key in keyof typeof PILOT_LIMIT_DEFAULTS]: number };

function positiveWholeNumber(value: string | undefined, key: string, fallback: number): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return fallback;
  if (!/^\d+$/.test(setting) || Number(setting) < 1 || !Number.isSafeInteger(Number(setting))) throw new Error(`${key} must be a positive whole number`);
  return Number(setting);
}

export function pilotLimits(source: PilotEnvironmentSource): PilotLimits {
  const requestQuota = modelRequestQuotaLimitsFromEnvironment(source);
  return Object.freeze({
    chatTurnsPerSessionPerHour: requestQuota.hourlyGuestLimit,
    chatTurnsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR, "SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.chatTurnsPerAddressPerHour),
    newSessionsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR, "SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.newSessionsPerAddressPerHour),
    operatorLoginsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR, "SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.operatorLoginsPerAddressPerHour),
    sessionRuntimeIdleMinutes: positiveWholeNumber(source.SHORTLET_GUEST_RUNTIME_IDLE_MINUTES, "SHORTLET_GUEST_RUNTIME_IDLE_MINUTES", PILOT_LIMIT_DEFAULTS.sessionRuntimeIdleMinutes),
    dailyModelCallCap: requestQuota.dailyTenantLimit,
  });
}

export type PilotDeployment = "production" | "staging";
export interface PilotCoreConfiguration {
  readonly deployment: PilotDeployment;
  /** ADR 0105: true only on staging with SHORTLET_DEMO=enabled. The invite gate is off while it is on. */
  readonly demo: boolean;
  /** ADR 0105: zero unless the demo is on and the operator set a delay. */
  readonly demoAcceptDelaySeconds: number;
  readonly betaInviteCode: string | null;
  readonly publicOrigin: string;
  readonly paystack: PaystackConfiguration;
  readonly paystackTransfersEnabled: boolean;
  readonly manualTransferAccount: ManualTransferAccount | null;
  readonly receiptMaxBytes: number | null;
  readonly concierge: ConciergeConfiguration;
  readonly limits: PilotLimits;
  readonly notifications: PilotNotificationConfiguration | null;
}

export function required(source: PilotEnvironmentSource, key: keyof PilotEnvironmentSource): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required for pilot production startup`);
  return value.trim();
}

export function publicOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("SHORTLET_PUBLIC_ORIGIN must be an absolute URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("SHORTLET_PUBLIC_ORIGIN must be an origin with the HTTPS scheme and no path");
  }
  return parsed.origin;
}

/** ADR 0088: typoed activation switches fail closed. */
export function paystackTransfersEnabled(value: string | undefined): boolean {
  const setting = value?.trim() ?? "";
  if (setting !== "" && setting !== "enabled" && setting !== "disabled") throw new Error("SHORTLET_PAYSTACK_TRANSFERS must be enabled or disabled");
  return setting === "enabled";
}

/** ADR 0090: whole configured business account or none. */
export function manualTransferAccount(source: PilotEnvironmentSource): ManualTransferAccount | null {
  const bankName = source.SHORTLET_MANUAL_TRANSFER_BANK_NAME?.trim() ?? "";
  const accountName = source.SHORTLET_MANUAL_TRANSFER_ACCOUNT_NAME?.trim() ?? "";
  const accountNumber = source.SHORTLET_MANUAL_TRANSFER_ACCOUNT_NUMBER?.trim() ?? "";
  if (!bankName && !accountName && !accountNumber) return null;
  if (!bankName || !accountName || !/^\d{10}$/.test(accountNumber)) throw new Error("SHORTLET_MANUAL_TRANSFER_BANK_NAME, _ACCOUNT_NAME and a ten-digit _ACCOUNT_NUMBER must all be set, or none");
  return Object.freeze({ bankName, accountName, accountNumber });
}

export function receiptMaxBytes(value: string | undefined): number | null {
  const setting = value?.trim() ?? "";
  if (setting === "") return null;
  if (!/^\d+$/.test(setting) || Number(setting) <= 0 || !Number.isSafeInteger(Number(setting))) throw new Error("SHORTLET_RECEIPT_MAX_BYTES must be a positive whole number of bytes");
  return Number(setting);
}

export function pilotDeployment(value: string | undefined): PilotDeployment {
  const setting = value?.trim() ?? "";
  if (setting === "" || setting === "production") return "production";
  if (setting === "staging") return "staging";
  throw new Error("SHORTLET_DEPLOYMENT must be production or staging");
}

/**
 * ADR 0105: the demo is a staging-only exception. Production refuses it at startup; any value other than enabled or
 * disabled fails closed. Unset means off.
 */
export function demoMode(deployment: PilotDeployment, value: string | undefined): boolean {
  const setting = value?.trim() ?? "";
  if (setting !== "" && setting !== "enabled" && setting !== "disabled") throw new Error("SHORTLET_DEMO must be enabled or disabled");
  if (setting === "enabled" && deployment === "production") throw new Error("SHORTLET_DEMO is refused in production (ADR 0105)");
  return setting === "enabled";
}

/** ADR 0105: the demo acceptance delay when none is configured. Zero accepts a submitted request at once. */
export const DEFAULT_DEMO_ACCEPT_DELAY_SECONDS = 0;

/** A whole number of seconds, or the default. Anything else fails closed at startup. */
export function demoAcceptDelaySeconds(value: string | undefined): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return DEFAULT_DEMO_ACCEPT_DELAY_SECONDS;
  if (!/^\d+$/.test(setting) || !Number.isSafeInteger(Number(setting))) throw new Error("SHORTLET_DEMO_ACCEPT_DELAY_SECONDS must be a whole number of seconds");
  return Number(setting);
}

export function betaInviteCode(deployment: PilotDeployment, value: string | undefined, demo = false): string | null {
  const code = value?.trim() ?? "";
  // ADR 0105: with the demo on, the staging invite gate is off, so a visitor needs only the staging URL.
  if (demo) return null;
  if (deployment === "production") {
    if (code !== "") throw new Error("SHORTLET_BETA_INVITE_CODE is only used when SHORTLET_DEPLOYMENT=staging");
    return null;
  }
  if (code === "" || /\s/.test(code)) throw new Error("SHORTLET_BETA_INVITE_CODE is required for staging and must not contain spaces");
  return code;
}

/** Explicit source only: no environment lookup or file access. */
export function loadPilotCoreConfiguration(source: PilotEnvironmentSource): PilotCoreConfiguration {
  const deployment = pilotDeployment(source.SHORTLET_DEPLOYMENT);
  const demo = demoMode(deployment, source.SHORTLET_DEMO);
  const inviteCode = betaInviteCode(deployment, source.SHORTLET_BETA_INVITE_CODE, demo);
  const acceptDelaySeconds = demoAcceptDelaySeconds(source.SHORTLET_DEMO_ACCEPT_DELAY_SECONDS);
  if (!demo && acceptDelaySeconds !== DEFAULT_DEMO_ACCEPT_DELAY_SECONDS) throw new Error("SHORTLET_DEMO_ACCEPT_DELAY_SECONDS requires SHORTLET_DEMO=enabled");
  const origin = publicOrigin(required(source, "SHORTLET_PUBLIC_ORIGIN"));
  const paystackSource: PilotEnvironmentSource = { ...source, PAYSTACK_CALLBACK_BASE_URL: source.PAYSTACK_CALLBACK_BASE_URL?.trim() || origin };
  // ADR 0087: retain live-only production and origin binding, with test-only staging.
  const paystack = loadPaystackConfiguration(paystackSource, { runtime: deployment === "staging" ? "test" : "production" });
  if (!paystack) throw new Error("Live Paystack configuration is required for pilot production startup");
  if (deployment === "staging" && paystack.environment !== "test") throw new Error("Staging requires PAYSTACK_ENVIRONMENT=test");
  if (paystack.callbackBaseUrl !== origin) throw new Error("Paystack callback origin must match SHORTLET_PUBLIC_ORIGIN");
  const concierge = loadConciergeConfiguration(source);
  // ADR 0105: OpenRouter processing is a staging demo exception, never a production processor approval.
  if (deployment === "production" && [concierge.primary, concierge.fallback].some((settings) => settings?.provider === "openai-compatible"
    && (settings.label === "openrouter" || new URL(settings.baseUrl).hostname === "openrouter.ai"))) {
    throw new Error("OpenRouter is permitted only for the staging demo (ADR 0105)");
  }
  return Object.freeze({
    deployment, demo, demoAcceptDelaySeconds: acceptDelaySeconds, betaInviteCode: inviteCode, concierge,
    limits: pilotLimits(source), notifications: notificationConfiguration(source),
    paystackTransfersEnabled: paystackTransfersEnabled(source.SHORTLET_PAYSTACK_TRANSFERS),
    manualTransferAccount: manualTransferAccount(source), receiptMaxBytes: receiptMaxBytes(source.SHORTLET_RECEIPT_MAX_BYTES),
    publicOrigin: origin, paystack,
  });
}
