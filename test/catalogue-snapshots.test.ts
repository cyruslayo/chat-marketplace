import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBasicWebRuntime } from "@cylayo/weaver-web";
import { Window } from "happy-dom";
import {
  canonicalJson,
  catalogueSnapshotSlug,
  classifyCatalogueChange,
  defineCatalogueManifest,
  defineSurfaceComponent,
  type ComposedCatalogue,
  type JsonObject,
  type JsonValue,
} from "../packages/surface-kit/src/index.js";
import { composeWeaverCatalogue } from "../apps/web-agent/src/catalogues/weaver-catalogues.js";
import { SHORTLET_COMPOSED_CATALOGUES } from "../apps/web-agent/src/shortlet-catalogs.js";
import { rendererRegistrationsFor } from "../apps/local-guest/src/catalogue-renderers.js";
import { mountGuestSurfaceOrFallback } from "../apps/local-guest/src/guest-surface-fallback.js";
import { PROBE_CARD, probeCardHtml, type ProbeCardProps } from "./fixtures/surface-kit/probe-card.js";
import { PROBE_CATALOGUE_ID } from "./fixtures/surface-kit/probe-manifest.js";
import { UPDATE_SNAPSHOTS_VARIABLE, checkCatalogueSnapshots } from "./helpers/catalogue-snapshots.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const COMMITTED = path.join(root, "test", "fixtures", "catalogues");

// ---- classifier fixtures -------------------------------------------------------------------------------------------

function base(): Record<string, JsonValue> {
  return {
    $id: "urn:chat-marketplace:test/classify/v1",
    components: {
      Alpha: {
        type: "object",
        properties: {
          id: { type: "string" },
          component: { const: "Alpha" },
          label: { type: "string", maxLength: 10 },
          items: { type: "array", maxItems: 4 },
          amount: { type: "number", maximum: 100 },
          tone: { enum: ["a", "b"] },
          action: { $ref: "common_types.json#/$defs/Action" },
        },
        required: ["id", "component"],
        additionalProperties: false,
      },
    },
    functions: { required: { type: "object", properties: { call: { const: "required" } } } },
    $defs: {
      anyComponent: { oneOf: [{ $ref: "#/components/Alpha" }], discriminator: { propertyName: "component" } },
      Shared: { type: "object", properties: { x: { type: "string" } } },
    },
  };
}

type Mutation = (schema: Record<string, JsonValue>) => void;
const components = (schema: Record<string, JsonValue>) => schema["components"] as Record<string, Record<string, JsonValue>>;
const alphaProperties = (schema: Record<string, JsonValue>) => components(schema)["Alpha"]!["properties"] as Record<string, Record<string, JsonValue>>;

function classify(change: Mutation) {
  const after = base();
  change(after);
  return classifyCatalogueChange(base(), after);
}

const ADDITIVE: readonly (readonly [string, Mutation, string])[] = [
  ["a new component", (s) => { components(s)["Beta"] = { type: "object", properties: { id: { type: "string" } } }; }, "/components/Beta"],
  ["a new optional property", (s) => { alphaProperties(s)["subtitle"] = { type: "string" }; }, "/components/Alpha/properties/subtitle"],
  ["an enum value appended", (s) => { (alphaProperties(s)["tone"]!["enum"] as JsonValue[]).push("c"); }, "/components/Alpha/properties/tone/enum/2"],
  ["a raised maxLength", (s) => { alphaProperties(s)["label"]!["maxLength"] = 20; }, "/components/Alpha/properties/label/maxLength"],
  ["a raised maxItems", (s) => { alphaProperties(s)["items"]!["maxItems"] = 8; }, "/components/Alpha/properties/items/maxItems"],
  ["a raised maximum", (s) => { alphaProperties(s)["amount"]!["maximum"] = 500; }, "/components/Alpha/properties/amount/maximum"],
  ["a new $defs entry", (s) => { (s["$defs"] as Record<string, JsonValue>)["Extra"] = { type: "string" }; }, "/$defs/Extra"],
  ["a new function", (s) => { (s["functions"] as Record<string, JsonValue>)["extra"] = { type: "object" }; }, "/functions/extra"],
  ["an alternative appended to the anyComponent union", (s) => { (((s["$defs"] as Record<string, Record<string, JsonValue>>)["anyComponent"]!["oneOf"]) as JsonValue[]).push({ $ref: "#/components/Beta" }); }, "/$defs/anyComponent/oneOf/1"],
];

