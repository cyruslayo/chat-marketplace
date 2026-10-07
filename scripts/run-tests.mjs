import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createRunRecord, finalizeRunRecord, recordFileResult, recordPhaseResult } from "./test-runner-results.mjs";

const scriptRoot = fileURLToPath(new URL("..", import.meta.url));
const reporterPath = fileURLToPath(new URL("./test-runner-reporter.mjs", import.meta.url));
const DEFAULT_NON_BROWSER_WORKERS = 8;

function usageError(message) {
  console.error(`test runner: ${message}`);
  process.exitCode = 2;
}

function cancellationExitCode(signal) {
  return signal === "SIGTERM" ? 143 : 130;
}

function parseArgs(args) {
  const options = { suite: "all", files: [], list: false, workers: undefined, patterns: [], report: undefined, root: scriptRoot, cancel: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const takeValue = (name) => {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      if (arg === name) {
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
        index += 1;
        return value;
      }
      return undefined;
    };
    const suite = takeValue("--suite");
    if (suite !== undefined) { options.suite = suite; continue; }
    const file = takeValue("--file");
    if (file !== undefined) { options.files.push(file); continue; }
    const workers = takeValue("--workers");
    if (workers !== undefined) { options.workers = workers; continue; }
    const report = takeValue("--report");
    if (report !== undefined) { options.report = report; continue; }
    const root = takeValue("--root");
    if (root !== undefined) { options.root = resolve(root); continue; }
    const cancel = takeValue("--cancel");
    if (cancel !== undefined) { options.cancel = cancel; continue; }
    const pattern = takeValue("--test-name-pattern");
    if (pattern !== undefined) {
      try { new RegExp(pattern); }
      catch { throw new Error("invalid --test-name-pattern"); }
      options.patterns.push(pattern);
      continue;
    }
    if (arg === "--list") { options.list = true; continue; }
    if (arg === "--test-concurrency" || arg.startsWith("--test-concurrency=") || arg === "--test-concurrency=1") {
      throw new Error("--test-concurrency is controlled by the runner; use --workers for non-browser files");
    }
    throw new Error("unsupported argument");
  }
  if (!new Set(["all", "non-browser", "browser"]).has(options.suite)) throw new Error("invalid --suite value");
  const workerCount = options.workers === undefined ? undefined : Number(options.workers);
  if (options.workers !== undefined && (!/^\d+$/.test(options.workers) || !Number.isSafeInteger(workerCount) || workerCount < 1)) {
    throw new Error("--workers must be a positive integer");
  }
  if (options.workers !== undefined) options.workers = workerCount;
  if (options.suite === "browser" && options.workers !== undefined) throw new Error("--workers applies only to non-browser files");
  if (options.cancel !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.cancel)) throw new Error("--cancel requires a run UUID");
    if (options.suite !== "all" || options.files.length > 0 || options.list || options.workers !== undefined || options.patterns.length > 0 || options.report !== undefined) {
      throw new Error("--cancel cannot be combined with test selection options");
    }
  }
  return options;
}

function discover(root) {
  const testRoot = join(root, "test");
  const files = readdirSync(testRoot).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `test/${name}`);
  const helpers = readdirSync(join(testRoot, "helpers"))
    .filter((name) => name.endsWith(".ts") && name !== "chrome-devtools.ts" && readFileSync(join(testRoot, "helpers", name), "utf8").includes("launchRealBrowser"))
    .map((name) => `./helpers/${name.replace(/\.ts$/, ".js")}`);
  const browser = new Set(files.filter((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return source.includes("launchRealBrowser") || helpers.some((helper) => source.includes(`"${helper}"`));
  }));
  return files.map((file) => ({ file, suite: browser.has(file) ? "browser" : "non-browser" }));
}

function normalizeFile(path, root) {
  if (isAbsolute(path)) throw new Error(`test file must be relative to the workspace: ${path}`);
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("test/") || !normalized.endsWith(".test.ts")) throw new Error("file selection must name a discovered test file");
  const absolute = resolve(root, normalized);
  const rel = relative(join(root, "test"), absolute);
  if (rel.startsWith(`..${sep}`) || rel === "..") throw new Error("file selection must stay inside test/");
  const file = `test/${rel.split(sep).join("/")}`;
  return file;
}

function selectedFiles(options, discovered) {
  let selection = discovered;
  if (options.files.length) {
    const chosen = [...new Set(options.files.map((path) => normalizeFile(path, options.root)))];
    const byName = new Map(discovered.map((entry) => [entry.file, entry]));
    for (const file of chosen) if (!byName.has(file)) throw new Error("file selection includes a missing or undiscovered test");
    selection = chosen.map((file) => byName.get(file));
  } else if (options.suite !== "all") {
    selection = discovered.filter((entry) => entry.suite === options.suite);
  }
  if (options.suite !== "all") selection = selection.filter((entry) => entry.suite === options.suite);
  if (selection.length === 0) throw new Error("selection contains no test files");
  if (options.workers !== undefined && !selection.some((entry) => entry.suite === "non-browser")) {
    throw new Error("--workers applies only to non-browser files");
  }
  return selection;
}

