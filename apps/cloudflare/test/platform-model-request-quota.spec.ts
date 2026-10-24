import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { platformModelRequestQuota } from "../src/do-clients.js";

test("AC5: independent domain adapters share PLATFORM hourly reservations and reject malformed RPC input", async () => {
  const tenantId = env.SHORTLET_TENANT_ID?.trim();
  expect(tenantId).toBeTruthy();
  const guestId = `quota-test-${crypto.randomUUID()}`;
  const firstDomain = platformModelRequestQuota(env, tenantId!);
  const secondDomain = platformModelRequestQuota(env, tenantId!);
  for (let index = 0; index < 60; index++) {
    expect(await (index % 2 === 0 ? firstDomain : secondDomain).reserve({ tenantId: tenantId!, guestId })).toEqual({ reserved: true });
  }
  expect(await secondDomain.reserve({ tenantId: tenantId!, guestId })).toEqual({ reserved: false, reason: "guest_hour_limit" });

  const stub = env.PLATFORM.get(env.PLATFORM.idFromName(tenantId!));
  const malformed = await stub.fetch("https://do.internal/_internal/model-quota/reserve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, guestId: `malformed-${crypto.randomUUID()}`, limit: 1 }),
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ ok: false, code: "INVALID_QUOTA_REQUEST" });
}, 30_000);
