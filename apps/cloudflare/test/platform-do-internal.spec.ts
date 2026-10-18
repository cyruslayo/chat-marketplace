import { env } from "cloudflare:workers";
import { SELF, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import type { CloudflareEnv } from "../src/cloudflare-config.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { platformAccountStateReader, platformGuestAccounts, shortletDomainClient } from "../src/do-clients.js";

const TENANT = "tenant-synthetic";
const ORIGIN = "https://pilot.example.test";

test("Slice 17 AC2: Worker denies public internal paths while typed tenant-scoped DO clients call the opposite authority", async () => {
  const publicInternal = await SELF.fetch(`${ORIGIN}/_internal/account-assurance-state`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: TENANT, accountGuestId: "gacct-internal" }),
  });
  expect(publicInternal.status).toBe(404);

  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  await runInDurableObject(platform, (_instance, ctx) => {
    new DurableObjectSqlDatabase(ctx.storage).prepare(`INSERT INTO guest_accounts
      (account_guest_id, tenant_id, email_normalized, status, created_at, updated_at, revision, email_revision)
      VALUES (?, ?, ?, 'active', ?, ?, 0, 7)`).run(["gacct-internal", TENANT, "internal@example.test", "2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z"]);
  });
  const state = await platformAccountStateReader(env as unknown as CloudflareEnv, TENANT)
    .readAccountAssuranceState({ tenantId: TENANT, accountGuestId: "gacct-internal" });
  expect(state).toEqual({ status: "active", emailRevision: 7 });
  await expect(platformAccountStateReader(env as unknown as CloudflareEnv, TENANT)
    .readAccountAssuranceState({ tenantId: "tenant-other", accountGuestId: "gacct-internal" })).rejects.toThrow(/scope/);

  const shortlet = env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));
  await runInDurableObject(shortlet, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    database.prepare(`INSERT INTO guest_identity_assurance
      (tenant_id, account_guest_id, account_email_revision, level, method, status, verified_at, expires_at, provider_reference)
      VALUES (?, ?, 7, 'government-ID-verified', 'nigeria_nin_v2_biometric_kyc', 'verified', ?, ?, NULL)`)
      .run([TENANT, "gacct-internal", "2026-10-10T00:00:00.000Z", "2026-11-10T00:00:00.000Z"]);
  });
  await shortletDomainClient(env as unknown as CloudflareEnv, TENANT).invalidateGuestIdentityAssurance({ tenantId: TENANT, accountGuestId: "gacct-internal" });
  const remaining = await runInDurableObject(shortlet, (_instance, ctx) =>
    new DurableObjectSqlDatabase(ctx.storage).prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?").get([TENANT, "gacct-internal"])?.n,
  );
  expect(remaining).toBe(0);
}, 30000);

test("PLATFORM account RPC writes codes only in PLATFORM and serves the public account path through the configured application", async () => {
  const client = platformGuestAccounts(env as unknown as CloudflareEnv, TENANT);
  const challenge = await client.requestCode({ tenantId: TENANT, email: "account-runtime@example.test", purpose: "sign_in", clientAddress: "192.0.2.1" });
  expect(challenge.challengeId).toBeTruthy();
  const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
  const platformRow = await runInDurableObject(platform, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
    .prepare("SELECT tenant_id, email_normalized FROM guest_sign_in_codes WHERE challenge_id = ?")
    .get([challenge.challengeId]));
  expect(platformRow).toEqual({ tenant_id: TENANT, email_normalized: "account-runtime@example.test" });
  const shortlet = env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));
  const shortletAccountTable = await runInDurableObject(shortlet, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'guest_sign_in_codes'").get([]));
  expect(shortletAccountTable).toBeUndefined();
  const response = await platform.fetch(new Request(`${ORIGIN}/account/sign-in`) as unknown as import("@cloudflare/workers-types").Request);
  expect(response.status).not.toBe(404);
}, 30000);
