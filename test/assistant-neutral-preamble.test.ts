import assert from "node:assert/strict";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { ASSISTANT_PLATFORM_PREAMBLE, composeSystemInstruction } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { ASSISTANT_SYSTEM_INSTRUCTION, createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { createStubPack } from "./helpers/stub-domain-pack.js";

// ADR 0107 decision 8: the platform preamble names no domain; the pack's prompt section carries the stays identity.
const DOMAIN_WORDS = /shortlet|stay|accommodation|booking|lagos|abuja/i;
const TYPED_REPLY_PLAN_SENTENCE = "When you have no tool call, return only the requested typed reply plan. Do not write guest-facing prose.";

test("AC1: The platform preamble names no domain and keeps the typed reply plan sentence.", () => {
  assert.doesNotMatch(ASSISTANT_PLATFORM_PREAMBLE, DOMAIN_WORDS);
  assert.ok(ASSISTANT_PLATFORM_PREAMBLE.includes(TYPED_REPLY_PLAN_SENTENCE), "the typed reply plan sentence is unchanged");
});

test("AC2: The stays instruction keeps its identity and rules.", () => {
  assert.match(ASSISTANT_SYSTEM_INSTRUCTION, /discovering accommodation/);
  assert.match(ASSISTANT_SYSTEM_INSTRUCTION, /answering questions about stays and pricing/);
  assert.match(ASSISTANT_SYSTEM_INSTRUCTION, /preparing booking actions/);
  assert.doesNotMatch(ASSISTANT_SYSTEM_INSTRUCTION, /Shortlet Guest Assistant/, "the separately named persona is retired");
});

test("AC3: A stub pack gets no stays identity.", () => {
  const composed = composeSystemInstruction(createStubPack());
  assert.ok(composed.endsWith("\nSTUB SECTION"));
  assert.doesNotMatch(composed, DOMAIN_WORDS);
});

test("AC4: The instruction is stable.", () => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`neutral_preamble_${Date.now()}.sqlite`) });
  try {
    const pack = createShortletAssistantPack(env);
    const first = composeSystemInstruction(pack);
    const second = composeSystemInstruction(pack);
    assert.equal(first, second);
    assert.equal(first, ASSISTANT_SYSTEM_INSTRUCTION);
  } finally {
    env.close();
  }
});
