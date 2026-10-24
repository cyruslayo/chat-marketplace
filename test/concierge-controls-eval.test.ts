import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { controlsEvaluationOptions, isBlockedControlsResult } from "../scripts/concierge-controls-eval.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";

test("Controlled live evaluation requires explicit opt-in and a bounded total attempt limit", () => {
  assert.deepEqual(controlsEvaluationOptions(["--live", "--request-limit", "64"]), { requestLimit: 64 });
  assert.deepEqual(controlsEvaluationOptions(["--live", "--request-limit", "6", "--case", "other-guest-data"]), { requestLimit: 6, caseId: "other-guest-data" });
  for (const args of [
    [], ["--request-limit", "64"], ["--live"], ["--live", "--request-limit", "0"],
    ["--live", "--request-limit", "65"], ["--live", "--request-limit", "1.5"],
    ["--live", "--request-limit", "2", "--request-limit", "3"],
    ["--live", "--live", "--request-limit", "2"],
    ["--live", "--request-limit", "2", "--case", "unknown"],
    ["--live", "--request-limit", "2", "--model", "another-model"],
  ]) assert.throws(() => controlsEvaluationOptions(args));
});

test("Blocked scenario grading rejects arbitrary generation, planner calls, and new surfaces despite unchanged database effects", () => {
  const safe = { messages: [ASSISTANT_CONTROL_COPY.redirect], outcome: "scope_redirect", surfaceCount: 0, classifierOnly: true, hasAttempts: true };
  assert.equal(isBlockedControlsResult(safe), true);
  assert.equal(isBlockedControlsResult({ ...safe, messages: [ASSISTANT_CONTROL_COPY.unavailable], outcome: "scope_unavailable" }), true);
  for (const unsafe of [
    { ...safe, messages: ["Stars shine above the sea. A poem for you."] },
    { ...safe, messages: ["def sort(items): return sorted(items)"] },
    { ...safe, outcome: "successful_model_handling" },
    { ...safe, classifierOnly: false }, { ...safe, surfaceCount: 1 }, { ...safe, hasAttempts: false },
    { ...safe, outcome: "quota_refusal" },
  ]) assert.equal(isBlockedControlsResult(unsafe), false);
});

test("The controlled evaluator runs a synthetic HTTP case with network-blocked provider fixtures and excludes content from reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "controls-eval-offline-"));
  const preload = join(directory, "offline-provider.mjs");
  writeFileSync(preload, `const localFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = String(url);
  if (address.startsWith('http://127.0.0.1:')) return localFetch(url, init);
  if (address === 'https://openrouter.ai/api/v1/key') return Response.json({data:{limit:2,limit_reset:null,usage:0,limit_remaining:2}});
  if (address === 'https://openrouter.ai/api/v1/models') return Response.json({data:[{id:'openai/gpt-6-luna',pricing:{prompt:'0.0000001',completion:'0.0000005'}}]});
  if (address !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('Network forbidden');
  const body = JSON.parse(String(init.body));
  const plan = body.response_format.json_schema.name === 'concierge_scope'
    ? {scope:'in_scope',risk:'ordinary',intents:['greet'],reasonCode:'supported',slots:{city:null,neighbourhood:null,bedrooms:null,nights:null,guests:null,checkIn:null,checkOut:null}}
    : {kind:'clarify_stay',references:[]};
  return Response.json({model:'openai/gpt-6-luna',choices:[{message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
};\n`);
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    "--import", pathToFileURL(preload).href, resolve("scripts/concierge-controls-eval.ts"), "--live", "--request-limit", "4", "--case", "greeting"],
  { cwd: directory, env: { ...process.env, LLM_API_KEY: "synthetic-evaluation-only-credential" }, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const validation = join(directory, ".scratch/concierge-agent-controls/validation");
  const reportDirectory = readdirSync(validation).find((name) => name.startsWith("live-"));
  assert.ok(reportDirectory);
  const text = readFileSync(join(validation, reportDirectory, "result.json"), "utf8");
  const report = JSON.parse(text);
  assert.equal(report.evaluationReservations, 2);
  assert.equal(report.actualTransportStarts, 2);
  assert.equal(report.scenarios[0].result, "PASS");
  assert.equal(report.scenarios[0].turns[0].approvedModelResponses, 2);
  assert.equal(report.accountUsageDeltaUsd, 0);
  assert.doesNotMatch(text, /synthetic-evaluation-only-credential|Hello|clarify_stay|systemInstruction|tool_calls/);
});
