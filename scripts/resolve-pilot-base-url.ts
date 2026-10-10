/**
 * Slice 15: prints the validated origin of `SHORTLET_BASE_URL` (or `--base-url`) for the PowerShell acceptance harness.
 * Prints nothing and exits 0 when no base URL is configured; on a refused value it writes only the refusal reason.
 */
import { resolvePilotBaseUrl } from "./pilot-base-url.js";

try {
  const resolved = resolvePilotBaseUrl(process.argv.slice(2), process.env);
  process.stdout.write(resolved ? `${resolved.origin}\n` : "");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Base URL refused"}\n`);
  process.exitCode = 2;
}
