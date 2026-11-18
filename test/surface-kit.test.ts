import assert from "node:assert/strict";
import test from "node:test";
import { createBasicCatalogV091Registration } from "@cylayo/weaver-core";
import {
  canonicalJson,
  catalogueIds,
  catalogueSnapshotSlug,
  composeCatalogueSchema,
  defineCatalogueManifest,
  defineSurfaceComponent,
  findGlossaryTerms,
  type CatalogueManifestInput,
  type JsonObject,
  type JsonValue,
  type SurfaceComponentInput,
} from "../packages/surface-kit/src/index.js";
import {
  PROBE_CARD,
  PROBE_CARD_OPTIONAL,
  PROBE_CARD_REQUIRED,
  probeCardHtml,
  probeCardText,
  type ProbeCardProps,
} from "./fixtures/surface-kit/probe-card.js";
import { assertPropsMatchSchema } from "./helpers/surface-kit-props.js";

const BASE = createBasicCatalogV091Registration().schema as JsonObject;

function deepFreezeCopy<T extends JsonValue>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (typeof node === "object" && node !== null) {
      Object.freeze(node);
      for (const child of Object.values(node)) freeze(child);
    }
  };
  freeze(copy);
  return copy;
}

function probeInput(overrides: Partial<SurfaceComponentInput<ProbeCardProps>> = {}): SurfaceComponentInput<ProbeCardProps> {
  return {
    name: "ProbeCard",
    version: "1.0.0",
    tier: 2,
    schema: PROBE_CARD.schema,
    html: probeCardHtml,
    text: probeCardText,
    fixtures: { valid: PROBE_CARD.fixtures.valid, invalid: PROBE_CARD.fixtures.invalid },
    ...overrides,
  };
}

function withSchema(change: (schema: Record<string, JsonValue>) => void): JsonObject {
  const schema = structuredClone(PROBE_CARD.schema) as Record<string, JsonValue>;
  change(schema);
  return schema;
}

function manifest(overrides: Partial<CatalogueManifestInput> = {}): CatalogueManifestInput {
  return {
    id: "urn:chat-marketplace:test/probe/v1",
    owner: "test",
    base: "basic/v0.9.1",
    components: { ProbeStayCard: { component: PROBE_CARD, major: 1 } },
    actions: ["probe_open"],
    ...overrides,
  };
}

test("the fixture component's Props interface equals its schema", () => {
  assertPropsMatchSchema<ProbeCardProps, (typeof PROBE_CARD_REQUIRED)[number], (typeof PROBE_CARD_OPTIONAL)[number]>(
    PROBE_CARD.schema,
    { required: PROBE_CARD_REQUIRED, optional: PROBE_CARD_OPTIONAL },
  );
  assert.deepEqual([...PROBE_CARD.slots].sort(), ["badge", "facts"], "the optional properties are the slots");
});

test("AC1 - defineSurfaceComponent accepts a valid definition and throws for a missing or true additionalProperties, a foreign $ref, a non-semver version and a missing component property", () => {
  const defined = defineSurfaceComponent(probeInput());
  assert.ok(Object.isFrozen(defined), "the definition is frozen");
  assert.equal(defined.major, 1);

  assert.throws(() => defineSurfaceComponent(probeInput({ schema: withSchema((s) => { delete s["additionalProperties"]; }) })), /additionalProperties/);
  assert.throws(() => defineSurfaceComponent(probeInput({ schema: withSchema((s) => { s["additionalProperties"] = true; }) })), /additionalProperties/);
  assert.throws(
    () => defineSurfaceComponent(probeInput({
      schema: withSchema((s) => { (s["properties"] as Record<string, JsonValue>)["extra"] = { $ref: "https://example.com/other.json#/$defs/X" }; }),
    })),
    /\$ref/,
  );
  assert.throws(() => defineSurfaceComponent(probeInput({ version: "1.0" })), /version/);
  assert.throws(() => defineSurfaceComponent(probeInput({ version: "v1.0.0" })), /version/);
  assert.throws(
    () => defineSurfaceComponent(probeInput({ schema: withSchema((s) => { delete (s["properties"] as Record<string, JsonValue>)["component"]; }) })),
    /component property/,
  );
  assert.throws(
    () => defineSurfaceComponent(probeInput({ fixtures: { valid: [], invalid: [{ bad: undefined } as unknown as JsonValue] } })),
    /valid JSON/,
  );
});

