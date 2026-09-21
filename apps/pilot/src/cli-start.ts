import { startPilotServer } from "./pilot-server.js";

const server = startPilotServer({ port: Number.parseInt(process.env.PORT ?? "3000", 10) });
const port = await server.listen();

console.log(`Shortlet pilot initialized`);
console.log(`environment=production`);
console.log(`publicOrigin=${server.configuration.publicOrigin}`);
console.log(`paystackEnvironment=${server.configuration.paystack.environment}`);
console.log(`status=ready`);
console.log(`health=/healthz`);
console.log(`listeningPort=${port}`);

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
