import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetLoader } from "../packages/platform-core/src/asset-loader.js";
import {
  createGuestShell,
  type RouteModule,
} from "../apps/local-guest/src/guest-shell.js";
import {
  createGuestRequestHandler,
  GUEST_COMMERCE_COMPOSITION,
  type GuestRequestHandler,
} from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import {
  createLandingRouteModule,
  type LandingRouteOptions,
} from "../apps/local-guest/src/landing-route-module.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import {
  createFakeHttpRequest,
  createFakeHttpResponse,
  type CapturedResponse,
  type FakeRequestOptions,
} from "./helpers/http-like.js";

const assets: AssetLoader = {
  text: (name) =>
    name.endsWith(".css")
      ? "/* injected stylesheet */"
      : "/* injected script */",
};
const binaryAssets = {
  read: (_name: string): Uint8Array => new Uint8Array([1, 2, 3]),
};

async function request(
  handler: { handle: GuestRequestHandler["handle"] },
  path: string,
  options: Partial<FakeRequestOptions> = {},
): Promise<CapturedResponse> {
  const req = createFakeHttpRequest({
    method: "GET",
    url: path,
    headers: { host: "localhost" },
    ...options,
  });
  const { response, finished } = createFakeHttpResponse();
  await handler.handle(req, response);
  return finished;
}

async function withGuest(
  demo: boolean,
  run: (handler: GuestRequestHandler) => Promise<void>,
): Promise<void> {
  const handler = createGuestRequestHandler({
    environment: LocalGuestEnvironment.openNode({ databasePath: ":memory:" }),
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    assets,
    sessionScopedGuestPrincipals: true,
    landingDemo: demo,
    landingBinaryAssets: binaryAssets,
  });
  try {
    await run(handler);
  } finally {
    await handler.close();
  }
}

async function landingModule(
  options: Pick<LandingRouteOptions, "assets" | "binaryAssets" | "demo">,
): Promise<RouteModule> {
  return createLandingRouteModule({
    ...options,
    originAccepted: () => true,
    readForm: async () => new URLSearchParams(),
  });
}

