import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Issue 08 (state-machines PRD, Track B): SurfaceLifecycleStatus has one declaration, in platform-core's surface.ts.
// The browser-bundled conversational shell may only re-export the type; a runtime import would pull surface.ts into client.ts.
// ADR 0074 governs the lifecycle; this file changes no behaviour.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const scannedFolders = [
  "domains/shortlet/src",
  "packages/platform-core/src",
  "apps/local-guest/src",
  "apps/web-agent/src",
] as const;
const canonicalFile = "packages/platform-core/src/surface.ts";
const shellFile = "apps/local-guest/src/conversational-shell.ts";

const typeDeclaration = /\b(?:export\s+)?type\s+SurfaceLifecycleStatus\s*=/g;
const arrayDeclaration = /\b(?:export\s+)?const\s+SURFACE_LIFECYCLE_STATUSES\s*=/g;

async function collectTypeScriptFiles(directory: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "test" || entry.name === "dist") continue;
      await collectTypeScriptFiles(file, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(file);
    }
  }
  return out;
}

async function declarationsIn(pattern: RegExp): Promise<string[]> {
  const found: string[] = [];
  for (const folder of scannedFolders) {
    for (const file of await collectTypeScriptFiles(path.join(repositoryRoot, folder))) {
      const text = await readFile(file, "utf8");
      if (pattern.test(text)) found.push(path.relative(repositoryRoot, file).replace(/\\/g, "/"));
      pattern.lastIndex = 0;
    }
  }
  return found.sort();
}

test("AC1: SurfaceLifecycleStatus is declared exactly once, in packages/platform-core/src/surface.ts", async () => {
  const typeDeclarations = await declarationsIn(typeDeclaration);
  const arrayDeclarations = await declarationsIn(arrayDeclaration);

  assert.deepEqual(typeDeclarations, [canonicalFile]);
  assert.deepEqual(arrayDeclarations, [canonicalFile]);
});

test("AC2: The client bundle builds unchanged: the conversational shell imports from platform-core only as types", async () => {
  const shellText = await readFile(path.join(repositoryRoot, shellFile), "utf8");
  const platformCoreImports = [...shellText.matchAll(/^(?:import|export)\s[^;]*?from\s+["'][^"']*platform-core[^"']*["'];?/gms)].map(
    (match) => match[0],
  );

  assert.ok(platformCoreImports.length >= 1, "the shell re-exports SurfaceLifecycleStatus from platform-core");
  for (const statement of platformCoreImports) {
    assert.match(statement, /^(?:import|export)\s+type[\s{*]/, `runtime import or re-export from platform-core in the browser shell: ${statement}`);
  }
  assert.doesNotMatch(shellText, /SURFACE_LIFECYCLE_STATUSES/, "the browser shell must not reference the runtime array");
});
