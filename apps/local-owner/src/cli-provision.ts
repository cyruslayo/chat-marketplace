import { LocalApartmentOwnerEnvironment, DEFAULT_LOCAL_OWNER_CONFIG } from "./local-owner-environment.js";
import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";

const [actorId, tenantId, requestedOperatorId] = process.argv.slice(2);
if (!actorId || !tenantId) throw new Error("Usage: npm run operator:provision -- <actorId> <tenantId>");
const databasePath = process.env.SHORTLET_DB_PATH ?? DEFAULT_LOCAL_OWNER_CONFIG.databasePath;
const inventoryPath = process.env.SHORTLET_INVENTORY_PATH;
const operatorsPath = process.env.SHORTLET_OPERATORS_PATH;
const operatorId = requestedOperatorId ?? (operatorsPath
  ? new JsonOperatorRepository(operatorsPath).findAll().find((operator) => operator.tenantId === tenantId)?.id
  : undefined);
if (operatorsPath && !operatorId) throw new Error("An Operator ID is required when no Operator for the tenant is configured");
const env = new LocalApartmentOwnerEnvironment({
  databasePath,
  ...(inventoryPath ? { inventoryPath } : {}),
  ...(operatorsPath ? { operatorsPath } : {}),
  seedFixture: inventoryPath === undefined && operatorsPath === undefined,
  representativePersonId: actorId,
  tenantId,
  ...(operatorId ? { operatorId } : {}),
});
try {
  const token = env.provisionOperatorAccessToken(actorId, tenantId);
  console.log(JSON.stringify({ actorId, tenantId, token }, null, 2));
} finally { env.close(); }
