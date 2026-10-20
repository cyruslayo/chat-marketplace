// `npm test`: runs the suite in two phases so the real-browser tests never compete with the rest for CPU.
// Phase 1 runs every other test file concurrently. Phase 2 runs the files that drive a real Chrome
// (`launchRealBrowser` in test/helpers/chrome-devtools.ts) one file at a time. Under full-suite load, their fixed
// render and click budgets ran out in a different test each run (issue operator-dashboard/12).
// Extra arguments (for example --test-name-pattern) are passed to both phases.
// `--non-browser` runs phase 1 only (CI's required job); the file split lives in scripts/test-phases.mjs.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planTestPhases } from "./test-phases.mjs";
import { browserFileTimeoutMs, runBrowserFiles } from "./browser-phase.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const { concurrent: otherFiles, browser: browserFiles, extra } = planTestPhases({ root, args: process.argv.slice(2) });

function phase(label, list, options) {
  if (list.length === 0) return 0;
  console.log(`\n# ${label}: ${list.length} files`);
  const result = spawnSync(process.execPath, [tsx, "--test", ...options, ...extra, ...list], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// Phase 2 runs each browser file in its own process under a timeout (scripts/browser-phase.mjs): a stalled file is killed,
// reported as timed out, and the phase goes on. The phase exits non-zero when any file did not pass.
async function browserPhase(list) {
  if (list.length === 0) return 0;
  const timeoutMs = browserFileTimeoutMs();
  console.log(`
# Phase 2 (real browser, one file at a time, each under ${Math.round(timeoutMs / 1000)} s): ${list.length} files`);
  const results = await runBrowserFiles({ root, tsx, files: list, extra, timeoutMs });
  const failed = results.filter((result) => result.status !== "passed");
  for (const result of failed) {
    console.error(`# ${result.file}: ${result.status === "timed-out" ? "timed out" : `failed (exit ${result.exitCode})`}`);
  }
  return failed.length === 0 ? 0 : (failed[0].exitCode ?? 1);
}

const first = phase("Phase 1 (concurrent)", otherFiles, []);
const second = await browserPhase(browserFiles);
if (first !== 0 || second !== 0) console.error(`\n# npm test failed: phase 1 exit ${first}, phase 2 exit ${second}`);
process.exitCode = first !== 0 ? first : second;
