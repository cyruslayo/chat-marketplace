import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";
import { nodeSqlitePathOpenCount } from "../packages/platform-core/src/node-sqlite-database.js";
import { restartFixture } from "./helpers/guest-restart.js";

type ServerOptions = Parameters<typeof startLocalGuestServer>[0];

async function withServer(options: Omit<NonNullable<ServerOptions>, "port" | "environment">, run: (base: string, server: LocalGuestServerHandle) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "guest-runtime-limit-"));
  const server = startLocalGuestServer({ ...options, port: 0, sessionScopedGuestPrincipals: true, environment: LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") }) });
  try {
    await run(`http://127.0.0.1:${await server.listen()}`, server);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function newSession(base: string): Promise<string> {
  const response = await fetch(`${base}/`);
  await response.text();
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function touch(base: string, cookie: string): Promise<Response> {
  const response = await fetch(`${base}/guest/contact`, { headers: { cookie } });
  await response.text();
  return response;
}

test("04c AC1: Every session runtime uses the same database handle", async () => {
  await withServer({}, async (base, server) => {
    const opened = nodeSqlitePathOpenCount();
    await newSession(base);
    await newSession(base);
    await newSession(base);
    assert.equal(server.activeSessionRuntimes, 3);
    assert.equal(nodeSqlitePathOpenCount(), opened, "three sessions opened no new handle");
  });
});

test("04c AC2: With sessionRuntimeLimit N, opening session N+1 evicts the least recently used runtime", async () => {
  await withServer({ sessionRuntimeLimit: 2 }, async (base, server) => {
    const first = await newSession(base);
    const second = await newSession(base);
    assert.equal(server.activeSessionRuntimes, 2);
    assert.equal(server.sessionRuntimesBuilt, 2);

    await touch(base, first); // the first session is now the most recently used
    await newSession(base); // evicts the second
    assert.equal(server.activeSessionRuntimes, 2, "the Map never holds more than N");
    assert.equal(server.sessionRuntimesBuilt, 3);

    await touch(base, first);
    assert.equal(server.sessionRuntimesBuilt, 3, "the recently used session was kept");
    await touch(base, second);
    assert.equal(server.sessionRuntimesBuilt, 4, "the least recently used session was evicted and rebuilt");
    assert.equal(server.activeSessionRuntimes, 2);
  });
});

test("04c AC2: a limit that is not a positive whole number is refused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "guest-runtime-limit-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  try {
    for (const sessionRuntimeLimit of [0, -1, 1.5, Number.NaN])
      assert.throws(() => startLocalGuestServer({ port: 0, sessionRuntimeLimit, environment }), /sessionRuntimeLimit/);
  } finally {
    environment.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("04c AC3: An evicted session that comes back sees its conversation and booking state unchanged, rebuilt from SQLite", async () => {
  const fixture = await restartFixture({}, { sessionScopedGuestPrincipals: true, sessionRuntimeLimit: 1 });
  try {
    await fixture.advance("review");
    const before = await fixture.state();
    assert.equal(before.ok, true);
    const built = fixture.server.sessionRuntimesBuilt;

    const other = await fetch(fixture.base);
    await other.text();
    assert.equal(fixture.server.activeSessionRuntimes, 1, "the first session's runtime was evicted");

    // Eviction must behave exactly like the restart the restart-persistence work proves (test/helpers/guest-restart.ts):
    // the thread is rebuilt from SQLite, restoring again changes nothing, and a full restart yields the same view.
    const after = await fixture.state();
    assert.equal(after.ok, true);
    assert.deepEqual(await fixture.state(), after, "restoration must not run another command or change the projection");
    assert.ok(fixture.server.sessionRuntimesBuilt > built + 1, "the returning session was rebuilt");
    await fixture.restart();
    assert.deepEqual(await fixture.state(), after, "an evicted session is restored exactly as after a restart");
    // A session principal starts without the seeded phone, so the Booking Request draft is restored behind the phone prompt
    // (surfaces[0] is the contact surface, as before eviction). The draft survives as the thread's "Draft created" receipt.
    assert.equal(after.timeline.some((entry) => entry.role === "receipt" && entry.text === "Draft created"), true, "the booking draft survived eviction");
  } finally {
    await fixture.close();
  }
});

test("04c AC4: Evicting a runtime does not close the shared handle", async () => {
  await withServer({ sessionRuntimeLimit: 1 }, async (base, server) => {
    const first = await newSession(base);
    const second = await newSession(base);
    assert.equal(server.activeSessionRuntimes, 1);
    assert.deepEqual(server.environment.database.prepare("SELECT 1 AS one").get(), { one: 1 });
    assert.equal((await touch(base, second)).status, 200, "the surviving session keeps working");
    assert.equal((await touch(base, first)).status, 200, "the evicted session is rebuilt on the same handle");
  });
});

test("04c AC5: With the option unset, behaviour matches today's", async () => {
  await withServer({}, async (base, server) => {
    for (let index = 0; index < 6; index++) await newSession(base);
    assert.equal(server.activeSessionRuntimes, 6, "no cap by default");
    assert.equal(server.sessionRuntimesBuilt, 6);
  });
});
