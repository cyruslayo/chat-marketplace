import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  catalogueSnapshotSlug,
  classifyCatalogueChange,
  type ComposedCatalogue,
  type JsonObject,
} from "../../packages/surface-kit/src/index.js";

/** The variable that rewrites snapshots (documented in packages/surface-kit/README.md). */
export const UPDATE_SNAPSHOTS_VARIABLE = "UPDATE_CATALOGUE_SNAPSHOTS";

const CATALOGUE_ID = /^(urn:chat-marketplace:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*)\/v([1-9][0-9]*)$/;

export interface SnapshotCheck {
  readonly failures: readonly string[];
  readonly written: readonly string[];
}

function parseId(id: string): { readonly stem: string; readonly major: number } {
  const match = CATALOGUE_ID.exec(id);
  if (match === null) throw new Error(`Catalogue id has no major version: ${id}`);
  return { stem: match[1]!, major: Number(match[2]) };
}

async function readSnapshot(file: string): Promise<JsonObject> {
  // A Windows checkout may hold CRLF; the line ending is not part of the schema.
  return JSON.parse((await readFile(file, "utf8")).replace(/\r\n/g, "\n")) as JsonObject;
}

/**
 * The snapshot gate (ADR 0108 decision 6). For each composed catalogue it compares the schema with the committed
 * snapshot of the same id:
 * - identical passes;
 * - additive fails unless `update`, then the snapshot is rewritten;
 * - breaking fails, with `update` too, because the same id keeps the same major;
 * - no snapshot for the id: a lower major of the same catalogue means a deliberate new major, which fails unless
 *   `update` and is then written next to the old file; a catalogue with no snapshot at all fails unless `update`.
 * A snapshot file that matches no current catalogue fails, so a retired catalogue is removed on purpose.
 */
export async function checkCatalogueSnapshots(options: {
  readonly catalogues: readonly ComposedCatalogue[];
  readonly directory: string;
  readonly update: boolean;
}): Promise<SnapshotCheck> {
  const { catalogues, directory, update } = options;
  const failures: string[] = [];
  const written: string[] = [];
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const expected = new Set(catalogues.map((catalogue) => `${catalogueSnapshotSlug(catalogue.manifest.id)}.json`));

  for (const catalogue of catalogues) {
    const id = catalogue.manifest.id;
    const file = path.join(directory, `${catalogueSnapshotSlug(id)}.json`);
    const text = canonicalJson(catalogue.schema);
    if (files.includes(path.basename(file))) {
      const change = classifyCatalogueChange(await readSnapshot(file), catalogue.schema);
      if (change.kind === "identical") continue;
      if (change.kind === "breaking") {
        failures.push(`${id}: breaking change under the same catalogue major (${change.reasons.join("; ")}). Publish it as a new major id instead of rewriting the snapshot.`);
      } else if (update) {
        await writeFile(file, text);
        written.push(path.basename(file));
      } else {
        failures.push(`${id}: additive change (${change.reasons.join("; ")}). Re-run with ${UPDATE_SNAPSHOTS_VARIABLE}=1 to rewrite the snapshot.`);
      }
      continue;
    }
    const { stem, major } = parseId(id);
    let earlier = false;
    for (const name of files) {
      const candidate = (await readSnapshot(path.join(directory, name)))["catalogId"];
      if (typeof candidate === "string" && CATALOGUE_ID.test(candidate)) {
        const parsed = parseId(candidate);
        if (parsed.stem === stem && parsed.major < major) earlier = true;
      }
    }
    if (update) {
      await writeFile(file, text);
      written.push(path.basename(file));
    } else {
      failures.push(`${id}: no snapshot${earlier ? " for this new catalogue major" : ""}. Re-run with ${UPDATE_SNAPSHOTS_VARIABLE}=1 to write it.`);
    }
  }
  for (const name of files) {
    if (!expected.has(name)) failures.push(`${name}: orphan snapshot with no current catalogue. Remove it if the catalogue was retired.`);
  }
  return { failures, written };
}
