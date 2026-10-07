import assert from "node:assert/strict";
import test from "node:test";
import { bundleWorker, forbiddenWorkerModules } from "../scripts/check-worker-bundle.mjs";

test("10b AC3: the Worker bundle carries no node:sqlite or Node SQLite adapter", async () => {
  const { metafile, output } = await bundleWorker();
  assert.deepEqual(forbiddenWorkerModules(metafile, output), []);
});

test("10b AC3 failure path: an adapter input or a direct node:sqlite import is reported", () => {
  const metafile = { inputs: { "packages/platform-core/src/node-sqlite-database.ts": {}, "apps/cloudflare/src/worker.ts": {} } };
  assert.deepEqual(forbiddenWorkerModules(metafile, "export const x = 1;"), ["packages/platform-core/src/node-sqlite-database.ts"]);
  const direct = { inputs: { "apps/local-guest/src/guest-server.ts": {} } };
  assert.deepEqual(forbiddenWorkerModules(direct, 'import { DatabaseSync } from "node:sqlite";'), ["direct node:sqlite import"]);
  assert.deepEqual(forbiddenWorkerModules(direct, "export const x = 1;"), []);
});
