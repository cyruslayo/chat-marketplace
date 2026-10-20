import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { attachToOwnBrowser, terminateOwnedChromeProcess, type DevToolsEndpoint } from "./helpers/chrome-devtools.js";
import { killProcessTree } from "../scripts/browser-phase.mjs";

// Before anything is sent to the browser, its /json/version must name the browser the profile directory named. Any failure
// on that path (a network error, a bad status, unreadable JSON, a different browser) must run the cleanup the launch
// depends on (kill Chrome, remove the profile, release the lock), and then be rethrown.

const endpoint: DevToolsEndpoint = { port: 51234, browserPath: "/devtools/browser/aaaa" };

function stubFetch(respond: () => Response | Promise<Response>): typeof fetch {
  return (async () => respond()) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("A matching browser is attached to: nothing is cleaned up, and the reported version is returned", async () => {
  let cleanedUp = 0;
  const reported = await attachToOwnBrowser({
    endpoint,
    fetchImpl: stubFetch(() => json({ Browser: "Chrome/130", webSocketDebuggerUrl: "ws://127.0.0.1:51234/devtools/browser/aaaa" })),
    onFailure: () => { cleanedUp += 1; },
  });
  assert.equal(reported.Browser, "Chrome/130");
  assert.equal(cleanedUp, 0);
});

test("A network error on /json/version runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => { throw new TypeError("fetch failed"); }),
      onFailure: () => { cleanedUp += 1; },
    }),
    /fetch failed/
  );
  assert.equal(cleanedUp, 1);
});

test("A non-OK status runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => new Response("<html>nope</html>", { status: 500 })),
      onFailure: () => { cleanedUp += 1; },
    }),
    /answered 500 to \/json\/version/
  );
  assert.equal(cleanedUp, 1);
});

test("Unreadable JSON runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => new Response("not json", { status: 200 })),
      onFailure: () => { cleanedUp += 1; },
    }),
    (error: unknown) => error instanceof Error
  );
  assert.equal(cleanedUp, 1);
});

test("A different browser on the port runs the cleanup once and is rethrown", async () => {
  let cleanedUp = 0;
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => json({ webSocketDebuggerUrl: "ws://127.0.0.1:51234/devtools/browser/someone-else" })),
      onFailure: () => { cleanedUp += 1; },
    }),
    /not the browser this run launched/
  );
  assert.equal(cleanedUp, 1);
});

test("A rejected browser endpoint does not disclose its path, query, or fragment", async () => {
  const secret = "sentinel-private-reference";
  await assert.rejects(
    attachToOwnBrowser({
      endpoint,
      fetchImpl: stubFetch(() => json({ webSocketDebuggerUrl: `ws://127.0.0.1:51234/devtools/browser/${secret}?reference=${secret}#${secret}` })),
      onFailure: () => {},
    }),
    (error: unknown) => error instanceof Error && !error.message.includes(secret)
  );
});

test("A stalled DevTools fetch aborts within its bound and runs cleanup once", async () => {
  let cleanedUp = 0;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  })) as typeof fetch;
  await assert.rejects(
    attachToOwnBrowser({ endpoint, fetchImpl, timeoutMs: 20, onFailure: () => { cleanedUp += 1; } }),
    /did not answer \/json\/version within 20 ms/
  );
  assert.equal(cleanedUp, 1);
});

test("A stalled DevTools JSON body is bounded and runs cleanup once", async () => {
  let cleanedUp = 0;
  const fetchImpl = (async () => ({ ok: true, json: () => new Promise<unknown>(() => {}) }) as Response) as typeof fetch;
  await assert.rejects(
    attachToOwnBrowser({ endpoint, fetchImpl, timeoutMs: 20, onFailure: () => { cleanedUp += 1; } }),
    /did not answer \/json\/version within 20 ms/
  );
  assert.equal(cleanedUp, 1);
});

test("Fetch and JSON timeouts await asynchronous cleanup before rejecting once", async () => {
  for (const stage of ["fetch", "json"] as const) {
    let cleanupCalls = 0;
    let finishCleanup!: () => void;
    let settled = false;
    const fetchImpl = stage === "fetch"
      ? (((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
        })) as typeof fetch)
      : ((async () => ({ ok: true, json: () => new Promise<unknown>(() => {}) }) as Response) as typeof fetch);
    const attachment = attachToOwnBrowser({
      endpoint,
      fetchImpl,
      timeoutMs: 20,
      onFailure: async () => {
        cleanupCalls += 1;
        await new Promise<void>((resolve) => { finishCleanup = resolve; });
      },
    });
    const observed = attachment.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(cleanupCalls, 1, `${stage} timeout invokes cleanup once`);
    assert.equal(settled, false, `${stage} timeout waits while cleanup remains pending`);
    finishCleanup();
    await assert.rejects(attachment, /did not answer \/json\/version within 20 ms/);
    await observed;
    assert.equal(settled, true);
  }
});

test("Owned-browser termination waits for the launched process to exit", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  assert.ok(child.pid !== undefined);
  try {
    await terminateOwnedChromeProcess(child, 3000);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) killProcessTree(child.pid);
  }
});
