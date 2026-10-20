import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyTestEnvDefaults, TEST_ENV_DEFAULTS } from "../scripts/test-env-defaults.mjs";

// The runner sets the suite's environment defaults on process.env before either phase, so phase 2's child processes
// inherit them. A value the caller already set is never overwritten.

test("A default is set when the variable is unset, and reported as applied", () => {
  const env: Record<string, string | undefined> = {};
  const applied = applyTestEnvDefaults(env, { EXAMPLE_FLAG: "1" });
  assert.equal(env.EXAMPLE_FLAG, "1");
  assert.deepEqual(applied, ["EXAMPLE_FLAG"]);
});

test("A variable the caller already set keeps its value", () => {
  const env: Record<string, string | undefined> = { EXAMPLE_FLAG: "mine" };
  const applied = applyTestEnvDefaults(env, { EXAMPLE_FLAG: "1" });
  assert.equal(env.EXAMPLE_FLAG, "mine");
  assert.deepEqual(applied, []);
});

function runPhase(flag: "--non-browser" | "--browser-only", env: NodeJS.ProcessEnv): Array<{ readonly phase: string; readonly node: string | undefined; readonly key: string | undefined }> {
  const directory = mkdtempSync(join(tmpdir(), "commerce-test-env-"));
  const capture = join(directory, "phase-env.jsonl");
  try {
    execFileSync(process.execPath, ["--import", pathToFileURL(fileURLToPath(new URL("./fixtures/test-runner-env-spy.mjs", import.meta.url))).href, "scripts/run-tests.mjs", flag], {
      cwd: process.cwd(),
      env: { ...env, RUNNER_ENV_CAPTURE: capture },
      encoding: "utf8",
    });
    return readFileSync(capture, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line) as { phase: string; node: string | undefined; key: string | undefined });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("The real runner passes defaults to children in both phases", () => {
  assert.deepEqual(TEST_ENV_DEFAULTS, { NODE_ENV: "test", COMMERCE_REFERENCE_TEST_KEY: "allow" });
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.COMMERCE_REFERENCE_TEST_KEY;

  const phaseOne = runPhase("--non-browser", env);
  const phaseTwo = runPhase("--browser-only", env);
  assert.equal(phaseOne.length, 1, "phase 1 launches one isolated child");
  assert.ok(phaseTwo.length > 0, "phase 2 launches its browser-file children");
  assert.ok(phaseOne.every(child => child.phase === "phase1"));
  assert.ok(phaseTwo.every(child => child.phase === "phase2"));
  for (const child of [...phaseOne, ...phaseTwo]) assert.deepEqual({ node: child.node, key: child.key }, { node: "test", key: "allow" });
});

test("The real runner keeps explicit caller values in children of both phases", () => {
  const env = { ...process.env, NODE_ENV: "development", COMMERCE_REFERENCE_TEST_KEY: "caller-value" };
  const phaseOne = runPhase("--non-browser", env);
  const phaseTwo = runPhase("--browser-only", env);
  assert.equal(phaseOne.length, 1, "phase 1 launches one isolated child");
  assert.ok(phaseTwo.length > 0, "phase 2 launches its browser-file children");
  assert.ok(phaseOne.every(child => child.phase === "phase1"));
  assert.ok(phaseTwo.every(child => child.phase === "phase2"));
  for (const child of [...phaseOne, ...phaseTwo]) assert.deepEqual({ node: child.node, key: child.key }, { node: "development", key: "caller-value" });
});
