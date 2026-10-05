import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)) },
  })],
  test: {
    include: ["apps/cloudflare/test/**/*.spec.ts"],
  },
});
