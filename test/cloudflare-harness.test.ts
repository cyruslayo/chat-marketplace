import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = (path: string) =>
  JSON.parse(readFileSync(new URL(path, root), "utf8"));

test("AC2: npm run check type-checks both the Node tree and apps/cloudflare with their own types", () => {
  const node = json("tsconfig.json");
  const workers = json("apps/cloudflare/tsconfig.json");
  assert.deepEqual(node.compilerOptions.types, ["node"]);
  assert.ok(node.exclude.includes("apps/cloudflare/**"));
  // Slice 10b: the Worker tree loads only Node globals. The Workers types are
  // imported as a module (cloudflare-workers.d.ts) so they do not clash with the
  // repository's DOM and Node globals, and the node:sqlite rule is enforced by the
  // worker-bundle guard rather than by a Workers-types global.
  assert.equal(workers.extends, "../../tsconfig.json");
  assert.deepEqual(workers.compilerOptions.types, ["node"]);
  assert.ok(!workers.compilerOptions.types.includes("@cloudflare/workers-types"));
  assert.deepEqual(workers.include, ["src/**/*.ts"]);
  const workersTypes = readFileSync(
    new URL("apps/cloudflare/src/cloudflare-workers.d.ts", root),
    "utf8",
  );
  assert.match(workersTypes, /declare module "cloudflare:workers"/);
  assert.match(workersTypes, /import\("@cloudflare\/workers-types"\)/);

  const scripts: Record<string, string> = json("package.json").scripts;
  const checkSteps = scripts.check.split("&&").map((step) => step.trim());
  assert.ok(checkSteps.includes("tsc --noEmit -p apps/cloudflare"));
  assert.ok(checkSteps.includes("node scripts/check-worker-bundle.mjs"));
  assert.match(scripts["test:workers"], /node scripts\/check-worker-bundle\.mjs/);
});

test("AC3: npm test neither runs nor breaks on the .spec.ts files, and still passes", () => {
  const runner = readFileSync(new URL("scripts/run-tests.mjs", root), "utf8");
  assert.match(runner, /readdirSync\(join\(root, "test"\)\)/);
  assert.match(runner, /name\.endsWith\("\.test\.ts"\)/);
  assert.match(
    json("package.json").scripts["test:workers"],
    /apps\/cloudflare\/vitest.config.ts/,
  );
});

test("AC4: No production Wrangler config or developer-facing Wrangler command is introduced by this harness", () => {
  const scripts: Record<string, string> = json("package.json").scripts;
  assert.ok(
    Object.values(scripts).every((command) => !/\bwrangler\b/.test(command)),
  );
  assert.match(
    readFileSync(new URL("apps/cloudflare/vitest.config.ts", root), "utf8"),
    /wrangler\.test\.jsonc/,
  );
  assert.ok(!("wrangler" in json("package.json").devDependencies));
});
