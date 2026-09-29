import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  JsonOperatorRepository,
  JsonUnitRepository,
  loadPaystackConfiguration,
  type OperatorRecord,
  type PaystackConfiguration,
  type PaystackEnvironmentSource,
  normalizeContactEmail,
  type ManualTransferAccount,
  type Unit,
} from "../../../domains/shortlet/src/index.js";
import { loadConciergeConfiguration, type ConciergeConfiguration, type ConciergeEnvironmentSource } from "../../local-guest/src/assistant/concierge-configuration.js";

export interface PilotEnvironmentSource extends PaystackEnvironmentSource, ConciergeEnvironmentSource {
  readonly SHORTLET_PUBLIC_ORIGIN?: string;
  readonly SHORTLET_DB_PATH?: string;
  readonly SHORTLET_INVENTORY_PATH?: string;
  readonly SHORTLET_OPERATORS_PATH?: string;
  readonly SHORTLET_TENANT_ID?: string;
  /** "enabled" switches on Paystack Pay with Transfer; only after the ADR 0047 certification passes (ADR 0088). */
  readonly SHORTLET_PAYSTACK_TRANSFERS?: string;
  /** ADR 0090: the one business account for manual bank transfer. All three or none. */
  readonly SHORTLET_MANUAL_TRANSFER_BANK_NAME?: string;
  readonly SHORTLET_MANUAL_TRANSFER_ACCOUNT_NAME?: string;
  readonly SHORTLET_MANUAL_TRANSFER_ACCOUNT_NUMBER?: string;
  /** ADR 0090 "a configured size limit" for receipts, in bytes. */
  readonly SHORTLET_RECEIPT_MAX_BYTES?: string;
  /** "production" (the default) or "staging": the closed beta on Paystack test keys (launch-readiness issue 22). */
  readonly SHORTLET_DEPLOYMENT?: string;
  /** Staging only: the code invited testers need before a Guest session starts. */
  readonly SHORTLET_BETA_INVITE_CODE?: string;
  /** Issue 19 guardrails; each is a positive whole number and has a documented default. */
  readonly SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR?: string;
  readonly SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR?: string;
  readonly SHORTLET_GUEST_RUNTIME_IDLE_MINUTES?: string;
  readonly CONCIERGE_DAILY_MODEL_CALL_CAP?: string;
  /** Issue 23: Resend email notifications. The key, sender and Operator alert list are all set, or none. */
  readonly RESEND_API_KEY?: string;
  readonly SHORTLET_NOTIFICATION_FROM?: string;
  /** Comma-separated addresses of the people covering the response window (ADR 0042). */
  readonly SHORTLET_OPERATOR_ALERT_EMAILS?: string;
  readonly SHORTLET_NOTIFICATION_SWEEP_SECONDS?: string;
}

export interface PilotNotificationConfiguration {
  readonly resendApiKey: string;
  readonly from: string;
  readonly operatorAlertEmails: readonly string[];
  readonly sweepSeconds: number;
}

/** Default pause between notification sweeps; well inside the 10-minute first reminder (ADR 0041). */
export const DEFAULT_NOTIFICATION_SWEEP_SECONDS = 30;

/** Issue 23: all three settings or none, so notifications are never half-configured. None means disabled. */
export function notificationConfiguration(source: PilotEnvironmentSource): PilotNotificationConfiguration | null {
  const resendApiKey = source.RESEND_API_KEY?.trim() ?? "";
  const from = source.SHORTLET_NOTIFICATION_FROM?.trim() ?? "";
  const alertList = source.SHORTLET_OPERATOR_ALERT_EMAILS?.trim() ?? "";
  if (!resendApiKey && !from && !alertList) return null;
  if (!resendApiKey || !from || !alertList) throw new Error("RESEND_API_KEY, SHORTLET_NOTIFICATION_FROM and SHORTLET_OPERATOR_ALERT_EMAILS must all be set, or none");
  // "Name <address>" or a bare address; the address must be valid either way.
  const fromAddress = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  try { normalizeContactEmail(fromAddress); } catch { throw new Error("SHORTLET_NOTIFICATION_FROM must be an email address or Name <address>"); }
  const operatorAlertEmails = alertList.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "").map((entry) => {
    try { return normalizeContactEmail(entry); } catch { throw new Error("SHORTLET_OPERATOR_ALERT_EMAILS must be a comma-separated list of email addresses"); }
  });
  if (operatorAlertEmails.length === 0) throw new Error("SHORTLET_OPERATOR_ALERT_EMAILS must name at least one address");
  return Object.freeze({
    resendApiKey,
    from,
    operatorAlertEmails: Object.freeze(operatorAlertEmails),
    sweepSeconds: positiveWholeNumber(source.SHORTLET_NOTIFICATION_SWEEP_SECONDS, "SHORTLET_NOTIFICATION_SWEEP_SECONDS", DEFAULT_NOTIFICATION_SWEEP_SECONDS),
  });
}

