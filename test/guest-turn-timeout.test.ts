import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLIENT_TURN_TIMEOUT_MS,
  CLIENT_TURN_TRANSPORT_MARGIN_MS,
  MAX_PLANNER_TOOL_ROUNDS,
  PLANNER_PROVIDER_ATTEMPTS,
  PLANNER_REQUEST_TIMEOUT_MS,
  SCOPE_CLASSIFIER_BUDGET_MS,
  SERVER_TURN_MAX_MS,
} from "../apps/local-guest/src/turn-budget.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { SCOPE_TOTAL_BUDGET_MS } from "../apps/local-guest/src/assistant/scope-classifier-retry.js";

test("Turn timeout AC1: the browser waits longer than the server's worst-case turn", () => {
  assert.ok(CLIENT_TURN_TIMEOUT_MS > SERVER_TURN_MAX_MS, "a client timeout below the server's worst case would duplicate a committed turn");
  assert.ok(CLIENT_TURN_TIMEOUT_MS - SERVER_TURN_MAX_MS >= CLIENT_TURN_TRANSPORT_MARGIN_MS, "the margin covers transport and rendering");
});

test("Turn timeout AC2: the worst-case turn is the scope budget plus every planner request on every provider attempt", () => {
  assert.equal(SERVER_TURN_MAX_MS, SCOPE_CLASSIFIER_BUDGET_MS + MAX_PLANNER_TOOL_ROUNDS * PLANNER_PROVIDER_ATTEMPTS * PLANNER_REQUEST_TIMEOUT_MS);
  assert.equal(SERVER_TURN_MAX_MS, 168_000);
  assert.equal(CLIENT_TURN_TIMEOUT_MS, 188_000);
});

test("Turn timeout AC3: the scope budget is the one constant the classifier retry enforces", () => {
  assert.equal(SCOPE_TOTAL_BUDGET_MS, SCOPE_CLASSIFIER_BUDGET_MS);
});

test("Turn timeout AC4: the planner round limit is the one constant the assistant platform enforces", () => {
  assert.equal(MAX_ASSISTANT_TOOL_ROUNDS, MAX_PLANNER_TOOL_ROUNDS);
});

test("Turn timeout AC5: the planner requests use the shared request timeout, not a second literal", () => {
  const runtime = readFileSync("apps/local-guest/src/assistant/assistant-runtime.ts", "utf8");
  // Issue 02 made each planner and summary call take its timeout from the turn deadline: the call's timeout is the runtime's
  // model-call timeout (defaulting to the shared constant) capped by the time left in the turn. No call names a literal.
  assert.match(runtime, /DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS = PLANNER_REQUEST_TIMEOUT_MS/);
  assert.match(runtime, /Math\.min\(this\.#modelCallTimeoutMs, remainingMs\)/);
  assert.match(runtime, /timeoutMs: plannerTimeoutMs/);
  assert.match(runtime, /timeoutMs: summaryTimeoutMs/);
  assert.doesNotMatch(runtime, /timeoutMs: 20_000/);
});

test("Turn timeout AC6: the browser turn request uses the shared client timeout", () => {
  const client = readFileSync("apps/local-guest/src/client.ts", "utf8");
  assert.match(client, /CLIENT_TURN_TIMEOUT_MS/);
  assert.doesNotMatch(client, /AbortSignal\.timeout\(10_000\)/, "the turn request no longer uses the old ten-second wait");
});
