import { startLocalPilotServer } from "./local-pilot-server.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
const server = startLocalPilotServer({ port });
await server.listen();
console.log("Local Shortlet pilot started");
console.log(`\nGuest:\nhttp://127.0.0.1:${port}/`);
console.log(`\nOperator:\nhttp://127.0.0.1:${port}/operator/`);
console.log(`\nHealth:\nhttp://127.0.0.1:${port}/healthz`);
console.log(`\nData:\n${server.paths.directory}`);
const shutdown = async (): Promise<void> => { await server.close(); process.exit(0); };
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
