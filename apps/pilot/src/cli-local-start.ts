import { startLocalPilotServer } from "./local-pilot-server.js";
import { localPilotStartupLines } from "./startup-banner.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
const server = startLocalPilotServer({ port });
await server.listen();
for (const line of localPilotStartupLines({ port, dataDirectory: server.paths.directory })) console.log(line);
const shutdown = async (): Promise<void> => { await server.close(); process.exit(0); };
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
