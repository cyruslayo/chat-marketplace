/** Types for the Worker bundle guard (slice 10b AC3). */
export interface WorkerBundleMetafile {
  readonly inputs: Readonly<Record<string, unknown>>;
}

export function bundleWorker(
  entryPoints?: readonly string[],
): Promise<{ readonly metafile: WorkerBundleMetafile; readonly output: string }>;

export function forbiddenWorkerModules(
  metafile: WorkerBundleMetafile,
  output: string,
): string[];

/** True when an unindented line reads `import.meta.url` (undefined in Workers, so it throws at startup). */
export function hasModuleScopeImportMetaUrl(source: string): boolean;

/** Worker-graph input paths whose module source reads `import.meta.url` at module scope. */
export function moduleScopeImportMetaUrlOffenders(metafile: WorkerBundleMetafile): Promise<string[]>;
