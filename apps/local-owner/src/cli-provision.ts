import { LocalApartmentOwnerEnvironment, DEFAULT_LOCAL_OWNER_CONFIG } from "./local-owner-environment.js";
import { JsonOperatorRepository } from "../../../domains/shortlet/src/index.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration, type OpsRemoteConfiguration } from "../../shortlet-ops/src/ops-client.js";

const [actorId, tenantId, requestedOperatorId] = process.argv.slice(2);
if (!actorId || !tenantId) throw new Error("Usage: npm run operator:provision -- <actorId> <tenantId>");

/** The operator for a tenant, listed through the authenticated route. */
async function remoteOperatorId(remote: OpsRemoteConfiguration, tenant: string, requested: string | undefined): Promise<string> {
  if (requested) return requested;
  const body = assertOpsOk(await opsRequest(remote, "/_ops/operators", { method: "GET" }));
  const operator = (body.operators as readonly { readonly id: string; readonly tenantId: string }[]).find((candidate) => candidate.tenantId === tenant);
  if (!operator) throw new Error("An Operator ID is required when no Operator for the tenant is configured");
  return operator.id;
}

const remote = remoteOpsConfiguration();
if (remote !== null) {
  const operatorId = await remoteOperatorId(remote, tenantId, requestedOperatorId);
  const body = assertOpsOk(await opsRequest(remote, `/_ops/operators/${encodeURIComponent(operatorId)}/access`, {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ actorId, tenantId }),
  }));
  // ADR 0086: the token is printed once, to stdout, and never written to a file or a log.
  console.log(JSON.stringify({ actorId, tenantId, token: body.token }, null, 2));
} else {
  const databasePath = process.env.SHORTLET_DB_PATH ?? DEFAULT_LOCAL_OWNER_CONFIG.databasePath;
  const inventoryPath = process.env.SHORTLET_INVENTORY_PATH;
  const operatorsPath = process.env.SHORTLET_OPERATORS_PATH;
  const operatorId = requestedOperatorId ?? (operatorsPath
    ? new JsonOperatorRepository(operatorsPath).findAll().find((operator) => operator.tenantId === tenantId)?.id
    : undefined);
  if (operatorsPath && !operatorId) throw new Error("An Operator ID is required when no Operator for the tenant is configured");
  const env = LocalApartmentOwnerEnvironment.openNode({
    databasePath,
    ...(inventoryPath ? { inventoryPath } : {}),
    ...(operatorsPath ? { operatorsPath } : {}),
    seedFixture: inventoryPath === undefined && operatorsPath === undefined,
    representativePersonId: actorId,
    tenantId,
    ...(operatorId ? { operatorId } : {}),
    ...(operatorsPath ? { clock: () => new Date() } : {}),
  });
  try {
    const token = env.provisionOperatorAccessToken(actorId, tenantId);
    console.log(JSON.stringify({ actorId, tenantId, token }, null, 2));
  } finally { env.close(); }
}
