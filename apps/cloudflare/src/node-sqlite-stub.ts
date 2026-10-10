import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/**
 * Build-time replacement for `node-sqlite-database.ts` in the Worker bundle (slice 10b).
 *
 * Workers exposes only a non-functional `node:sqlite` stub, so the Node file-opening adapter must never enter the
 * Worker import graph. `vite.config.ts` aliases this module over the adapter for the Worker build, and
 * `scripts/check-worker-bundle.mjs` enforces the same exclusion. The Durable Object always injects a `SqlDatabase`
 * (04a/04b), so the Node convenience factory is never reached; reaching it means the graph wrongly included the
 * Node adapter, so it throws rather than silently opening a file.
 */
export function openNodeSqliteDatabase(_path: string): SqlDatabase {
  throw new Error("node:sqlite is unavailable on Cloudflare; the Durable Object injects a SqlDatabase");
}
