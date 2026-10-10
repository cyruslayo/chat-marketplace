import { execSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ASSETS = ["client.js", "gallery.js", "offer.js", "payment.js"];

function build(): void {
  // The build script resolves its paths from the repository root.
  execSync("node apps/local-guest/scripts/build-client.mjs", { stdio: "pipe", env: { ...process.env, NODE_ENV: "" }, cwd: join(import.meta.dirname, ".."), windowsHide: true });
}

test("09b AC1: npm run build writes the four bundles into apps/cloudflare/public byte-identical to the Node output", () => {
  build();
  for (const name of ASSETS) {
    const node = readFileSync(join(import.meta.dirname, `../apps/local-guest/dist/${name}`));
    const edge = readFileSync(join(import.meta.dirname, `../apps/cloudflare/public/${name}`));
    assert.deepEqual(edge, node, `${name} must be byte-identical to the Node-served bundle`);
  }
});

test("09b AC2: _headers mirrors each asset's Cache-Control exactly as the Node server sends it", async () => {
  build();
  // The Node values, read from the real guest server (the handler that serves these routes).
  const directory = await mkdtemp(join(tmpdir(), "static-assets-headers-"));
  const { startLocalGuestServer } = await import("../apps/local-guest/src/guest-server.js");
  const { LocalGuestEnvironment } = await import("../apps/local-guest/src/fixture.js");
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(directory, "guest.sqlite") });
  const server = startLocalGuestServer({ port: 0, environment });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const nodeCaching = new Map<string, string>();
    for (const path of ["/shortlet-foundations.css", ...ASSETS.map((name) => `/${name}`)]) {
      const response = await fetch(new URL(path, base));
      const cacheControl = response.headers.get("cache-control");
      if (cacheControl !== null) nodeCaching.set(path, cacheControl);
    }
    // The committed header policy of the Cloudflare static assets.
    const headersText = readFileSync(join(import.meta.dirname, "../apps/cloudflare/public/_headers"), "utf8");
    const edgeCaching = new Map<string, Map<string, string>>();
    for (const line of headersText.split("\n")) {
      if (line.startsWith("/")) edgeCaching.set(line.trim(), new Map());
      else if (line.startsWith("  ")) {
        const [name, value] = line.trim().split(": ");
        edgeCaching.get([...edgeCaching.keys()].at(-1)!)!.set(name.toLowerCase(), value ?? "");
      }
    }
    for (const path of ["/shortlet-foundations.css", ...ASSETS.map((name) => `/${name}`)]) {
      assert.equal(edgeCaching.get(path)!.get("cache-control") ?? null, nodeCaching.get(path) ?? null, `${path} Cache-Control must mirror the Node response`);
    }
    assert.equal(edgeCaching.get("/shortlet-foundations.css")!.get("cache-control"), "public, max-age=3600");
    for (const name of ASSETS) assert.equal(edgeCaching.get(`/${name}`)!.has("cache-control"), false, `${name} must carry no Cache-Control, like the Node script routes`);
    for (const name of ASSETS) assert.equal(edgeCaching.get(`/${name}`)!.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(edgeCaching.get("/shortlet-foundations.css")!.get("content-type"), "text/css; charset=utf-8");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("09b AC3: the foundations CSS copy is byte-identical to the source; any whitespace drift fails", () => {
  build();
  const source = readFileSync(join(import.meta.dirname, "../apps/web/src/shortlet-foundations.css"));
  const copied = readFileSync(join(import.meta.dirname, "../apps/cloudflare/public/shortlet-foundations.css"));
  assert.deepEqual(copied, source, "the CSS must be copied byte for byte, never formatted");
});
