import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapLocalPilot, localPilotPaths } from "../apps/pilot/src/local-pilot.js";

test("The four-turn scripted reference uses the full smoke harness without credentials, network calls or live performance claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "smoke-reference-"));
  bootstrapLocalPilot(localPilotPaths(join(directory, ".scratch/pilot-local")));
  const blockNetwork = join(directory, "block-network.mjs");
  writeFileSync(blockNetwork, "globalThis.fetch = async () => { throw new Error('Network forbidden in scripted reference'); };\n");
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, CONCIERGE_MODE: "openai-compatible", LLM_API_KEY: "synthetic-reference-must-not-be-used", GEMINI_API_KEY: "synthetic-reference-must-not-be-used" };
  delete childEnvironment.SHORTLET_BASE_URL;
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    "--import", pathToFileURL(blockNetwork).href, resolve("scripts/pilot-agent-smoke.ts"), "--scripted", "--runs", "1"],
  { cwd: directory, env: childEnvironment, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(readFileSync(join(directory, ".scratch/pilot-agent-smoke/agent-smoke-result.json"), "utf8"));
  assert.equal(result.result, "PASS");
  assert.equal(result.liveRun, false);
  assert.equal(result.credentialConfigured, false);
  assert.equal(result.totalProviderRequests, 0);
  assert.equal(result.performance, undefined);
  assert.equal(result.scenarios.length, 4);
  assert.ok(result.scenarios.every((scenario: { semanticResult: string }) => scenario.semanticResult === "PASS"));
});
