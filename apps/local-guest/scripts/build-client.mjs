import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { writeOutput } from "../../../scripts/write-output.mjs";

async function buildBundle(options) {
  const result = await build({ ...options, write: false });
  for (const output of result.outputFiles) {
    mkdirSync(dirname(output.path), { recursive: true });
    await writeOutput(output.path, output.contents);
  }
}

async function copyOutput(source, target) {
  await writeOutput(target, readFileSync(source));
}

// Reuse the route's closed allow-list rather than keeping a second list of published files. esbuild (a runtime dependency)
// compiles the TypeScript module in memory, so the production build needs no development-only loader.
const allowList = await build({
  entryPoints: [fileURLToPath(new URL("../src/landing-assets.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "landingAssets",
  platform: "node",
});
// The bundle is evaluated, not imported, so the build has no non-literal import() (the source sweep forbids one).
const { LANDING_BINARY_ASSETS } = runInNewContext(`${allowList.outputFiles[0].text}\nlandingAssets`);

// Landing motion stays separate from the guest bundle; preserve the Cloudflare public-copy block below.
await buildBundle({
  entryPoints: ["apps/local-guest/src/landing-page.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "apps/local-guest/dist/landing.js",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

// The full apartment page's gallery script (guest-gallery issue 01), shared with the chat bundle's gallery.
await buildBundle({
  entryPoints: ["apps/local-guest/src/gallery-page.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "apps/local-guest/dist/gallery.js",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

await buildBundle({
  entryPoints: ["apps/local-guest/src/offer-page.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "apps/local-guest/dist/offer.js",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

// The bank transfer pages' copy-account-number script.
await buildBundle({
  entryPoints: ["apps/local-guest/src/payment-page.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "apps/local-guest/dist/payment.js",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

await buildBundle({
  entryPoints: ["apps/local-guest/src/client.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "apps/local-guest/dist/client.js",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

// Slice 09b / landing 12: Cloudflare Static Assets output — browser bundles, styles and landing binaries, byte for byte
// (ADR 0081 identical bytes; AGENTS.md: the CSS is never formatted). `dist/` stays the Node-served output.
mkdirSync("apps/cloudflare/public", { recursive: true });
for (const name of [
  "gallery.js",
  "offer.js",
  "payment.js",
  "client.js",
  "landing.js",
]) {
  await copyOutput(
    `apps/local-guest/dist/${name}`,
    join("apps/cloudflare/public", name),
  );
}
for (const name of ["shortlet-foundations.css", "shortlet-landing.css"]) {
  await copyOutput(
    join("apps/web/src", name),
    join("apps/cloudflare/public", name),
  );
}
for (const [path, asset] of Object.entries(LANDING_BINARY_ASSETS)) {
  const target = join("apps/cloudflare/public", path.slice(1));
  mkdirSync(dirname(target), { recursive: true });
  await copyOutput(join("apps/local-guest/assets", asset.file), target);
}

// `_headers` mirrors the values the Node handlers send today (guest-server.ts script routes, and both CSS
// routes): the CSS is an hour of shared caching; the scripts set neither `Cache-Control` nor an extra header.
await writeOutput(
  "apps/cloudflare/public/_headers",
  [
    "\
/shortlet-foundations.css",
    "  Content-Type: text/css; charset=utf-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/gallery.js",
    "  Content-Type: text/javascript; charset=utf-8",
    "",
    "/offer.js",
    "  Content-Type: text/javascript; charset=utf-8",
    "",
    "/payment.js",
    "  Content-Type: text/javascript; charset=utf-8",
    "",
    "/client.js",
    "  Content-Type: text/javascript; charset=utf-8",
    "",
    "/landing.js",
    "  Content-Type: text/javascript; charset=utf-8",
    "",
    "/shortlet-landing.css",
    "  Content-Type: text/css; charset=utf-8",
    "  Cache-Control: public, max-age=3600",
    ...Object.entries(LANDING_BINARY_ASSETS).flatMap(([path, asset]) => [
      "",
      path,
      `  Content-Type: ${asset.contentType}`,
      "  Cache-Control: public, max-age=31536000, immutable",
      "  X-Content-Type-Options: nosniff",
    ]),
    "",
  ].join("\n"),
);
