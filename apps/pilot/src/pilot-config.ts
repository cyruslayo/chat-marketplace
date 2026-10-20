import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  JsonOperatorRepository,
  JsonUnitRepository,
  type OperatorRecord,
  type Unit,
} from "../../../domains/shortlet/src/index.js";
import {
  betaInviteCode,
  pilotDeployment,
  publicOrigin,
  required,
  loadPilotCoreConfiguration,
  type PilotCoreConfiguration,
  type PilotEnvironmentSource,
} from "./pilot-config-core.js";
export * from "./pilot-config-core.js";

export interface PilotConfiguration extends PilotCoreConfiguration {
  /** Stays-only launch: commerce is not an operator-configurable switch (readiness issue 27). */
  readonly commerce: "disabled";
  readonly databasePath: string;
  readonly inventoryPath: string;
  readonly operatorsPath: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly unitId: string;
  readonly propertyId: string;
}

function requiredPersistentFile(path: string, key: string): void {
  if (!isAbsolute(path))
    throw new Error(`${key} must be an absolute persistent file path`);
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`${key} must point to an existing persistent file`);
}

function operatorForUnit(
  unit: Unit,
  operators: readonly OperatorRecord[],
): OperatorRecord {
  const operator = operators.find(
    (candidate) => candidate.id === unit.operator.id,
  );
  if (!operator)
    throw new Error(
      `Inventory Operator ${unit.operator.id} is missing from SHORTLET_OPERATORS_PATH`,
    );
  return operator;
}

/** Node convenience wrapper keeps file checks and the original failure ordering. */
export function loadPilotConfiguration(
  source: PilotEnvironmentSource = process.env,
): PilotConfiguration {
  const deployment = pilotDeployment(source.SHORTLET_DEPLOYMENT);
  betaInviteCode(deployment, source.SHORTLET_BETA_INVITE_CODE);
  publicOrigin(required(source, "SHORTLET_PUBLIC_ORIGIN"));
  const databasePath = required(source, "SHORTLET_DB_PATH");
  const inventoryPath = required(source, "SHORTLET_INVENTORY_PATH");
  const operatorsPath = required(source, "SHORTLET_OPERATORS_PATH");
  if (!isAbsolute(databasePath))
    throw new Error(
      "SHORTLET_DB_PATH must be an absolute persistent file path",
    );
  requiredPersistentFile(inventoryPath, "SHORTLET_INVENTORY_PATH");
  requiredPersistentFile(operatorsPath, "SHORTLET_OPERATORS_PATH");
  const operators = new JsonOperatorRepository(operatorsPath).findAll();
  if (operators.length === 0)
    throw new Error(
      "SHORTLET_OPERATORS_PATH must contain at least one Operator",
    );
  const units = new JsonUnitRepository(inventoryPath).findAll();
  if (units.length === 0)
    throw new Error("SHORTLET_INVENTORY_PATH must contain at least one Unit");
  const firstUnit = units[0]!;
  const operator = operatorForUnit(firstUnit, operators);
  for (const unit of units) operatorForUnit(unit, operators);
  const tenantId = source.SHORTLET_TENANT_ID?.trim() || operator.tenantId;
  if (tenantId !== operator.tenantId)
    throw new Error(
      "SHORTLET_TENANT_ID does not match the configured Operator data",
    );
  return Object.freeze({
    ...loadPilotCoreConfiguration(source),
    commerce: "disabled",
    databasePath,
    inventoryPath,
    operatorsPath,
    tenantId,
    operatorId: operator.id,
    operatorName: operator.name,
    unitId: firstUnit.id,
    propertyId: firstUnit.propertyId,
  });
}
