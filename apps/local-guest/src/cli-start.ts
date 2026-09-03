import { startLocalGuestServer } from "./guest-server.js";

const server = startLocalGuestServer();
const port = await server.listen();
console.log(`Shortlet guest concierge (local demo): http://localhost:${port}`);
console.log("Local deterministic fixture only. No live LLM, no live payment, no real personal data.");
