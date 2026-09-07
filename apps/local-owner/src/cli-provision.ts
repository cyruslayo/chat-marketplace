import { LocalApartmentOwnerEnvironment } from "./local-owner-environment.js";

const [actorId, tenantId] = process.argv.slice(2);
if (!actorId || !tenantId) throw new Error("Usage: npm run operator:provision -- <actorId> <tenantId>");
const env = new LocalApartmentOwnerEnvironment({ representativePersonId: actorId, tenantId });
try {
  const token = env.provisionOperatorAccessToken(actorId, tenantId);
  console.log(JSON.stringify({ actorId, tenantId, token }, null, 2));
} finally { env.close(); }
