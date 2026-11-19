import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { A2UI_V091_BASIC_CATALOG_ID } from "@cylayo/weaver-core";
import { surfaceMessages } from "../apps/web-agent/src/a2ui-surface.js";
import { unitDetailArtifactToA2UI } from "../apps/web-agent/src/unit-detail-a2ui.js";
import { quotedUnitDetailArtifact } from "./helpers/unit-detail-fixture.js";

/** Weaver catalogues issue 02 (ADR 0073, ADR 0081): every A2UI envelope under apps/ is built by Weaver's producer. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("AC2: no file under apps/ builds a createSurface, updateComponents, updateDataModel or deleteSurface envelope as an object literal", async () => {
  const offenders: string[] = [];
  for (const path of await sourceFiles(join(ROOT, "apps"))) {
    const source = await readFile(path, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (/\b(?:createSurface|updateComponents|updateDataModel|deleteSurface)\s*:\s*\{/.test(line)) offenders.push(`${path.slice(ROOT.length)}:${index + 1}`);
    }
  }
  assert.deepEqual(offenders, [], "envelopes come from A2UI_PRODUCER / surfaceMessages (apps/web-agent/src/a2ui-surface.ts)");
});

test("AC1: surfaceMessages returns the frozen create and update pair the builders emitted before", () => {
  const components = [{ id: "root", component: "Text", text: "Hello" }] as const;
  const messages = surfaceMessages("surface-1", A2UI_V091_BASIC_CATALOG_ID, components);
  assert.deepEqual(messages, [
    { version: "v0.9.1", createSurface: { surfaceId: "surface-1", catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId: "surface-1", components: [{ id: "root", component: "Text", text: "Hello" }] } },
  ]);
  assert.equal(Object.isFrozen(messages), true);
  assert.notEqual(messages[1].updateComponents.components[0], components[0], "the producer owns a copy of the caller's components");
});

test("AC3: surfaceMessages throws on an invalid envelope, such as an empty surfaceId or catalogId", () => {
  assert.throws(() => surfaceMessages("", A2UI_V091_BASIC_CATALOG_ID, [{ id: "root", component: "Text", text: "x" }]), TypeError);
  assert.throws(() => surfaceMessages("surface-1", "", [{ id: "root", component: "Text", text: "x" }]), TypeError);
  assert.throws(() => surfaceMessages("surface-1", A2UI_V091_BASIC_CATALOG_ID, [{ id: "root", component: "Text", text: "x", size: Number.NaN }]), TypeError);
});

test("AC3: a builder given a fixture with a missing surface id fails loudly instead of emitting a malformed surface", () => {
  assert.throws(() => unitDetailArtifactToA2UI({ artifact: quotedUnitDetailArtifact(), surfaceId: "" }), TypeError);
  assert.equal(unitDetailArtifactToA2UI({ artifact: quotedUnitDetailArtifact(), surfaceId: "unit-detail-ok" }).length, 2);
});
