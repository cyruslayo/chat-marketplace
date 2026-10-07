import { DEFAULT_LOCAL_OWNER_CONFIG, LocalApartmentOwnerEnvironment } from "./local-owner-environment.js";
import { assertOpsOk, opsRequest, remoteOpsConfiguration } from "../../shortlet-ops/src/ops-client.js";

const [mode, value, tenantId] = process.argv.slice(2);
if (mode !== "session" && mode !== "all") throw new Error("Usage: npm run operator:revoke -- session <sessionId> | all <actorId> <tenantId>");

const remote = remoteOpsConfiguration();
if (remote !== null) {
  // The 11a ops routes revoke an actor's operator access; a single session is revoked from the back office.
  if (mode !== "all") throw new Error("Remote revoke supports 'all' <actorId> <tenantId>; revoke a single session from the back office");
  if (!value || !tenantId) throw new Error("Usage: npm run operator:revoke -- all <actorId> <tenantId>");
  const list = assertOpsOk(await opsRequest(remote, "/_ops/operators", { method: "GET" }));
  const operator = (list.operators as readonly { readonly id: string; readonly tenantId: string }[]).find((candidate) => candidate.tenantId === tenantId);
  if (!operator) throw new Error(`No Operator exists for tenant ${tenantId}`);
  assertOpsOk(await opsRequest(remote, `/_ops/operators/${encodeURIComponent(operator.id)}/access`, {
    method: "DELETE",
    contentType: "application/json",
    body: JSON.stringify({ actorId: value, tenantId }),
  }));
} else {
  const databasePath = process.env.SHORTLET_DB_PATH ?? DEFAULT_LOCAL_OWNER_CONFIG.databasePath;
  const inventoryPath = process.env.SHORTLET_INVENTORY_PATH;
  const operatorsPath = process.env.SHORTLET_OPERATORS_PATH;
  const env = LocalApartmentOwnerEnvironment.openNode({
    databasePath,
    ...(inventoryPath ? { inventoryPath } : {}),
    ...(operatorsPath ? { operatorsPath } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(inventoryPath || operatorsPath ? { seedFixture: false } : {}),
  });
  try {
    if (mode === "session") env.sessionAuthority.revokeSession(value ?? "");
    else env.sessionAuthority.revokeAll(value ?? "", tenantId ?? "");
  } finally { env.close(); }
}
