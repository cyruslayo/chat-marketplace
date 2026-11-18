import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Every file under a directory, for the boundary tests. It follows source links (junctions and file links) with a cycle
 * guard, and skips `node_modules`, so a dependency junction is never scanned.
 */
export async function sourceFiles(directory: string, ancestors: readonly string[] = []): Promise<string[]> {
  const canonical = await realpath(directory);
  if (ancestors.includes(canonical)) return [];
  const nextAncestors = [...ancestors, canonical];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.name === "node_modules") return [];
    const entryPath = path.join(directory, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      const targetStat = await stat(entryPath);
      if (targetStat.isDirectory()) return sourceFiles(entryPath, nextAncestors);
      if (targetStat.isFile()) return [entryPath];
      throw new Error(`Unsupported source link target: ${entryPath}`);
    }
    if (entry.isDirectory()) return sourceFiles(entryPath, nextAncestors);
    if (entry.isFile()) return [entryPath];
    throw new Error(`Unsupported source entry: ${entryPath}`);
  }));
  return files.flat();
}
