import { isJsonObject } from "./json.js";
import type { JsonObject, JsonValue } from "./types.js";

export interface GlossaryHit {
  /** JSON pointer to the property or enum value. */
  readonly pointer: string;
  readonly kind: "property" | "enum";
  readonly value: string;
  readonly term: string;
}

function words(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Finds property names and enum values in a schema that match a list of domain glossary terms. Case-insensitive, and
 * camelCase names are split into words, so `nightlyKobo` matches the term `kobo`. Tier 1 and 2 schemas must hold no
 * domain vocabulary (ADR 0108 decision 2); phase 2 runs this over the real schemas.
 */
export function findGlossaryTerms(schema: JsonObject, terms: readonly string[]): readonly GlossaryHit[] {
  const wanted = terms.map((term) => term.toLowerCase());
  const hits: GlossaryHit[] = [];
  const check = (pointer: string, kind: GlossaryHit["kind"], value: string): void => {
    const parts = words(value);
    for (const term of wanted) {
      if (parts.includes(term)) hits.push({ pointer, kind, value, term });
    }
  };
  const walk = (node: JsonValue, pointer: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${index}`));
    } else if (isJsonObject(node)) {
      for (const [key, item] of Object.entries(node)) {
        if (key === "properties" && isJsonObject(item)) {
          for (const [name, property] of Object.entries(item)) {
            const at = `${pointer}/properties/${escapePointer(name)}`;
            check(at, "property", name);
            walk(property, at);
          }
        } else if (key === "enum" && Array.isArray(item)) {
          item.forEach((value, index) => {
            if (typeof value === "string") check(`${pointer}/enum/${index}`, "enum", value);
          });
        } else {
          walk(item, `${pointer}/${escapePointer(key)}`);
        }
      }
    }
  };
  walk(schema, "");
  return hits;
}
