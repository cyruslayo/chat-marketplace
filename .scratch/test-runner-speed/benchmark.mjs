import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chooseBenchmarkWinner } from "../../scripts/test-runner-results.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const runner = join(root, "scripts", "run-tests.mjs");
const outputDirectory = join(root, ".scratch", "test-runner-speed", "benchmark-runs");
const resultPath = join(root, ".scratch", "test-runner-speed", "benchmark-results.json");
const selection = [
  "test/sqlite-repositories.test.ts",
  "test/sqlite-audit-log.test.ts",
  "test/sqlite-telemetry.test.ts",
  "test/sqlite-revenue-state.test.ts",
  "test/operator-server-robustness.test.ts",
  "test/assistant-interactions-protocol.test.ts",
  "test/weaver-runtime-safety.test.ts",
  "test/weaver-web-agent-adapter.test.ts",
  "test/weaver-dependency-boundary.test.ts",
];
const configs = [
  { id: "current-default", workers: null },
  { id: "2-workers", workers: 2 },
  { id: "4-workers", workers: 4 },
  { id: "8-workers", workers: 8 },
];
const result = {
  schemaVersion: 1,
  selection,
  selectionSha256: Object.fromEntries(selection.map((file) => [file, fileHash(file)])),
  sourcesSha256: Object.fromEntries([
    "scripts/run-tests.mjs",
    "scripts/test-runner-reporter.mjs",
    "scripts/test-runner-results.mjs",
    "test/test-runner.test.ts",
  ].map((file) => [file, fileHash(file)])),
  environment: {
    node: process.version,
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    availableParallelism: os.availableParallelism(),
    currentDefaultNonBrowserWorkers: Math.max(1, os.availableParallelism() - 1),
    cpuModel: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
  },
  method: {
    warmup: "one unmeasured bounded run of the same nine files with the current default",
    order: "repeat 1: current-default, 2, 4, 8; repeat 2: current-default, 2, 4, 8",
    repetitionsPerConfig: 2,
    workerOverride: "omitted for current-default; explicit values 2, 4, and 8 for candidates",
  },
  warmup: undefined,
  measured: [],
  benchmarkConfigurations: [],
  winner: undefined,
};
function saveCheckpoint() {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}

mkdirSync(outputDirectory, { recursive: true });

function fileHash(file) {
  return createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
}

function runOnce(config, label) {
  const reportPath = join(outputDirectory, `${label}.json`);
  const args = [runner, "--suite=non-browser"];
  if (config.workers !== null) args.push(`--workers=${config.workers}`);
  for (const file of selection) args.push(`--file=${file}`);
  args.push(`--report=${reportPath}`);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const wallDurationMs = Math.round(performance.now() - started);
  if (!readFileSync(reportPath, "utf8")) throw new Error(`${label}: missing run report`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  return {
    label,
    configId: config.id,
    runId: report.run.id,
    state: report.run.state,
    exitCode: result.status ?? 1,
    counts: report.counts,
    runnerDurationMs: report.run.durationMs,
    wallDurationMs,
    report: reportPath,
    sample: {
      durationMs: report.run.durationMs,
      exitCode: result.status ?? 1,
      failures: report.counts.failed,
    },
  };
}

const warmup = runOnce(configs[0], "warmup-current-default");
result.warmup = warmup;
saveCheckpoint();
const measured = [];
for (let repetition = 1; repetition <= 2; repetition += 1) {
  for (const config of configs) {
    measured.push(runOnce(config, `${config.id}-repeat-${repetition}`));
    result.measured = measured;
    saveCheckpoint();
  }
}

const benchmarkConfigurations = configs.map((config) => ({
  id: config.id,
  workers: config.workers ?? Math.max(1, os.availableParallelism() - 1),
  samples: measured.filter((sample) => sample.configId === config.id).map(({ sample }) => sample),
}));
const winner = chooseBenchmarkWinner(benchmarkConfigurations, "current-default");
result.benchmarkConfigurations = benchmarkConfigurations;
result.winner = winner;
saveCheckpoint();
console.log(JSON.stringify({ resultPath, winner, measured: measured.map(({ configId, runId, exitCode, runnerDurationMs, counts }) => ({ configId, runId, exitCode, runnerDurationMs, counts })) }, null, 2));
