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
