/**
 * Shortlet Assistant Live Gemini API Smoke Test
 *
 * SAFETY GUARD: This script will NEVER execute during automated testing or offline runs.
 * It strictly requires explicit environment opt-in: RUN_LIVE_GEMINI=1 and GEMINI_API_KEY.
 *
 * DO NOT RUN THIS SCRIPT during automated building or coding-agent tasks.
 * Reserved exclusively for the human developer after all offline gates pass.
 */
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import {
  GeminiInteractionsClient,
  DEFAULT_GEMINI_MODEL,
} from "../apps/local-guest/src/assistant/gemini-interactions-client.js";

if (process.env.RUN_LIVE_GEMINI !== "1") {
  console.error("Live Gemini smoke test was blocked: RUN_LIVE_GEMINI=1 is required.");
  console.error("Live Gemini API smoke intentionally NOT run — reserved for the final human test after all offline gates pass.");
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY environment variable is required to run live smoke test.");
  process.exit(1);
}

function parseThinkingLevel(val: string | undefined): "minimal" | "low" | "medium" | "high" | undefined {
  if (!val) return undefined;
  const normalized = val.trim().toLowerCase();
  if (normalized === "minimal" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return undefined;
}

console.log("Initializing Live Gemini Interactions Assistant...");
const env = new LocalGuestEnvironment();
const gemini = new GeminiInteractionsClient({
  apiKey,
  model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  thinkingLevel: parseThinkingLevel(process.env.GEMINI_THINKING_LEVEL),
});
const runtime = new AssistantRuntime(env, gemini);

const threadId = `g-${crypto.randomUUID()}`;
console.log(`Executing live turn 1: Search Ikoyi for 4 nights... (Thread: ${threadId})`);

const turn1 = await runtime.handleTurn(threadId, "I need a place in Ikoyi for 4 nights for 2 guests");
console.log("Turn 1 Result Ok:", turn1.ok);
console.log("Assistant Response:", turn1.messages);
console.log("Surfaces Mounted:", turn1.surfaces?.map((s) => s.surfaceId));

if (turn1.ok && turn1.surfaces && turn1.surfaces.length > 0) {
  console.log("\nLive Gemini smoke test completed successfully!");
} else {
  console.error("\nLive Gemini smoke test failed.");
  process.exit(1);
}

env.close();