const BREAKING: readonly (readonly [string, Mutation, string])[] = [
  ["a removed component", (s) => { delete components(s)["Alpha"]; }, "/components/Alpha"],
  ["a removed property", (s) => { delete alphaProperties(s)["label"]; }, "/components/Alpha/properties/label"],
  ["a new required entry", (s) => { (components(s)["Alpha"]!["required"] as JsonValue[]).push("label"); }, "/components/Alpha/required"],
  ["a removed enum value", (s) => { alphaProperties(s)["tone"]!["enum"] = ["a"]; }, "/components/Alpha/properties/tone/enum"],
  ["a changed type", (s) => { alphaProperties(s)["label"]!["type"] = "number"; }, "/components/Alpha/properties/label/type"],
  ["a changed const", (s) => { alphaProperties(s)["component"]!["const"] = "Renamed"; }, "/components/Alpha/properties/component/const"],
  ["a changed $ref", (s) => { alphaProperties(s)["action"]!["$ref"] = "common_types.json#/$defs/DynamicString"; }, "/components/Alpha/properties/action/$ref"],
  ["a lowered maxLength", (s) => { alphaProperties(s)["label"]!["maxLength"] = 5; }, "/components/Alpha/properties/label/maxLength"],
  ["a lowered maxItems", (s) => { alphaProperties(s)["items"]!["maxItems"] = 2; }, "/components/Alpha/properties/items/maxItems"],
  ["a lowered maximum", (s) => { alphaProperties(s)["amount"]!["maximum"] = 50; }, "/components/Alpha/properties/amount/maximum"],
  ["a changed $defs entry", (s) => { ((s["$defs"] as Record<string, Record<string, JsonValue>>)["Shared"]!["properties"] as Record<string, JsonValue>)["y"] = { type: "string" }; }, "/$defs/Shared/properties/y"],
  ["a changed functions entry", (s) => { (s["functions"] as Record<string, Record<string, JsonValue>>)["required"]!["type"] = "string"; }, "/functions/required/type"],
  ["a removed $defs entry", (s) => { delete (s["$defs"] as Record<string, JsonValue>)["Shared"]; }, "/$defs/Shared"],
  ["additionalProperties opened", (s) => { components(s)["Alpha"]!["additionalProperties"] = true; }, "/components/Alpha/additionalProperties"],
  ["a changed id", (s) => { s["$id"] = "urn:chat-marketplace:test/classify/v2"; }, "/$id"],
];

test("AC1 - classifyCatalogueChange returns identical for equal schemas and additive for each additive case, with a reason per change", () => {
  assert.deepEqual(classifyCatalogueChange(base(), base()), { kind: "identical", reasons: [] });
  for (const [name, change, pointer] of ADDITIVE) {
    const result = classify(change);
    assert.equal(result.kind, "additive", name);
    assert.ok(result.reasons.some((reason) => reason.startsWith(`${pointer}:`)), `${name}: a reason names ${pointer}, got ${JSON.stringify(result.reasons)}`);
  }
  const two = classify((s) => { alphaProperties(s)["subtitle"] = { type: "string" }; alphaProperties(s)["label"]!["maxLength"] = 99; });
  assert.equal(two.kind, "additive");
  assert.equal(two.reasons.length, 2, "one reason per change");
});

