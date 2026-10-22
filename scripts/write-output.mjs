import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const MAX_WRITE_ATTEMPTS = 51;
const WRITE_RETRY_DELAY_MS = 100;
const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "UNKNOWN"]);

/** Wait up to five seconds for transient Windows mappings; preserve persistent failures. */
export async function writeOutput(path, data) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      if (attempt === MAX_WRITE_ATTEMPTS || !RETRYABLE_CODES.has(error.code)) throw error;
      await delay(WRITE_RETRY_DELAY_MS);
    }
  }
}
