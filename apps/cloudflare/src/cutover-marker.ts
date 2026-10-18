import type { R2Bucket } from "@cloudflare/workers-types";
import { completeCutover, cutoverCompletedAt } from "../../../packages/platform-core/src/data-migration.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/**
 * Issue 16 A (decided by the parent agent, 10 Oct 2026): the cutover marker.
 *
 * The one-way cutover flag is also written as a marker in the private EXPORTS bucket. The object's storage is rewound by a
 * point-in-time restore, so a flag stored only there can be lost; the bucket is not rewound. The marker sits under the reserved
 * `_ops/` prefix, which no dated export day can match, so the daily retention sweep never deletes or lists it as a day
 * (do-export.ts deletes only `YYYY-MM-DD/...` keys).
 *
 * Order and failure rules (fail closed):
 * - Completing the cutover writes the marker first, then the database flag. A failure of the marker write leaves the flag unset,
 *   so the cutover is not recorded. A failure of the flag write after the marker leaves the marker set; the object refuses
 *   imports anyway, and running the completion again finishes the flag.
 * - Any import first reconciles: a marker with no flag re-asserts the flag, and a flag with no marker repairs the marker. Either
 *   way the import is refused. An unreadable marker, or a missing binding, refuses the import rather than reading it as "not cut over".
 * - The marker key is fixed per object. The Worker names the object from the tenant (`idFromName`), so the key is fixed for the
 *   tenant in production, and separate test objects never share a marker.
 */
export const CUTOVER_MARKER_PREFIX = "_ops/cutover/";
const CUTOVER_MARKER_FORMAT = 1;

/** The marker key for one object. Under the reserved prefix, so it is never an export day (do-export.ts). */
export type CutoverObjectKind = "platform" | "shortlet" | "commerce";

/** Namespaces a marker by authority while retaining the tenant-derived Durable Object name. */
export function cutoverMarkerKey(objectName: string, objectKind: CutoverObjectKind = "shortlet"): string {
  return `${CUTOVER_MARKER_PREFIX}${objectKind}/${objectName}.json`;
}

/** The marker could not be read or written, or its binding is absent. Always treated as "refuse", never as "not cut over". */
export class CutoverMarkerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoverMarkerUnavailableError";
  }
}

export interface CutoverMarker {
  readonly completedAt: string;
}

export interface CutoverMarkerStore {
  /** The stored marker, or null when none exists. Throws CutoverMarkerUnavailableError when it cannot be read. */
  read(): Promise<CutoverMarker | null>;
  /** Creates the marker when none exists and returns the stored marker either way. Throws CutoverMarkerUnavailableError on failure. */
  createIfAbsent(completedAt: string): Promise<CutoverMarker>;
}

/** Reads a marker's content. A damaged object is unreadable, so it is refused rather than read as absent (fail closed). */
function parseMarker(text: string): CutoverMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CutoverMarkerUnavailableError("The cutover marker is damaged");
  }
  const completedAt = parsed !== null && typeof parsed === "object" ? (parsed as { completedAt?: unknown }).completedAt : undefined;
  if (typeof completedAt !== "string" || completedAt === "") throw new CutoverMarkerUnavailableError("The cutover marker is damaged");
  return { completedAt };
}

/**
 * The R2 marker store. `bucket` is the EXPORTS binding; it is undefined when the binding is absent, and then every operation
 * fails closed. Creation is conditional (`onlyIf etagDoesNotMatch "*"`), so two creations never overwrite each other.
 */
export function createCutoverMarkerStore(bucket: R2Bucket | undefined, objectName: string, objectKind: CutoverObjectKind = "shortlet"): CutoverMarkerStore {
  const key = cutoverMarkerKey(objectName, objectKind);
  const unavailable = (): CutoverMarkerUnavailableError => new CutoverMarkerUnavailableError("The cutover marker store is not available");
  const read = async (): Promise<CutoverMarker | null> => {
    if (bucket === undefined) throw unavailable();
    let object: Awaited<ReturnType<R2Bucket["get"]>>;
    try {
      object = await bucket.get(key);
    } catch {
      throw new CutoverMarkerUnavailableError("The cutover marker could not be read");
    }
    if (object === null) return null;
    let text: string;
    try {
      text = await object.text();
    } catch {
      throw new CutoverMarkerUnavailableError("The cutover marker could not be read");
    }
    return parseMarker(text);
  };
  return {
    read,
    async createIfAbsent(completedAt: string): Promise<CutoverMarker> {
      if (bucket === undefined) throw unavailable();
      const body = JSON.stringify({ format: CUTOVER_MARKER_FORMAT, completedAt });
      try {
        const written = await bucket.put(key, body, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json" },
        });
        if (written !== null) return { completedAt };
      } catch {
        throw new CutoverMarkerUnavailableError("The cutover marker could not be written");
      }
      // The condition failed: a marker already exists. Its timestamp is the cutover's, so return it.
      const existing = await read();
      if (existing === null) throw new CutoverMarkerUnavailableError("The cutover marker could not be confirmed");
      return existing;
    },
  };
}

/**
 * Read-only status for `GET /_ops/status` and the verify route. `completedAt` is the database flag, or the marker when the flag
 * is missing. `marker` says whether the marker could be read, so an unreadable marker is shown, never shown as "not cut over".
 */
export async function cutoverStatus(
  database: SqlDatabase,
  store: CutoverMarkerStore,
): Promise<{ completedAt: string | null; marker: "present" | "absent" | "unavailable" }> {
  const flagged = cutoverCompletedAt(database);
  try {
    const marker = await store.read();
    if (marker === null) return { completedAt: flagged, marker: "absent" };
    return { completedAt: flagged ?? marker.completedAt, marker: "present" };
  } catch (error) {
    if (error instanceof CutoverMarkerUnavailableError) return { completedAt: flagged, marker: "unavailable" };
    throw error;
  }
}

/**
 * Makes the database flag agree with the marker before anything is written (issue 16 A). A marker with no flag re-asserts the flag
 * (a restore rewound it). A flag with no marker repairs the marker. Returns the cutover time, or null when the cutover is not
 * complete. Throws CutoverMarkerUnavailableError when the marker cannot be read or repaired.
 */
export async function reconcileCutover(database: SqlDatabase, store: CutoverMarkerStore): Promise<string | null> {
  const marker = await store.read();
  const flagged = cutoverCompletedAt(database);
  if (marker !== null) {
    if (flagged === null) completeCutover(database, marker.completedAt);
    return flagged ?? marker.completedAt;
  }
  if (flagged !== null) {
    await store.createIfAbsent(flagged);
    return flagged;
  }
  return null;
}

/**
 * Completes the cutover: the marker first, then the database flag (issue 16 A). A second completion returns the first timestamp,
 * taken from the marker or the flag. A failed marker write throws before the flag is touched.
 */
export async function completeCutoverWithMarker(database: SqlDatabase, store: CutoverMarkerStore, now: string): Promise<string> {
  const existing = await store.read();
  const flagged = cutoverCompletedAt(database);
  const stored = await store.createIfAbsent(existing?.completedAt ?? flagged ?? now);
  return completeCutover(database, stored.completedAt);
}
