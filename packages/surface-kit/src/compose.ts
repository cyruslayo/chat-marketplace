import { collectRefs } from "./define.js";
import { cloneJson, isJsonObject } from "./json.js";
import type { AnySurfaceComponent, CatalogueManifest, ComposedCatalogue, JsonObject, JsonValue } from "./types.js";

const COMMON_TYPES_PREFIX = "common_types.json#/$defs/";
const LOCAL_PREFIX = "#/$defs/";

function objectAt(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (!isJsonObject(value)) throw new Error(`Base catalogue schema has no ${label}`);
  return value as Record<string, JsonValue>;
}

function commonTypeNames(root: Record<string, JsonValue>): ReadonlySet<string> {
  const defs = isJsonObject(root["$defs"]) ? root["$defs"] : undefined;
  const commonTypes = defs === undefined ? undefined : defs["commonTypes"];
  const commonDefs = isJsonObject(commonTypes) ? commonTypes["$defs"] : undefined;
  return new Set(isJsonObject(commonDefs) ? Object.keys(commonDefs) : []);
}

/**
 * Composes one manifest into a self-contained A2UI v0.9.1 catalogue schema (ADR 0108 decision 3). A pure function: the
 * base schema is deep-copied and never mutated. Components are added under their alias, narrowed to the manifest's slot
 * choice, and appended to the `anyComponent` union that the base catalogue uses to pick a component by name.
 */
export function composeCatalogueSchema(manifest: CatalogueManifest, baseSchema: JsonObject): ComposedCatalogue {
  const schema = cloneJson(baseSchema) as Record<string, JsonValue>;
  schema["$id"] = manifest.id;
  schema["catalogId"] = manifest.id;
  const aliases = Object.entries(manifest.components);
  if (aliases.length === 0) return { manifest, schema, components: [] };

  const components = objectAt(schema["components"], "components");
  const rootDefs = objectAt(schema["$defs"], "$defs");
  const known = commonTypeNames(schema);
  const anyComponent = objectAt(rootDefs["anyComponent"], "$defs.anyComponent");
  const union = anyComponent["oneOf"];
  if (!Array.isArray(union)) throw new Error("Base catalogue schema has no $defs.anyComponent.oneOf");
  const unionRefs: JsonValue[] = [...union];
  const composed: { alias: string; definition: AnySurfaceComponent }[] = [];

  for (const [alias, entry] of aliases) {
    if (alias in components) throw new Error(`Alias ${alias} collides with a component in the base catalogue`);
    const piece = cloneJson(entry.component.schema) as Record<string, JsonValue>;
    const properties = { ...objectAt(piece["properties"], "component properties") };
    properties["component"] = { const: alias };
    let required: JsonValue[] = Array.isArray(piece["required"]) ? [...piece["required"]] : [];
    for (const [slot, choice] of Object.entries(entry.slots ?? {})) {
      if (choice === "absent") {
        delete properties[slot];
        required = required.filter((name) => name !== slot);
      } else if (choice === "required" && !required.includes(slot)) {
        required.push(slot);
      }
    }
    piece["properties"] = properties;
    piece["required"] = required;
    // A component's own `$defs` are hoisted to the catalogue root, where its local `#/$defs/...` refs resolve.
    const ownDefs = piece["$defs"];
    delete piece["$defs"];
    if (isJsonObject(ownDefs)) {
      for (const [name, def] of Object.entries(ownDefs)) {
        const existing = rootDefs[name];
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(def)) {
          throw new Error(`Alias ${alias}: $defs.${name} clashes with a different definition already in the catalogue`);
        }
        rootDefs[name] = cloneJson(def);
      }
    }
    const refs: string[] = [];
    collectRefs(piece, refs);
    for (const ref of refs) {
      const missing = ref.startsWith(COMMON_TYPES_PREFIX)
        ? !known.has(ref.slice(COMMON_TYPES_PREFIX.length))
        : ref.startsWith(LOCAL_PREFIX)
          ? rootDefs[ref.slice(LOCAL_PREFIX.length)] === undefined
          : true;
      if (missing) throw new Error(`Alias ${alias}: $ref ${ref} does not resolve in the composed catalogue`);
    }
    components[alias] = piece;
    unionRefs.push({ $ref: `#/components/${alias}` });
    composed.push({ alias, definition: entry.component });
  }
  anyComponent["oneOf"] = unionRefs;
  return { manifest, schema, components: composed };
}

/** The ids of composed catalogues, in order. A duplicate id throws (one registration source, ADR 0108 decision 4). */
export function catalogueIds(composed: readonly ComposedCatalogue[]): readonly string[] {
  const ids = composed.map((catalogue) => catalogue.manifest.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`Duplicate catalogue id: ${duplicate}`);
  return ids;
}
