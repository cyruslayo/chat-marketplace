import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { A2UI_V091_BASIC_CATALOG_ID } from "@cylayo/weaver-core";
import { Window } from "happy-dom";
import { createGuestWebRuntime, createShortletWebRuntime } from "../apps/local-guest/src/shortlet-runtime.js";
import { basicEquivalentCatalogue, catalogueIds, composeWeaverCatalogue } from "../apps/web-agent/src/catalogues/weaver-catalogues.js";
import { COMMERCE_CATALOGS } from "../apps/web-agent/src/commerce-catalogs.js";
import {
  SHORTLET_BOOKING_CATALOG_ID,
  SHORTLET_COMPOSED_CATALOGUES,
  SHORTLET_DISCOVERY_CATALOG_ID,
} from "../apps/web-agent/src/shortlet-catalogs.js";
import { CatalogueRegistry } from "../packages/platform-core/src/index.js";
import { PROBE_CATALOGUE_ID, PROBE_MANIFEST } from "./fixtures/surface-kit/probe-manifest.js";
import { sourceFiles } from "./helpers/source-files.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const probe = composeWeaverCatalogue(PROBE_MANIFEST);

/** Whether a runtime accepts `createSurface` for the catalogue id; the registry refuses an unregistered id. */
function accepts(runtime: ReturnType<typeof createGuestWebRuntime>, catalogId: string, index: number): boolean {
  return runtime.runtime.process({ version: "v0.9.1", createSurface: { surfaceId: `probe-${index}`, catalogId } }).ok;
}

test("AC1 - createGuestWebRuntime registers exactly the given catalogues and their renderers, and throws on a duplicate id", () => {
  const runtime = createGuestWebRuntime({ catalogues: [probe.composed] });
  assert.equal(accepts(runtime, PROBE_CATALOGUE_ID, 0), true);
  assert.equal(accepts(runtime, A2UI_V091_BASIC_CATALOG_ID, 1), true, "the Basic catalogue is always present");
  assert.equal(accepts(runtime, SHORTLET_DISCOVERY_CATALOG_ID, 2), false, "a catalogue that was not given is refused");
  assert.equal(accepts(runtime, SHORTLET_BOOKING_CATALOG_ID, 3), false);

  // The alias renderer is registered: a probe surface validates and mounts.
  const messages = [
    { version: "v0.9.1" as const, createSurface: { surfaceId: "probe-mount", catalogId: PROBE_CATALOGUE_ID } },
    {
      version: "v0.9.1" as const,
      updateComponents: {
        surfaceId: "probe-mount",
        components: [{ id: "root", component: "ProbeOtherCard", title: "Probe", primaryActionLabel: "Open", primaryAction: { event: { name: "probe_open" } } }],
      },
    },
  ];
  for (const message of messages) assert.equal(runtime.runtime.process(message as never).ok, true);
  const target = new Window().document.createElement("div") as unknown as Element;
  assert.equal(runtime.mount({ surfaceId: "probe-mount", target }).ok, true);
  assert.match(target.textContent ?? "", /Probe/);

  const noCatalogues = createGuestWebRuntime({ catalogues: [] });
  assert.equal(accepts(noCatalogues, PROBE_CATALOGUE_ID, 0), false, "no catalogues given, none registered");

  assert.throws(() => createGuestWebRuntime({ catalogues: [probe.composed, probe.composed] }), /Duplicate catalogue id/);
  assert.throws(() => createGuestWebRuntime({ catalogues: [...SHORTLET_COMPOSED_CATALOGUES, SHORTLET_COMPOSED_CATALOGUES[0]!] }), /Duplicate catalogue id/);
});

test("AC2 - createShortletWebRuntime accepts exactly the shortlet ids and refuses a commerce surface", () => {
  const runtime = createShortletWebRuntime();
  assert.equal(accepts(runtime, SHORTLET_DISCOVERY_CATALOG_ID, 0), true);
  assert.equal(accepts(runtime, SHORTLET_BOOKING_CATALOG_ID, 1), true);
  for (const [index, commerce] of COMMERCE_CATALOGS.entries()) {
    assert.equal(accepts(runtime, commerce.catalogId, 10 + index), false, `${commerce.catalogId} is refused with commerce off (ADR 0104)`);
  }
  assert.equal(accepts(runtime, PROBE_CATALOGUE_ID, 20), false);
});

test("AC3 - the commerce-enabled runtime built from explicit catalogues accepts every commerce surface message", () => {
  const catalogues = [...SHORTLET_COMPOSED_CATALOGUES, ...COMMERCE_CATALOGS.map(basicEquivalentCatalogue)];
  const runtime = createGuestWebRuntime({ catalogues });
  for (const [index, commerce] of COMMERCE_CATALOGS.entries()) {
    assert.equal(accepts(runtime, commerce.catalogId, index), true, commerce.catalogId);
  }
  assert.equal(accepts(runtime, SHORTLET_DISCOVERY_CATALOG_ID, 9), true, "shortlet catalogues stay registered");
  // The full ADR 0103 surface check lives in test/commerce-switch-catalogues.test.ts and test/commerce-agent-tools.test.ts.
});

test("AC4 - ShortletWebRuntimeOptions no longer has commerce, and no guest runtime factory is passed commerce: true", async () => {
  // @ts-expect-error `commerce` is not an option any more
  createShortletWebRuntime({ commerce: true });
  const offenders: string[] = [];
  for (const area of ["apps", "test", "scripts"]) {
    for (const file of await sourceFiles(path.join(root, area))) {
      if (!/\.(?:ts|tsx|mts|mjs)$/.test(file) || file.includes(`${path.sep}dist${path.sep}`)) continue;
      if (file.endsWith("guest-web-runtime.test.ts")) continue;
      const text = await readFile(file, "utf8");
      if (/create(?:Shortlet|Guest)WebRuntime\(\s*\{[^}]*\bcommerce\s*:/s.test(text)) offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
  const runtimeSource = await readFile(path.join(root, "apps", "local-guest", "src", "shortlet-runtime.ts"), "utf8");
  assert.ok(!/commerce-catalogs/.test(runtimeSource), "the runtime module no longer imports the commerce catalogues");
});

test("AC5 - the id set a CatalogueRegistry gets from catalogueIds(SHORTLET_COMPOSED_CATALOGUES) equals the custom id set the runtime accepts", () => {
  const registry = new CatalogueRegistry();
  registry.register("shortlet", catalogueIds(SHORTLET_COMPOSED_CATALOGUES));
  const runtime = createShortletWebRuntime();
  const candidates = [
    ...registry.ids(),
    A2UI_V091_BASIC_CATALOG_ID,
    ...COMMERCE_CATALOGS.map(({ catalogId }) => catalogId),
    PROBE_CATALOGUE_ID,
    "discovery/v1",
    "urn:chat-marketplace:shortlet/unapproved/v1",
  ];
  const accepted = candidates.filter((id, index) => accepts(runtime, id, index) && id !== A2UI_V091_BASIC_CATALOG_ID);
  assert.deepEqual([...new Set(accepted)].sort(), [...registry.ids()].sort());
  assert.deepEqual([...registry.ids()].sort(), [SHORTLET_BOOKING_CATALOG_ID, SHORTLET_DISCOVERY_CATALOG_ID].sort());
  for (const id of registry.ids()) assert.equal(registry.ownerOf(id), "shortlet");
  assert.equal(registry.has(PROBE_CATALOGUE_ID), false);
  assert.throws(() => catalogueIds([...SHORTLET_COMPOSED_CATALOGUES, ...SHORTLET_COMPOSED_CATALOGUES]), /Duplicate catalogue id/);
});