/**
 * Issue 19 defaults. They are operational guardrails, not domain policy: generous for one person chatting, and
 * above what a shared mobile-carrier address serves during the closed beta. Override per deployment.
 */
export const PILOT_LIMIT_DEFAULTS = Object.freeze({
  chatTurnsPerSessionPerHour: 60,
  chatTurnsPerAddressPerHour: 600,
  newSessionsPerAddressPerHour: 120,
  operatorLoginsPerAddressPerHour: 10,
  sessionRuntimeIdleMinutes: 30,
  dailyModelCallCap: 3000,
});

export type PilotLimits = { readonly [Key in keyof typeof PILOT_LIMIT_DEFAULTS]: number };

function positiveWholeNumber(value: string | undefined, key: string, fallback: number): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return fallback;
  if (!/^\d+$/.test(setting) || Number(setting) < 1 || !Number.isSafeInteger(Number(setting))) throw new Error(`${key} must be a positive whole number`);
  return Number(setting);
}

export function pilotLimits(source: PilotEnvironmentSource): PilotLimits {
  return Object.freeze({
    chatTurnsPerSessionPerHour: positiveWholeNumber(source.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR, "SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR", PILOT_LIMIT_DEFAULTS.chatTurnsPerSessionPerHour),
    chatTurnsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR, "SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.chatTurnsPerAddressPerHour),
    newSessionsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR, "SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.newSessionsPerAddressPerHour),
    operatorLoginsPerAddressPerHour: positiveWholeNumber(source.SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR, "SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR", PILOT_LIMIT_DEFAULTS.operatorLoginsPerAddressPerHour),
    sessionRuntimeIdleMinutes: positiveWholeNumber(source.SHORTLET_GUEST_RUNTIME_IDLE_MINUTES, "SHORTLET_GUEST_RUNTIME_IDLE_MINUTES", PILOT_LIMIT_DEFAULTS.sessionRuntimeIdleMinutes),
    dailyModelCallCap: positiveWholeNumber(source.CONCIERGE_DAILY_MODEL_CALL_CAP, "CONCIERGE_DAILY_MODEL_CALL_CAP", PILOT_LIMIT_DEFAULTS.dailyModelCallCap),
  });
}

export type PilotDeployment = "production" | "staging";

export interface PilotConfiguration {
  /** Staging takes only Paystack test keys and shows the beta banner; production takes only live keys. */
  readonly deployment: PilotDeployment;
  /** Staging: required before a Guest session starts. Production: always null. */
  readonly betaInviteCode: string | null;
  readonly publicOrigin: string;
  readonly databasePath: string;
  readonly inventoryPath: string;
  readonly operatorsPath: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly paystack: PaystackConfiguration;
  /** Off unless explicitly enabled after certification (ADR 0088 activation). */
  readonly paystackTransfersEnabled: boolean;
  /** Null: manual transfer is not offered. */
  readonly manualTransferAccount: ManualTransferAccount | null;
  readonly receiptMaxBytes: number | null;
  /** Validated at startup so a mistyped CONCIERGE_MODE can never silently switch the AI concierge off. */
  readonly concierge: ConciergeConfiguration;
  /** Issue 19: rate limits, the daily model-call cap and the idle session-runtime lifetime. */
  readonly limits: PilotLimits;
  /** Issue 23: null means email notifications are disabled (the startup banner says so). */
  readonly notifications: PilotNotificationConfiguration | null;
}

function required(source: PilotEnvironmentSource, key: keyof PilotEnvironmentSource): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required for pilot production startup`);
  return value.trim();
}

function requiredPersistentFile(path: string, key: string): void {
  if (!isAbsolute(path)) throw new Error(`${key} must be an absolute persistent file path`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${key} must point to an existing persistent file`);
}

function publicOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("SHORTLET_PUBLIC_ORIGIN must be an absolute URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("SHORTLET_PUBLIC_ORIGIN must be an origin with the HTTPS scheme and no path");
  }
  return parsed.origin;
}

function operatorForUnit(unit: Unit, operators: readonly OperatorRecord[]): OperatorRecord {
  const operator = operators.find((candidate) => candidate.id === unit.operator.id);
  if (!operator) throw new Error(`Inventory Operator ${unit.operator.id} is missing from SHORTLET_OPERATORS_PATH`);
  return operator;
}

/**
 * ADR 0088 activation switch for Paystack Pay with Transfer. Unset or "disabled" is off; "enabled" is on. Anything
 * else fails closed, so a typo can never switch transfers on.
 */
