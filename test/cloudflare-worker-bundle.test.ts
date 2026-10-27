import assert from "node:assert/strict";
import test from "node:test";
import {
  bundleWorker,
  forbiddenWorkerModules,
  moduleScopeImportMetaUrlOffenders,
  hasModuleScopeImportMetaUrl,
} from "../scripts/check-worker-bundle.mjs";

test("worker fix AC2: no Worker-graph module reads import.meta.url at module scope", async () => {
  const { metafile } = await bundleWorker();
  assert.deepEqual(await moduleScopeImportMetaUrlOffenders(metafile), []);
});

test("worker fix AC2 failure path: a top-level import.meta.url is reported, a function-scoped one is not", () => {
  assert.equal(
    hasModuleScopeImportMetaUrl('import { fileURLToPath } from "node:url";\nvar dir = dirname(fileURLToPath(import.meta.url));\n'),
    true,
  );
  assert.equal(
    hasModuleScopeImportMetaUrl("export function f() {\n  return new URL('../a', import.meta.url);\n}\n"),
    false,
  );
  assert.equal(hasModuleScopeImportMetaUrl("// import.meta.url is documented here\nexport const x = 1;\n"), false);
});

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
