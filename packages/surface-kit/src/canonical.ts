import { isJsonObject } from "./json.js";
import type { JsonValue } from "./types.js";

function sorted(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sorted);
  if (isJsonObject(value)) {
    const copy: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) copy[key] = sorted(value[key]!);
    return copy;
  }
  return value;
}

/**
 * The one canonical text form of a catalogue schema, for snapshots and the byte-identity check: keys sorted at every
 * depth, two-space indent, LF line ends, one trailing newline. Array order is kept (it is meaningful in JSON Schema).
 */
export function canonicalJson(value: JsonValue): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

/** The snapshot file stem for a catalogue id: `urn:chat-marketplace:<namespace>/<name>/v1` becomes `urn-chat-marketplace-<namespace>-<name>-v1`. */
export function catalogueSnapshotSlug(catalogueId: string): string {
  return catalogueId.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
