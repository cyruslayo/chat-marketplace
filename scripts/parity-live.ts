/**
 * Issue 16 (AC4): the owner-run parity live script. Each parity row runs k times through the staging model, on the assistant path,
 * and is compared with the deterministic path. It prints pass^k per row and logs no guest text (ADR 0075).
 *
 * SAFETY GUARD: it never runs in npm test, and it needs explicit opt-in: RUN_PARITY_LIVE=1 and LLM_API_KEY. It is paid (the daily model
 * call cap, AGENTS.md), so it runs only when the owner asks. The implementing agent never runs it.
 */
import { OpenAiCompatibleClient } from "../apps/local-guest/src/assistant/openai-compatible-client.js";
import { runParityPath } from "../test/helpers/parity-fixture.js";
import { ROWS } from "../test/helpers/parity-rows.js";
import assert from "node:assert/strict";
import { formatParityReport, runHasFailureOutcome, type ParityRowResult } from "./parity-live-report.js";

const K = 5;
// The staging model (AGENTS.md, Staging deployment): OpenRouter, openai/gpt-6-luna.
const BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "openai/gpt-6-luna";

if (process.env.RUN_PARITY_LIVE !== "1") {
  console.error("The parity live script is blocked: RUN_PARITY_LIVE=1 is required. It is owner-run and paid.");
  process.exit(1);
}
const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("LLM_API_KEY is required. Its value is never printed.");
  process.exit(1);
}

const live = new OpenAiCompatibleClient({ apiKey, baseUrl: BASE_URL, model: MODEL });

async function main(): Promise<void> {
  const rows: ParityRowResult[] = [];
  for (const [index, row] of ROWS.entries()) {
    const runs: boolean[] = [];
    const seen: Record<string, number> = {};
    for (let run = 0; run < K; run += 1) {
      // Each run is a new thread, so no run sees another run's state. Errors are counted, never printed: they can carry guest text.
      const threadId = `g-17${index.toString(16).padStart(2, "0")}${run.toString(16).padStart(4, "0")}`;
      try {
        const deterministic = await runParityPath("deterministic", row.turns, row.script, threadId);
        const assistant = await runParityPath("assistant", row.turns, row.script, threadId, live);
        assert.deepEqual(assistant.map((step) => step.kinds), deterministic.map((step) => step.kinds));
        assert.deepEqual(assistant.map((step) => step.filters), deterministic.map((step) => step.filters));
        // ADR 0106: a run passes when the screens match and no turn recorded a failure outcome (closed codes only).
        const codes = assistant.flatMap((step) => step.outcomes);
        for (const code of codes) seen[code] = (seen[code] ?? 0) + 1;
        runs.push(!runHasFailureOutcome(codes));
      } catch {
        runs.push(false);
      }
    }
    rows.push({ name: row.name, passes: runs.filter(Boolean).length, outcomes: seen });
  }
  console.log(formatParityReport(rows, K));
}

void main();
