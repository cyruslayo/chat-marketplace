import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";
import worker, { isPlatformPath } from "../src/worker.js";
import type { CloudflareEnv } from "../src/cloudflare-config.js";

const ORIGIN = "https://pilot.example.test";
const UNPROVISIONED_BINDINGS = [{}, { SHORTLET_TENANT_ID: "" }, { SHORTLET_TENANT_ID: "   " }];

test.each(UNPROVISIONED_BINDINGS)("24 AC2: public commerce API paths return 404 without tenant provisioning (%j)", async (bindings) => {
  for (const path of ["/api/commerce", "/api/commerce/orders"]) {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, { method: "POST" }) as unknown as import("@cloudflare/workers-types").Request,
      bindings as unknown as CloudflareEnv,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: "NOT_FOUND" });
  }
});

test.each(UNPROVISIONED_BINDINGS)("24 AC1: internal paths stay private without tenant provisioning (%j)", async (bindings) => {
  for (const path of ["/_internal", "/_internal/ops/status"]) {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, { method: "POST" }) as unknown as import("@cloudflare/workers-types").Request,
      bindings as unknown as CloudflareEnv,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: "NOT_FOUND" });
  }
});

test.each(UNPROVISIONED_BINDINGS)("24 AC3: unprovisioned Shortlet paths retain 503 (%j)", async (bindings) => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/healthz`) as unknown as import("@cloudflare/workers-types").Request,
    bindings as unknown as CloudflareEnv,
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "NOT_PROVISIONED" });
});

test("Slice 17 AC2: SELF.fetch routes account/session/thread paths to PLATFORM and shortlet paths to SHORTLET, preserving the missing-tenant 503", async () => {
  // Account presentation is forwarded directly to the Shortlet application; provisioning keeps it unavailable here.
  const account = await SELF.fetch(`${ORIGIN}/account/sign-in`);
  const shortletHealth = await SELF.fetch(`${ORIGIN}/healthz`);
  expect(account.status).toBe(503);
  expect(shortletHealth.status).toBe(503);
  expect(await shortletHealth.json()).toEqual({ ok: false, code: "NOT_PROVISIONED" });
  expect(isPlatformPath("/account/sign-in/code")).toBe(true);
  expect(isPlatformPath("/api/threads/thread-123")).toBe(true);
  expect(isPlatformPath("/bookings/request")).toBe(false);

  const missingTenant = await worker.fetch(
    new Request(`${ORIGIN}/healthz`) as unknown as import("@cloudflare/workers-types").Request,
    { SHORTLET_TENANT_ID: "" } as unknown as CloudflareEnv,
  );
  expect(missingTenant.status).toBe(503);
}, 30000);
