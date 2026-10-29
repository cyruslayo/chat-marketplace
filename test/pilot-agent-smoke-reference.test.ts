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
  delete childEnvironment.PILOT_AGENT_SMOKE_REPORT_DIRECTORY;
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

test("A bounded offline transport probe reserves retries outside transport catches and reports quota refusal once", () => {
  const directory = mkdtempSync(join(tmpdir(), "smoke-budget-probe-"));
  bootstrapLocalPilot(localPilotPaths(join(directory, ".scratch/pilot-local")));
  const preload = join(directory, "synthetic-provider.mjs");
  const starts = join(directory, "transport-starts.txt");
  writeFileSync(preload, `import { writeFileSync } from 'node:fs';
let starts = 0;
globalThis.fetch = async (url) => {
  if (String(url) === 'https://openrouter.ai/api/v1/models') return Response.json({data:[{id:'openai/gpt-6-luna',pricing:{prompt:'0.0000001',completion:'0.0000005'}}]});
  if (String(url) !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('Unexpected network destination');
  starts++;
  writeFileSync(${JSON.stringify(starts)}, String(starts));
  throw new TypeError('Synthetic offline connection failure');
};\n`);
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, CONCIERGE_MODE: "openai-compatible", LLM_API_KEY: "synthetic-budget-probe", LLM_MODEL: "openai/gpt-6-luna", LLM_BASE_URL: "https://openrouter.ai/api/v1", LLM_PROVIDER_LABEL: "offline transport probe" };
  delete childEnvironment.SHORTLET_BASE_URL;
  delete childEnvironment.PILOT_AGENT_SMOKE_REPORT_DIRECTORY;
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    "--import", pathToFileURL(preload).href, resolve("scripts/pilot-agent-smoke.ts"), "--runs", "1", "--request-limit", "1"],
  { cwd: directory, env: childEnvironment, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1);
  assert.equal(readFileSync(starts, "utf8"), "1");
  const result = JSON.parse(readFileSync(join(directory, ".scratch/pilot-agent-smoke/agent-smoke-result.json"), "utf8"));
  assert.equal(result.totalReservedRequests, 1);
  assert.equal(result.totalProviderRequests, 1);
  assert.equal(result.providerRequestBudgetExceeded, true);
  assert.equal(result.controlOutcomeCounts.quota_refusal, 1);
  assert.equal(result.controlOutcomeCounts.guard_failure, 0);
  assert.equal(result.result, "FAIL", "A bounded synthetic transport probe cannot provide successful live evidence");
});
