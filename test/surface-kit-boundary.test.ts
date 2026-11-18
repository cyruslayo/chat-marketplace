import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sourceFiles } from "./helpers/source-files.js";
import { specifiersIn } from "./helpers/import-closure.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const kitSource = path.join(repositoryRoot, "packages", "surface-kit", "src");

/**
 * Every import in a file that leaves its own source folder. The library may import only files inside itself: a bare
 * specifier (Weaver, `node:*`, any package) and any relative specifier that resolves outside the folder (domains,
 * apps, platform-core) are violations (ADR 0081, ADR 0108 decision 5).
 */
async function importsOutside(root: string, files: readonly string[]): Promise<string[]> {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of specifiersIn(await readFile(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        violations.push(`${path.relative(root, file)} -> ${specifier}`);
      } else if (path.relative(root, path.resolve(path.dirname(file), specifier)).startsWith("..")) {
        violations.push(`${path.relative(root, file)} -> ${specifier}`);
      }
    }
  }
  return violations;
}

test("AC7 - no file under packages/surface-kit/src imports domains, apps, platform-core or Weaver", async () => {
  const files = (await sourceFiles(kitSource)).filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
  assert.ok(files.length >= 5, "the scan finds the library files");
  assert.deepEqual(await importsOutside(kitSource, files), []);
});

test("AC7 - the scanner catches relative, bare and Weaver imports that leave the library", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surface-kit-boundary-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "ok.ts"), 'import { a } from "./other.js";\nexport { a };\n');
    await writeFile(path.join(root, "src", "domain.ts"), 'import { x } from "../../../domains/shortlet/src/browse.js";\nexport { x };\n');
    await writeFile(path.join(root, "src", "platform.ts"), 'export * from "../../platform-core/src/surface.js";\n');
    await writeFile(path.join(root, "src", "weaver.ts"), 'import { y } from "@cylayo/weaver-core";\nimport("@weaver/core");\nexport { y };\n');
    const src = path.join(root, "src");
    const violations = await importsOutside(src, await sourceFiles(src));
    assert.equal(violations.length, 4);
    assert.ok(violations.some((line) => line.includes("domain.ts")));
    assert.ok(violations.some((line) => line.includes("platform.ts")));
    assert.ok(violations.some((line) => line.includes("@cylayo/weaver-core")));
    assert.ok(violations.some((line) => line.includes("@weaver/core")));
    assert.ok(!violations.some((line) => line.includes("ok.ts")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
