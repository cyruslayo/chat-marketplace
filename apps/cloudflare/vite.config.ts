import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The `cf` CLI drives dev/build/deploy for this project; Vite is the build implementation the Cloudflare plugin
// hooks into (verified in slice 01c). Run `cf dev`/`cf build` from `apps/cloudflare`.
const nodeSqliteStub = fileURLToPath(new URL("./src/node-sqlite-stub.ts", import.meta.url));

export default defineConfig({
  plugins: [cloudflare()],
  resolve: {
    alias: [
      // Slice 10b: the Node file-opening adapter must never be bundled into the Worker (Workers has only a
      // non-functional `node:sqlite`). The Durable Object injects a `SqlDatabase`, so the factory is unreachable;
      // scripts/check-worker-bundle.mjs enforces the same exclusion and rejects any direct `node:sqlite` import.
      // The pattern matches the whole specifier so the replacement is absolute, not appended to the import path.
      { find: /^.*node-sqlite-database\.(ts|js)$/, replacement: nodeSqliteStub },
    ],
  },
});
