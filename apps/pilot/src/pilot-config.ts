import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  JsonOperatorRepository,
  JsonUnitRepository,
  loadPaystackConfiguration,
  type OperatorRecord,
  type PaystackConfiguration,
  type PaystackEnvironmentSource,
  type Unit,
} from "../../../domains/shortlet/src/index.js";

export interface PilotEnvironmentSource extends PaystackEnvironmentSource {
  readonly SHORTLET_PUBLIC_ORIGIN?: string;
  readonly SHORTLET_DB_PATH?: string;
  readonly SHORTLET_INVENTORY_PATH?: string;
  readonly SHORTLET_OPERATORS_PATH?: string;
  readonly SHORTLET_TENANT_ID?: string;
}

export interface PilotConfiguration {
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

export function loadPilotConfiguration(source: PilotEnvironmentSource = process.env): PilotConfiguration {
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
  const paystack = loadPaystackConfiguration(paystackSource, { runtime: "production" });
  if (!paystack) throw new Error("Live Paystack configuration is required for pilot production startup");
  if (paystack.callbackBaseUrl !== origin) throw new Error("Paystack callback origin must match SHORTLET_PUBLIC_ORIGIN");

  return Object.freeze({
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
