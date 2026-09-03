import { build } from "esbuild";

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
