// Local staging-demo server for the issue 04 captures (ADR 0105). Synthetic fixture inventory only; the demo flag is on,
// so no invite is needed and every stay carries the "Demo listing" chip.
// Usage: tsx serve-demo.ts <databasePath> [port]
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("usage: tsx serve-demo.ts <databasePath> [port]");
const port = Number(process.argv[3] ?? 3041);
const environment = LocalGuestEnvironment.openNode({ databasePath, demo: true });
const server = startLocalGuestServer({ port, environment });
const bound = await server.listen();
console.log(`demo guest server listening on http://127.0.0.1:${bound}`);