function safeCommand(options, selected) {
  const command = [process.execPath, "scripts/run-tests.mjs", `--suite=${options.suite}`];
  if (selected.some((entry) => entry.suite === "non-browser")) {
    command.push(`--workers=${options.workers ?? DEFAULT_NON_BROWSER_WORKERS}`);
  }
  for (const file of options.files) command.push(`--file=${file}`);
  for (const _pattern of options.patterns) command.push("--test-name-pattern=<redacted>");
  if (options.root !== scriptRoot) command.push("--root=<root>");
  if (options.report !== undefined) command.push("--report=<path>");
  return command;
}

function parseRows(path) {
  let content;
  try { content = readFileSync(path, "utf8"); } catch { return []; }
  return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function reportFile(value, root) {
  if (typeof value !== "string") return undefined;
  const candidate = isAbsolute(value) ? relative(root, value) : value;
  const normalized = candidate.replaceAll("\\", "/");
  if (!normalized.startsWith("test/") || normalized.startsWith("test/../") || normalized.includes("/../")) return undefined;
  return normalized;
}

function emitReporterRows(rows, root) {
  for (const row of rows) {
    if (!row || row.kind === "summary" || typeof row.name !== "string") continue;
    if (!["pass", "fail", "skip", "cancelled"].includes(row.status)) continue;
    const file = reportFile(row.file, root);
    if (!file) continue;
    const output = {
      file,
      name: row.name,
      status: row.status,
      durationMs: Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : 0,
    };
    const code = typeof row.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(row.code) ? row.code : undefined;
    if (code) output.code = code;
    const sourceFile = reportFile(row.source?.file, root);
    if (sourceFile) {
      output.source = {
        file: sourceFile,
        ...(Number.isInteger(row.source.line) && row.source.line > 0 ? { line: row.source.line } : {}),
        ...(Number.isInteger(row.source.column) && row.source.column > 0 ? { column: row.source.column } : {}),
      };
    }
    console.log(JSON.stringify(output));
  }
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function reportText(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function hasFileEntry(path) {
  try { lstatSync(path); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function writeNewReport(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, reportText(record), { flag: "wx" });
}

function replaceOwnedReport(path, record) {
  let existing;
  try { existing = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("owned report is unreadable"); }
  if (existing?.run?.id !== record.run.id) throw new Error("report ownership changed");
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, reportText(record), { flag: "wx" });
    renameSync(temporaryPath, path);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* No temporary file remains. */ }
    throw error;
  }
}

function writeReport(path, record) {
  if (existsSync(path)) replaceOwnedReport(path, record);
  else writeNewReport(path, record);
}

function customReportPath(root, value) {
  if (value === undefined) return undefined;
  const rootReal = realpathSync(root);
  const target = isAbsolute(value) ? resolve(value) : resolve(root, value);
  mkdirSync(dirname(target), { recursive: true });
  const parentReal = realpathSync(dirname(target));
  if (!isWithin(rootReal, parentReal)) throw new Error("--report must stay inside the workspace");
  if (hasFileEntry(target)) throw new Error("--report must name a new file");
  return target;
}

function exportManifestPath(runDir) { return join(runDir, "export.json"); }

function writeRunReports(canonicalPath, customPath, record) {
  writeReport(canonicalPath, record);
  if (customPath) writeReport(customPath, record);
}

function syncCustomExport(root, runDir, record) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(exportManifestPath(runDir), "utf8")); }
  catch { return; }
  if (manifest?.runId !== record.run.id || typeof manifest.path !== "string" || isAbsolute(manifest.path)) return;
  const target = resolve(root, manifest.path);
  try {
    const rootReal = realpathSync(root);
    const parentReal = realpathSync(dirname(target));
    if (!isWithin(rootReal, parentReal) || !existsSync(target) || lstatSync(target).isSymbolicLink()) return;
    const current = JSON.parse(readFileSync(target, "utf8"));
    if (current?.run?.id !== record.run.id) return;
    replaceOwnedReport(target, record);
  } catch { /* Never write to an unverified custom destination. */ }
}

function ownerIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    return true;
  }
}

