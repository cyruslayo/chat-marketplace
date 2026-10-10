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
