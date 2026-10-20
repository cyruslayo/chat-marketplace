// Phase 2 of `npm test`: each real-browser file runs in its own process under a timeout. A file that stalls (a CDP call
// or a lock that never answers, see test/helpers/cdp-transport.ts and test/helpers/chrome-devtools.ts) is killed with its
// browser children and reported as timed out, and the run goes on with the next file. The phase still exits non-zero.
import { spawn, spawnSync } from "node:child_process";

/**
 * Default per-file budget: 15 minutes. The slowest real-browser file, mobile-guest-journey-chromium, runs for about 376 s
 * alone, so this is about 2.4 times that, which leaves room for a loaded machine. A stall is then reported in 15 minutes,
 * not hours. Override with SHORTLET_BROWSER_FILE_TIMEOUT_MS (whole milliseconds) when a machine needs more or less.
 */
export const BROWSER_FILE_TIMEOUT_MS = 15 * 60 * 1000;
export const BROWSER_FILE_TIMEOUT_ENV = "SHORTLET_BROWSER_FILE_TIMEOUT_MS";

export function browserFileTimeoutMs(env = process.env) {
  const raw = env[BROWSER_FILE_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") return BROWSER_FILE_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${BROWSER_FILE_TIMEOUT_ENV} must be a positive whole number of milliseconds, got "${raw}"`);
  }
  return value;
}

// Kills the process and everything it started. On Windows, taskkill /T walks the tree (the Chrome children included).
export function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function withoutNodeTestContext(env) {
  const copy = { ...env };
  delete copy.NODE_TEST_CONTEXT;
  return copy;
}

/**
 * Runs one browser test file alone. Resolves with its status: "passed", "failed" (exit code non-zero) or "timed-out"
 * (killed when the timeout ran out). It never rejects for a failing test; only a failure to start the process does.
 */
export function runBrowserFile({ root, tsx, file, extra = [], timeoutMs, log = console.log }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const posix = process.platform !== "win32";
    const child = spawn(process.execPath, [tsx, "--test", "--test-concurrency=1", ...extra, file], {
      cwd: root,
      stdio: "inherit",
      // On POSIX the child leads its own process group, so the group can be killed as one.
      detached: posix,
      // A nested `node --test` must not inherit the parent runner's context: it would run as a subtest and exit early.
      env: withoutNodeTestContext(process.env),
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      if (timedOut) {
        log(`# ${file}: timed out after ${Math.round(timeoutMs / 1000)} s; its process tree was killed`);
        resolve({ file, status: "timed-out", exitCode: null, elapsedMs });
        return;
      }
      const exitCode = code ?? 1;
      resolve({ file, status: exitCode === 0 ? "passed" : "failed", exitCode, elapsedMs });
    });
  });
}

/** Runs the files one after another; a timed-out or failed file does not stop the phase. */
export async function runBrowserFiles({ root, tsx, files, extra = [], timeoutMs, log = console.log }) {
  const results = [];
  for (const file of files) {
    results.push(await runBrowserFile({ root, tsx, file, extra, timeoutMs, log }));
  }
  return results;
}