test("AC2 - defineCatalogueManifest throws for a malformed id, a non-PascalCase, reserved or a2ui-prefixed alias, a major mismatch, an unknown or non-optional slot and duplicate actions", () => {
  assert.doesNotThrow(() => defineCatalogueManifest(manifest({ components: { ProbeStayCard: { component: PROBE_CARD, major: 1, slots: { badge: "absent" } } } })));

  for (const id of ["urn:chat-marketplace:test/probe", "urn:chat-marketplace:Test/probe/v1", "urn:chat-marketplace:test/probe/v0", "https://example.com/probe/v1"]) {
    assert.throws(() => defineCatalogueManifest(manifest({ id })), /id is malformed/, id);
  }
  for (const alias of ["probeCard", "Probe_Card", "Surface", "A2uiCard", "a2uiCard", "A2UICard"]) {
    assert.throws(() => defineCatalogueManifest(manifest({ components: { [alias]: { component: PROBE_CARD, major: 1 } } })), /Alias/, alias);
  }
  assert.throws(() => defineCatalogueManifest(manifest({ components: { ProbeStayCard: { component: PROBE_CARD, major: 2 } } })), /major/);
  assert.throws(
    () => defineCatalogueManifest(manifest({ components: { ProbeStayCard: { component: PROBE_CARD, major: 1, slots: { nightlyKobo: "absent" } } } })),
    /not an optional property/,
  );
  assert.throws(
    () => defineCatalogueManifest(manifest({ components: { ProbeStayCard: { component: PROBE_CARD, major: 1, slots: { title: "absent" } } } })),
    /not an optional property/,
    "a required property is not a slot",
  );
  assert.throws(() => defineCatalogueManifest(manifest({ actions: ["probe_open", "probe_open"] })), /duplicate/);
});

test("AC3 - composeCatalogueSchema with an empty components map returns a schema deep-equal to the base with only $id and catalogId changed, and leaves the base unchanged", () => {
  const frozen = deepFreezeCopy(BASE);
  const before = JSON.stringify(frozen);
  const empty = defineCatalogueManifest(manifest({ components: {} }));
  const composed = composeCatalogueSchema(empty, frozen);
  assert.equal(composed.schema["$id"], empty.id);
  assert.equal(composed.schema["catalogId"], empty.id);
  assert.deepEqual({ ...composed.schema, $id: BASE["$id"], catalogId: BASE["catalogId"] }, BASE);
  assert.equal(JSON.stringify(frozen), before, "the base schema is unchanged");
  assert.notEqual(composed.schema["components"], frozen["components"], "the result shares no object with the base");
  assert.deepEqual(composed.components, []);
});

