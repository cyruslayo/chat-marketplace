import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

// The full apartment page's gallery script (guest-gallery issue 01), shared with the chat bundle's gallery.
await build({
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

await build({
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
await build({
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

await build({
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

// Slice 09b: Cloudflare Static Assets output — the four bundles and the foundations CSS, byte for byte
// (ADR 0081 identical bytes; AGENTS.md: the CSS is never formatted). `dist/` stays the Node-served output.
mkdirSync("apps/cloudflare/public", { recursive: true });
for (const name of ["gallery.js", "offer.js", "payment.js", "client.js"]) {
  copyFileSync(`apps/local-guest/dist/${name}`, join("apps/cloudflare/public", name));
}
copyFileSync(
  "apps/web/src/shortlet-foundations.css",
  "apps/cloudflare/public/shortlet-foundations.css",
);

// `_headers` mirrors the values the Node handlers send today (guest-server.ts script routes, and both CSS
// routes): the CSS is an hour of shared caching; the scripts set neither `Cache-Control` nor an extra header.
writeFileSync(
  "apps/cloudflare/public/_headers",
  ["\
/shortlet-foundations.css", "  Content-Type: text/css; charset=utf-8", "  Cache-Control: public, max-age=3600",
  "", "/gallery.js", "  Content-Type: text/javascript; charset=utf-8",
  "", "/offer.js", "  Content-Type: text/javascript; charset=utf-8",
  "", "/payment.js", "  Content-Type: text/javascript; charset=utf-8",
  "", "/client.js", "  Content-Type: text/javascript; charset=utf-8",
  "",
  ].join("\n"),
);

