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

const ADAPTERS: readonly string[] = [
  "apps/web-agent/src/catalogues/weaver-catalogues.ts",
  "apps/local-guest/src/catalogue-renderers.ts",
];

/** Files that import both the library and a Weaver package, as repository-relative forward-slash paths. */
async function filesPairingKitWithWeaver(root: string, files: readonly string[]): Promise<string[]> {
  const pairing: string[] = [];
  for (const file of files) {
    const specifiers = specifiersIn(await readFile(file, "utf8"));
    const kit = specifiers.some((specifier) => /(?:^|\/)surface-kit(?:\/|$)/.test(specifier));
    const weaver = specifiers.some((specifier) => /^@(?:cylayo\/weaver-|weaver\/)/.test(specifier));
    if (kit && weaver) pairing.push(path.relative(root, file).split(path.sep).join("/"));
  }
  return pairing.sort();
}

test("AC7 - only the two adapter modules pair surface-kit with Weaver outside tests", async () => {
  const files: string[] = [];
  for (const area of ["apps", "domains", "packages", "scripts"]) {
    files.push(...(await sourceFiles(path.join(repositoryRoot, area))).filter((file) => /\.(?:ts|tsx|mts|mjs)$/.test(file)));
  }
  const pairing = await filesPairingKitWithWeaver(repositoryRoot, files);
  assert.deepEqual(pairing, [...ADAPTERS].sort(), "exactly the two adapters pair the library with Weaver");
});

test("AC7 - the pairing scan flags a module that imports both the library and Weaver", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "surface-kit-pairing-"));
  try {
    await mkdir(path.join(root, "apps"));
    await writeFile(path.join(root, "apps", "both.ts"), 'import { x } from "../packages/surface-kit/src/index.js";\nimport { y } from "@cylayo/weaver-web";\nexport { x, y };\n');
    await writeFile(path.join(root, "apps", "kit-only.ts"), 'import { x } from "../packages/surface-kit/src/index.js";\nexport { x };\n');
    await writeFile(path.join(root, "apps", "weaver-only.ts"), 'import { y } from "@cylayo/weaver-core";\nexport { y };\n');
    assert.deepEqual(await filesPairingKitWithWeaver(root, await sourceFiles(root)), ["apps/both.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
