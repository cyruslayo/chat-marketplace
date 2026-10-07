import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestEvent } from "node:test/reporters";
import reporter from "../scripts/test-runner-reporter.mjs";
import { chooseBenchmarkWinner, createRunRecord, finalizeRunRecord, recordFileResult, recordPhaseResult, recoverStaleRunRecord } from "../scripts/test-runner-results.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runnerPath = join(repoRoot, "scripts", "run-tests.mjs");
const browserHelperMarker = "launchReal" + "Browser";

async function* events(items: TestEvent[]) {
  for (const item of items) yield item;
}

async function reporterLines(items: unknown[]): Promise<string[]> {
  const output: string[] = [];
  for await (const line of reporter(events(items as TestEvent[]))) output.push(String(line));
  return output;
}

function makeFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "marketplace-test-runner-"));
  mkdirSync(join(root, "test", "helpers"), { recursive: true });
  mkdirSync(join(root, "node_modules", "tsx", "dist"), { recursive: true });
  writeFileSync(join(root, "node_modules", "tsx", "dist", "cli.mjs"), [
    "import { spawnSync } from 'node:child_process';",
    "const result = spawnSync(process.execPath, process.argv.slice(2), { cwd: process.cwd(), stdio: 'inherit' });",
    "if (result.error) throw result.error;",
    "process.exitCode = result.status ?? 1;",
  ].join("\n"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fixtureTest(root: string, name: string, source: string): void {
  writeFileSync(join(root, "test", name), source);
}

function runControlled(root: string, args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [runnerPath, `--root=${root}`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
    env,
  });
}

test("AC1: The complete selection equals the current discovery set, with every browser file classified correctly", () => {
  const result = spawnSync(process.execPath, [runnerPath, "--list"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const listed = result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { file: string; suite: string });
  const discovered = readdirSync(join(repoRoot, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `test/${name}`);
  assert.deepEqual(listed.map(({ file }) => file), discovered);

  const helpers = readdirSync(join(repoRoot, "test", "helpers"))
    .filter((name) => name.endsWith(".ts") && name !== "chrome-devtools.ts")
    .filter((name) => readFileSync(join(repoRoot, "test", "helpers", name), "utf8").includes(browserHelperMarker))
    .map((name) => `./helpers/${name.replace(/\.ts$/, ".js")}`);
  const expectedBrowserFiles = discovered.filter((file) => {
    const source = readFileSync(join(repoRoot, file), "utf8");
    return source.includes(browserHelperMarker) || helpers.some((helper) => source.includes(`"${helper}"`));
  });
  assert.deepEqual(listed.filter(({ suite }) => suite === "browser").map(({ file }) => file), expectedBrowserFiles);
  assert.ok(listed.every(({ suite }) => suite === "browser" || suite === "non-browser"));
  assert.equal(listed.find(({ file }) => file === "test/test-runner.test.ts")?.suite, "non-browser");
});

test("AC2: Suite, repeated file, list-only, and named-test selection run exactly the intended tests", () => {
  const fixture = makeFixture();
  try {
    fixtureTest(fixture.root, "alpha.test.ts", [
      "import test from 'node:test';",
      "import { appendFileSync } from 'node:fs';",
      "test('chosen case', () => appendFileSync(process.env.RUN_MARKER, 'chosen\\n'));",
      "test('other case', () => appendFileSync(process.env.RUN_MARKER, 'other\\n'));",
    ].join("\n"));
    fixtureTest(fixture.root, "beta.test.ts", "import test from 'node:test'; test('not selected', () => { throw new Error('must not run'); });");
    fixtureTest(fixture.root, "browser.test.ts", `import test from 'node:test'; import "./helpers/browser.js"; test('browser placeholder', () => {});`);
    writeFileSync(join(fixture.root, "test", "helpers", "browser.ts"), `export const x = '${browserHelperMarker}';`);
    const marker = join(fixture.root, "executed.txt");
    const env: NodeJS.ProcessEnv = { ...process.env, RUN_MARKER: marker };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [runnerPath, `--root=${fixture.root}`, "--suite=non-browser", "--file=test/alpha.test.ts", "--file=test/alpha.test.ts", "--test-name-pattern=chosen"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
      env,
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.ok(existsSync(marker), `${result.stderr}\n${result.stdout}`);
    assert.equal(readFileSync(marker, "utf8"), "chosen\n", `${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, /chosen case/);
    assert.doesNotMatch(result.stdout, /other case|not selected/);
    const listed = runControlled(fixture.root, ["--list", "--suite=browser"]);
    assert.deepEqual(listed.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)), [{ file: "test/browser.test.ts", suite: "browser" }]);
    const zeroMatchReport = join(fixture.root, "zero-match.json");
    const zeroMatch = runControlled(fixture.root, ["--suite=non-browser", "--file=test/alpha.test.ts", "--test-name-pattern=does-not-match", `--report=${zeroMatchReport}`]);
    assert.notEqual(zeroMatch.status, 0, "a valid file with no matching named tests must not pass as normal execution");
    const zeroMatchRecord = JSON.parse(readFileSync(zeroMatchReport, "utf8")) as { run: { state: string; exitCode: number }; counts: { passed: number; failed: number; skipped: number }; files: { state: string; counts: { passed: number; failed: number; skipped: number } }[] };
    assert.equal(zeroMatchRecord.run.state, "incomplete");
    assert.notEqual(zeroMatchRecord.run.exitCode, 0);
    assert.deepEqual(zeroMatchRecord.counts, { passed: 0, failed: 0, skipped: 0, cancelled: 0 });
    assert.equal(zeroMatchRecord.files[0]?.state, "incomplete");
    assert.deepEqual(zeroMatchRecord.files[0]?.counts, { passed: 0, failed: 0, skipped: 0, cancelled: 0 });
  } finally {
    fixture.cleanup();
  }
});

test("AC3: Missing files, empty selections, invalid workers, and conflicting concurrency arguments fail before test execution", () => {
  const fixture = makeFixture();
  try {
    fixtureTest(fixture.root, "present.test.ts", "import test from 'node:test'; test('must not run', () => {});");
    for (const args of [
      ["--suite=unknown"],
      ["--suite=non-browser", "--workers=0"],
      ["--suite=browser", "--workers=2"],
      ["--suite=non-browser", "--test-concurrency=1"],
      ["--suite=non-browser", "--file=test/missing.test.ts"],
      ["--suite=non-browser", "--file=test/present.test.ts", "--file=test/missing.test.ts"],
    ]) {
      const result = runControlled(fixture.root, args);
      assert.notEqual(result.status, 0, args.join(" "));
      assert.doesNotMatch(`${result.stdout ?? ""}${result.stderr ?? ""}`, /must not run/);
    }
    const empty = runControlled(fixture.root, ["--suite=browser"]);
    assert.notEqual(empty.status, 0);
    assert.doesNotMatch(`${empty.stdout ?? ""}${empty.stderr ?? ""}`, /must not run/);
  } finally {
    fixture.cleanup();
  }
});

test("AC4: Non-browser worker limits apply correctly, and browser execution remains sequential", () => {
  const fixture = makeFixture();
  try {
    fixtureTest(fixture.root, "alpha.test.ts", `import test from 'node:test'; import { appendFileSync } from 'node:fs'; import "./helpers/browser.js"; test('alpha', async () => { appendFileSync(process.env.ORDER_MARKER, 'alpha-start\\n'); await new Promise((resolve) => setTimeout(resolve, 40)); appendFileSync(process.env.ORDER_MARKER, 'alpha-end\\n'); });`);
    fixtureTest(fixture.root, "beta.test.ts", `import test from 'node:test'; import { appendFileSync } from 'node:fs'; import "./helpers/browser.js"; test('beta', async () => { appendFileSync(process.env.ORDER_MARKER, 'beta-start\\n'); await new Promise((resolve) => setTimeout(resolve, 40)); appendFileSync(process.env.ORDER_MARKER, 'beta-end\\n'); });`);
    fixtureTest(fixture.root, "gamma.test.ts", "import test from 'node:test'; test('gamma', () => {});");
    writeFileSync(join(fixture.root, "test", "helpers", "browser.ts"), `export const marker = '${browserHelperMarker}';`);
    writeFileSync(join(fixture.root, "test", "helpers", "browser.js"), `export const marker = '${browserHelperMarker}';`);
    const browser = runControlled(fixture.root, ["--suite=browser", "--workers=2"]);
    assert.notEqual(browser.status, 0, "browser worker override must be rejected");

    const orderMarker = join(fixture.root, "order.txt");
    const env: NodeJS.ProcessEnv = { ...process.env, ORDER_MARKER: orderMarker };
    delete env.NODE_TEST_CONTEXT;
    const browserRun = spawnSync(process.execPath, [runnerPath, `--root=${fixture.root}`, "--suite=browser"], { cwd: repoRoot, env, encoding: "utf8", timeout: 20_000 });
    assert.equal(browserRun.status, 0, `${browserRun.stderr}\n${browserRun.stdout}`);
    assert.equal(readFileSync(orderMarker, "utf8"), "alpha-start\nalpha-end\nbeta-start\nbeta-end\n");

    const nonBrowserReport = join(fixture.root, "non-browser-report.json");
    const nonBrowser = runControlled(fixture.root, ["--suite=non-browser", "--workers=2", `--report=${nonBrowserReport}`]);
    const nonBrowserRecord = existsSync(nonBrowserReport) ? readFileSync(nonBrowserReport, "utf8") : "missing report";
    assert.equal(nonBrowser.status, 0, `${nonBrowser.stderr}\n${nonBrowser.stdout}\n${nonBrowserRecord}`);
    const nonBrowserPhase = JSON.parse(nonBrowserRecord) as { run: { workerDefaults: { nonBrowser: number }; phases: { workers: number }[] } };
    assert.equal(nonBrowserPhase.run.workerDefaults.nonBrowser, 8);
    assert.equal(nonBrowserPhase.run.phases[0]?.workers, 2);
  } finally {
    fixture.cleanup();
  }
});

test("AC5: Successful, failed, skipped, and cancelled runs record complete counts, durations, exit codes, and final state", () => {
  const successRecord = createRunRecord({ selectedFiles: ["test/success.test.ts"], ownerPid: 122 });
  recordFileResult(successRecord, "test/success.test.ts", [
    { file: "test/success.test.ts", name: "passed", status: "pass", durationMs: 3 },
    { file: "test/success.test.ts", name: "skipped", status: "skip", durationMs: 0 },
    { file: "test/success.test.ts", kind: "summary", durationMs: 9, success: true, counts: { passed: 1, failed: 0, skipped: 1, cancelled: 0, todo: 0 } },
  ], { exitCode: 0, durationMs: 10 });
  const passed = finalizeRunRecord(successRecord, { exitCode: 0, elapsedMs: 10 });
  assert.equal(passed.run.state, "passed");
  assert.deepEqual(passed.counts, { passed: 1, failed: 0, skipped: 1, cancelled: 0 });

  const record = createRunRecord({ startedAt: "2026-10-07T10:00:00.000Z", selectedFiles: ["test/outcomes.test.ts"], ownerPid: 123 });
  recordFileResult(record, "test/outcomes.test.ts", [
    { file: "test/outcomes.test.ts", name: "passed", status: "pass", durationMs: 3 },
    { file: "test/outcomes.test.ts", name: "failed", status: "fail", durationMs: 7, code: "ERR_ASSERTION" },
    { file: "test/outcomes.test.ts", name: "skipped", status: "skip", durationMs: 0 },
    { file: "test/outcomes.test.ts", kind: "summary", durationMs: 25, success: false, counts: { passed: 1, failed: 1, skipped: 1, cancelled: 0, todo: 0, tests: 3 } },
  ], { exitCode: 1, durationMs: 26, childPid: 456 });
  const failed = finalizeRunRecord(record, { exitCode: 1, state: "failed", endedAt: "2026-10-07T10:00:00.026Z", elapsedMs: 26 });
  assert.deepEqual(failed.counts, { passed: 1, failed: 1, skipped: 1, cancelled: 0 });
  assert.equal(failed.files[0]?.durationMs, 25);
  assert.equal(failed.files[0]?.exitCode, 1);
  assert.equal(failed.run.durationMs, 26);
  assert.equal(failed.run.state, "failed");

  const cancelled = createRunRecord({ selectedFiles: ["test/pending.test.ts"], ownerPid: 124 });
  const interrupted = finalizeRunRecord(cancelled, { exitCode: 143, state: "cancelled" });
  assert.equal(interrupted.counts.cancelled, 1);
  assert.equal(interrupted.files[0]?.state, "cancelled");
  assert.equal(interrupted.run.state, "cancelled");
});

test("AC5: Mixed file results use per-file summaries and preserve the failed run's complete counts", () => {
  const fixture = makeFixture();
  const reportPath = join(fixture.root, "mixed-run.json");
  try {
    fixtureTest(fixture.root, "pass.test.ts", [
      "import test from 'node:test';",
      "test('passes', () => {});",
      "test('skips', { skip: true }, () => {});",
    ].join("\n"));
    fixtureTest(fixture.root, "fail.test.ts", [
      "import test from 'node:test';",
      "test('fails', () => { throw Object.assign(new Error('synthetic raw error'), { code: 'ERR_ASSERTION', payload: 'synthetic payload' }); });",
    ].join("\n"));
    const result = runControlled(fixture.root, ["--suite=non-browser", "--file=test/pass.test.ts", "--file=test/fail.test.ts", `--report=${reportPath}`]);
    assert.notEqual(result.status, 0);
    const record = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { state: string; exitCode: number }; counts: { passed: number; failed: number; skipped: number; cancelled: number }; files: { file: string; state: string; durationMs: number; exitCode: number; counts: { passed: number; failed: number; skipped: number; cancelled: number }; failures: { name: string; code?: string; source?: { file: string; line?: number } }[] }[] };
    assert.equal(record.run.state, "failed");
    assert.notEqual(record.run.exitCode, 0);
    assert.deepEqual(record.counts, { passed: 1, failed: 1, skipped: 1, cancelled: 0 });
    const passFile = record.files.find(({ file }) => file === "test/pass.test.ts");
    const failFile = record.files.find(({ file }) => file === "test/fail.test.ts");
    assert.equal(passFile?.state, "passed");
    assert.deepEqual(passFile?.counts, { passed: 1, failed: 0, skipped: 1, cancelled: 0 });
    assert.equal(failFile?.state, "failed");
    assert.equal(failFile?.counts.failed, 1);
    assert.ok(failFile && failFile.durationMs > 0);
    assert.deepEqual(failFile?.failures, [{ name: "fails", code: "ERR_TEST_FAILURE", source: { file: "test/fail.test.ts", line: 2, column: 1 } }]);
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("synthetic raw error"), false);
    assert.equal(serialized.includes("synthetic payload"), false);
  } finally {
    fixture.cleanup();
  }
});

test("AC6: Every run has a unique identifier, sanitized command metadata, selected files, and owned-process metadata", () => {
  const secret = "synthetic-secret-command-42";
  const first = createRunRecord({ command: ["node", "scripts/run-tests.mjs", "--suite=all", "--test-name-pattern", secret], selectedFiles: ["test/a.test.ts"], ownerPid: 123, workerDefaults: { nonBrowser: 8, source: "benchmark" } });
  const second = createRunRecord({ command: ["node", "scripts/run-tests.mjs"], selectedFiles: [], ownerPid: 124 });
  assert.match(first.run.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first.run.id, second.run.id);
  assert.deepEqual(first.run.selectedFiles, ["test/a.test.ts"]);
  assert.deepEqual(first.run.owner, { pid: 123, childPids: [] });
  assert.deepEqual(first.run.workerDefaults, { nonBrowser: 8, source: "benchmark" });
  assert.equal(JSON.stringify(first.run.command).includes(secret), false);
  recordPhaseResult(first, { suite: "non-browser", selectedFiles: ["test/a.test.ts"], workers: 8, durationMs: 17, exitCode: 0, state: "passed", childPid: 456 });
  assert.deepEqual(first.run.phases, [{ suite: "non-browser", selectedFiles: ["test/a.test.ts"], workers: 8, durationMs: 17, exitCode: 0, state: "passed", childPid: 456 }]);
  assert.deepEqual(first.run.owner.childPids, [456]);
});

test("AC7: Long output preserves failure names, codes, and source locations without storing synthetic secrets or raw payloads", async () => {
  const secret = "synthetic-secret-7d3b";
  const rows = await reporterLines([
    { type: "test:pass", data: { name: "inner pass", nesting: 1, testId: 2, details: { duration_ms: 4, type: "test" }, file: "test/a.test.ts", line: 8, column: 2 } },
    { type: "test:fail", data: { name: "long failure name " + "x".repeat(100_000), nesting: 1, testId: 3, details: { duration_ms: 5, type: "test", error: Object.assign(new Error(secret), { code: "ERR_ASSERTION", payload: secret }) }, file: "test/a.test.ts", line: 12, column: 4 } },
    { type: "test:stdout", data: { file: "test/a.test.ts", message: secret } },
    { type: "test:diagnostic", data: { file: "test/a.test.ts", message: secret, level: "error", nesting: 0 } },
    { type: "test:pass", data: { name: "skipped case", nesting: 0, testId: 4, details: { duration_ms: 0, type: "test" }, skip: secret, file: "test/a.test.ts" } },
  ]);
  const parsed = rows.map((row) => JSON.parse(row) as { file: string; name?: string; status?: string; kind?: string; durationMs: number; code?: string; source?: { file?: string; line?: number; column?: number } });
  assert.deepEqual(parsed.filter(({ kind }) => kind !== "summary").map(({ name, status }) => [name?.slice(0, 20), status]), [
    ["inner pass", "pass"],
    ["long failure name xx", "fail"],
    ["skipped case", "skip"],
  ]);
  const failure = parsed.find(({ status }) => status === "fail");
  assert.equal(failure?.code, "ERR_ASSERTION");
  assert.deepEqual(failure?.source, { file: "test/a.test.ts", line: 12, column: 4 });
  assert.equal(rows.join("\n").includes(secret), false);
  assert.ok(rows.some((row) => row.length > 100_000), "long test names remain complete");
});

test("AC8: Interrupted execution stops owned work and hard-killed runs recover as incomplete", async () => {
  const fixture = makeFixture();
  const startedMarker = join(fixture.root, "started.txt");
  const env: NodeJS.ProcessEnv = { ...process.env, STARTED_MARKER: startedMarker };
  delete env.NODE_TEST_CONTEXT;
  let ownedTestPid = 0;
  let reportPath = "";
  fixtureTest(fixture.root, "slow.test.ts", [
    "import test from 'node:test';",
    "import { writeFileSync } from 'node:fs';",
    "test('wait for cancellation', () => { writeFileSync(process.env.STARTED_MARKER, String(process.pid)); setInterval(() => {}, 1000); return new Promise(() => {}); });",
  ].join("\n"));
  fixtureTest(fixture.root, "recovery.test.ts", "import test from 'node:test'; test('recover stale record', () => {});");
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const runner = spawn(process.execPath, [runnerPath, `--root=${fixture.root}`, "--suite=non-browser", "--file=test/slow.test.ts"], {
    cwd: repoRoot,
    env,
    stdio: "ignore",
    detached: process.platform === "win32",
  });
  try {
    const deadline = Date.now() + 8000;
    while ((!existsSync(startedMarker) || !reportPath) && Date.now() < deadline) {
      const runsPath = join(fixture.root, ".scratch", "test-runs");
      const runId = existsSync(runsPath) ? readdirSync(runsPath)[0] : undefined;
      if (runId) {
        const candidate = join(runsPath, runId, "run.json");
        if (existsSync(candidate)) reportPath = candidate;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(existsSync(startedMarker), "owned test process did not start");
    ownedTestPid = Number(readFileSync(startedMarker, "utf8"));
    assert.ok(reportPath, "runner did not persist its startup checkpoint");
    runner.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
    const code = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error("runner did not finish after cancellation")), 10_000);
      runner.once("exit", (exitCode) => { clearTimeout(timeout); resolveExit(exitCode); });
    });
    assert.notEqual(code, 0);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { state: string; owner: { pid: number; childPids: number[] } }; files: { state: string }[] };
    assert.ok(report.run.owner.childPids.length > 0);
    if (process.platform === "win32") {
      assert.equal(report.run.state, "running", "a hard-killed runner leaves its startup checkpoint for recovery");
      const recovery = runControlled(fixture.root, ["--suite=non-browser", "--file=test/recovery.test.ts"]);
      assert.equal(recovery.status, 0, recovery.stderr);
      const recoveredReport = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { state: string }; files: { state: string }[] };
      assert.equal(recoveredReport.run.state, "incomplete");
      assert.equal(recoveredReport.files[0]?.state, "incomplete");
    } else {
      const cancelledReport = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { state: string }; files: { state: string }[] };
      assert.equal(cancelledReport.run.state, "cancelled");
      assert.equal(cancelledReport.files[0]?.state, "cancelled");
      let ownedAlive = true;
      const processDeadline = Date.now() + 3000;
      while (ownedAlive && Date.now() < processDeadline) {
        try { process.kill(ownedTestPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 50)); }
        catch { ownedAlive = false; }
      }
      assert.equal(ownedAlive, false, "owned test process must stop");
    }
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0), "unowned process must remain alive");

    const killedRecord = createRunRecord({ selectedFiles: ["test/slow.test.ts"], ownerPid: 321 });
    assert.equal(recoverStaleRunRecord(killedRecord, { isProcessAlive: () => true }).run.state, "running");
    const recovered = recoverStaleRunRecord(killedRecord, { isProcessAlive: () => false, endedAt: "2026-10-07T10:01:00.000Z" });
    assert.equal(recovered.run.state, "incomplete");
    assert.equal(recovered.files[0]?.state, "incomplete");
    assert.notEqual(recovered.run.state, "passed");
  } finally {
    if (runner.exitCode === null) runner.kill("SIGKILL");
    if (ownedTestPid > 0) {
      try { process.kill(ownedTestPid, "SIGKILL"); } catch { /* The fixture worker may already be gone. */ }
    }
    if (reportPath && existsSync(reportPath)) {
      try {
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as { run?: { owner?: { childPids?: number[] } } };
        for (const pid of report.run?.owner?.childPids ?? []) {
          try {
            if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            else process.kill(-pid, "SIGKILL");
          } catch { /* The fixture process tree may already be gone. */ }
        }
      } catch { /* The startup checkpoint may not exist. */ }
    }
    unrelated.kill("SIGTERM");
    fixture.cleanup();
  }
});

test("AC8: Cooperative cancellation stops the owned test tree, leaves unrelated work alive, and records cancelled state", async () => {
  const fixture = makeFixture();
  const startedMarker = join(fixture.root, "started.txt");
  const env: NodeJS.ProcessEnv = { ...process.env, STARTED_MARKER: startedMarker };
  delete env.NODE_TEST_CONTEXT;
  fixtureTest(fixture.root, "slow.test.ts", [
    "import test from 'node:test';",
    "import { writeFileSync } from 'node:fs';",
    "test('wait for cooperative cancellation', () => { writeFileSync(process.env.STARTED_MARKER, String(process.pid)); setInterval(() => {}, 1000); return new Promise(() => {}); });",
  ].join("\n"));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const runner = spawn(process.execPath, [runnerPath, `--root=${fixture.root}`, "--suite=non-browser", "--file=test/slow.test.ts"], {
    cwd: repoRoot,
    env,
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 8000;
    let reportPath = "";
    while ((!existsSync(startedMarker) || !reportPath) && Date.now() < deadline) {
      const runsPath = join(fixture.root, ".scratch", "test-runs");
      const runId = existsSync(runsPath) ? readdirSync(runsPath)[0] : undefined;
      if (runId) {
        const candidate = join(runsPath, runId, "run.json");
        if (existsSync(candidate)) reportPath = candidate;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(existsSync(startedMarker), "owned test process did not start");
    const ownedTestPid = Number(readFileSync(startedMarker, "utf8"));
    assert.ok(reportPath, "runner did not persist its startup checkpoint");
    const before = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { id: string } };
    const request = runControlled(fixture.root, [`--cancel=${before.run.id}`]);
    assert.equal(request.status, 0, `${request.stderr}\n${request.stdout}`);
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error("runner did not finish after cooperative cancellation")), 10_000);
      runner.once("exit", (code) => { clearTimeout(timeout); resolveExit(code); });
    });
    assert.notEqual(exitCode, 0);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { run: { state: string; exitCode: number }; files: { state: string }[] };
    assert.equal(report.run.state, "cancelled");
    assert.equal(report.run.exitCode, 143);
    assert.equal(report.files[0]?.state, "cancelled");
    let ownedAlive = true;
    const processDeadline = Date.now() + 3000;
    while (ownedAlive && Date.now() < processDeadline) {
      try { process.kill(ownedTestPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 50)); }
      catch { ownedAlive = false; }
    }
    assert.equal(ownedAlive, false, "owned test process must stop");
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0), "unowned process must remain alive");
  } finally {
    if (runner.exitCode === null) runner.kill("SIGKILL");
    unrelated.kill("SIGTERM");
    fixture.cleanup();
  }
});

test("AC9: Fixed-selection benchmarks choose the fastest zero-failure median, prefer fewer workers on ties, and retain the default without improvement", () => {
  const configs = [
    { id: "default", workers: 4, samples: [{ durationMs: 100, exitCode: 0, failures: 0 }, { durationMs: 110, exitCode: 0, failures: 0 }] },
    { id: "2", workers: 2, samples: [{ durationMs: 80, exitCode: 0, failures: 0 }, { durationMs: 100, exitCode: 0, failures: 0 }] },
    { id: "4", workers: 4, samples: [{ durationMs: 85, exitCode: 0, failures: 0 }, { durationMs: 95, exitCode: 0, failures: 0 }] },
    { id: "8-failed", workers: 8, samples: [{ durationMs: 30, exitCode: 1, failures: 1 }, { durationMs: 35, exitCode: 1, failures: 1 }] },
  ];
  assert.deepEqual(chooseBenchmarkWinner(configs, "default"), { selectedId: "2", workers: 2, medianMs: 90, reason: "fastest zero-failure median" });
  const tie = [
    configs[0]!,
    { id: "2", workers: 2, samples: [{ durationMs: 60, exitCode: 0, failures: 0 }, { durationMs: 60, exitCode: 0, failures: 0 }] },
    { id: "8", workers: 8, samples: [{ durationMs: 60, exitCode: 0, failures: 0 }, { durationMs: 60, exitCode: 0, failures: 0 }] },
  ];
  assert.equal(chooseBenchmarkWinner(tie, "default").selectedId, "2");
  const noImprovement = [configs[0]!, { id: "2", workers: 2, samples: [{ durationMs: 120, exitCode: 0, failures: 0 }, { durationMs: 130, exitCode: 0, failures: 0 }] }];
  assert.equal(chooseBenchmarkWinner(noImprovement, "default").selectedId, "default");
});

test("AC10: Project instructions require targeted checks per issue and integrated full verification before resolving coordinated waves", () => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  const issueTracker = readFileSync(join(repoRoot, "docs", "agents", "issue-tracker.md"), "utf8");
  assert.match(agents, /Use `npm run test:non-browser`, `npm run test:browser`, or `npm run test:files`/);
  assert.match(agents, /Keep coordinated wave issues claimed until integrated full-suite verification passes/);
  assert.match(issueTracker, /A passing focused run does not satisfy a coordinated wave's integrated full-suite gate/);
  assert.match(issueTracker, /Failures receive diagnosis/);
});

test("AC7: Run records exclude raw error properties and retain complete failure metadata", () => {
  const secret = "synthetic-secret-2a91";
  const longName = `failure ${"details ".repeat(15_000)}`;
  const record = createRunRecord({
    startedAt: "2026-10-07T10:00:00.000Z",
    command: ["node", "scripts/run-tests.mjs", "--suite=all", `--test-name-pattern=${secret}`],
    selectedFiles: ["test/a.test.ts"],
    ownerPid: 123,
  });
  recordFileResult(record, "test/a.test.ts", [
    { file: "test/a.test.ts", name: "passed", status: "pass", durationMs: 2 },
    { file: "test/a.test.ts", name: "skipped", status: "skip", durationMs: 0 },
    { file: "test/a.test.ts", name: longName, status: "fail", durationMs: 5, code: "ERR_ASSERTION", source: { file: "test/a.test.ts", line: 30, column: 7 }, error: { message: secret, payload: secret } },
  ], { exitCode: 1, durationMs: 19, state: "failed", childPid: 456 });
  const completed = finalizeRunRecord(record, { exitCode: 1, state: "failed", endedAt: "2026-10-07T10:00:00.019Z" });
  assert.deepEqual(completed.counts, { passed: 1, failed: 1, skipped: 1, cancelled: 0 });
  assert.equal(completed.files[0]?.durationMs, 19);
  assert.equal(completed.files[0]?.failures[0]?.name, longName);
  assert.equal(completed.files[0]?.failures[0]?.code, "ERR_ASSERTION");
  assert.deepEqual(completed.files[0]?.failures[0]?.source, { file: "test/a.test.ts", line: 30, column: 7 });
  const serialized = JSON.stringify(completed);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("payload"), false);
  assert.equal(completed.run.state, "failed");
  assert.equal(completed.run.exitCode, 1);
});
