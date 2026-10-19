import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ID_KEY_GENERATOR_ALIASES,
  PLATFORM_ID_CONSCIOUSLY_EXCLUDED,
  PLATFORM_ID_PREFIXES_BY_KEY
} from "../packages/platform-core/src/redaction.js";
import { sourceFiles } from "./helpers/platform-id-fixtures.js";

// ADR 0075 & Issue 50. The exemption table is checked against the generator call sites in domains/, packages/ and apps/.
// TypeScript 7 exposes no JS compiler API and no parser is a dependency, so sites are found by text: a template literal
// `<prefix>-${randomUUID()}` (or idFactory) is resolved to the name it is assigned to by a bracket-aware scan backwards:
// `name =`, `name:`, through ternary branches and `??`/`||`. A site inside call arguments has no resolved name (lhs null).
// Audited keys are read from the brace-matched literals of every audit.record / telemetry.track / trackTransition call.

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = ["domains", "packages", "apps"].flatMap((area) => sourceFiles(join(root, area))).map((file) => ({
  // Exclusion records use repository-style paths; normalize Windows separators before comparing them.
  file: relative(root, file).replaceAll("\\", "/"),
  text: readFileSync(file, "utf8")
}));

interface GeneratorSite {
  lhs: string | null;
  prefix: string;
  file: string;
  // True for generatePlatformId calls (regenerate on the card-shape gate); false for a bare template generator.
  helper: boolean;
}

