// Phase 2 of `npm test`: each real-browser file runs in its own process under a timeout. A file that stalls (a CDP call
// or a lock that never answers, see test/helpers/cdp-transport.ts and test/helpers/chrome-devtools.ts) is killed with its
// browser children and reported as timed out, and the run goes on with the next file. The phase still exits non-zero.
import { execFileSync, spawn, spawnSync } from "node:child_process";

/**
 * Default per-file budget: 15 minutes. The slowest real-browser file, mobile-guest-journey-chromium, runs for about 376 s
 * alone, so this is about 2.4 times that, which leaves room for a loaded machine. A stall is then reported in 15 minutes,
 * not hours. Override with SHORTLET_BROWSER_FILE_TIMEOUT_MS (whole milliseconds) when a machine needs more or less.
 */
export const BROWSER_FILE_TIMEOUT_MS = 15 * 60 * 1000;
export const BROWSER_FILE_TIMEOUT_ENV = "SHORTLET_BROWSER_FILE_TIMEOUT_MS";

const COUNTERS = ["tests", "pass", "fail", "skipped", "cancelled"];

export function browserFileTimeoutMs(env = process.env) {
  const raw = env[BROWSER_FILE_TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") return BROWSER_FILE_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${BROWSER_FILE_TIMEOUT_ENV} must be a positive whole number of milliseconds, got "${raw}"`);
  }
  return value;
}

/** The TAP summary a file printed at its end: the last value of each counter, or undefined when it printed none. */
export function parseTapSummary(output) {
  const found = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^# (tests|pass|fail|skipped|cancelled) (\d+)$/.exec(line);
    if (match) found[match[1]] = Number(match[2]);
  }
  if (!COUNTERS.some((name) => name in found)) return undefined;
  return Object.fromEntries(COUNTERS.map((name) => [name, found[name] ?? 0]));
}

/** A file passes only when it exits zero, printed a summary, and no test failed. Everything else is failed or timed out. */
export function browserFileStatus({ timedOut, exitCode, summary }) {
  if (timedOut) return "timed-out";
  if (summary === undefined) return "failed";
  return exitCode === 0 && summary.fail === 0 ? "passed" : "failed";
}

/** Adds the files' counters. A file with no summary (a crash or a timeout) counts as failed. */
export function aggregateBrowserPhase(results) {
  const totals = { files: results.length, passed: 0, failed: 0, timedOut: 0, tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0 };
  for (const result of results) {
    if (result.status === "passed") totals.passed += 1;
    else if (result.status === "timed-out") totals.timedOut += 1;
    if (result.status !== "passed") totals.failed += 1;
    for (const name of COUNTERS) totals[name] += result.summary?.[name] ?? 0;
  }
  return totals;
}

/** The totals in the format the suite always printed, then one phase line. */
export function formatBrowserPhaseTotals(totals) {
  return [
    `# tests ${totals.tests}`,
    `# pass ${totals.pass}`,
    `# fail ${totals.fail}`,
    `# skipped ${totals.skipped}`,
    `# cancelled ${totals.cancelled}`,
    `# Phase 2: ${totals.files} files, ${totals.passed} passed, ${totals.failed} failed, ${totals.timedOut} timed out`,
  ];
}

