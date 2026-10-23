import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelRequest, AssistantToolResult } from "../apps/local-guest/src/assistant/assistant-model.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";

test("Current offer replies show authoritative amounts and stop treating expired offers as payable", (t) => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("reply-offer.sqlite") });
  t.after(() => env.close());
  const pack = createShortletAssistantPack(env);
  const result: AssistantToolResult = { callId: "offer", name: "get_offer_status", result: {
    hasOffer: true, status: "issued", totalAmountDueNowKobo: 20_200_000, allInStayTotalKobo: 20_200_000,
    refundableSecurityDepositKobo: 0, expiresAtIso: new Date(env.clock().getTime() + 60_000).toISOString(),
  } };
  assert.match(pack.renderReply!(undefined, [result], "What is due?"), /202,000/);
  const expired = { ...result, result: { ...result.result, status: "expired" } };
  assert.match(pack.renderReply!(undefined, [expired], "What is due?"), /no longer active|expired/i);
  assert.doesNotMatch(pack.renderReply!(undefined, [expired], "What is due?"), /202,000/);
});

test("Only a successfully created Request Draft gets a review-ready reply", (t) => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("reply-draft.sqlite") });
  t.after(() => env.close());
  const pack = createShortletAssistantPack(env);
  const result: AssistantToolResult = { callId: "draft", name: "prepare_request_draft", result: { operation: "request_draft.create", created: true } };
  assert.match(pack.renderReply!(undefined, [result], "Book this"), /draft.*ready.*review/i);
  assert.match(pack.renderReply!(undefined, [result], "Book this"), /not.*submitted/i);
  assert.doesNotMatch(pack.renderReply!(undefined, [{ ...result, result: { created: false } }], "Book this"), /ready/i);
});

test("Zero-deposit price replies never claim that a deposit is collected", (t) => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("reply-deposit.sqlite") });
  t.after(() => env.close());
  const copy = createShortletAssistantPack(env).renderReply!(undefined, [{ callId: "price", name: "explain_stay_price",
    result: { title: "Stay", allInStayTotalKobo: 20_200_000, mandatoryFeesKobo: 1_200_000, refundableSecurityDepositKobo: 0 } }], "Explain price");
  assert.match(copy, /202,000/);
  assert.doesNotMatch(copy, /collected/i);
});

test("Planning output has a separate configurable bound from the final reply", async (t) => {
  const env = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("reply-bounds.sqlite") });
  t.after(() => env.close());
  const requests: AssistantModelRequest[] = [];
  const model = { generate: async (request: AssistantModelRequest) => { requests.push(request); return { text: "{}" }; } };
  const runtime = new AssistantRuntime(env, model, { maxPlanningOutputTokens: 777, maxReplyOutputTokens: 77 });
  await runtime.handleTurn("bounds", "Hello");
  assert.equal(requests[0]?.maxOutputTokens, 777);
  assert.throws(() => new AssistantRuntime(env, model, { maxPlanningOutputTokens: 0 }), /maxPlanningOutputTokens/);
});
