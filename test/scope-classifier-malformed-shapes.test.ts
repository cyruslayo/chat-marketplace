import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime, type AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ModelScopeClassifier, ScopeClassificationError, assessScopeResponse, parseScopeAssessment, scopeVerdictCodes, type ScopeContext, type ScopeFailureReason } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { clientWith, jsonResponse } from "./helpers/openai-compatible-client.js";
import { MALFORMED_REPLACEMENT_CODES, MALFORMED_SHAPES, NAMED_EDGE_CASES, SCOPE_ALLOWED, SCOPE_ALLOWED_JSON, legacyScopeOutcome, seededScopeCorpus } from "./helpers/scope-classifier-corpus.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { SCOPE_RETRY_ELIGIBLE_REASONS } from "../apps/local-guest/src/assistant/scope-classifier-retry.js";

const CONTEXT: ScopeContext = { domain: "shortlet", description: "Lagos and Abuja short-let stays", hasShortlist: true, hasSelectedStay: false, hasOffer: false };
const MESSAGE = "What is included in the price for the first one?";

// Each malformed shape goes through the real OpenAI-compatible adapter and the real classifier parse path. Only fetch is injected.
for (const shape of MALFORMED_SHAPES) {
  test(`Classifier shape "${shape.name}" is reported as ${shape.reason} through the OpenAI-compatible client`, async () => {
    const { client, requests } = clientWith(() => jsonResponse(200, {
      id: "cmpl-shape", choices: [{ index: 0, message: { role: "assistant", content: shape.text }, finish_reason: "stop" }], usage: { prompt_tokens: 443, completion_tokens: 143 },
    }));
    const classifier = new ModelScopeClassifier(client);
    await assert.rejects(classifier.assess(MESSAGE, CONTEXT), (error: unknown) => {
      assert.ok(error instanceof ScopeClassificationError);
      assert.equal(error.reason, shape.reason);
      return true;
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(assessScopeResponse({ text: shape.text, finishReason: "stop" }), { failure: shape.reason });
  });
}

test("Classifier shapes: the four replacement codes are closed and the former catch-all is gone from the union", () => {
  const reasons = new Set(MALFORMED_SHAPES.map((shape) => shape.reason));
  assert.deepEqual([...reasons].sort(), [...MALFORMED_REPLACEMENT_CODES].sort());
  for (const shape of MALFORMED_SHAPES) assert.notEqual(shape.reason, "invalid_json_malformed" as ScopeFailureReason);
});

test("Classifier shapes: a canary inside any malformed response never reaches the failure code, error message or verdict codes", async () => {
  const canary = "PRIVATE_SHAPE_CANARY_7f3a";
  for (const shape of MALFORMED_SHAPES) {
    const text = `${shape.text}${canary}`;
    const { client } = clientWith(() => jsonResponse(200, { choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    const classifier = new ModelScopeClassifier(client);
    await assert.rejects(classifier.assess(`${MESSAGE} ${canary}`, CONTEXT), (error: unknown) => {
      assert.ok(error instanceof ScopeClassificationError, shape.name);
      assert.doesNotMatch(error.message, new RegExp(canary), shape.name);
      assert.doesNotMatch(error.reason, new RegExp(canary), shape.name);
      return true;
    });
    assert.doesNotMatch(JSON.stringify(scopeVerdictCodes({ text, finishReason: "stop" })), new RegExp(canary), shape.name);
  }
});

test("Classifier shapes: runtime diagnostics name the closed code for each malformed shape and never the canary text", async (t) => {
  const canary = "PRIVATE_RUNTIME_SHAPE_CANARY";
  for (const shape of MALFORMED_SHAPES) {
    const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath(`scope-shape-${MALFORMED_SHAPES.indexOf(shape)}.sqlite`) });
    t.after(() => environment.close());
    const diagnostics: AssistantDiagnosticEvent[] = [];
    // The canary rides in the user message. Appending it to the response would change the defect the shape names.
    const runtime = new AssistantRuntime(environment, { generate: async (request) =>
      request.structuredOutput?.name === "concierge_scope" ? { text: shape.text, finishReason: "stop" } : { text: "{}" } }, {
      onDiagnostic: (event) => diagnostics.push(event),
    });
    const result = await runtime.handleTurn(`shape-${MALFORMED_SHAPES.indexOf(shape)}`, `Find stays in Lagos ${canary}`);
    assert.equal(result.ok, true, shape.name);
    assert.deepEqual(diagnostics.filter((event) => event.scopeFailureReason !== undefined).map((event) => event.scopeFailureReason), [shape.reason], shape.name);
    assert.doesNotMatch(JSON.stringify({ result, diagnostics }), new RegExp(canary), shape.name);
  }
});

test("Differential: the new codes accept and reject exactly what the previous validator accepted and rejected, across 20,000 seeded inputs and named edge cases", () => {
  const corpus = [...seededScopeCorpus(20_000, 0x5eed), ...NAMED_EDGE_CASES.map((text) => ({ text, finishReason: "stop" as const })),
    ...NAMED_EDGE_CASES.map((text) => ({ text, finishReason: "length" as const }))];
  assert.ok(corpus.length >= 20_000);
  let accepted = 0;
  let rejected = 0;
  const replaced = new Set<string>();
  for (const { text, finishReason } of corpus) {
    const before = legacyScopeOutcome(text, finishReason);
    const after = assessScopeResponse({ text, finishReason });
    assert.equal("assessment" in after, before.accepted, JSON.stringify({ text, finishReason }));
    if ("assessment" in after) {
      accepted++;
      assert.deepEqual(after.assessment, before.accepted ? before.assessment : undefined);
      continue;
    }
    rejected++;
    if (before.accepted) assert.fail("A previously accepted response is now rejected");
    if (before.reason === "invalid_json_malformed") {
      assert.ok(MALFORMED_REPLACEMENT_CODES.includes(after.failure), `${after.failure} from the former malformed code`);
      replaced.add(after.failure);
    } else {
      assert.equal(after.failure, before.reason, "A non-malformed rejection changed its code");
    }
  }
  assert.ok(accepted > 0 && rejected > 0, `accepted ${accepted}, rejected ${rejected}`);
  assert.ok(replaced.size >= 3, [...replaced].join(","));
});

test("Differential: the named edge cases keep their earlier labels where the shape did not change", () => {
  const failureOf = (text: string, finishReason?: "stop" | "length") => {
    const result = assessScopeResponse({ text, finishReason });
    return "failure" in result ? result.failure : "accepted";
  };
  assert.equal(failureOf(""), "invalid_json_prose");
  assert.equal(failureOf(`Result: ${SCOPE_ALLOWED_JSON}`), "invalid_json_wrapped");
  assert.equal(failureOf("```json\n" + SCOPE_ALLOWED_JSON + "\n```"), "invalid_json_fenced");
  assert.equal(failureOf("{", "length"), "invalid_json_truncated");
  assert.equal(failureOf(`${SCOPE_ALLOWED_JSON} Note: done.`), "invalid_json_wrapped");
  // The earlier wrapped precedence still wins when the first and last braces bracket a parseable object.
  assert.equal(failureOf(`${SCOPE_ALLOWED_JSON}{"scope":`), "invalid_json_wrapped");
  assert.equal(failureOf("[" + SCOPE_ALLOWED_JSON + "]"), "invalid_shape");
  assert.notEqual(parseScopeAssessment(SCOPE_ALLOWED), undefined);
  assert.equal(parseScopeAssessment({ ...SCOPE_ALLOWED, extra: 1 }), undefined);
});

// ADR 0106 amendment: pin the length-stop classification that decides retry eligibility. Shape codes, not prose, drive the retry.
test("length-stopped complete object followed by text is wrapped and retry-eligible", () => {
  const result = assessScopeResponse({ text: `${SCOPE_ALLOWED_JSON} Note: done.`, finishReason: "length" });
  assert.deepEqual(result, { failure: "invalid_json_wrapped" });
  assert.ok(SCOPE_RETRY_ELIGIBLE_REASONS.includes("invalid_json_wrapped"));
});

test("length-stopped unterminated object is truncated and not retried", () => {
  const result = assessScopeResponse({ text: `{"scope":"in_scope","risk":"ordinary",`, finishReason: "length" });
  assert.deepEqual(result, { failure: "invalid_json_truncated" });
  assert.equal(SCOPE_RETRY_ELIGIBLE_REASONS.includes("invalid_json_truncated"), false);
});

test("Scope failure finishReason is recorded alongside the shape code, and acceptance and retry eligibility are unchanged", async (t) => {
  const truncated = `{"scope":"in_scope","risk":"ordinary",`;
  // The classifier error carries the closed finish reason next to the same code the validator returned without it.
  const { client } = clientWith(() => jsonResponse(200, {
    id: "cmpl-finish", choices: [{ index: 0, message: { role: "assistant", content: truncated }, finish_reason: "length" }], usage: { prompt_tokens: 443, completion_tokens: 512 },
  }));
  await assert.rejects(new ModelScopeClassifier(client).assess(MESSAGE, CONTEXT), (error: unknown) => {
    assert.ok(error instanceof ScopeClassificationError);
    assert.equal(error.reason, "invalid_json_truncated");
    assert.equal(error.finishReason, "length");
    return true;
  });
  assert.deepEqual(assessScopeResponse({ text: truncated, finishReason: "length" }), { failure: "invalid_json_truncated" });
  // Acceptance is unchanged: a valid verdict is still accepted whatever its finish reason.
  assert.ok("assessment" in assessScopeResponse({ text: SCOPE_ALLOWED_JSON, finishReason: "length" }));
  // Runtime diagnostics record the same closed pair and no classifier text.
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("scope-finish-reason.sqlite") });
  t.after(() => environment.close());
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const runtime = new AssistantRuntime(environment, { generate: async (request) =>
    request.structuredOutput?.name === "concierge_scope" ? { text: truncated, finishReason: "length" } : { text: "{}" } }, {
    onDiagnostic: (event) => diagnostics.push(event),
  });
  const result = await runtime.handleTurn("scope-finish-reason", "Find stays in Lagos");
  assert.equal(result.ok, true);
  assert.deepEqual(diagnostics.filter((event) => event.scopeFailureReason !== undefined).map((event) => [event.scopeFailureReason, event.finishReason]),
    [["invalid_json_truncated", "length"]]);
  assert.doesNotMatch(JSON.stringify({ result, diagnostics }), /in_scope/);
});