function runNonBrowserFiles(files: readonly string[]): void {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      "--test",
      "--test-concurrency=1",
      ...files,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test("AC1 — On main's shell GET /welcome renders the landing page with its stylesheet, script, fonts and demo photos, and shortlet routes behave as before", async () => {
  await withGuest(true, async (handler) => {
    const page = await request(handler, "/welcome");
    assert.equal(page.statusCode, 200);
    assert.equal(
      page.headers.some((header) => header.name === "set-cookie"),
      false,
      "landing creates no Guest session",
    );
    const html = page.body.toString("utf8");
    for (const path of [
      "/shortlet-landing.css",
      "/landing.js",
      "/landing/fonts/newsreader-500.woff2",
      "/landing/photos/ikoyi-living.jpg",
    ]) {
      assert.ok(html.includes(path), path);
      const response = await request(handler, path);
      assert.equal(response.statusCode, 200, path);
      assert.ok(response.body.length > 0, path);
    }
    assert.equal((await request(handler, "/")).statusCode, 200);
    assert.equal((await request(handler, "/cart")).statusCode, 404);
    assert.doesNotMatch(html, /\bShop\b|\bcommerce\b/);
  });
});

test("AC2 — Welcome and its assets use a landing route module before shortlet, and unknown asset names return 404", async () => {
  const module = await landingModule({ assets, binaryAssets });
  let shortletCalls = 0;
  const shell = createGuestShell({
    assets,
    staticAssets: [],
    routeModules: [
      module,
      {
        name: "shortlet",
        async tryHandle(_req, res) {
          shortletCalls++;
          res.writeHead(401);
          res.end();
          return true;
        },
      },
    ],
    notFound: async (_req, res) => {
      res.writeHead(404);
      res.end();
    },
  });
  assert.equal(module.name, "landing");
  for (const path of [
    "/welcome",
    "/landing.js",
    "/shortlet-landing.css",
    "/landing/fonts/newsreader-500.woff2",
    "/landing/photos/ikoyi-living.jpg",
  ]) {
    assert.equal(
      (
        await request(shell, path, {
          headers: {
            host: "localhost",
            cookie: "shortlet_guest_session=stale",
          },
        })
      ).statusCode,
      200,
      path,
    );
  }
  for (const path of [
    "/landing/fonts/no-such-font.woff2",
    "/landing/photos/no-such-photo.jpg",
    "/landing/photos/%2e%2e%2fsecret.jpg",
  ])
    assert.equal((await request(shell, path)).statusCode, 404, path);
  assert.equal(
    shortletCalls,
    0,
    "the landing owns even unknown names within its asset prefixes",
  );
  await request(shell, "/api/state");
  assert.equal(shortletCalls, 1);
});

test("AC3 — No landing code reads the filesystem at module load; assets come from injected loaders", async () => {
  let reads = 0;
  const module = await landingModule({
    assets: {
      text: () => {
        reads++;
        return "injected";
      },
    },
    binaryAssets: {
      read: () => {
        reads++;
        return new Uint8Array([4]);
      },
    },
  });
  assert.equal(reads, 0, "constructing/importing a route reads no assets");
  const shell = createGuestShell({
    assets,
    staticAssets: [],
    routeModules: [module],
    notFound: async (_req, res) => {
      res.writeHead(404);
      res.end();
    },
  });
  assert.equal((await request(shell, "/welcome")).statusCode, 200);
  assert.equal(reads, 0, "HTML references assets rather than reading them");
  assert.equal(
    (await request(shell, "/landing.js")).body.toString(),
    "injected",
  );
  assert.deepEqual(
    (await request(shell, "/landing/fonts/newsreader-500.woff2")).body,
    Buffer.from([4]),
  );
  assert.equal(reads, 2);
  const missing = await landingModule({
    assets: {
      text: () => {
        throw new Error("missing");
      },
    },
    binaryAssets: {
      read: () => {
        throw new Error("missing");
      },
    },
  });
  const missingShell = createGuestShell({
    assets,
    staticAssets: [],
    routeModules: [missing],
    notFound: async (_req, res) => {
      res.writeHead(404);
      res.end();
    },
  });
  assert.equal((await request(missingShell, "/landing.js")).statusCode, 404);
  assert.equal(
    (await request(missingShell, "/landing/photos/ikoyi-living.jpg"))
      .statusCode,
    404,
  );
  assert.doesNotMatch(
    readFileSync(
      new URL(
        "../apps/local-guest/src/landing-route-module.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    /readFileSync\s*\(/,
  );
  runNonBrowserFiles(["test/asset-loader.test.ts"]); // Reuse the fresh-process import probe, not a warm module cache.
});

test("AC4 — Existing landing expectations pass without weakening; serial browser expectations are also required by the wave gate", () => {
  runNonBrowserFiles([
    "test/landing-page.test.ts",
    "test/landing-page-motion.test.ts",
  ]);
});

test("AC5 — The domain boundary tests and Weaver dependency boundary test still pass", () => {
  runNonBrowserFiles([
    "test/domain-boundary.test.ts",
    "test/weaver-dependency-boundary.test.ts",
  ]);
});

test("Owner demo approval — Current photos render only in an explicit labelled demo or local preview, never the normal public render", async () => {
  const normal = renderLandingHtml();
  const demo = renderLandingHtml("system", { demo: true });
  assert.doesNotMatch(normal, /<img\b/);
  assert.doesNotMatch(
    normal,
    /Demo — illustrative photos, not live listings\./,
  );
  assert.match(demo, /Demo — illustrative photos, not live listings\./);
  assert.match(demo, /<img[^>]+src="\/landing\/photos\/ikoyi-living\.jpg"/);
  assert.match(demo, /<img[^>]+src="\/landing\/photos\/lekki-bedroom\.jpg"/);
  assert.doesNotMatch(demo, /\[ABUJA PHOTO|\[Area\]|\[bedrooms\]/);
  assert.match(renderLandingHtml("system", { placeholders: true }), /<img\b/);
});

test("Owner demo approval — Demo presentation grants no booking or payment authority to its illustrative Units", async () => {
  await withGuest(true, async (handler) => {
    const before = handler.environment.unitRepository
      .findAll()
      .map((unit) => unit.id);
    const page = await request(handler, "/welcome");
    assert.equal(page.statusCode, 200);
    assert.match(
      page.body.toString(),
      /Demo — illustrative photos, not live listings\./,
    );
    assert.deepEqual(
      handler.environment.unitRepository.findAll().map((unit) => unit.id),
      before,
      "rendering must not seed or publish demo inventory",
    );
    for (const id of ["old-ikoyi", "lekki-phase-1", "abuja-placeholder"]) {
      assert.equal((await request(handler, `/stays/${id}`)).statusCode, 404);
      const payment = await request(handler, `/payments/offers/${id}`);
      assert.notEqual(payment.statusCode, 200);
      assert.equal(
        payment.headers.some(
          (header) =>
            header.name === "location" &&
            /^https:\/\/checkout\./.test(header.value),
        ),
        false,
      );
    }
  });
});
