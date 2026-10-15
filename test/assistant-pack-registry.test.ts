import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import {
  ASSISTANT_PLATFORM_PREAMBLE,
  AssistantPackRegistry,
  composeSystemInstruction,
  type AssistantDomainPack,
} from "../apps/local-guest/src/assistant/assistant-platform.js";
import {
  ASSISTANT_SYSTEM_INSTRUCTION,
  createShortletAssistantPack,
} from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";

function stubPack(overrides: Partial<AssistantDomainPack> = {}): AssistantDomainPack {
  return {
    id: "stub",
    promptSection: "STUB SECTION",
    intentKeywords: [],
    toolNames: ["stub_tool"],
    toolsForState: () => [],
    validateToolCall: () => undefined,
    executeTool: () => { throw new Error("not executed"); },
    discoverySurface: () => [],
    unitDetailSurface: () => [],
    pendingActionSurface: () => [],
    bookingRequestSurface: () => [],
    conditionalOfferSurface: () => [],
    cardPaymentSurface: () => [],
    bookingContractSurface: () => [],
    revalidateProposal: () => ({ ok: true }),
    ...overrides,
  };
}

let testDbIndex = 0;
function createTestRuntime(model: ScriptedAssistantModel) {
  testDbIndex++;
  const databasePath = `.scratch/local-guest/packregistry_test_${testDbIndex}_${Date.now()}.sqlite`;
  const env = LocalGuestEnvironment.openNode({ databasePath });
  return { env, runtime: new AssistantRuntime(env, model) };
}

test("AC1: the runtime has no import from domains/shortlet or shortlet web-agent converters", () => {
  const source = readFileSync(new URL("../apps/local-guest/src/assistant/assistant-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /domains\/shortlet/);
  assert.doesNotMatch(source, /web-agent/);
});

test("AC2: a tool call naming a tool not offered by the active pack is rejected before execution", async () => {
  let continuationResults: readonly { readonly result: Record<string, unknown>; readonly isError?: boolean }[] = [];
  const model = new ScriptedAssistantModel([
    (request) => {
      if (request.history.at(-1)?.role === "user") {
        return { toolCalls: [{ id: "not-offered", name: "open_store", args: {} }] };
      }
      const last = request.history.at(-1);
      if (last?.role === "tool_results") {
        continuationResults = last.results;
        return { text: "That tool is unavailable." };
      }
      return null;
    },
  ]);
  const { runtime } = createTestRuntime(model);

  const response = await runtime.handleTurn("g-not-offered", "Open a store.");

  assert.equal(response.ok, true);
  assert.equal(response.surfaces?.length, 0);
  assert.equal(continuationResults[0]?.isError, true);
  assert.equal(continuationResults[0]?.result.error, "invalid_tool_for_state");
});

test("Prompt composition prefixes the platform preamble to the active pack's section", () => {
  const pack = stubPack();
  assert.equal(composeSystemInstruction(pack), `${ASSISTANT_PLATFORM_PREAMBLE}\nSTUB SECTION`);

  const registry = new AssistantPackRegistry();
  registry.register(pack);
  assert.equal(registry.active.id, "stub");
  assert.equal(registry.hasTool("stub_tool"), true);
  assert.equal(registry.hasTool("search_stays"), false);

  const env = LocalGuestEnvironment.openNode({ databasePath: `.scratch/local-guest/packregistry_shortlet_${Date.now()}.sqlite` });
  const shortlet = createShortletAssistantPack(env);
  assert.equal(composeSystemInstruction(shortlet), ASSISTANT_SYSTEM_INSTRUCTION);
  assert.equal(shortlet.toolNames.includes("search_stays"), true);
});
