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

try {
  console.log(`Executing live turn 1: Incomplete search prompt... (Thread: ${threadId})`);
  const turn1 = await runtime.handleTurn(threadId, "I want somewhere in Ikoyi.");
  console.log("Turn 1 Result Ok:", turn1.ok);
  console.log("Assistant Response:", turn1.messages);
  console.log("Surfaces Mounted:", turn1.surfaces?.map((s) => s.surfaceId));

  if (!turn1.ok) {
    console.error("Turn 1 failed unexpectedly:", turn1);
    process.exit(1);
  }

  // Turn 1 assertions: Gemini asks a clarification, no discovery surface yet
  if (!turn1.messages || turn1.messages.length === 0 || !turn1.messages[0]) {
    console.error("Turn 1 failed: Expected clarification message from Gemini.");
    process.exit(1);
  }
  const hasDiscoveryTurn1 = (turn1.surfaces ?? []).some((s) => s.surfaceId.includes("discovery"));
  if (hasDiscoveryTurn1) {
    console.error("Turn 1 failed: Discovery surface should not be mounted prior to complete criteria.");
    process.exit(1);
  }
  console.log("✓ Turn 1 succeeded: Clarification asked, no discovery surface mounted.");

  console.log(`\nExecuting live turn 2: Completing criteria... (Thread: ${threadId})`);
  const turn2 = await runtime.handleTurn(threadId, "Four nights for two people.");
  console.log("Turn 2 Result Ok:", turn2.ok);
  console.log("Assistant Response:", turn2.messages);
  console.log("Surfaces Mounted:", turn2.surfaces?.map((s) => s.surfaceId));

  if (!turn2.ok) {
    console.error("Turn 2 failed unexpectedly:", turn2);
    process.exit(1);
  }

  // Turn 2 assertions: Gemini continues stateless history, search_stays runs, authoritative discovery surface returned
  const discoverySurface = (turn2.surfaces ?? []).find((s) => s.surfaceId.includes("discovery"));
  if (!discoverySurface) {
    console.error("Turn 2 failed: Expected authoritative discovery surface to be returned.");
    process.exit(1);
  }

  const thread = runtime.getThread(threadId);
  if (thread.taskState.shortlist.length === 0) {
    console.error("Turn 2 failed: Expected taskState shortlist to be populated by search_stays.");
    process.exit(1);
  }

  console.log("✓ Turn 2 succeeded: Stateless thought-signature continuity, tool round-trip, and discovery surface validated.");
  console.log("\nLive Gemini multi-turn smoke test completed successfully!");
} finally {
  env.close();
}
