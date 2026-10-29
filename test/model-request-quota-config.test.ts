import test from "node:test";
import assert from "node:assert/strict";
import { modelRequestQuotaLimitsFromEnvironment } from "../packages/platform-core/src/model-request-quota-config.js";
import type { AssistantModelClient, AssistantModelRequest } from "../apps/local-guest/src/assistant/assistant-model.js";
import { restartFixture } from "./helpers/guest-restart.js";

test("AC1: shared quota configuration defaults to existing daily and per-guest limits", () => {
  assert.deepEqual(modelRequestQuotaLimitsFromEnvironment({}), { dailyTenantLimit: 3000, hourlyGuestLimit: 60 });
});

test("AC5: default local paid composition honors existing per-guest and tenant limit overrides", async (t) => {
  const originalDaily = process.env.CONCIERGE_DAILY_MODEL_CALL_CAP;
  const originalHourly = process.env.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR;
  t.after(() => {
    if (originalDaily === undefined) delete process.env.CONCIERGE_DAILY_MODEL_CALL_CAP;
    else process.env.CONCIERGE_DAILY_MODEL_CALL_CAP = originalDaily;
    if (originalHourly === undefined) delete process.env.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR;
    else process.env.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR = originalHourly;
  });

  for (const limits of [
    { CONCIERGE_DAILY_MODEL_CALL_CAP: "100", SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "1" },
    { CONCIERGE_DAILY_MODEL_CALL_CAP: "1", SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "100" },
  ]) {
    process.env.CONCIERGE_DAILY_MODEL_CALL_CAP = limits.CONCIERGE_DAILY_MODEL_CALL_CAP;
    process.env.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR = limits.SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR;
    let transports = 0;
    const modelClient: AssistantModelClient = {
      supportsProviderAttemptReservation: true,
      async generate(request: AssistantModelRequest) {
        await request.beforeProviderAttempt?.();
        transports += 1;
        if (request.structuredOutput?.name === "concierge_scope") return { text: JSON.stringify({
          scope: "out_of_scope", risk: "ordinary", intents: [], reasonCode: "outside",
          slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null },
        }) };
        return { text: "{}" };
      },
    };
    const fixture = await restartFixture({}, { conciergeMode: "openai-compatible", modelClient });
    try {
      const first = await fixture.send("/api/turn", { text: "Write me a poem." });
      assert.equal(first.ok, true, JSON.stringify(first));
      const second = await fixture.send("/api/turn", { text: "Write me another poem." });
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(transports, 1, JSON.stringify(limits));
    } finally {
      await fixture.close();
    }
  }
});

test("AC1: shared quota configuration uses existing environment overrides and rejects invalid bounds", () => {
  assert.deepEqual(modelRequestQuotaLimitsFromEnvironment({
    CONCIERGE_DAILY_MODEL_CALL_CAP: "12",
    SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "3",
  }), { dailyTenantLimit: 12, hourlyGuestLimit: 3 });
  for (const source of [
    { CONCIERGE_DAILY_MODEL_CALL_CAP: "0" },
    { CONCIERGE_DAILY_MODEL_CALL_CAP: "1.5" },
    { CONCIERGE_DAILY_MODEL_CALL_CAP: "1000001" },
    { SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "0" },
    { SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "many" },
    { SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "1000001" },
  ]) assert.throws(() => modelRequestQuotaLimitsFromEnvironment(source));
});
