// `npm test`: runs the suite in two phases so the real-browser tests never compete with the rest for CPU.
// Phase 1 runs every other test file concurrently. Phase 2 runs the files that drive a real Chrome
// (`launchRealBrowser` in test/helpers/chrome-devtools.ts) one file at a time, each under a timeout (scripts/browser-phase.mjs).
// Under full-suite load, their fixed render and click budgets ran out in a different test each run (issue operator-dashboard/12).
// Extra arguments (for example --test-name-pattern) are passed to both phases.
// `--non-browser` runs phase 1 only (CI's required job); the file split lives in scripts/test-phases.mjs.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planTestPhases } from "./test-phases.mjs";
import { aggregateBrowserPhase, browserFileTimeoutMs, formatBrowserPhaseTotals, runBrowserFiles } from "./browser-phase.mjs";
import { applyTestEnvDefaults } from "./test-env-defaults.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const { concurrent: otherFiles, browser: browserFiles, extra } = planTestPhases({ root, args: process.argv.slice(2) });

// The environment defaults are set once, before either phase, so phase 2's child processes inherit them.
// They are listed in scripts/test-env-defaults.mjs.
applyTestEnvDefaults(process.env);

function phase(label, list, options) {
  if (list.length === 0) return 0;
  console.log(`\n# ${label}: ${list.length} files`);
  const result = spawnSync(process.execPath, [tsx, "--test", ...options, ...extra, ...list], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// Phase 2 runs each browser file in its own process under a timeout. A file that times out or crashes counts as failed,
// and the phase prints one aggregate block: the files' counters, then "# Phase 2: F files, P passed, X failed, T timed out".
async function browserPhase(list) {
  if (list.length === 0) return 0;
  const timeoutMs = browserFileTimeoutMs();
  console.log(`\n# Phase 2 (real browser, one file at a time, each under ${Math.round(timeoutMs / 1000)} s): ${list.length} files`);
  const results = await runBrowserFiles({ root, tsx, files: list, extra, timeoutMs });
  const totals = aggregateBrowserPhase(results);
  for (const line of formatBrowserPhaseTotals(totals)) console.log(line);
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
