import { env } from "cloudflare:workers";
import { abortAllDurableObjects } from "cloudflare:test";
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

test("AC2: configured shared limits survive a PlatformDO cold start", async () => {
  const tenantId = `quota-limits-${crypto.randomUUID()}`;
  const bindings = { ...env, SHORTLET_TENANT_ID: tenantId, PLATFORM: env.ISOLATED_PLATFORM };
  const first = platformModelRequestQuota(bindings, tenantId);
  const second = platformModelRequestQuota(bindings, tenantId);
  const scope = { tenantId, guestId: "cold-start-guest" };
  const reservations = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? first : second).reserve(scope)));
  expect(reservations.filter((result) => result.reserved)).toHaveLength(2);
  expect(reservations.filter((result) => !result.reserved && result.reason === "guest_hour_limit")).toHaveLength(10);

  await abortAllDurableObjects();
  const restarted = platformModelRequestQuota(bindings, tenantId);
  expect(await restarted.reserve(scope)).toEqual({ reserved: false, reason: "guest_hour_limit" });
  expect(await restarted.reserve({ tenantId, guestId: "second-guest" })).toEqual({ reserved: true });
  expect(await restarted.reserve({ tenantId, guestId: "third-guest" })).toEqual({ reserved: false, reason: "tenant_day_limit" });
}, 30_000);