test("AC2 - classifyCatalogueChange returns breaking for each breaking case, with the JSON pointer in the reason", () => {
  for (const [name, change, pointer] of BREAKING) {
    const result = classify(change);
    assert.equal(result.kind, "breaking", name);
    assert.ok(result.reasons.some((reason) => reason.startsWith(`${pointer}:`)), `${name}: a reason names ${pointer}, got ${JSON.stringify(result.reasons)}`);
  }
  const mixed = classify((s) => { alphaProperties(s)["subtitle"] = { type: "string" }; alphaProperties(s)["label"]!["maxLength"] = 1; });
  assert.equal(mixed.kind, "breaking", "one breaking change makes the whole change breaking");
  assert.ok(mixed.reasons.every((reason) => reason.includes("maxLength")), "only the breaking reasons are listed");
  const required = classify((s) => { alphaProperties(s)["subtitle"] = { type: "string" }; (components(s)["Alpha"]!["required"] as JsonValue[]).push("subtitle"); });
  assert.equal(required.kind, "breaking", "a new property that is also required is breaking");
});

// ---- the gate ------------------------------------------------------------------------------------------------------

function probeVersion(options: { readonly version: string; readonly tweak?: (schema: Record<string, JsonValue>) => void; readonly subtitle?: boolean }) {
  const schema = structuredClone(PROBE_CARD.schema) as Record<string, JsonValue>;
  if (options.subtitle === true) (schema["properties"] as Record<string, JsonValue>)["subtitle"] = { type: "string" };
  options.tweak?.(schema);
  type Props = ProbeCardProps & { readonly subtitle?: string };
  return defineSurfaceComponent<Props>({
    name: "ProbeCard",
    version: options.version,
    tier: 2,
    schema: schema as JsonObject,
    html: (props) => probeCardHtml(props).replace("</h2>", `</h2>${props.subtitle === undefined ? "" : `<p>${props.subtitle.replace(/[&<>"']/g, "")}</p>`}`),
    text: (props) => [props.title, props.subtitle, props.badge?.label, ...(props.facts ?? []), props.primaryActionLabel]
      .filter((part): part is string => part !== undefined && part !== "")
      .join("\n"),
    fixtures: { valid: [], invalid: [] },
  });
}

function compose(id: string, component: ReturnType<typeof probeVersion>): ComposedCatalogue {
  const manifest = defineCatalogueManifest({
    id,
    owner: "test",
    base: "basic/v0.9.1",
    components: { ProbeOtherCard: { component, major: component.major } },
    actions: [],
  });
  return composeWeaverCatalogue(manifest).composed;
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "catalogue-snapshots-"));
}

const V1 = "urn:chat-marketplace:test/probe/v1";
const V2 = "urn:chat-marketplace:test/probe/v2";

test("AC3 - the snapshot test passes on the current tree with the issue-03 snapshots, unchanged", async () => {
  const before = new Map<string, string>();
  for (const name of await readdir(COMMITTED)) before.set(name, await readFile(path.join(COMMITTED, name), "utf8"));
  const update = process.env[UPDATE_SNAPSHOTS_VARIABLE] === "1";
  const result = await checkCatalogueSnapshots({ catalogues: SHORTLET_COMPOSED_CATALOGUES, directory: COMMITTED, update });
  assert.deepEqual(result.failures, []);
  // With the variable set, a deliberate rewrite (or a new major file) is the point, so the "nothing changed" checks
  // apply only to a normal run.
  if (!update) {
    assert.deepEqual(result.written, [], "a clean tree rewrites nothing");
    assert.deepEqual([...before.keys()].sort(), SHORTLET_COMPOSED_CATALOGUES.map((catalogue) => `${catalogueSnapshotSlug(catalogue.manifest.id)}.json`).sort());
    for (const [name, text] of before) assert.equal(await readFile(path.join(COMMITTED, name), "utf8"), text, `${name} is unchanged`);
  }
});

test("AC4 - a simulated additive drift fails without UPDATE_CATALOGUE_SNAPSHOTS and is rewritten with it", async () => {
  const directory = await temporaryDirectory();
  try {
    const original = compose(V1, probeVersion({ version: "1.0.0" }));
    assert.deepEqual((await checkCatalogueSnapshots({ catalogues: [original], directory, update: true })).failures, [], "the first write");
    assert.deepEqual((await checkCatalogueSnapshots({ catalogues: [original], directory, update: false })).failures, []);

    const drifted = compose(V1, probeVersion({ version: "1.1.0", subtitle: true }));
    const file = path.join(directory, `${catalogueSnapshotSlug(V1)}.json`);
    const failed = await checkCatalogueSnapshots({ catalogues: [drifted], directory, update: false });
    assert.equal(failed.failures.length, 1);
    assert.match(failed.failures[0]!, new RegExp(`${UPDATE_SNAPSHOTS_VARIABLE}=1`));
    assert.match(failed.failures[0]!, /subtitle/);
    assert.equal(await readFile(file, "utf8"), canonicalJson(original.schema), "a failed check does not rewrite");

    const updated = await checkCatalogueSnapshots({ catalogues: [drifted], directory, update: true });
    assert.deepEqual(updated.failures, []);
    assert.deepEqual(updated.written, [path.basename(file)]);
    assert.equal(await readFile(file, "utf8"), canonicalJson(drifted.schema));
    assert.deepEqual((await checkCatalogueSnapshots({ catalogues: [drifted], directory, update: false })).failures, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC5 - a simulated breaking drift under the same id major fails even with the variable set, and succeeds only under a new major id", async () => {
  const directory = await temporaryDirectory();
  try {
    const original = compose(V1, probeVersion({ version: "1.0.0" }));
    await checkCatalogueSnapshots({ catalogues: [original], directory, update: true });
    const file = path.join(directory, `${catalogueSnapshotSlug(V1)}.json`);

    const breaking = probeVersion({ version: "2.0.0", tweak: (schema) => { (schema["required"] as JsonValue[]).push("facts"); } });
    const sameMajor = await checkCatalogueSnapshots({ catalogues: [compose(V1, breaking)], directory, update: true });
    assert.equal(sameMajor.failures.length, 1, "fails with the variable set");
    assert.match(sameMajor.failures[0]!, /breaking/);
    assert.match(sameMajor.failures[0]!, /\/required/);
    assert.deepEqual(sameMajor.written, []);
    assert.equal(await readFile(file, "utf8"), canonicalJson(original.schema), "the snapshot is not rewritten");

    const composedV2 = compose(V2, breaking);
    const withoutVariable = await checkCatalogueSnapshots({ catalogues: [original, composedV2], directory, update: false });
    assert.equal(withoutVariable.failures.length, 1);
    assert.match(withoutVariable.failures[0]!, /new catalogue major/);

    const underNewMajor = await checkCatalogueSnapshots({ catalogues: [original, composedV2], directory, update: true });
    assert.deepEqual(underNewMajor.failures, []);
    assert.deepEqual(underNewMajor.written, [`${catalogueSnapshotSlug(V2)}.json`], "a new file is written next to the old one");
    assert.equal(await readFile(file, "utf8"), canonicalJson(original.schema), "the old snapshot stays");
    assert.deepEqual((await readdir(directory)).sort(), [`${catalogueSnapshotSlug(V1)}.json`, `${catalogueSnapshotSlug(V2)}.json`]);
    assert.deepEqual((await checkCatalogueSnapshots({ catalogues: [original, composedV2], directory, update: false })).failures, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC6 - an orphan snapshot file fails the test", async () => {
  const directory = await temporaryDirectory();
  try {
    const original = compose(V1, probeVersion({ version: "1.0.0" }));
    await checkCatalogueSnapshots({ catalogues: [original], directory, update: true });
    await writeFile(path.join(directory, "urn-chat-marketplace-test-retired-v1.json"), canonicalJson({ $id: "x" }));
    const result = await checkCatalogueSnapshots({ catalogues: [original], directory, update: false });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]!, /urn-chat-marketplace-test-retired-v1\.json: orphan/);
    const withVariable = await checkCatalogueSnapshots({ catalogues: [original], directory, update: true });
    assert.equal(withVariable.failures.length, 1, "the variable never deletes a snapshot");
    // A catalogue with no snapshot at all also fails without the variable.
    const empty = await temporaryDirectory();
    try {
      assert.match((await checkCatalogueSnapshots({ catalogues: [original], directory: empty, update: false })).failures[0]!, /no snapshot/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AC7 - ProbeCard 1.0.0 to 1.1.0 classifies as additive, and an old-client runtime receiving the new prop falls back to complete text", () => {
  const oldComponent = probeVersion({ version: "1.0.0" });
  const newComponent = probeVersion({ version: "1.1.0", subtitle: true });
  const oldClient = compose(PROBE_CATALOGUE_ID, oldComponent);
  const newServer = compose(PROBE_CATALOGUE_ID, newComponent);
  const change = classifyCatalogueChange(oldClient.schema, newServer.schema);
  assert.equal(change.kind, "additive");
  assert.ok(change.reasons.some((reason) => reason.startsWith("/components/ProbeOtherCard/properties/subtitle:")));

  const created = createBasicWebRuntime({
    additionalCatalogs: [{ catalogId: PROBE_CATALOGUE_ID, schema: oldClient.schema as never }],
    additionalRenderers: rendererRegistrationsFor(oldClient, () => undefined),
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const props = {
    title: "Probe title",
    subtitle: "New subtitle",
    facts: ["First fact"],
    primaryActionLabel: "Open probe",
    primaryAction: { event: { name: "probe_open" } },
  };
  const surface = (withSubtitle: boolean, surfaceId: string) => [
    { version: "v0.9.1" as const, createSurface: { surfaceId, catalogId: PROBE_CATALOGUE_ID } },
    { version: "v0.9.1" as const, updateComponents: { surfaceId, components: [{ id: "root", component: "ProbeOtherCard", ...(withSubtitle ? props : { ...props, subtitle: undefined }) }] } },
  ];
  const oldMessages = surface(false, "stale-old");
  // JSON drops `undefined`, which is what the wire carries.
  const wire = (messages: ReturnType<typeof surface>) => JSON.parse(JSON.stringify(messages)) as ReturnType<typeof surface>;
  for (const message of wire(oldMessages)) assert.equal(created.value.runtime.process(message as never).ok, true, "a message without the new prop still renders on the old client");

  const newMessages = wire(surface(true, "stale-new"));
  assert.equal(created.value.runtime.process(newMessages[0] as never).ok, true);
  assert.equal(created.value.runtime.process(newMessages[1] as never).ok, false, "the old client rejects the new prop (strict props)");

  const target = new Window().document.createElement("div") as unknown as HTMLElement;
  const fullText = newComponent.text(props as never);
  // The client (client.ts) takes this path when `runtime.process` fails: the fallback is mounted with no rich attempt.
  const result = mountGuestSurfaceOrFallback({
    attemptMount: () => ({ ok: false }),
    mount: target,
    surface: { surfaceId: "stale-new", mode: "inline-surface", status: "active", summary: "Probe", textFallback: fullText, conventionalRoute: "/conversation" },
  });
  assert.equal(result.ok, false);
  assert.equal(target.dataset["renderer"], "fallback");
  for (const part of ["Probe title", "New subtitle", "First fact", "Open probe"]) assert.ok((target.textContent ?? "").includes(part), `the fallback keeps ${part}`);
  assert.equal(target.querySelector("a")?.getAttribute("href"), "/conversation");
});
