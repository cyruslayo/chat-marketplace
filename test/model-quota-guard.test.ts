import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRequestQuotaPort } from "../packages/platform-core/src/model-request-quota.js";
import { ModelQuotaGuardClient } from "../apps/local-guest/src/assistant/model-quota-guard.js";
import { FallbackModelClient } from "../apps/local-guest/src/assistant/fallback-model-client.js";
import { APIConnectionError } from "../apps/local-guest/src/assistant/openai-compatible-client.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";

function attemptAware(transport: () => void): AssistantModelClient {
  return {
    supportsProviderAttemptReservation: true,
    async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
      await request.beforeProviderAttempt?.();
      transport();
      return { text: "ok" };
    },
  };
}

const request: AssistantModelRequest = {
  systemInstruction: "test",
  tools: [],
  history: [],
};

const identity = { tenantId: "tenant-a", guestId: "guest-a" };

test("AC3: a quota reservation that exceeds the request deadline cannot start transport after it resolves", async () => {
  let resolveReservation: ((value: { readonly reserved: true }) => void) | undefined;
  let transports = 0;
  const quota: ModelRequestQuotaPort = {
    reserve: () => new Promise((resolve) => { resolveReservation = resolve; }),
  };
  const client = new ModelQuotaGuardClient(attemptAware(() => { transports += 1; }), quota, identity);
  await assert.rejects(
    client.generate({ ...request, timeoutMs: 20 }),
    (error: unknown) => error instanceof Error && error.message === "deadline_exceeded",
  );
  resolveReservation?.({ reserved: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(transports, 0);
});

test("AC3: the shorter of the request timeout and absolute deadline bounds quota reservation", async () => {
  let transports = 0;
  const quota: ModelRequestQuotaPort = {
    reserve: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { reserved: true };
    },
  };
  const client = new ModelQuotaGuardClient(attemptAware(() => { transports += 1; }), quota, identity);
  await assert.rejects(client.generate({ ...request, timeoutMs: 15, deadlineAt: Date.now() + 500 }), /deadline_exceeded/);
  await assert.rejects(client.generate({ ...request, timeoutMs: 500, deadlineAt: Date.now() + 15 }), /deadline_exceeded/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(transports, 0);
});

test("AC3: a configured fallback provider reserves its own actual transport attempt", async () => {
  let reservations = 0;
  const quota: ModelRequestQuotaPort = {
    reserve: async () => { reservations += 1; return { reserved: true }; },
  };
  const primary = attemptAware(() => { throw new APIConnectionError("connection_failed"); });
  const secondary = attemptAware(() => undefined);
  const fallback = new ModelQuotaGuardClient(new FallbackModelClient(primary, secondary), quota, identity);
  assert.deepEqual(await fallback.generate(request), { text: "ok" });
  assert.equal(reservations, 2);
});

test("AC2: quota refusal and authority failure stop transport safely", async () => {
  let transports = 0;
  const outcomes: string[] = [];
  const inner = attemptAware(() => { transports += 1; });
  const denied = new ModelQuotaGuardClient(inner, {
    reserve: async () => ({ reserved: false, reason: "guest_hour_limit" }),
  }, identity, undefined, (outcome) => outcomes.push(outcome));
  await assert.rejects(
    denied.generate(request),
    (error: unknown) => error instanceof Error && error.message === "quota_denied",
  );

  const unavailable = new ModelQuotaGuardClient(inner, {
    reserve: async () => { throw new Error("storage unavailable"); },
  }, identity, undefined, (outcome) => outcomes.push(outcome));
  await assert.rejects(
    unavailable.generate(request),
    (error: unknown) => error instanceof Error && error.message === "quota_unavailable",
  );
  assert.equal(transports, 0);
  assert.deepEqual(outcomes, ["quota_refusal", "guard_failure"]);
});

// ---- Classifier retry through the quota guard (design section 14.4): each attempt reserves before its own transport ----

const retryIdentity = { tenantId: "tenant-retry", guestId: "guest-retry" };
const retryClassifierContext = { domain: "shortlet", description: "Stays", hasShortlist: false, hasSelectedStay: false, hasOffer: false };

async function guardedRetryClassifier(model: AssistantModelClient, quota: ModelRequestQuotaPort, events: { classifierRetryResult: string }[]) {
  const { RetryingScopeClassifier } = await import("../apps/local-guest/src/assistant/scope-classifier-retry.js");
  const { ModelScopeClassifier } = await import("../apps/local-guest/src/assistant/scope-classifier.js");
  const guard = new ModelQuotaGuardClient(model, quota, retryIdentity);
  return new RetryingScopeClassifier({
    createAttempt: (timeoutMs: number) => new ModelScopeClassifier(guard, timeoutMs),
    onAttempt: (event: { classifierRetryResult: string }) => events.push(event),
  });
}

test("Retry quota: a denied second reservation stops transport and reports quota_denied without a fetch", async () => {
  const { ScriptedClassifierModel, ScriptedQuotaPort, TRAILING_TEXT_CLASSIFIER_TEXT, VALID_CLASSIFIER_TEXT } = await import("./helpers/scope-classifier-retry-fixtures.js");
  const quota = new ScriptedQuotaPort([true, false]);
  const model = new ScriptedClassifierModel([{ response: { text: TRAILING_TEXT_CLASSIFIER_TEXT } }, { response: { text: VALID_CLASSIFIER_TEXT } }]);
  const events: { classifierRetryResult: string }[] = [];
  const classifier = await guardedRetryClassifier(model, quota, events);
  await assert.rejects(classifier.assess("Find a stay", retryClassifierContext));
  assert.deepEqual(quota.reservations, [true, false]);
  assert.equal(model.transports, 1);
  assert.equal(events.at(-1)?.classifierRetryResult, "quota_denied");
});

test("Retry reservation: each provider attempt reserves exactly once before its own transport, and a refused first reservation never transports", async () => {
  const { ScriptedClassifierModel, ScriptedQuotaPort, TRAILING_TEXT_CLASSIFIER_TEXT, VALID_CLASSIFIER_TEXT } = await import("./helpers/scope-classifier-retry-fixtures.js");
  const allowed = new ScriptedQuotaPort([true, true]);
  const retried = new ScriptedClassifierModel([{ response: { text: TRAILING_TEXT_CLASSIFIER_TEXT } }, { response: { text: VALID_CLASSIFIER_TEXT } }]);
  assert.equal((await (await guardedRetryClassifier(retried, allowed, [])).assess("Find a stay", retryClassifierContext)) !== undefined, true);
  assert.deepEqual(allowed.reservations, [true, true]);
  assert.equal(retried.transports, 2);
  const refused = new ScriptedQuotaPort([false]);
  const refusedModel = new ScriptedClassifierModel([{ response: { text: VALID_CLASSIFIER_TEXT } }]);
  await assert.rejects((await guardedRetryClassifier(refusedModel, refused, [])).assess("Find a stay", retryClassifierContext));
  assert.deepEqual(refused.reservations, [false]);
  assert.equal(refusedModel.transports, 0);
});

test("Retry reservation: a crash after reservation and before a successful send is not refunded", async () => {
  const { ScriptedClassifierModel, ScriptedQuotaPort, TRAILING_TEXT_CLASSIFIER_TEXT } = await import("./helpers/scope-classifier-retry-fixtures.js");
  const quota = new ScriptedQuotaPort([true, true]);
  const model = new ScriptedClassifierModel([{ response: { text: TRAILING_TEXT_CLASSIFIER_TEXT } }, { error: new Error("crash before send") }]);
  const classifier = await guardedRetryClassifier(model, quota, []);
  await assert.rejects(classifier.assess("Find a stay", retryClassifierContext));
  assert.deepEqual(quota.reservations, [true, true]);
  assert.deepEqual(quota.refunds, []);
});

test("Retry deadline: a reservation that resolves after the retry deadline cannot start transport", async () => {
  const { ScriptedClassifierModel, TRAILING_TEXT_CLASSIFIER_TEXT, VALID_CLASSIFIER_TEXT } = await import("./helpers/scope-classifier-retry-fixtures.js");
  const { RetryingScopeClassifier } = await import("../apps/local-guest/src/assistant/scope-classifier-retry.js");
  const { ModelScopeClassifier } = await import("../apps/local-guest/src/assistant/scope-classifier.js");
  let reservations = 0;
  const lateQuota: ModelRequestQuotaPort = { reserve: async () => {
    reservations++;
    if (reservations === 1) return { reserved: true };
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { reserved: true };
  } };
  const model = new ScriptedClassifierModel([{ response: { text: TRAILING_TEXT_CLASSIFIER_TEXT } }, { response: { text: VALID_CLASSIFIER_TEXT } }]);
  const guard = new ModelQuotaGuardClient(model, lateQuota, retryIdentity);
  const classifier = new RetryingScopeClassifier({
    createAttempt: (timeoutMs: number) => new ModelScopeClassifier(guard, timeoutMs),
    retryTimeoutMs: 50,
  });
  await assert.rejects(classifier.assess("Find a stay", retryClassifierContext));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(model.transports, 1);
});
