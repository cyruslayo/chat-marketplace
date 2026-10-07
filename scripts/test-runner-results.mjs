import { randomUUID } from "node:crypto";

const VALID_STATES = new Set(["running", "passed", "failed", "cancelled", "incomplete"]);
const COMMAND_FLAGS = ["--list"];

function sanitizedCommand(command) {
  if (!Array.isArray(command)) return [];
  const values = [];
  for (const raw of command) {
    if (typeof raw !== "string") continue;
    if (raw === "node" || raw === "scripts/run-tests.mjs") {
      values.push(raw);
    } else if (raw === "--list") {
      values.push(raw);
    } else if (/^--suite=(all|non-browser|browser)$/.test(raw)) {
      values.push(raw);
    } else if (/^--workers=\d+$/.test(raw)) {
      values.push(raw);
    } else if (/^--file=test\/[A-Za-z0-9._/-]+\.test\.ts$/.test(raw)) {
      values.push(raw);
    } else if (raw === "--test-name-pattern" || raw.startsWith("--test-name-pattern=")) {
      values.push("--test-name-pattern=<redacted>");
    } else if (raw === "--report" || raw.startsWith("--report=")) {
      values.push("--report=<path>");
    } else if (raw === "--root" || raw.startsWith("--root=")) {
      values.push("--root=<root>");
    }
  }
  return values.length ? values : COMMAND_FLAGS;
}

function emptyCounts() {
  return { passed: 0, failed: 0, skipped: 0, cancelled: 0 };
}

function addCount(counts, status) {
  if (status === "pass") counts.passed += 1;
  if (status === "fail") counts.failed += 1;
  if (status === "skip") counts.skipped += 1;
  if (status === "cancelled") counts.cancelled += 1;
}

function safeSource(source) {
  if (!source || typeof source.file !== "string") return undefined;
  return {
    file: source.file,
    ...(Number.isInteger(source.line) && source.line > 0 ? { line: source.line } : {}),
    ...(Number.isInteger(source.column) && source.column > 0 ? { column: source.column } : {}),
  };
}

function failureFromRow(row) {
  if (row.status !== "fail") return undefined;
  return {
    name: row.name,
    ...(typeof row.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(row.code) ? { code: row.code } : {}),
    ...(safeSource(row.source) ? { source: safeSource(row.source) } : {}),
  };
}

function duration(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function safeState(state, exitCode) {
  if (!VALID_STATES.has(state)) throw new TypeError(`Invalid test run state: ${state}`);
  if (state === "passed" && exitCode !== 0) return "failed";
  return state;
}

export function createRunRecord({ runId = randomUUID(), startedAt = new Date().toISOString(), command = [], selectedFiles = [], ownerPid = process.pid, workerDefaults = { nonBrowser: 1, source: "unspecified" } } = {}) {
  if (typeof runId !== "string" || runId.length === 0) throw new TypeError("runId must be a non-empty string");
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) throw new TypeError("ownerPid must be a positive process ID");
  return {
    schemaVersion: 1,
    run: {
      id: runId,
      startedAt,
      endedAt: null,
      durationMs: 0,
      command: sanitizedCommand(command),
      selectedFiles: [...new Set(selectedFiles)],
      workerDefaults: { nonBrowser: workerDefaults.nonBrowser, source: workerDefaults.source },
      owner: { pid: ownerPid, childPids: [] },
      phases: [],
      state: "running",
      exitCode: null,
    },
    counts: emptyCounts(),
    files: [],
  };
}

export function recordPhaseResult(record, { suite, selectedFiles = [], workers, durationMs = 0, exitCode = 0, state = exitCode === 0 ? "passed" : "failed", childPid } = {}) {
  if (!record || record.run?.state !== "running") throw new TypeError("phase results require a running record");
  if (!new Set(["non-browser", "browser"]).has(suite)) throw new TypeError(`Invalid test phase: ${suite}`);
  if (!["passed", "failed", "cancelled", "incomplete"].includes(state)) throw new TypeError(`Invalid test phase state: ${state}`);
  if (!Number.isSafeInteger(workers) || workers < 1) throw new TypeError("phase workers must be a positive safe integer");
  const phase = { suite, selectedFiles: [...selectedFiles], workers, durationMs: duration(durationMs), exitCode, state };
  if (Number.isInteger(childPid) && childPid > 0) {
    phase.childPid = childPid;
    if (!record.run.owner.childPids.includes(childPid)) record.run.owner.childPids.push(childPid);
  }
  record.run.phases.push(phase);
  return phase;
}

