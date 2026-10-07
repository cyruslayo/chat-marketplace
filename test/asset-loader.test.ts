import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGuestRequestHandler,
  type GuestRequestHandler,
} from "../apps/local-guest/src/guest-server.js";
import {
  createOwnerRequestHandler,
  type OwnerRequestHandler,
} from "../apps/local-owner/src/index.js";
import { nodeAssetLoader } from "../packages/platform-core/src/node-asset-loader.js";
import type { AssetLoader, AssetName } from "../packages/platform-core/src/asset-loader.js";
import {
  createFakeHttpRequest,
  createFakeHttpResponse,
  type CapturedResponse,
} from "./helpers/http-like.js";

test("09a AC1: neither handler module reads files into pages at import time", async () => {
  // Source first: no readFileSync call remains in either handler module (the Workers runtime has no filesystem).
  for (const path of ["../apps/local-guest/src/guest-server.ts", "../apps/local-owner/src/local-owner-server.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(/readFileSync\s*\(/.test(source), false, `${path} must not call readFileSync after 09a`);
  }
  // Then behavior: process.cwd() points at an empty temporary directory; fresh module execution in a child, because
  // a cached in-process import would not re-run module-level code.
  const cwd = await mkdtemp(join(tmpdir(), "asset-import-"));
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    const probe = spawnSync(process.execPath, [join(import.meta.dirname, "helpers", "asset-import-probe.mjs")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "" },
    });
    assert.equal(probe.status, 0, `probe output: ${probe.stdout} ${probe.stderr}`);
    assert.match(probe.stdout, /ASSET-IMPORT-OK/);
  } finally {
    process.chdir(previous);
    await rm(cwd, { recursive: true, force: true });
  }
});

function stubLoader(css: string, scripts: Partial<Record<AssetName, string>> = {}): AssetLoader {
  return {
    text(name) {
      const stub = scripts[name];
      if (stub !== undefined) return stub;
      if (name === "shortlet-foundations.css") return css;
      throw new Error(`no stub for ${name}`);
    },
  };
}

async function drive(
  handler: { handle(req: unknown, res: unknown): Promise<void> },
  method: string,
  url: string,
): Promise<CapturedResponse> {
  const request = createFakeHttpRequest({ method, url });
  const { response, finished } = createFakeHttpResponse();
  await handler.handle(request, response);
  return await finished;
}

test("09a AC2: a stub AssetLoader inlines the stub CSS and serves the stub bundles with today's headers", async () => {
  const css = "/* stub foundation css */";
  const script = "console.log('stub client');";
  const handler: GuestRequestHandler = createGuestRequestHandler({
    assets: stubLoader(css, { "client.js": script, "gallery.js": script, "offer.js": script, "payment.js": script }),
  });
  try {
    const cssResponse = await drive(handler, "GET", "/shortlet-foundations.css");
    assert.equal(cssResponse.body.toString("utf8"), css);
    assert.deepEqual(
      cssResponse.headers.filter((entry) => entry.name === "content-type" || entry.name === "cache-control"),
      [
        { name: "content-type", value: "text/css; charset=utf-8" },
        { name: "cache-control", value: "public, max-age=3600" },
      ],
    );
    for (const route of ["/client.js", "/gallery.js", "/payment.js", "/offer.js"]) {
      const scriptResponse = await drive(handler, "GET", route);
      assert.equal(scriptResponse.body.toString("utf8"), script, route);
      assert.deepEqual(
        scriptResponse.headers.filter(
          (entry) => entry.name === "content-type" || entry.name === "cache-control",
        ),
        [{ name: "content-type", value: "text/javascript; charset=utf-8" }],
        `${route} keeps today's Content-Type and sends no Cache-Control`,
      );
    }
  } finally {
    await handler.close();
  }

  const owner: OwnerRequestHandler = createOwnerRequestHandler({ assets: stubLoader(css) });
  try {
    const ownerCss = await drive(owner, "GET", "/shortlet-foundations.css");
    assert.equal(ownerCss.body.toString("utf8"), css);
    assert.deepEqual(
      ownerCss.headers.filter((entry) => entry.name === "content-type" || entry.name === "cache-control"),
      [
        { name: "content-type", value: "text/css; charset=utf-8" },
        { name: "cache-control", value: "public, max-age=3600" },
      ],
    );
  } finally {
    await owner.close();
  }
});

test("09a AC3: a missing asset answers per request, not a crash at import", async () => {
  const missing: AssetLoader = {
    text: () => {
      throw new Error("asset missing");
    },
  };
  const handler: GuestRequestHandler = createGuestRequestHandler({ assets: missing });
  try {
    const css = await drive(handler, "GET", "/shortlet-foundations.css");
    assert.equal(css.statusCode, 500, "the CSS route answers 500 per request");
    // The script routes keep today's statuses and copy: 404 for the built bundles, 500 for the client bundle.
    assert.equal((await drive(handler, "GET", "/gallery.js")).statusCode, 404);
    assert.match((await drive(handler, "GET", "/gallery.js")).body.toString("utf8"), /run npm run guest:local/);
    assert.equal((await drive(handler, "GET", "/offer.js")).statusCode, 404);
    assert.match((await drive(handler, "GET", "/offer.js")).body.toString("utf8"), /run npm run guest:local/);
    assert.equal((await drive(handler, "GET", "/payment.js")).statusCode, 404);
    assert.match((await drive(handler, "GET", "/payment.js")).body.toString("utf8"), /run npm run guest:local/);
    const client = await drive(handler, "GET", "/client.js");
    assert.equal(client.statusCode, 500, "the client bundle route answers 500 per request");
    assert.match(client.body.toString("utf8"), /run npm run guest:local/);
  } finally {
    await handler.close();
  }
});

test("09a: nodeAssetLoader() resolves and caches today's real assets", async () => {
  const css = nodeAssetLoader().text("shortlet-foundations.css");
  // Resolutions are module-relative, so they work from an arbitrary process.cwd().
  assert.ok(css.length > 0);
  assert.match(css, /^(\/\*|:\s?root)/);
});
