import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { loadCloudflareConfiguration, cloudflareProvisioningState, type CloudflareEnv } from "../src/cloudflare-config.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

const source = {
  SHORTLET_PUBLIC_ORIGIN: "https://pilot.example.test", SHORTLET_TENANT_ID: "tenant-synthetic",
  PAYSTACK_SECRET_KEY: "sk_test_synthetic", PAYSTACK_ENVIRONMENT: "test",
  SHORTLET_DEPLOYMENT: "staging", SHORTLET_BETA_INVITE_CODE: "synthetic-invite",
  SHORTLET: env.TEST_HARNESS, RECEIPTS: env.RECEIPTS, EXPORTS: env.EXPORTS,
  ASSETS: { fetch: async () => new Response("not used") },
} as unknown as CloudflareEnv;

test("10a: Shared configuration validates explicit vars in workerd without Node file paths", () => {
  const configuration = loadCloudflareConfiguration(source);
  expect(configuration.tenantId).toBe("tenant-synthetic");
  expect(configuration.paystack.environment).toBe("test");
  expect(configuration.publicOrigin).toBe(source.SHORTLET_PUBLIC_ORIGIN);
  expect(() => loadCloudflareConfiguration({ ...source, PAYSTACK_CALLBACK_BASE_URL: "https://other.example.test" })).toThrow(/callback origin/);
  expect(() => loadCloudflareConfiguration({ ...source, PAYSTACK_ENVIRONMENT: "live" })).toThrow(/Staging requires/);
});

test("10a: An empty Durable Object is not provisioned and creates no demo inventory", async () => {
  const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName("10a-empty-provisioning"));
  await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    expect(cloudflareProvisioningState(loadCloudflareConfiguration(source), database)).toEqual({ provisioned: false });
    expect(database.prepare("SELECT COUNT(*) AS count FROM units").get()?.count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM operators").get()?.count).toBe(0);
  });
});
