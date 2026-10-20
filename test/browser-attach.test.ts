import test from "node:test";
import assert from "node:assert/strict";
import { attachToOwnBrowser, type DevToolsEndpoint } from "./helpers/chrome-devtools.js";

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
