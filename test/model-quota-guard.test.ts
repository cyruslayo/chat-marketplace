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
  const inner = attemptAware(() => { transports += 1; });
  const denied = new ModelQuotaGuardClient(inner, {
    reserve: async () => ({ reserved: false, reason: "guest_hour_limit" }),
  }, identity);
  await assert.rejects(
    denied.generate(request),
    (error: unknown) => error instanceof Error && error.message === "quota_denied",
  );

  const unavailable = new ModelQuotaGuardClient(inner, {
    reserve: async () => { throw new Error("storage unavailable"); },
  }, identity);
  await assert.rejects(
    unavailable.generate(request),
    (error: unknown) => error instanceof Error && error.message === "quota_unavailable",
  );
  assert.equal(transports, 0);
});
