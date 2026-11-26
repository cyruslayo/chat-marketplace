// Local preview of /welcome for 2b-08 (local test data only). Usage: npx tsx .scratch/landing-page/serve-2b-08.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";

const directory = mkdtempSync(join(tmpdir(), "landing-serve-"));
const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
const server = startLocalGuestServer({ port: 3088, environment });
const port = await server.listen();
console.log(`ready http://127.0.0.1:${port}/welcome`);
