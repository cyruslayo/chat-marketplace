import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalOwnerFixtureConfig } from "../../apps/local-owner/src/index.js";
import { signInOperator, startOperatorServer, type OperatorServer, type OperatorSession, type SignedInOperator } from "./operator-session.js";

/** A `SignedInOperator` whose server can be closed and reopened over the same database, the owner-side twin of `restartFixture`. */
export interface OperatorRestartFixture extends SignedInOperator {
  readonly databasePath: string;
  /** The cookie issued before the first restart; it must keep working afterwards (ADR 0086). */
  readonly initialCookie: string;
  /** Closes the server and its environment, then reopens both over the same file. No instance state survives. */
  restart(): Promise<void>;
}

export async function operatorRestartFixture(options: { readonly start?: string; readonly config?: Partial<LocalOwnerFixtureConfig> } = {}): Promise<OperatorRestartFixture> {
  const directory = await mkdtemp(join(tmpdir(), "operator-restart-"));
  const databasePath = join(directory, "operator.sqlite");
  let current = new Date(options.start ?? "2026-09-03T10:00:00Z");
  const open = () => startOperatorServer({ ...options.config, databasePath, clock: () => current });
  let server: OperatorServer = await open();
  const initialCookie = await signInOperator(server);
  let session: OperatorSession = { base: server.base, cookie: initialCookie };
  return {
    databasePath,
    initialCookie,
    get server() { return server; },
    get session() { return session; },
    advance(ms) { current = new Date(current.getTime() + ms); },
    now: () => current,
    async restart() {
      await server.close();
      server = await open();
      session = { base: server.base, cookie: session.cookie };
    },
    async close() { await server.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
