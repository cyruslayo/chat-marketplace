import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Issue 16 C: a clean checkout must build the Worker. The `cf` CLI looks for the Cloudflare Vite plugin only in the project's own
 * node_modules (apps/cloudflare), so the app keeps its own committed lockfile, and every script that runs `cf` installs from it
 * first (scripts/ensure-worker-deps.mjs). These checks fail if the lockfile drifts from the manifest or a script skips the install.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(`${root}${path}`, "utf8")) as Record<string, unknown>;

test("16 C: the Cloudflare app's lockfile pins the same Vite plugin version its manifest declares", () => {
  const manifest = readJson("apps/cloudflare/package.json") as { devDependencies: Record<string, string> };
  const lock = readJson("apps/cloudflare/package-lock.json") as {
    packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
  };
  const declared = manifest.devDependencies["@cloudflare/vite-plugin"];
  assert.ok(declared, "the manifest declares @cloudflare/vite-plugin");
  assert.equal(lock.packages[""]?.devDependencies?.["@cloudflare/vite-plugin"], declared, "the lockfile's root entry matches the manifest");
  assert.equal(lock.packages["node_modules/@cloudflare/vite-plugin"]?.version, declared, "the locked plugin version matches the manifest");
  assert.ok(lock.packages["node_modules/vite"]?.version, "the lockfile includes vite, which the plugin's build uses");
});

test("16 C: every root script that runs the cf CLI installs the Cloudflare app's dependencies first", () => {
  const scripts = readJson("package.json").scripts as Record<string, string>;
  const cfScripts = Object.entries(scripts).filter(([, command]) => /\bcf\b/.test(command));
  assert.ok(cfScripts.length >= 6, "the worker scripts are present");
  for (const [name, command] of cfScripts) {
    assert.ok(command.startsWith("node scripts/ensure-worker-deps.mjs && "), `${name} must run the dependency install before cf`);
  }
});

test("16 C: the dependency install uses the committed lockfile and writes nothing outside the repository", () => {
  const source = readFileSync(`${root}scripts/ensure-worker-deps.mjs`, "utf8");
  assert.match(source, /\["ci", "--prefix", app/, "the install is npm ci from the app's own lockfile");
  assert.doesNotMatch(source, /symlink|symlinkSync|linkSync|copyFileSync/, "no symlink or copy of a machine-specific path");
  assert.doesNotMatch(source, /\/home\/|C:\\\\/, "no machine-specific path");
});
