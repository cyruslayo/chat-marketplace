import test from "node:test";
import assert from "node:assert/strict";
import { assertOwnBrowserEndpoint, parseDevToolsActivePort } from "./helpers/chrome-devtools.js";

// Chrome writes DevToolsActivePort into the profile directory it was launched with: line 1 is the port it actually bound
// (with --remote-debugging-port=0), line 2 is the browser's websocket path. The helper attaches only to that port and path,
// so it can never attach to another browser (for example a user's own Edge) that happens to listen on a port it guessed.

test("DevToolsActivePort gives the bound port and the browser websocket path", () => {
  assert.deepEqual(
    parseDevToolsActivePort("51234\n/devtools/browser/7f1c2a9e-0d3b-4c1a-9e1f-2b3c4d5e6f70\n"),
    { port: 51234, browserPath: "/devtools/browser/7f1c2a9e-0d3b-4c1a-9e1f-2b3c4d5e6f70" }
  );
});

test("A malformed or incomplete DevToolsActivePort is not used", () => {
  assert.equal(parseDevToolsActivePort(""), undefined);
  assert.equal(parseDevToolsActivePort("not-a-port\n/devtools/browser/x\n"), undefined);
  assert.equal(parseDevToolsActivePort("51234\n"), undefined, "no browser path");
  assert.equal(parseDevToolsActivePort("0\n/devtools/browser/x\n"), undefined, "port zero is not a bound port");
  assert.equal(parseDevToolsActivePort("70000\n/devtools/browser/x\n"), undefined, "port out of range");
});

test("The attached browser must be the one the file named: a different browser path on the same port is refused", () => {
  const own = { port: 51234, browserPath: "/devtools/browser/aaaa" };
  assert.doesNotThrow(() => assertOwnBrowserEndpoint(own, "ws://127.0.0.1:51234/devtools/browser/aaaa"));
  assert.throws(
    () => assertOwnBrowserEndpoint(own, "ws://127.0.0.1:51234/devtools/browser/someone-else"),
    /not the browser this run launched/
  );
});