export function recordFileResult(record, file, rows = [], { exitCode = 0, durationMs = 0, state, childPid } = {}) {
  if (!record || record.run?.state !== "running") throw new TypeError("file results require a running record");
  if (typeof file !== "string" || file.length === 0) throw new TypeError("file must be a non-empty path");
  const counts = emptyCounts();
  const failures = [];
  const summary = rows.find((row) => row?.kind === "summary" && row.file === file);
  for (const row of rows) {
    if (row?.kind === "summary") continue;
    if (!row || typeof row.name !== "string") continue;
    addCount(counts, row.status);
    const failure = failureFromRow(row);
    if (failure) failures.push(failure);
  }
  if (summary?.counts) {
    for (const key of Object.keys(counts)) {
      if (Number.isInteger(summary.counts[key]) && summary.counts[key] >= 0) counts[key] = summary.counts[key];
    }
    counts.skipped += Number.isInteger(summary.counts.todo) && summary.counts.todo >= 0 ? summary.counts.todo : 0;
  }
  const summaryExitCode = summary?.success === true ? 0 : summary?.success === false ? 1 : exitCode;
  const fileState = state ?? (summaryExitCode === 0 && counts.failed === 0 ? "passed" : "failed");
  if (!["passed", "failed", "cancelled", "incomplete"].includes(fileState)) throw new TypeError(`Invalid test file state: ${fileState}`);
  const previous = record.files.findIndex((entry) => entry.file === file);
  const result = { file, state: fileState, durationMs: duration(summary?.durationMs ?? durationMs), exitCode: summaryExitCode, counts, failures };
  if (previous === -1) record.files.push(result);
  else record.files[previous] = result;
  if (Number.isInteger(childPid) && childPid > 0 && !record.run.owner.childPids.includes(childPid)) {
    record.run.owner.childPids.push(childPid);
  }
  return result;
}

export function finalizeRunRecord(record, { exitCode = 0, state, endedAt = new Date().toISOString(), elapsedMs, durationMs } = {}) {
  if (!record || record.run?.state !== "running") throw new TypeError("only a running record can be finalized");
  let finalState = safeState(state ?? (exitCode === 0 ? "passed" : "failed"), exitCode);
  const selected = new Set(record.run.selectedFiles);
  for (const file of selected) {
    if (!record.files.some((entry) => entry.file === file)) {
      const missingState = finalState === "cancelled" ? "cancelled" : "incomplete";
      recordFileResult(record, file, [], { exitCode, state: missingState });
      if (missingState === "incomplete") finalState = "incomplete";
    }
  }
  if (record.files.some((file) => file.state === "incomplete") && finalState === "passed") finalState = "incomplete";
  if (record.files.some((file) => file.state === "failed") && finalState === "passed") finalState = "failed";
  if (finalState === "passed" && exitCode !== 0) finalState = "failed";
  const counts = emptyCounts();
  for (const file of record.files) {
    counts.passed += file.counts.passed;
    counts.failed += file.counts.failed;
    counts.skipped += file.counts.skipped;
    counts.cancelled += file.counts.cancelled;
    if (file.state === "cancelled" && file.counts.cancelled === 0) counts.cancelled += 1;
  }
  const timestampElapsed = Date.parse(endedAt) - Date.parse(record.run.startedAt);
  record.counts = counts;
  record.run.endedAt = endedAt;
  record.run.durationMs = duration(elapsedMs ?? durationMs ?? timestampElapsed);
  record.run.exitCode = exitCode;
  record.run.state = finalState;
  return record;
}

function median(samples) {
  const values = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return (values[0] + values[1]) / 2;
}

function reliableSamples(config) {
  return Array.isArray(config.samples)
    && config.samples.length === 2
    && config.samples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0 && sample.exitCode === 0 && sample.failures === 0);
}

export function chooseBenchmarkWinner(configurations, defaultId) {
  const baseline = configurations.find((configuration) => configuration.id === defaultId);
  if (!baseline || !reliableSamples(baseline)) return { selectedId: defaultId, reason: "default baseline lacks two zero-failure samples" };
  const candidates = configurations.filter(reliableSamples).map((configuration) => ({
    ...configuration,
    medianMs: median(configuration.samples),
  }));
  const ordered = candidates.sort((left, right) => left.medianMs - right.medianMs || left.workers - right.workers);
  const winner = ordered[0];
  if (!winner || winner.medianMs >= median(baseline.samples)) {
    return { selectedId: defaultId, medianMs: median(baseline.samples), reason: "no reliable improvement over the current default" };
  }
  return { selectedId: winner.id, workers: winner.workers, medianMs: winner.medianMs, reason: "fastest zero-failure median" };
}

export function recoverStaleRunRecord(record, { isProcessAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}, endedAt = new Date().toISOString() } = {}) {
  if (record?.run?.state !== "running") return record;
  if (isProcessAlive(record.run.owner.pid)) return record;
  return finalizeRunRecord(record, { exitCode: 1, state: "incomplete", endedAt });
}
