import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Launch-readiness issue 16: a production install (`npm ci` with NODE_ENV=production skips devDependencies)
// must still be able to build and start the pilot.

interface PackageManifest {
  readonly engines?: { readonly node?: string };
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { readonly packages: Readonly<Record<string, { readonly dev?: boolean }>> };
const buildClientSource = readFileSync("apps/local-guest/scripts/build-client.mjs", "utf8");

/** The executable each `&&` step of an npm script runs, e.g. "tsx" or "node". */
function scriptExecutables(script: string): readonly string[] {
  return script.split("&&").map((step) => step.trim().split(/\s+/)[0]!);
}

/** Bare package specifiers a script imports, e.g. "esbuild". */
function importedPackages(source: string): readonly string[] {
  return [...source.matchAll(/from\s+["']([^"'./][^"']*)["']/g)].map((match) => match[1]!).filter((name) => !name.startsWith("node:"));
}

function assertRuntimeDependency(name: string, context: string): void {
  assert.ok(Object.hasOwn(manifest.dependencies, name), `${name} (${context}) must be a runtime dependency, not a devDependency`);
  assert.notEqual(lock.packages[`node_modules/${name}`]?.dev, true, `${name} must not be marked dev in package-lock.json`);
}

test("A production install followed by the documented build and start commands starts the pilot", () => {
  for (const scriptName of ["build", "pilot:start"]) {
    const script = manifest.scripts[scriptName];
    assert.ok(script, `${scriptName} script exists`);
    for (const executable of scriptExecutables(script)) {
      if (executable === "node") continue;
      assertRuntimeDependency(executable, `runs ${scriptName}`);
    }
  }
  for (const name of importedPackages(buildClientSource)) assertRuntimeDependency(name, "imported by the client build");
  // Control: type checking is a development task and stays out of the production install.
  assert.ok(Object.hasOwn(manifest.devDependencies, "typescript"));
});

test("A build script rebuilds the guest client bundle as part of the production build", () => {
  assert.equal(manifest.scripts.build, "node apps/local-guest/scripts/build-client.mjs");
  assert.match(buildClientSource, /entryPoints:\s*\[\s*"apps\/local-guest\/src\/client\.ts"\s*\]/);
  assert.match(buildClientSource, /outfile:\s*"apps\/local-guest\/dist\/client\.js"/);
});

test("package.json declares engines.node for a version with node:sqlite, and .nvmrc matches", () => {
  const range = manifest.engines?.node;
  assert.equal(range, ">=22.13.0", "node:sqlite is available without a flag from Node 22.13.0");
  const pinned = readFileSync(".nvmrc", "utf8").trim();
  const [major, minor] = pinned.split(".").map(Number);
  assert.ok(major! > 22 || (major === 22 && minor! >= 13), `.nvmrc ${pinned} satisfies ${range}`);
});

test(".scratch/pilot-rehearsal-* is in .gitignore, so the rehearsal certificates and databases cannot be committed by accident", () => {
  for (const path of [".scratch/pilot-rehearsal-20260921/localhost.pfx", ".scratch/pilot-rehearsal-20261101/pilot.sqlite"]) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", path]);
    assert.equal(result.status, 0, `${path} is ignored`);
  }
  // Control: other scratch work is not swept up by the rule.
  assert.notEqual(spawnSync("git", ["check-ignore", "--no-index", "--quiet", ".scratch/pilot-launch-readiness/map.md"]).status, 0);
});