test("AC4 - composing a manifest that aliases a fixture component adds the alias, removes absent slots, adds required slots and throws on a base-name collision", () => {
  const frozen = deepFreezeCopy(BASE);
  const aliased = defineCatalogueManifest(manifest({
    components: {
      ProbeStayCard: { component: PROBE_CARD, major: 1, slots: { badge: "absent", facts: "required" } },
      ProbeOtherCard: { component: PROBE_CARD, major: 1 },
    },
  }));
  const composed = composeCatalogueSchema(aliased, frozen);
  const components = composed.schema["components"] as Record<string, JsonObject>;
  const stay = components["ProbeStayCard"]!;
  const stayProperties = stay["properties"] as Record<string, JsonValue>;
  assert.deepEqual(stayProperties["component"], { const: "ProbeStayCard" });
  assert.ok(!("badge" in stayProperties), "an absent slot is removed from properties");
  assert.ok((stay["required"] as string[]).includes("facts"), "a required slot joins required");
  assert.equal(stay["additionalProperties"], false);
  const other = components["ProbeOtherCard"]!;
  assert.deepEqual((other["properties"] as Record<string, JsonValue>)["component"], { const: "ProbeOtherCard" });
  assert.ok("badge" in (other["properties"] as object), "an optional slot stays");
  assert.ok(!(other["required"] as string[]).includes("facts"));
  assert.equal(JSON.stringify(PROBE_CARD.schema).includes("ProbeStayCard"), false, "the definition itself is not changed");
  const union = ((composed.schema["$defs"] as Record<string, JsonObject>)["anyComponent"]!["oneOf"]) as JsonObject[];
  assert.ok(union.some((entry) => entry["$ref"] === "#/components/ProbeStayCard"), "the alias joins the anyComponent union");
  assert.deepEqual(composed.components.map((entry) => entry.alias), ["ProbeStayCard", "ProbeOtherCard"]);

  const collides = defineCatalogueManifest(manifest({ components: { Row: { component: PROBE_CARD, major: 1 } } }));
  assert.throws(() => composeCatalogueSchema(collides, BASE), /collides/);

  const unresolved = defineSurfaceComponent(probeInput({
    schema: withSchema((s) => { (s["properties"] as Record<string, JsonValue>)["extra"] = { $ref: "common_types.json#/$defs/NoSuchType" }; }),
  }));
  assert.throws(
    () => composeCatalogueSchema(defineCatalogueManifest(manifest({ components: { ProbeStayCard: { component: unresolved, major: 1 } } })), BASE),
    /does not resolve/,
  );
});

test("AC5 - catalogueIds returns ids in order and throws on a duplicate id", () => {
  const first = composeCatalogueSchema(defineCatalogueManifest(manifest({ id: "urn:chat-marketplace:test/one/v1", components: {} })), BASE);
  const second = composeCatalogueSchema(defineCatalogueManifest(manifest({ id: "urn:chat-marketplace:test/two/v1", components: {} })), BASE);
  assert.deepEqual(catalogueIds([first, second]), ["urn:chat-marketplace:test/one/v1", "urn:chat-marketplace:test/two/v1"]);
  assert.deepEqual(catalogueIds([second, first]), ["urn:chat-marketplace:test/two/v1", "urn:chat-marketplace:test/one/v1"]);
  assert.throws(() => catalogueIds([first, second, first]), /Duplicate catalogue id/);
});

test("AC6 - findGlossaryTerms finds a camelCase property and an enum value from the term list and returns nothing for a neutral schema", () => {
  const leaky: JsonObject = {
    type: "object",
    properties: {
      nightlyKobo: { type: "integer" },
      mode: { enum: ["stay", "list"] },
    },
  };
  const hits = findGlossaryTerms(leaky, ["Kobo", "stay"]);
  assert.deepEqual(hits.map((hit) => [hit.kind, hit.value, hit.term]), [["property", "nightlyKobo", "kobo"], ["enum", "stay", "stay"]]);
  assert.equal(hits[0]!.pointer, "/properties/nightlyKobo");
  assert.equal(hits[1]!.pointer, "/properties/mode/enum/0");
  assert.deepEqual(findGlossaryTerms(PROBE_CARD.schema, ["kobo", "stay", "apartment"]), []);
  assert.deepEqual(findGlossaryTerms(leaky, []), []);
});

test("canonicalJson sorts keys at every depth with two-space indent, LF and one trailing newline, and catalogueSnapshotSlug maps an id to a file stem", () => {
  const text = canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } });
  assert.equal(text, '{\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  assert.ok(!text.includes("\r"));
  assert.equal(catalogueSnapshotSlug("urn:chat-marketplace:test/probe/v1"), "urn-chat-marketplace-test-probe-v1");
});
