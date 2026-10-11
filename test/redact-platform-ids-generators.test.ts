import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ID_KEY_GENERATOR_ALIASES,
  PLATFORM_ID_CONSCIOUSLY_EXCLUDED,
  PLATFORM_ID_PREFIXES_BY_KEY
} from "../packages/platform-core/src/redaction.js";
import { sourceFiles } from "./helpers/platform-id-fixtures.js";

// ADR 0075 & Issue 50. The exemption table is checked against the generator call sites in domains/, packages/ and apps/,
// not against a hand-typed copy. Generator sites are `<lhs> = \`<prefix>-${randomUUID()}\`` or `<lhs>: \`...\``.
// Audited keys are read from the brace-matched literals of every audit.record / telemetry.track / trackTransition call.

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = ["domains", "packages", "apps"].flatMap((area) => sourceFiles(join(root, area))).map((file) => ({
  file,
  text: readFileSync(file, "utf8")
}));

interface GeneratorSite {
  lhs: string;
  prefix: string;
  file: string;
}

function generatorSites(): GeneratorSite[] {
  const generator = /(\w+)\s*(?::|=)\s*`([a-z][a-z-]*)-\$\{(?:[\w.]+\.)?(?:randomUUID|idFactory)\(\)\}`/g;
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(generator)].map((match) => ({ lhs: match[1]!, prefix: match[2]!, file }))
  );
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
    if (!audited.has(site.lhs)) continue;
    const tabled = PLATFORM_ID_PREFIXES_BY_KEY[site.lhs]?.includes(site.prefix) ?? false;
    const exclusion = excluded.some((entry) => entry.key === site.lhs && entry.prefix === site.prefix);
    if (!tabled && !exclusion) missing.push(`${site.lhs}: ${site.prefix}- (${site.file})`);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("Every consciously excluded (key, prefix) pair has a stated reason and a generator in the source", () => {
  for (const entry of excluded) {
    assert.ok(entry.reason.length > 40, `${entry.key}/${entry.prefix} needs a reason`);
    assert.ok(sites.some((site) => site.prefix === entry.prefix), `excluded prefix ${entry.prefix} has no generator`);
  }
});

test("Every prefix in the exemption table is emitted by a platform id generator in the source", () => {
  const generated = new Set(sites.map((site) => site.prefix));
  const tabled = new Set(Object.values(PLATFORM_ID_PREFIXES_BY_KEY).flat());
  for (const prefix of tabled) assert.ok(generated.has(prefix), `prefix ${prefix} has no generator`);
});
