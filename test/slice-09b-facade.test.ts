import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Slice 09b finishes the façade: no application exposes a manager and no production file
// reaches through `.manager.`.

const appsRoot = fileURLToPath(new URL("../apps", import.meta.url));
const webSourceRoot = fileURLToPath(new URL("../apps/web/src", import.meta.url));

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

test("AC1: no class in apps/web/src exposes a readonly manager", () => {
  const offenders: string[] = [];
  for (const file of walk(webSourceRoot)) {
    if (!file.endsWith(".ts")) continue;
    // A `readonly manager` inside an `*Options` interface is constructor injection, not a class property.
    const exposed = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .some((line) => /\breadonly manager\b/.test(line) && !/\binterface\b/.test(line));
    if (exposed) offenders.push(path.relative(webSourceRoot, file));
  }
  assert.deepEqual(offenders, []);
});

test("AC2: no `.manager.` reach-through remains in apps/ (non-test)", () => {
  const offenders: string[] = [];
  for (const file of walk(appsRoot)) {
    if (!file.endsWith(".ts")) continue;
    const relative = path.relative(appsRoot, file);
    if (relative.split(path.sep).includes("test")) continue;
    if (/\.manager\./.test(readFileSync(file, "utf8"))) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});
