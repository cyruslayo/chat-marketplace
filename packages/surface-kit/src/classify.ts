import { isJsonObject, jsonEqual } from "./json.js";
import type { JsonObject, JsonValue } from "./types.js";

export type CatalogueChangeKind = "identical" | "additive" | "breaking";

export interface CatalogueChange {
  readonly kind: CatalogueChangeKind;
  /** One line per change of the winning kind, each starting with the JSON pointer it applies to. */
  readonly reasons: readonly string[];
}

/** Keywords whose value is a map from a name to a schema. */
const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set(["properties", "components", "$defs", "functions", "patternProperties"]);
/** Keywords whose value is one schema. */
const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set(["items", "additionalProperties", "not", "contains", "propertyNames", "if", "then", "else"]);
/** Bounds that may be raised without breaking a valid message. */
const RAISABLE_BOUNDS: ReadonlySet<string> = new Set(["maxLength", "maxItems", "maximum"]);

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

interface Findings {
  readonly additive: string[];
  readonly breaking: string[];
}

/**
 * Classifies a change to a composed catalogue schema (ADR 0108 decision 6).
 *
 * Additive means only: a new component; a new property (a new `required` entry is separately breaking); a new value
 * appended to an `enum`; a raised `maxLength`, `maxItems` or `maximum`; a new `$defs` or `functions` entry; an entry
 * appended to a `oneOf` or `anyOf` (how a new component joins the `anyComponent` union). Everything else is breaking,
 * including any change to an existing `$defs` or `functions` entry other than an appended `oneOf` or `anyOf` entry. A
 * changed description is breaking too: a composed catalogue changes only under review, and the gate fails closed.
 */
export function classifyCatalogueChange(before: JsonObject, after: JsonObject): CatalogueChange {
  const findings: Findings = { additive: [], breaking: [] };
  diffSchema("", before, after, false, findings);
  if (findings.breaking.length > 0) return { kind: "breaking", reasons: findings.breaking };
  if (findings.additive.length > 0) return { kind: "additive", reasons: findings.additive };
  return { kind: "identical", reasons: [] };
}

function diffSchema(pointer: string, before: JsonValue, after: JsonValue, strict: boolean, found: Findings): void {
  if (jsonEqual(before, after)) return;
  if (!isJsonObject(before) || !isJsonObject(after)) {
    found.breaking.push(`${pointer || "/"}: value changed`);
    return;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const at = `${pointer}/${escapePointer(key)}`;
    const old = before[key];
    const next = after[key];
    if (old === undefined || next === undefined) {
      found.breaking.push(`${at}: keyword ${old === undefined ? "added" : "removed"}`);
    } else if (jsonEqual(old, next)) {
      continue;
    } else if (SCHEMA_MAP_KEYWORDS.has(key)) {
      diffMap(at, key, old, next, strict, found);
    } else if (SCHEMA_KEYWORDS.has(key) && isJsonObject(old) && isJsonObject(next)) {
      diffSchema(at, old, next, strict, found);
    } else if (key === "oneOf" || key === "anyOf") {
      diffAlternatives(at, old, next, strict, found);
    } else if (key === "enum") {
      diffEnum(at, old, next, strict, found);
    } else if (RAISABLE_BOUNDS.has(key) && typeof old === "number" && typeof next === "number") {
      if (strict || next < old) found.breaking.push(`${at}: bound ${next < old ? "lowered" : "changed"} from ${old} to ${next}`);
      else found.additive.push(`${at}: bound raised from ${old} to ${next}`);
    } else {
      found.breaking.push(`${at}: ${key === "required" ? "required list changed" : `${key} changed`}`);
    }
  }
}

function diffMap(pointer: string, keyword: string, before: JsonValue, after: JsonValue, strict: boolean, found: Findings): void {
  if (!isJsonObject(before) || !isJsonObject(after)) {
    found.breaking.push(`${pointer}: ${keyword} changed shape`);
    return;
  }
  // Inside `$defs` and `functions` only an addition (or an appended union entry) is allowed.
  const childStrict = strict || keyword === "$defs" || keyword === "functions";
  // A `$defs` or `functions` map may always gain an entry. `components` and `properties` may gain one outside strict nodes.
  const additionsAllowed = keyword === "$defs" || keyword === "functions" || !strict;
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const at = `${pointer}/${escapePointer(name)}`;
    const old = before[name];
    const next = after[name];
    if (old === undefined && next !== undefined) {
      if (additionsAllowed) found.additive.push(`${at}: ${keyword === "components" ? "component" : keyword === "properties" ? "property" : "entry"} added`);
      else found.breaking.push(`${at}: entry added inside an existing $defs or functions entry`);
    } else if (old !== undefined && next === undefined) {
      found.breaking.push(`${at}: ${keyword === "components" ? "component" : keyword === "properties" ? "property" : "entry"} removed`);
    } else if (old !== undefined && next !== undefined) {
      diffSchema(at, old, next, childStrict, found);
    }
  }
}

function diffAlternatives(pointer: string, before: JsonValue, after: JsonValue, strict: boolean, found: Findings): void {
  if (!Array.isArray(before) || !Array.isArray(after) || after.length < before.length) {
    found.breaking.push(`${pointer}: alternatives removed or reshaped`);
    return;
  }
  before.forEach((entry, index) => diffSchema(`${pointer}/${index}`, entry, after[index]!, strict, found));
  for (let index = before.length; index < after.length; index += 1) found.additive.push(`${pointer}/${index}: alternative appended`);
}

function diffEnum(pointer: string, before: JsonValue, after: JsonValue, strict: boolean, found: Findings): void {
  const prefix = Array.isArray(before) && Array.isArray(after) && after.length >= before.length
    && before.every((value, index) => jsonEqual(value, after[index]!));
  if (!prefix || !Array.isArray(after) || !Array.isArray(before)) {
    found.breaking.push(`${pointer}: enum value removed or reordered`);
  } else if (strict) {
    found.breaking.push(`${pointer}: enum changed inside a $defs or functions entry`);
  } else {
    for (let index = before.length; index < after.length; index += 1) found.additive.push(`${pointer}/${index}: enum value appended`);
  }
}
