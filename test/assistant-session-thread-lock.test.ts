import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";
import { THREAD_BUSY_CODE } from "../apps/local-guest/src/assistant/assistant-thread-lock.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { LIVE_LIKE_CLOCK, firstButtonAction } from "./helpers/guest-date-fixtures.js";
import { HELD_TEXT, PROPOSE_TEXT, SEARCH_TEXT, THREAD, lockModel } from "./helpers/assistant-thread-lock-fixtures.js";

// Issue 06 (ADR 0070), session level: production builds one runtime per browser session over one shared store handle, keeps
// at most `sessionRuntimeLimit` resident, and evicts idle ones (guest-server.ts runtimeForSession). A run in flight must hold its
// thread against every other session: the typed turn and the View event of the held session are refused, the held run commits,
// and no later read presents a proposal the guest already executed.

type ServerOptions = Parameters<typeof startLocalGuestServer>[0];
interface Json { readonly status: number; readonly body: Record<string, unknown> }

async function withSessionServer(
  options: Omit<NonNullable<ServerOptions>, "port" | "environment">,
  run: (base: string, server: LocalGuestServerHandle) => Promise<void>,
  clock: () => Date = LIVE_LIKE_CLOCK,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "guest-session-lock-"));
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite"), clock });
  const server = startLocalGuestServer({ ...options, port: 0, sessionScopedGuestPrincipals: true, conciergeMode: "assistant-offline", environment });
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
  assert.ok(cookie, "the page sets a browser session");
  return cookie;
}

async function post(base: string, path: string, cookie: string, body: Record<string, unknown>): Promise<Json> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getState(base: string, cookie: string, threadId: string): Promise<Json> {
  const response = await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function surfacesOf(body: Record<string, unknown>): { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[] {
  return (body.surfaces as { surfaceId: string; a2uiMessages: unknown[] }[] | undefined) ?? [];
}

function codeOfBody(body: Record<string, unknown>): string | undefined {
  return body.ok === false ? String(body.code) : undefined;
}

async function typed(base: string, cookie: string, text: string): Promise<Json> {
  return post(base, "/api/turn", cookie, { threadId: THREAD, text });
}

test("with sessionRuntimeLimit 1, a second session that takes the slot mid-turn leaves the held turn's thread refused, not bypassed", async () => {
  const { model, gate } = lockModel();
  await withSessionServer({ sessionRuntimeLimit: 1, modelClient: model }, async (base, server) => {
    const a = await newSession(base);
    const search = await typed(base, a, SEARCH_TEXT);
    assert.equal(search.body.ok, true, "the search is answered");
    const proposal = await typed(base, a, PROPOSE_TEXT);
    const card = surfacesOf(proposal.body).find((surface) => /:pending-action:/.test(surface.surfaceId));
    assert.ok(card, "the proposal shows its card");
    const view = firstButtonAction(surfacesOf(search.body)[0]!);

    const held = post(base, "/api/turn", a, { threadId: THREAD, text: HELD_TEXT });
    held.catch(() => undefined);
    await gate.reached;

    // The second session takes the single slot while the held turn is in flight.
    const b = await newSession(base);
    await touchSession(base, b);
    const rebuilds = server.sessionRuntimesBuilt;
    await touchSession(base, a);
    assert.equal(server.sessionRuntimesBuilt, rebuilds, "the session with a run in flight is not rebuilt when it returns");

    assert.equal(codeOfBody((await typed(base, a, "Yes")).body), THREAD_BUSY_CODE, "a typed Yes during the held turn is refused");
    const viewRefused = await post(base, "/api/event", a, { threadId: THREAD, ...view });
    assert.equal(codeOfBody(viewRefused.body), THREAD_BUSY_CODE, "a View event during the held turn is refused");
    const confirm = { ...firstButtonAction(card), name: ASSISTANT_CONFIRM_ACTION_EVENT };
    assert.equal(codeOfBody((await post(base, "/api/event", a, { threadId: THREAD, ...confirm })).body), THREAD_BUSY_CODE, "a confirm during the held turn is refused");

    gate.release();
    const held0 = await held;
    assert.equal(held0.status, 200, "the held turn commits and answers");
    assert.equal(held0.body.ok, true, "the held turn is not refused");

    const yes = await typed(base, a, "Yes");
    assert.equal(yes.status, 200, "a later Yes answers over HTTP");
    assert.notEqual(yes.body.code, "INTERNAL_ERROR", "a later Yes does not throw out of the turn");
    if (yes.body.ok === false) assert.match(String(yes.body.code), /^[A-Z_]+$/, "a later Yes that is refused carries a closed code");

    if (yes.body.ok === true) {
      const state = await getState(base, a, THREAD);
      assert.equal(surfacesOf(state.body).some((surface) => /:pending-action:/.test(surface.surfaceId)), false, "a fresh read does not re-present the executed proposal");
    }
    const again = await typed(base, a, "Yes");
    assert.equal(again.status, 200, "a second later Yes answers");
    assert.notEqual(again.body.code, "INTERNAL_ERROR", "a second later Yes does not throw");
  });
});

test("with an idle timeout, an idle sweep that runs mid-turn does not evict the session whose turn is in flight", async () => {
  const { model, gate } = lockModel();
  await withSessionServer({ sessionRuntimeIdleMs: 1, modelClient: model }, async (base, server) => {
    const a = await newSession(base);
    assert.equal(surfacesOf((await typed(base, a, SEARCH_TEXT)).body).length > 0, true, "the search is answered");

    const held = post(base, "/api/turn", a, { threadId: THREAD, text: HELD_TEXT });
    held.catch(() => undefined);
    await gate.reached;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rebuilds = server.sessionRuntimesBuilt;
    // Another session's request runs the idle sweep, which would close the held session's runtime if it were idle.
    const b = await newSession(base);
    await touchSession(base, b);
    assert.equal(server.activeSessionRuntimes >= 2, true, "the session with a run in flight stays resident");
    const built = server.sessionRuntimesBuilt;
    await touchSession(base, a);
    assert.equal(server.sessionRuntimesBuilt, built, "the held session was not rebuilt: its idle runtime was kept while its run was in flight");

    assert.equal(codeOfBody((await typed(base, a, "Yes")).body), THREAD_BUSY_CODE, "a typed Yes during the held turn is still refused");
    gate.release();
    assert.equal((await held).body.ok, true, "the held turn completes");
  }, () => new Date());
});

async function touchSession(base: string, cookie: string): Promise<void> {
  const response = await fetch(`${base}/guest/contact`, { headers: { cookie } });
  await response.text();
}
