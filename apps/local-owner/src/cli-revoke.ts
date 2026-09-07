import { LocalApartmentOwnerEnvironment } from "./local-owner-environment.js";

const [mode, value, tenantId] = process.argv.slice(2);
if (mode !== "session" && mode !== "all") throw new Error("Usage: npm run operator:revoke -- session <sessionId> | all <actorId> <tenantId>");
const env = new LocalApartmentOwnerEnvironment(tenantId ? { tenantId } : {});
try {
  if (mode === "session") env.sessionAuthority.revokeSession(value ?? "");
  else env.sessionAuthority.revokeAll(value ?? "", tenantId ?? "");
} finally { env.close(); }
