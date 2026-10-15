import assert from "node:assert/strict";
import test from "node:test";
import type { AssetLoader } from "../packages/platform-core/src/asset-loader.js";
import type { HttpRequestLike, HttpResponseLike } from "../packages/platform-core/src/http-like.js";
import { createGuestShell, type RouteModule } from "../apps/local-guest/src/guest-shell.js";

function fakeRequest(method: string, url: string): HttpRequestLike {
  const req = {
    method,
    url,
    headers: { host: "localhost" },
    on() { return req; },
    resume() { return req; },
  };
  return req as unknown as HttpRequestLike;
}

interface Recorded {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}
function fakeResponse(): { res: HttpResponseLike; recorded: Recorded } {
  const recorded: Recorded = { status: 0, headers: {}, body: "" };
  const res = {
    headersSent: false,
    writeHead(statusCode: number, headers?: Record<string, unknown>) {
      recorded.status = statusCode;
      if (headers) Object.assign(recorded.headers, headers);
      res.headersSent = true;
      return res;
    },
    setHeader(name: string, value: unknown) { recorded.headers[name] = value; return res; },
    end(body?: string | Buffer) { recorded.body = body === undefined ? "" : body.toString(); return res; },
    destroy() { return res; },
  };
  return { res: res as unknown as HttpResponseLike, recorded };
}

const assets: AssetLoader = { text: (name) => `/* ${name} */` };

function shell(routeModules: readonly RouteModule[]) {
  return createGuestShell({
    assets,
    staticAssets: [
      { path: "/client.js", assetName: "client.js", contentType: "text/javascript; charset=utf-8", missingStatus: 500, missingMessage: "bundle missing" },
      { path: "/shortlet-foundations.css", assetName: "shortlet-foundations.css", contentType: "text/css; charset=utf-8", cacheControl: "public, max-age=3600", missingStatus: 500, missingMessage: "styles missing" },
    ],
    routeModules,
    notFound: async (_req, res) => { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not Found"); },
  });
}

test("The shell dispatches to a registered route module and falls back to not-found", async () => {
  const handled: string[] = [];
  const module: RouteModule = {
    name: "fake",
    tryHandle: async (req, res, url) => {
      if (url.pathname !== "/fake") return false;
      handled.push(url.pathname);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("handled");
      return true;
    },
  };
  const guestShell = shell([module]);

  const hit = fakeResponse();
  await guestShell.handle(fakeRequest("GET", "/fake"), hit.res);
  assert.equal(hit.recorded.status, 200);
  assert.equal(hit.recorded.body, "handled");
  assert.deepEqual(handled, ["/fake"]);

  const miss = fakeResponse();
  await guestShell.handle(fakeRequest("GET", "/nowhere"), miss.res);
  assert.equal(miss.recorded.status, 404);
  assert.equal(miss.recorded.body, "Not Found");
});

test("The shell serves a registered static asset for GET, with its cache header", async () => {
  const guestShell = shell([]);

  const script = fakeResponse();
  await guestShell.handle(fakeRequest("GET", "/client.js"), script.res);
  assert.equal(script.recorded.status, 200);
  assert.equal(script.recorded.headers["Content-Type"], "text/javascript; charset=utf-8");
  assert.equal(script.recorded.body, "/* client.js */");

  const css = fakeResponse();
  await guestShell.handle(fakeRequest("GET", "/shortlet-foundations.css"), css.res);
  assert.equal(css.recorded.status, 200);
  assert.equal(css.recorded.headers["Cache-Control"], "public, max-age=3600");
  assert.equal(css.recorded.body, "/* shortlet-foundations.css */");

  // A non-GET request is not an asset request: it falls through to the routes.
  const post = fakeResponse();
  await guestShell.handle(fakeRequest("POST", "/client.js"), post.res);
  assert.equal(post.recorded.status, 404);
});

test("The shell answers the asset's missing status when the loader throws", async () => {
  const throwing: AssetLoader = { text: () => { throw new Error("missing"); } };
  const guestShell = createGuestShell({
    assets: throwing,
    staticAssets: [{ path: "/client.js", assetName: "client.js", contentType: "text/javascript; charset=utf-8", missingStatus: 500, missingMessage: "bundle missing" }],
    routeModules: [],
    notFound: async (_req, res) => { res.writeHead(404); res.end(); },
  });

  const response = fakeResponse();
  await guestShell.handle(fakeRequest("GET", "/client.js"), response.res);
  assert.equal(response.recorded.status, 500);
  assert.equal(response.recorded.body, "bundle missing");
});

test("The shell module imports no domain code", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../apps/local-guest/src/guest-shell.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /domains\/shortlet/);
});
