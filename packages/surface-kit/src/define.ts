import { cloneJson, deepFreeze, isJsonObject, isJsonValue } from "./json.js";
import type {
  CatalogueManifest,
  CatalogueManifestInput,
  JsonValue,
  SurfaceComponentDefinition,
  SurfaceComponentInput,
} from "./types.js";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANIFEST_ID = /^urn:chat-marketplace:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/v[1-9][0-9]*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const COMMON_TYPES_REF = /^common_types\.json#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/;
const LOCAL_REF = /^#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/;
/** Properties every component carries; they are never slots. */
const STRUCTURAL_PROPERTIES: ReadonlySet<string> = new Set(["component", "id"]);

export function collectRefs(value: JsonValue, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, found);
  } else if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string") found.push(item);
      else collectRefs(item, found);
    }
  }
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Defines one Surface Component. Throws on a schema that is not closed, a foreign `$ref` or a fixture that is not JSON. */
export function defineSurfaceComponent<TProps>(input: SurfaceComponentInput<TProps>): SurfaceComponentDefinition<TProps> {
  const { name, version, schema } = input;
  if (!PASCAL_CASE.test(name)) throw new Error(`Surface Component name must be PascalCase: ${name}`);
  if (!SEMVER.test(version)) throw new Error(`Surface Component ${name}: version must be <major>.<minor>.<patch>, got ${version}`);
  if (schema["additionalProperties"] !== false) {
    throw new Error(`Surface Component ${name}: schema must set additionalProperties to false (ADR 0073)`);
  }
  const properties = schema["properties"];
  if (!isJsonObject(properties) || !isJsonObject(properties["component"])) {
    throw new Error(`Surface Component ${name}: schema must declare a component property`);
  }
  if (!isJsonObject(properties["id"])) throw new Error(`Surface Component ${name}: schema must declare an id property`);
  const refs: string[] = [];
  collectRefs(schema, refs);
  for (const ref of refs) {
    if (!COMMON_TYPES_REF.test(ref) && !LOCAL_REF.test(ref)) {
      throw new Error(`Surface Component ${name}: $ref ${ref} is outside common_types.json#/$defs and local #/$defs`);
    }
  }
  for (const fixture of [...input.fixtures.valid, ...input.fixtures.invalid]) {
    if (!isJsonValue(fixture)) throw new Error(`Surface Component ${name}: every fixture must be valid JSON`);
  }
  const required = new Set(stringArray(schema["required"]));
  const slots = Object.keys(properties).filter((key) => !required.has(key) && !STRUCTURAL_PROPERTIES.has(key));
  return deepFreeze({
    ...input,
    schema: cloneJson(schema),
    fixtures: { valid: [...input.fixtures.valid], invalid: [...input.fixtures.invalid] },
    slots,
    major: Number(version.split(".")[0]),
  });
}

/** Defines one Catalogue Manifest. Throws on a malformed id, alias, major, slot or duplicate action. */
export function defineCatalogueManifest(input: CatalogueManifestInput): CatalogueManifest {
  if (!MANIFEST_ID.test(input.id)) throw new Error(`Catalogue manifest id is malformed: ${input.id}`);
  for (const [alias, entry] of Object.entries(input.components)) {
    if (!PASCAL_CASE.test(alias)) throw new Error(`Alias must be PascalCase: ${alias}`);
    if (alias === "Surface" || alias.toLowerCase().startsWith("a2ui")) {
      throw new Error(`Alias ${alias} is reserved by A2UI`);
    }
    if (entry.major !== entry.component.major) {
      throw new Error(`Alias ${alias}: pinned major ${entry.major} differs from component ${entry.component.name} major ${entry.component.major}`);
    }
    for (const slot of Object.keys(entry.slots ?? {})) {
      if (!entry.component.slots.includes(slot)) {
        throw new Error(`Alias ${alias}: ${slot} is not an optional property of ${entry.component.name}`);
      }
    }
  }
  if (new Set(input.actions).size !== input.actions.length) throw new Error("Catalogue manifest actions contain a duplicate");
  const components: Record<string, CatalogueManifestInput["components"][string]> = {};
  for (const [alias, entry] of Object.entries(input.components)) {
    components[alias] = Object.freeze({
      ...entry,
      ...(entry.slots === undefined ? {} : { slots: Object.freeze({ ...entry.slots }) }),
    });
  }
  return Object.freeze({ ...input, components: Object.freeze(components), actions: Object.freeze([...input.actions]) });
}
