import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";
import worker, { isPlatformPath } from "../src/worker.js";
import type { CloudflareEnv } from "../src/cloudflare-config.js";

const ORIGIN = "https://pilot.example.test";

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
