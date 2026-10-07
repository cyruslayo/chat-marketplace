import { SELF } from "cloudflare:test";
import { createHmac } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import { ORIGIN, SECRET, TENANT, accessToken, opsHeaders, provisionTenant } from "./ops-test-helpers.js";

// The synthetic Paystack secret from `wrangler.test.jsonc`.
const PAYSTACK_SECRET = "sk_test_synthetic";

function webhookSignature(body: string): string {
  return createHmac("sha256", PAYSTACK_SECRET).update(Buffer.from(body)).digest("hex");
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("13 AC1: no cookie, token, shared secret, signature or webhook body reaches the console", async () => {
  await provisionTenant();
  const token = await accessToken();

  const captured: string[] = [];
  const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
  for (const spy of spies) spy.mockImplementation((...args: unknown[]) => { captured.push(args.map((argument) => typeof argument === "string" ? argument : JSON.stringify(argument)).join(" ")); });

  // A guest page; its session cookie must not be logged.
  const guest = await SELF.fetch(`${ORIGIN}/?invite=synthetic-invite`);
  const sessionCookie = (guest.headers.getSetCookie().find((cookie: string) => cookie.startsWith("shortlet_guest_session=")) ?? "").split(";")[0]!;

  // An ops call carrying the shared secret and an Access assertion.
  const ops = await SELF.fetch(`${ORIGIN}/_ops/operators`, { headers: opsHeaders(token) });

  // A signed Paystack webhook with a distinctive body.
  const body = JSON.stringify({ event: "charge.success", data: { reference: "webhook-body-must-not-leak" } });
  const webhook = await SELF.fetch(`${ORIGIN}/webhooks/paystack`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": webhookSignature(body) },
    body,
  });

  for (const spy of spies) spy.mockRestore();
  expect(guest.status, `guest=${guest.status} ops=${ops.status} webhook=${webhook.status}`).toBe(200);
  expect(ops.status).toBe(200);
  expect(typeof webhook.status).toBe("number");
  const output = captured.join("\n");

  const secrets = [sessionCookie, SECRET, token, webhookSignature(body), "webhook-body-must-not-leak"].filter((value) => value !== "");
  // The shared secret, the token, the signature and the body marker are always in the list.
  expect(secrets.length).toBeGreaterThanOrEqual(4);
  for (const secret of secrets) expect(output).not.toContain(secret);
});

test("13 AC2: the Guest security headers arrive through the Worker unchanged", async () => {
  await provisionTenant();
  const response = await SELF.fetch(`${ORIGIN}/?invite=synthetic-invite`);
  expect(response.status).toBe(200);
  // The same constants the Node guest server sends (packages/platform-core/src/security-headers.ts).
  expect(response.headers.get("content-security-policy")).toBe(GUEST_HTML_SECURITY_HEADERS["Content-Security-Policy"]);
  expect(response.headers.get("referrer-policy")).toBe(GUEST_HTML_SECURITY_HEADERS["Referrer-Policy"]);
});