export function inspectWindowsWorker(pid, scriptToken) {
  if (process.platform !== "win32" || !Number.isSafeInteger(pid) || pid <= 0 || typeof scriptToken !== "string" || !scriptToken.trim()) return undefined;
  const safeToken = scriptToken.replaceAll("'", "''");
  const script = String.raw`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; if($null -eq $p){exit 3}; if([string]$p.ExecutablePath -ine '${process.execPath.replaceAll("'", "''")}' -or -not ([string]$p.CommandLine).Contains('${safeToken}')){exit 4}; [pscustomobject]@{pid=[int]$p.ProcessId; parentProcessId=[int]$p.ParentProcessId; executable=[string]$p.ExecutablePath; creationTime=$p.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  try {
    const value = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
    if (value.pid !== pid || !Number.isSafeInteger(value.parentProcessId) || typeof value.executable !== "string" || !value.executable || typeof value.creationTime !== "string" || !value.creationTime) return undefined;
    return { pid, parentProcessId: value.parentProcessId, executable: value.executable, creationTime: value.creationTime, scriptToken };
  } catch { return undefined; }
}

function inspectWindowsProcessTree(pid, scriptToken) {
  if (process.platform !== "win32") return undefined;
  const safeToken = scriptToken.replaceAll("'", "''");
  const safeExecutable = process.execPath.replaceAll("'", "''");
  const script = String.raw`$all=@(Get-CimInstance Win32_Process -ErrorAction Stop); $root=$all | Where-Object { $_.ProcessId -eq ${pid} }; if($null -eq $root -or [string]$root.ExecutablePath -ine '${safeExecutable}' -or -not ([string]$root.CommandLine).Contains('${safeToken}')){exit 4}; $owned=@{}; $owned[[int]$root.ProcessId]=$true; $changed=$true; while($changed){$changed=$false; foreach($p in $all){if(!$owned.ContainsKey([int]$p.ProcessId) -and $owned.ContainsKey([int]$p.ParentProcessId)){$owned[[int]$p.ProcessId]=$true;$changed=$true}}}; $rows=@(foreach($p in $all){if($owned.ContainsKey([int]$p.ProcessId)){[pscustomobject]@{pid=[int]$p.ProcessId;parentProcessId=[int]$p.ParentProcessId;executable=[string]$p.ExecutablePath;creationTime=$p.CreationDate.ToUniversalTime().ToString('o')}}}); ConvertTo-Json -InputObject ([pscustomobject]@{items=@($rows)}) -Compress`;
  try {
    const value = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
    if (!Array.isArray(value?.items)) return undefined;
    if (!value.items.every((row) => Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parentProcessId) && typeof row.executable === "string" && row.executable && typeof row.creationTime === "string" && row.creationTime)) return undefined;
    return value.items;
  } catch { return undefined; }
}

// Windows process actions require an exact script-token and creation-time identity.
export function killProcessTree(pid, identity, actions = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const platform = actions.platform ?? process.platform;
  if (platform === "win32") {
    if (!identity || identity.pid !== pid || typeof identity.scriptToken !== "string" || !identity.scriptToken.trim()) return false;
    const tree = (actions.inspectTree ?? inspectWindowsProcessTree)(pid, identity.scriptToken);
    if (!tree || tree.length === 0) return false;
    const root = tree.find((row) => row.pid === pid);
    if (!root || root.parentProcessId !== identity.parentProcessId || root.executable.toLowerCase() !== identity.executable.toLowerCase() || root.creationTime !== identity.creationTime) return false;
    const inspect = actions.inspectProcess ?? ((processId) => {
      const rows = (actions.inspectTree ?? inspectWindowsProcessTree)(pid, identity.scriptToken);
      return rows?.find((row) => row.pid === processId);
    });
    // Kill descendants before their verified parent. Recheck identity before each PID action.
    const depth = (row) => {
      if (row.pid === pid) return 0;
      let count = 0;
      let parent = row.parentProcessId;
      while (count < tree.length && parent !== pid) {
        const owner = tree.find((item) => item.pid === parent);
        if (!owner) break;
        parent = owner.parentProcessId;
        count += 1;
      }
      return parent === pid ? count + 1 : count;
    };
    const ordered = [...tree].sort((left, right) => depth(right) - depth(left));
    for (const row of ordered) {
      const actual = inspect(row.pid);
      if (!actual || actual.pid !== row.pid || actual.parentProcessId !== row.parentProcessId || actual.creationTime !== row.creationTime || actual.executable.toLowerCase() !== row.executable.toLowerCase()) return false;
      const result = (actions.signal ?? ((processId) => spawnSync("taskkill", ["/PID", String(processId), "/F"], { stdio: "ignore", timeout: 5_000, windowsHide: true }).status === 0))(row.pid);
      if (!result) return false;
    }
    return true;
  }
  try { process.kill(-pid, "SIGKILL"); return true; } catch { return false; }
}

function withoutNodeTestContext(env) {
  const copy = { ...env };
  delete copy.NODE_TEST_CONTEXT;
  return copy;
}

/**
 * Runs one browser test file alone and captures its output (forwarded as it arrives, so the log stays live). Resolves with
 * the file's status, exit code, elapsed time and TAP summary. It never rejects for a failing test; only a failure to start
 * the process does.
 */
export function runBrowserFile({ root, tsx, file, extra = [], timeoutMs, log = console.log }) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const posix = process.platform !== "win32";
    const child = spawn(process.execPath, [tsx, "--test", "--test-concurrency=1", ...extra, file], {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
      // On POSIX the child leads its own process group, so the group can be killed as one.
      detached: posix,
      // A nested `node --test` must not inherit the parent runner's context: it would run as a subtest and exit early.
      env: withoutNodeTestContext(process.env),
    });
    const childIdentity = process.platform === "win32" ? inspectWindowsWorker(child.pid, file) : undefined;
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    let timedOut = false;
    let settled = false;
    let timer;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      const summary = parseTapSummary(output);
      const exitCode = timedOut ? null : (code ?? 1);
      const status = browserFileStatus({ timedOut, exitCode, summary });
      if (timedOut) {
        log(`# ${file}: timed out after ${Math.round(timeoutMs / 1000)} s; a process-tree kill was requested`);
      } else if (summary === undefined) {
        log(`# ${file}: exited ${exitCode} without a test summary (a crash)`);
      }
      resolve({ file, status, exitCode, elapsedMs, summary });
    };
    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid, childIdentity);
      // A descendant can keep the pipes open after the direct child exits. Close our readers and
      // report the timeout at its deadline instead of waiting forever for the stream `close` event.
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null);
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      finish(code);
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