const TEMPLATE = /`([a-z][a-z-]*)-\$\{(?:[\w.]+\.)?(?:randomUUID|idFactory)\(\)\}/g;
// The shared helper (packages/platform-core/src/platform-id.ts): generatePlatformId("<prefix>" ...) at the call site.
const HELPER_CALL = /generatePlatformId\(\s*"([a-z][a-z-]*)"/g;

function identifierBefore(text: string, index: number): string | null {
  const match = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, index - 200), index));
  return match ? match[1]! : null;
}

// Name the template at `index` is assigned to, or null when it sits in call arguments or another non-assignment position.
function assignedName(text: string, index: number): string | null {
  let depth = 0;
  for (let position = index - 1; position >= 0 && index - position < 400; position -= 1) {
    const char = text[position]!;
    if (char === ")" || char === "]") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) return null;
      depth += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      if (depth === 0) return null;
      depth -= 1;
      continue;
    }
    if (depth > 0 || char === "?") continue;
    if (char === ";") return null;
    if (char === "=" && !"=!<>".includes(text[position - 1] ?? "") && text[position + 1] !== "=" && text[position + 1] !== ">") {
      return identifierBefore(text, position);
    }
    if (char === ":" && text[position - 1] !== ":" && text[position + 1] !== ":") {
      return identifierBefore(text, position);
    }
  }
  return null;
}

function generatorSites(): GeneratorSite[] {
  return sources.flatMap(({ file, text }) => {
    if (!text.includes("randomUUID") && !text.includes("idFactory") && !text.includes("generatePlatformId")) return [];
    // Matches on comment lines (JSDoc or line comments that describe the pattern) are documentation, not generators.
    const onCodeLine = (index: number) => {
      const lineStart = text.lastIndexOf("\n", index - 1) + 1;
      const lineEnd = text.indexOf("\n", index);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trimStart();
      return !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*");
    };
    const templates = [...text.matchAll(TEMPLATE)].filter((match) => onCodeLine(match.index)).map((match) => ({ index: match.index, prefix: match[1]!, helper: false }));
    const helperCalls = [...text.matchAll(HELPER_CALL)].filter((match) => onCodeLine(match.index)).map((match) => ({ index: match.index, prefix: match[1]!, helper: true }));
    return [...templates, ...helperCalls].map((site) => ({
      lhs: assignedName(text, site.index),
      prefix: site.prefix,
      file,
      helper: site.helper
    }));
  });
}

// Top-level keys of every object literal passed to an audit or telemetry record/track call.
function auditedKeys(): Set<string> {
  const keys = new Set<string>();
  const call = /\b\w*(?:[aA]udit|[tT]elemetry)\w*\??\.(?:record|track|trackTransition)\(\s*\{/g;
  for (const { text } of sources) {
    for (const match of text.matchAll(call)) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let end = open;
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = text.slice(open + 1, end);
      let segment = "";
      let level = 0;
      for (const char of `${body},`) {
        if ("{[(".includes(char)) level += 1;
        else if ("}])".includes(char)) level -= 1;
        if (char === "," && level === 0) {
          const key = /^([A-Za-z_]\w*)\s*(?::|$)/.exec(segment.trim());
          if (key) keys.add(key[1]!);
          segment = "";
        } else {
          segment += char;
        }
      }
    }
  }
  return keys;
}

const sites = generatorSites();
const excluded = PLATFORM_ID_CONSCIOUSLY_EXCLUDED;

test("The generator extraction resolves the principalId ternary at guest-server.ts to principalId with prefix guest", () => {
  assert.ok(
    sites.some((site) => site.lhs === "principalId" && site.prefix === "guest" && site.file.endsWith("apps/local-guest/src/guest-server.ts")),
    "principalId ternary site not found"
  );
});

test("Every (key, prefix) pair in the exemption table has a generator call site that assigns that prefix to that key or its alias", () => {
  for (const [key, prefixes] of Object.entries(PLATFORM_ID_PREFIXES_BY_KEY)) {
    if (key === "aggregateId") continue; // derived union; checked by the source-prefix test below
    const lhs = ID_KEY_GENERATOR_ALIASES[key] ?? key;
    for (const prefix of prefixes) {
      assert.ok(
        sites.some((site) => site.lhs === lhs && site.prefix === prefix),
        `no generator assigns ${prefix}- to ${lhs} (table key ${key})`
      );
    }
  }
});

test("Every audited key that receives a prefixed randomUUID generator is tabled for that prefix or consciously excluded with a reason", () => {
  const audited = auditedKeys();
  const missing: string[] = [];
  for (const site of sites) {
    if (site.lhs === null || !audited.has(site.lhs)) continue;
    const tabled = PLATFORM_ID_PREFIXES_BY_KEY[site.lhs]?.includes(site.prefix) ?? false;
    const exclusion = excluded.some((entry) => entry.key === site.lhs && entry.prefix === site.prefix);
    if (!tabled && !exclusion) missing.push(`${site.lhs}: ${site.prefix}- (${site.file})`);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("Every consciously excluded (key, prefix) pair names its key as audited, a stated reason, and the files that emit that prefix", () => {
  const audited = auditedKeys();
  for (const entry of excluded) {
    assert.ok(audited.has(entry.key), `${entry.key} is not an audited key`);
    assert.ok(entry.reason.length > 40, `${entry.key}/${entry.prefix} needs a reason`);
    assert.ok(entry.files.length > 0, `${entry.key}/${entry.prefix} must name its files`);
    for (const file of entry.files) {
      assert.ok(
        sites.some((site) => site.file === file && site.prefix === entry.prefix),
        `${entry.key}/${entry.prefix}: ${file} has no ${entry.prefix}- generator`
      );
    }
  }
});

test("Every prefix in the exemption table is emitted by a platform id generator in the source", () => {
  const generated = new Set(sites.map((site) => site.prefix));
  const tabled = new Set(Object.values(PLATFORM_ID_PREFIXES_BY_KEY).flat());
  for (const prefix of tabled) assert.ok(generated.has(prefix), `prefix ${prefix} has no generator`);
});

// A tabled prefix generated as a call argument has no assigned key, so the redactor cannot exempt it by key. Every such
// site must be switched to generatePlatformId or be listed here with a reason. The list is empty by design.
const CALL_ARGUMENT_EXCEPTIONS: ReadonlyArray<{ readonly file: string; readonly prefix: string; readonly reason: string }> = [];

test("Every tabled prefix generated as a call argument is switched to generatePlatformId or listed as an exception", () => {
  const tabled = new Set(
    Object.entries(PLATFORM_ID_PREFIXES_BY_KEY)
      .filter(([key]) => key !== "aggregateId")
      .flatMap(([, prefixes]) => prefixes)
  );
  const offenders = sites
    .filter((site) => site.lhs === null && !site.helper && tabled.has(site.prefix))
    .filter((site) => !CALL_ARGUMENT_EXCEPTIONS.some((entry) => entry.file === site.file && entry.prefix === site.prefix))
    .map((site) => `${site.file}: ${site.prefix}-`);
  assert.deepEqual([...new Set(offenders)], []);
});
