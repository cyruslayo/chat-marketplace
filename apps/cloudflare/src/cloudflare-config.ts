import type { DurableObjectNamespace, R2Bucket, Fetcher } from "@cloudflare/workers-types";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { loadPilotCoreConfiguration, required, type PilotCoreConfiguration, type PilotEnvironmentSource } from "../../pilot/src/pilot-config-core.js";

/** Inherits every shared Paystack, concierge, notification and guardrail var/secret, not Node file paths. */
export interface CloudflareEnv extends Omit<PilotEnvironmentSource, "SHORTLET_DB_PATH" | "SHORTLET_INVENTORY_PATH" | "SHORTLET_OPERATORS_PATH"> {
  readonly SHORTLET: DurableObjectNamespace;
  readonly RECEIPTS: R2Bucket;
  readonly EXPORTS: R2Bucket;
  readonly ASSETS: Fetcher;
}

export interface CloudflareConfiguration extends PilotCoreConfiguration {
  readonly tenantId: string;
}

/** Explicit bindings source: never defaults to process.env. */
export function loadCloudflareConfiguration(env: CloudflareEnv): CloudflareConfiguration {
  return Object.freeze({ ...loadPilotCoreConfiguration(env), tenantId: required(env, "SHORTLET_TENANT_ID") });
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
