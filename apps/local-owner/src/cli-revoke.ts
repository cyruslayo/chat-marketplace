import { DEFAULT_LOCAL_OWNER_CONFIG, LocalApartmentOwnerEnvironment } from "./local-owner-environment.js";

const [mode, value, tenantId] = process.argv.slice(2);
if (mode !== "session" && mode !== "all") throw new Error("Usage: npm run operator:revoke -- session <sessionId> | all <actorId> <tenantId>");
const databasePath = process.env.SHORTLET_DB_PATH ?? DEFAULT_LOCAL_OWNER_CONFIG.databasePath;
const inventoryPath = process.env.SHORTLET_INVENTORY_PATH;
const operatorsPath = process.env.SHORTLET_OPERATORS_PATH;
const env = new LocalApartmentOwnerEnvironment({
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
