import { startLocalGuestServer } from "./guest-server.js";
import { LOCAL_COMMERCE_MODULE } from "./commerce-module-local.js";

// The local dev demo is the composition root that injects commerce (ADR 0104 decision 4). The switch still decides whether it is on.
const server = startLocalGuestServer({ commerceModule: LOCAL_COMMERCE_MODULE });
const port = await server.listen();
console.log(`Shortlet guest concierge (local demo): http://localhost:${port}`);
console.log("Local deterministic fixture only. No live LLM, no live payment, no real personal data.");
