import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Per-process scratch directory for SQLite files created by local-guest tests.
 *
 * Databases used to be written to `.scratch/local-guest/`, which accumulated tens of thousands of files because nothing
 * removed them. The directory is created under os.tmpdir() and deleted when the test process exits. Removing the whole
 * directory also removes any `-wal`, `-shm` and `-journal` siblings. Cleanup is best effort: on Windows a database
 * that a test never closed can keep its files locked, and those files are then left for the OS temp cleaner.
 */
const directory = mkdtempSync(join(tmpdir(), "local-guest-test-"));

process.on("exit", () => {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    // Best effort only; a locked file must not fail the test run.
  }
});

export function temporaryDatabasePath(fileName: string): string {
  return join(directory, fileName);
}
