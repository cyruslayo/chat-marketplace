import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nodeAssetLoader } from "../../packages/platform-core/src/node-asset-loader.js";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Node-side reference bytes: Vite's CSS ?raw transform normalizes CRLF, so it cannot prove byte parity.
const nodeAssets = nodeAssetLoader();
const landingNodeAssets = Object.fromEntries(
  (["shortlet-landing.css", "landing.js"] as const).map((name) => {
    const bytes = Buffer.from(nodeAssets.text(name), "utf8");
    return [
      name,
      {
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ];
  }),
);

export default defineConfig({
  define: { __LANDING_NODE_ASSETS__: JSON.stringify(landingNodeAssets) },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: fileURLToPath(
          new URL("./wrangler.test.jsonc", import.meta.url),
        ),
      },
    }),
  ],
  test: {
    include: ["apps/cloudflare/test/**/*.spec.ts"],
  },
});