export function paystackTransfersEnabled(value: string | undefined): boolean {
  const setting = value?.trim() ?? "";
  if (setting !== "" && setting !== "enabled" && setting !== "disabled") throw new Error("SHORTLET_PAYSTACK_TRANSFERS must be enabled or disabled");
  return setting === "enabled";
}

/** ADR 0090: the business account is configuration. A partial account fails startup rather than half-offering the method. */
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

/** Unset means production. Anything other than production or staging fails closed. */
export function pilotDeployment(value: string | undefined): PilotDeployment {
  const setting = value?.trim() ?? "";
  if (setting === "" || setting === "production") return "production";
  if (setting === "staging") return "staging";
  throw new Error("SHORTLET_DEPLOYMENT must be production or staging");
}

/** The beta gate exists only in staging: it is required there and refused in production. */
export function betaInviteCode(deployment: PilotDeployment, value: string | undefined): string | null {
  const code = value?.trim() ?? "";
  if (deployment === "production") {
    if (code !== "") throw new Error("SHORTLET_BETA_INVITE_CODE is only used when SHORTLET_DEPLOYMENT=staging");
    return null;
  }
  if (code === "" || /\s/.test(code)) throw new Error("SHORTLET_BETA_INVITE_CODE is required for staging and must not contain spaces");
  return code;
}

export function loadPilotConfiguration(source: PilotEnvironmentSource = process.env): PilotConfiguration {
  const deployment = pilotDeployment(source.SHORTLET_DEPLOYMENT);
  const inviteCode = betaInviteCode(deployment, source.SHORTLET_BETA_INVITE_CODE);
  const origin = publicOrigin(required(source, "SHORTLET_PUBLIC_ORIGIN"));
  const databasePath = required(source, "SHORTLET_DB_PATH");
  const inventoryPath = required(source, "SHORTLET_INVENTORY_PATH");
  const operatorsPath = required(source, "SHORTLET_OPERATORS_PATH");
  if (!isAbsolute(databasePath)) throw new Error("SHORTLET_DB_PATH must be an absolute persistent file path");
  requiredPersistentFile(inventoryPath, "SHORTLET_INVENTORY_PATH");
  requiredPersistentFile(operatorsPath, "SHORTLET_OPERATORS_PATH");

  const operators = new JsonOperatorRepository(operatorsPath).findAll();
  if (operators.length === 0) throw new Error("SHORTLET_OPERATORS_PATH must contain at least one Operator");
  const units = new JsonUnitRepository(inventoryPath).findAll() as Unit[];
  if (units.length === 0) throw new Error("SHORTLET_INVENTORY_PATH must contain at least one Unit");
  const firstUnit = units[0]!;
  const operator = operatorForUnit(firstUnit, operators);
  for (const unit of units) operatorForUnit(unit, operators);
  const tenantId = source.SHORTLET_TENANT_ID?.trim() || operator.tenantId;
  if (tenantId !== operator.tenantId) throw new Error("SHORTLET_TENANT_ID does not match the configured Operator data");

  const paystackSource: PilotEnvironmentSource = {
    ...source,
    PAYSTACK_CALLBACK_BASE_URL: source.PAYSTACK_CALLBACK_BASE_URL?.trim() || origin,
  };
  // Production keeps the live-only rule (ADR 0087). Staging is the closed beta and takes test keys only, so no real
  // money can move behind a banner that says payments are tests.
  const paystack = loadPaystackConfiguration(paystackSource, { runtime: deployment === "staging" ? "test" : "production" });
  if (!paystack) throw new Error("Live Paystack configuration is required for pilot production startup");
  if (deployment === "staging" && paystack.environment !== "test") throw new Error("Staging requires PAYSTACK_ENVIRONMENT=test");
  if (paystack.callbackBaseUrl !== origin) throw new Error("Paystack callback origin must match SHORTLET_PUBLIC_ORIGIN");

  const concierge = loadConciergeConfiguration(source);

  return Object.freeze({
    deployment,
    betaInviteCode: inviteCode,
    concierge,
    limits: pilotLimits(source),
    notifications: notificationConfiguration(source),
    paystackTransfersEnabled: paystackTransfersEnabled(source.SHORTLET_PAYSTACK_TRANSFERS),
    manualTransferAccount: manualTransferAccount(source),
    receiptMaxBytes: receiptMaxBytes(source.SHORTLET_RECEIPT_MAX_BYTES),
    publicOrigin: origin,
    databasePath,
    inventoryPath,
    operatorsPath,
    tenantId,
    operatorId: operator.id,
    operatorName: operator.name,
    unitId: firstUnit.id,
    propertyId: firstUnit.propertyId,
    paystack,
  });
}
