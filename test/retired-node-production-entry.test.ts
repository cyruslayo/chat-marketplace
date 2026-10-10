import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

// Cloudflare cutover issue 17 (ADR 0095): Cloudflare is the only production host. The Node production entry
// (`pilot:start` and `apps/pilot/src/cli-start.ts`) is retired; Node stays for local development and tests.

interface PackageManifest {
  readonly scripts: Readonly<Record<string, string>>;
}

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;

const RETIRED_PATTERNS: readonly RegExp[] = [/\bpilot:start\b/, /pilot\/src\/cli-start\b/];
const SCANNED_DIRECTORIES = ["docs", "scripts", "apps", "packages", "domains"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "public", ".git", ".scratch", "vendor", "test"]);
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".tsx", ".mjs", ".js", ".cjs", ".json", ".ps1", ".sh", ".yml", ".yaml", ".csv", ".html", ".txt", ".example"]);

/** Every text file a person or script could follow: docs, scripts, app source, env templates and root Markdown. */
function instructionFiles(): readonly string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(ROOT, directory))) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(join(ROOT, path)).isDirectory()) walk(path);
      else if (TEXT_EXTENSIONS.has(extname(entry)) || entry.startsWith(".env")) files.push(path);
    }
  };
  for (const directory of SCANNED_DIRECTORIES) walk(directory);
  for (const entry of readdirSync(ROOT)) {
    if (statSync(join(ROOT, entry)).isFile() && (entry.endsWith(".md") || entry.startsWith(".env") || entry === "package.json")) files.push(entry);
  }
  return files;
}

test("AC1 — pilot:start and cli-start.ts no longer exist", () => {
  assert.equal(manifest.scripts["pilot:start"], undefined, "package.json has no pilot:start script");
  assert.equal(existsSync("apps/pilot/src/cli-start.ts"), false, "apps/pilot/src/cli-start.ts is removed");
});

test("AC1 — no doc tells anyone to run pilot:start or the removed entry", () => {
  const offenders: string[] = [];
  for (const file of instructionFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (RETIRED_PATTERNS.some((pattern) => pattern.test(line))) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], "no instruction file references the retired Node production entry");
});

test("AC3 — docs/pilot-deployment.md describes Cloudflare deployment using cf and local parity using cf dev", () => {
  const doc = readFileSync("docs/pilot-deployment.md", "utf8");
  assert.match(doc, /Cloudflare/);
  assert.match(doc, /\bcf deploy\b/, "documents a cf deploy");
  assert.match(doc, /\bcf build\b/, "documents a cf build");
  assert.match(doc, /\bcf dev\b/, "documents cf dev as the production-parity local run");
  assert.doesNotMatch(doc, /reverse proxy/i, "the Node reverse proxy is no longer described");
  assert.doesNotMatch(doc, /\bwrangler\s+(?:dev|deploy|build|secret|types|versions|publish|login|whoami|tail)\b/i, "no Wrangler command is documented outside a confirmed beta gap");
});

test("AC2 — pilot:local, guest:local and owner:local still point at existing entries", () => {
  const entries: Readonly<Record<string, string>> = {
    "pilot:local": "apps/pilot/src/cli-local-start.ts",
    "guest:local": "apps/local-guest/src/cli-start.ts",
    "owner:local": "apps/local-owner/src/cli-start.ts",
  };
  for (const [script, entry] of Object.entries(entries)) {
    assert.ok(manifest.scripts[script]?.includes(entry), `${script} runs ${entry}`);
    assert.ok(existsSync(entry), `${entry} exists`);
  }
});

test("AGENTS.md Tech Stack & Tooling names npm run test:workers", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  const techStack = agents.slice(agents.indexOf("### Tech Stack & Tooling"), agents.indexOf("### Issue tracker"));
  assert.match(techStack, /npm run test:workers/);
});
