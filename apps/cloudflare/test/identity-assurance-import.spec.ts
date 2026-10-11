import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";
import { ORIGIN, accessToken, opsHeaders } from "./ops-test-helpers.js";

/**
 * Issue 09 (review): an ops import row that fails the identity-assurance rules is refused over the real `POST /_ops/import`
 * route with 400 and the stable code IDENTITY_ASSURANCE_REFUSED, and the message names no value (ops-routes.ts status mapping).
 */
test("AC6 failure path: the ops import route refuses an identity assurance row with 400 IDENTITY_ASSURANCE_REFUSED and no value", async () => {
  const response = await SELF.fetch(`${ORIGIN}/_ops/import`, {
    method: "POST",
    headers: opsHeaders(await accessToken({})),
    body: JSON.stringify({
      table: "guest_identity_assurance",
      rows: [{
        tenant_id: "tenant-synthetic", account_guest_id: "gacct-not-provisioned", level: "government-ID-verified",
        method: "12345678901", status: "verified", verified_at: "2026-10-10T09:00:00.000Z",
        expires_at: "2026-11-10T09:00:00.000Z", provider_reference: null,
      }],
    }),
  });
  const body = (await response.json()) as { ok: boolean; code: string; message: string };
  expect(response.status).toBe(400);
  expect(body.ok).toBe(false);
  expect(body.code).toBe("IDENTITY_ASSURANCE_REFUSED");
  expect(JSON.stringify(body).includes("12345678901")).toBe(false);
  expect(JSON.stringify(body).includes("gacct-not-provisioned")).toBe(false);
});