function recoverStaleRuns(root) {
  const runsPath = join(root, ".scratch", "test-runs");
  if (!existsSync(runsPath)) return;
  for (const entry of readdirSync(runsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(runsPath, entry.name, "run.json");
    let record;
    try { record = JSON.parse(readFileSync(reportPath, "utf8")); }
    catch { continue; }
    if (record?.run?.id !== entry.name || !["running", "passed", "failed", "cancelled", "incomplete"].includes(record.run.state)) continue;
    if (record.run.state !== "running") {
      syncCustomExport(root, join(runsPath, entry.name), record);
      continue;
    }
    if (ownerIsRunning(record.run.owner?.pid)) continue;
    try {
      const recovered = finalizeRunRecord(record, {
        exitCode: Number.isInteger(record.run.exitCode) && record.run.exitCode !== 0 ? record.run.exitCode : 1,
        state: "incomplete",
        endedAt: new Date().toISOString(),
        elapsedMs: Number.isFinite(record.run.durationMs) && record.run.durationMs >= 0 ? record.run.durationMs : 0,
      });
      writeReport(reportPath, recovered);
      syncCustomExport(root, join(runsPath, entry.name), recovered);
    } catch { /* Ignore malformed or concurrently replaced run records. */ }
  }
}

function requestCancellation(root, runId) {
  const runDir = join(root, ".scratch", "test-runs", runId);
  const reportPath = join(runDir, "run.json");
  let record;
  try { record = JSON.parse(readFileSync(reportPath, "utf8")); }
  catch { usageError("run report was not found"); return; }
  if (record?.run?.id !== runId) { usageError("run report does not match the requested identifier"); return; }
  if (record.run.state !== "running") { usageError("run is no longer active; read its final report"); return; }
  const controlPath = join(runDir, "cancel.request");
  try {
    writeFileSync(controlPath, `${JSON.stringify({ runId, requestedAt: new Date().toISOString() })}\n`, { flag: "wx" });
    console.log(`Cancellation requested for run ${runId}. The report will show the final state after the runner stops its owned process.`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      console.log(`Cancellation is already requested for run ${runId}. The report will show the final state after the runner stops its owned process.`);
      return;
    }
    usageError("could not write the run-owned cancellation request");
  }
}

function runProcess(args, cwd, onSpawn) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    let closed = false;
    let stderrObserved = false;
    child.stderr?.on("data", () => { stderrObserved = true; });
    const finish = (code, signal) => {
      if (closed) return;
      closed = true;
      if (runProcess.current === child) runProcess.current = undefined;
      resolveRun({ code: code ?? 1, signal, pid: child.pid, stderrObserved });
    };
    child.once("error", () => finish(1, undefined));
    child.once("close", (code, signal) => finish(code, signal));
    runProcess.current = child;
    if (child.pid) {
      try { onSpawn(child.pid); }
      catch {
        try {
          if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).unref();
          else process.kill(-child.pid, "SIGTERM");
        } catch { /* The owned child may have exited already. */ }
      }
    }
  });
}
runProcess.current = undefined;

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { usageError(error instanceof Error ? error.message : "invalid arguments"); return; }

  if (options.cancel !== undefined) { requestCancellation(options.root, options.cancel); return; }

  if (!options.list) recoverStaleRuns(options.root);

  let discovered;
  let selected;
  try {
    discovered = discover(options.root);
    selected = selectedFiles(options, discovered);
  } catch { usageError("unable to discover or select test files"); return; }
  if (options.list) {
    for (const entry of selected) console.log(JSON.stringify(entry));
    return;
  }

  const runId = randomUUID();
  const runDir = join(options.root, ".scratch", "test-runs", runId);
  let customPath;
  try { customPath = customReportPath(options.root, options.report); }
  catch { usageError("--report must name a new file inside the workspace"); return; }
  const reportPath = join(runDir, "run.json");
  if (customPath && hasFileEntry(customPath)) { usageError("report path already exists"); return; }
  const reporterPathname = join(runDir, "events.jsonl");
  const cancelPath = join(runDir, "cancel.request");
  mkdirSync(runDir, { recursive: true });
  const record = createRunRecord({ runId, startedAt: new Date().toISOString(), command: safeCommand(options, selected), selectedFiles: selected.map(({ file }) => file), ownerPid: process.pid, workerDefaults: { nonBrowser: DEFAULT_NON_BROWSER_WORKERS, source: "benchmark" } });
  const started = performance.now();
  try {
    if (customPath) writeFileSync(exportManifestPath(runDir), `${JSON.stringify({ runId, path: relative(options.root, customPath).split(sep).join("/") })}\n`, { flag: "wx" });
    writeNewReport(reportPath, record);
    if (customPath) writeNewReport(customPath, record);
  }
  catch { usageError("could not create the run report"); return; }
  let cancelled = false;
  let signalName;
  const cancel = (signal) => {
    cancelled = true;
    signalName = signal;
    const child = runProcess.current;
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => {});
        killer.unref();
      } else {
        process.kill(-child.pid, signal);
      }
    } catch { /* The child may have exited during cancellation. */ }
  };
  const onInterrupt = () => cancel("SIGINT");
  const onTerminate = () => cancel("SIGTERM");
  const onBreak = () => cancel("SIGBREAK");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  if (process.platform === "win32") process.on("SIGBREAK", onBreak);
  const cancellationPoll = setInterval(() => {
    if (!cancelled && existsSync(cancelPath)) cancel("SIGTERM");
  }, 200);
  cancellationPoll.unref();
  let exitCode = 0;
  let state = "passed";
  const phases = [
    { suite: "non-browser", label: "non-browser", files: selected.filter((entry) => entry.suite === "non-browser") },
    { suite: "browser", label: "browser", files: selected.filter((entry) => entry.suite === "browser") },
  ];
  try {
    for (const phase of phases) {
      if (phase.files.length === 0 || cancelled) continue;
      const jsonl = `${reporterPathname}.${phase.suite}`;
      const args = [join(options.root, "node_modules", "tsx", "dist", "cli.mjs"), "--test"];
      const workers = phase.suite === "browser" ? 1 : options.workers ?? DEFAULT_NON_BROWSER_WORKERS;
      args.push(`--test-concurrency=${workers}`);
      for (const pattern of options.patterns) args.push(`--test-name-pattern=${pattern}`);
      const reporterUrl = pathToFileURL(reporterPath).href;
      args.push(`--test-reporter=${reporterUrl}`, `--test-reporter-destination=${jsonl}`, ...phase.files.map(({ file }) => join(options.root, file)));
      const startedAt = performance.now();
      const result = await runProcess(args, options.root, (pid) => {
        if (!record.run.owner.childPids.includes(pid)) record.run.owner.childPids.push(pid);
        writeRunReports(reportPath, customPath, record);
      });
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      const rows = parseRows(jsonl);
      emitReporterRows(rows, options.root);
      if (result.stderrObserved) console.error("test process emitted diagnostics; raw text was discarded.");
      for (const { file } of phase.files) {
        const fileRows = rows.filter((row) => row.file === file);
        const summary = fileRows.find((row) => row.kind === "summary");
        const noTestsRan = summary && summary.counts?.tests === 0;
        const fileWasInterrupted = cancelled && (!summary || noTestsRan || (summary.counts?.cancelled ?? 0) > 0);
        const fileState = fileWasInterrupted ? "cancelled" : !summary || noTestsRan ? "incomplete" : summary.success ? "passed" : "failed";
        const fileExitCode = fileState === "passed" ? 0 : cancelled ? 130 : result.code || 1;
        recordFileResult(record, file, fileRows, { exitCode: fileExitCode, durationMs, state: fileState, childPid: result.pid });
      }
      const incompleteEvidence = phase.files.some(({ file }) => {
        const summary = rows.find((row) => row.file === file && row.kind === "summary");
        return !summary || summary.counts?.tests === 0;
      });
      const phaseState = cancelled ? "cancelled" : incompleteEvidence ? "incomplete" : result.code === 0 ? "passed" : "failed";
      recordPhaseResult(record, { suite: phase.suite, selectedFiles: phase.files.map(({ file }) => file), workers, durationMs, exitCode: cancelled ? cancellationExitCode(signalName) : result.code, state: phaseState, childPid: result.pid, startupDiagnosticsObserved: result.stderrObserved || undefined });
      writeRunReports(reportPath, customPath, record);
      if (cancelled) { exitCode = cancellationExitCode(signalName); state = "cancelled"; break; }
      if (result.code !== 0) { exitCode = result.code; state = "failed"; }
      else if (phase.files.some(({ file }) => record.files.find((entry) => entry.file === file)?.state === "incomplete")) {
        exitCode = 1;
        state = "incomplete";
      }
    }
  } catch {
    exitCode = cancelled ? cancellationExitCode(signalName) : 1;
    state = cancelled ? "cancelled" : "incomplete";
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    if (process.platform === "win32") process.off("SIGBREAK", onBreak);
    clearInterval(cancellationPoll);
    if (cancelled && state === "passed") { state = "cancelled"; exitCode = cancellationExitCode(signalName); }
    const completed = finalizeRunRecord(record, { exitCode, state, endedAt: new Date().toISOString(), elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    try { writeRunReports(reportPath, customPath, completed); }
    catch { console.error("test runner: could not write the final run report"); process.exitCode = 1; return; }
    console.log(`\nRun ${completed.run.id}: ${completed.run.state} (${completed.counts.passed} passed, ${completed.counts.failed} failed, ${completed.counts.skipped} skipped).`);
    process.exitCode = exitCode;
  }
}

await main();
