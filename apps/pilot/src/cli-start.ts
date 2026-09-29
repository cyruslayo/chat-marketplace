import { startPilotServer } from "./pilot-server.js";
import { productionPilotStartupLines } from "./startup-banner.js";

const server = startPilotServer({ port: Number.parseInt(process.env.PORT ?? "3000", 10) });
const port = await server.listen();

for (const line of productionPilotStartupLines({ publicOrigin: server.configuration.publicOrigin, paystackEnvironment: server.configuration.paystack.environment, port, concierge: server.configuration.concierge, deployment: server.configuration.deployment, notifications: server.configuration.notifications })) console.log(line);

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
