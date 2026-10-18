import type { DurableObjectNamespace, R2Bucket, Fetcher } from "@cloudflare/workers-types";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/index.js";
import { loadPilotCoreConfiguration, required, type PilotCoreConfiguration, type PilotEnvironmentSource } from "../../pilot/src/pilot-config-core.js";
import { createAccessJwtVerifier, type AccessJwks, type AccessVerifier } from "./access-jwt.js";

/** Inherits every shared Paystack, concierge, notification and guardrail var/secret, not Node file paths. */
export interface CloudflareEnv extends Omit<PilotEnvironmentSource, "SHORTLET_DB_PATH" | "SHORTLET_INVENTORY_PATH" | "SHORTLET_OPERATORS_PATH"> {
  readonly SHORTLET: DurableObjectNamespace;
  readonly PLATFORM: DurableObjectNamespace;
  readonly COMMERCE: DurableObjectNamespace;
  readonly RECEIPTS: R2Bucket;
  readonly EXPORTS: R2Bucket;
  readonly ASSETS: Fetcher;
  /** 04c/10a: the production cap on resident per-session Guest runtimes; unset keeps the approved default. */
  readonly SHORTLET_GUEST_RUNTIME_LIMIT?: string;
  readonly SHORTLET_GUEST_CODE_HASHING_KEY?: string;
  /** 11a: the `/_ops` shared secret (secret binding; never committed). */
  readonly OPS_SHARED_SECRET?: string;
  /** 11a: the Cloudflare Access team domain, e.g. `shortlet.cloudflareaccess.com`. */
  readonly CF_ACCESS_TEAM_DOMAIN?: string;
  /** 11a: the Cloudflare Access application audience tag. */
  readonly CF_ACCESS_AUD?: string;
  /** 11a: local/test JWKS override so workerd tests do not fetch the public certs. */
  readonly CF_ACCESS_JWKS?: string;
  /** 12a: how many days of JSONL exports to keep (user-approved; ADR 0075 retention is provisional). */
  readonly SHORTLET_EXPORT_RETENTION_DAYS?: string;
  /** 12a: the grace period before an orphaned receipt object is swept (user-approved). */
  readonly SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS?: string;
}

export interface CloudflareConfiguration extends PilotCoreConfiguration {
  readonly tenantId: string;
  /** 04c/10a: hard cap on resident per-session Guest runtimes (the Durable Object has 128 MB of memory). */
  readonly sessionRuntimeLimit: number;
}

/** 10a approved 32 as the initial production value; it is an engineering limit, configurable per deployment. */
const DEFAULT_SESSION_RUNTIME_LIMIT = 32;

/**
 * 04c: a positive whole number of resident session runtimes, or the approved default. A typo fails startup rather
 * than silently removing the cap an agent-setting change would need (AGENTS.md: no invented policy values).
 */
function sessionRuntimeLimit(value: string | undefined): number {
  const setting = value?.trim() ?? "";
  if (setting === "") return DEFAULT_SESSION_RUNTIME_LIMIT;
  if (!/^\d+$/.test(setting) || Number(setting) < 1 || !Number.isSafeInteger(Number(setting))) {
    throw new Error("SHORTLET_GUEST_RUNTIME_LIMIT must be a positive whole number");
  }
  return Number(setting);
}

/** Explicit bindings source: never defaults to process.env. */
export function loadCloudflareConfiguration(env: CloudflareEnv): CloudflareConfiguration {
  return Object.freeze({
    ...loadPilotCoreConfiguration(env),
    tenantId: required(env, "SHORTLET_TENANT_ID"),
    sessionRuntimeLimit: sessionRuntimeLimit(env.SHORTLET_GUEST_RUNTIME_LIMIT),
  });
}

export type CloudflareProvisioningState =
  | { readonly provisioned: false }
  | { readonly provisioned: true; readonly operatorId: string; readonly operatorName: string; readonly unitId: string; readonly propertyId: string };

/**
 * ADR 0004/0095: inventory comes only from the tenant's SQLite authority, never demo data.
 * Re-evaluate after import rather than freezing first boot. Assembly maps false to 503
 * on normal routes/health while authenticated provisioning remains available (user-approved Wave 3 policy).
 */
export function cloudflareProvisioningState(configuration: CloudflareConfiguration, database: SqlDatabase): CloudflareProvisioningState {
  const operators = new SqliteOperatorRepository(database).findAll();
  const units = new SqliteUnitRepository(database).findAll();
  for (const operator of operators) {
    if (operator.tenantId !== configuration.tenantId) throw new Error("SHORTLET_TENANT_ID does not match the configured Operator data");
  }
  if (operators.length === 0 || units.length === 0) return Object.freeze({ provisioned: false });
  for (const unit of units) {
    if (!operators.some(operator => operator.id === unit.operator.id)) throw new Error(`Inventory Operator ${unit.operator.id} is missing from SQLite`);
  }
  const unit = units[0]!;
  const operator = operators.find(operator => operator.id === unit.operator.id)!;
  return Object.freeze({ provisioned: true, operatorId: operator.id, operatorName: operator.name, unitId: unit.id, propertyId: unit.propertyId });
}

export interface OpsConfiguration {
  readonly sharedSecret: string;
  readonly verifier: AccessVerifier;
}

/**
 * 11a: the two `/_ops` authentication layers, both fail-closed. A missing shared secret or missing Access
 * configuration produces a configuration that refuses everything rather than one that admits anything.
 */
export function loadOpsConfiguration(env: CloudflareEnv): OpsConfiguration {
  const sharedSecret = env.OPS_SHARED_SECRET?.trim() ?? "";
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audience = env.CF_ACCESS_AUD?.trim() ?? "";
  let jwks: AccessJwks | undefined;
  const rawJwks = env.CF_ACCESS_JWKS?.trim() ?? "";
  if (rawJwks !== "") {
    try {
      jwks = JSON.parse(rawJwks) as AccessJwks;
    } catch {
      jwks = undefined;
    }
  }
  const verifier: AccessVerifier =
    teamDomain !== "" && audience !== ""
      ? createAccessJwtVerifier({ teamDomain, audience, ...(jwks === undefined ? {} : { jwks }) })
      : { verify: async () => false };
  return Object.freeze({ sharedSecret, verifier });
}

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

/** Explicit source only: a typo fails startup rather than silently changing the retention. */
export function loadExportConfiguration(env: CloudflareEnv): ExportConfiguration {
  return Object.freeze({
    retentionDays: positiveWholeNumber(env.SHORTLET_EXPORT_RETENTION_DAYS, "SHORTLET_EXPORT_RETENTION_DAYS", DEFAULT_EXPORT_RETENTION_DAYS),
    orphanGraceHours: positiveWholeNumber(env.SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS, "SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS", DEFAULT_RECEIPT_ORPHAN_GRACE_HOURS),
  });
}
