import { env } from "cloudflare:workers";
import { SELF, abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { seedIssue01Units } from "../../../domains/shortlet/src/browse.js";
import { createProvisionedOperator } from "../../../domains/shortlet/src/operator.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { LocalApartmentOwnerEnvironment } from "../../local-owner/src/local-owner-environment.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { R2ReceiptBlobStore } from "../src/r2-receipt-blob-store.js";

const ORIGIN = "https://pilot.example.test";
/** The single tenant the test Worker is bound to (`SHORTLET_TENANT_ID` in `wrangler.test.jsonc`). */
const TENANT = "tenant-synthetic";

/** Seed a tenant's inventory and its operators into the Durable Object (no demo fallback in production). */
async function provision(tenant: string) {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(tenant));
  const ids = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const units = new SqliteUnitRepository(database);
    if (units.findAll().length === 0) seedIssue01Units(units);
    const operators = new SqliteOperatorRepository(database, { clock: () => new Date() });
    const unitList = units.findAll();
    const now = new Date();
    for (const [id, name] of new Map(unitList.map((unit) => [unit.operator.id, unit.operator.name]))) {
      // Idempotent: sibling tests in this file share the tenant's Durable Object storage.
      if (!operators.findById(id)) operators.create(createProvisionedOperator({ id, tenantId: tenant, name: name?.trim() || "Fixture Operator", now }));
    }
    const unit = unitList[0]!;
    return { operatorId: unit.operator.id, unitId: unit.id, propertyId: unit.propertyId };
  });
  return { stub, ...ids };
}

test("10b AC4: SELF.fetch traverses the Worker into the Durable Object for health, a guest page and the webhook refusal", async () => {
  await provision(TENANT);

  const health = await SELF.fetch(`${ORIGIN}/healthz`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true });

  // The beta invite gate is on for the staging test deployment, so a new session needs the invite code.
  const guest = await SELF.fetch(`${ORIGIN}/?invite=synthetic-invite`);
  expect(guest.status).toBe(200);
  expect(guest.headers.get("content-type")).toContain("text/html");

  // ADR 0087/0088: a webhook without a valid signature is refused and changes nothing.
  const refused = await SELF.fetch(`${ORIGIN}/webhooks/paystack`, {
    method: "POST",
    headers: { "x-paystack-signature": "deadbeef", "content-type": "application/json" },
    body: JSON.stringify({ event: "charge.success" }),
  });
  expect(refused.status).toBe(401);
});

test("10b AC4 failure path: an unprovisioned object answers 503 and creates no inventory", async () => {
  const fresh = env.SHORTLET.get(env.SHORTLET.idFromName("tenant-empty"));
  const response = await fresh.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.8" } });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "NOT_PROVISIONED" });
  await runInDurableObject(fresh, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    expect(database.prepare("SELECT COUNT(*) AS count FROM units").get()?.count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM operators").get()?.count).toBe(0);
  });
});

test("10b AC2: a provisioned operator signs in and the session survives a Durable Object restart", async () => {
  const { stub, operatorId, unitId, propertyId } = await provision(TENANT);
  const actorId = "production-session-actor";

  const token = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const owner = new LocalApartmentOwnerEnvironment(
      {
        tenantId: TENANT,
        operatorId,
        operatorName: "Fixture Operator",
        representativePersonId: actorId,
        representativePersonName: "Production Operator Representative",
        adminId: "production-operations",
        unitId,
        propertyId,
        seedFixture: false,
        production: true,
        clock: () => new Date(),
      },
      {
        database,
        unitRepository: new SqliteUnitRepository(database),
        operatorRepository: new SqliteOperatorRepository(database),
        receiptBlobs: new R2ReceiptBlobStore(env.RECEIPTS),
      },
    );
    // ADR 0082: provisioning an access token needs an explicit representative grant, as the ops route will require.
    if (!owner.grantStore.canActForOperator({ actorId, operatorId, tenantId: TENANT })) {
      owner.grantStore.createGrant(
        createPlatformCommandEnvelope({
          commandName: "operator_representative.grant",
          principal: { id: "production-operations", role: "admin", tenantId: TENANT },
          payload: {
            actorId,
            operatorId,
            expiresAtIso: "2027-01-01T00:00:00Z",
            responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z",
            verificationReference: "verification-test-001",
          },
          idempotencyKey: `seed-grant-${actorId}`,
        }),
      );
    }
    return owner.provisionOperatorAccessToken(actorId, TENANT);
  });

  const login = await SELF.fetch(`${ORIGIN}/operator/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" },
    body: `token=${encodeURIComponent(token)}`,
    redirect: "manual",
  });
  expect(login.status).toBe(302);
  const cookies = login.headers.getSetCookie().map((cookie: string) => cookie.split(";")[0]).join("; ");
  expect(cookies).toContain("shortlet_operator_session");

  const before = await SELF.fetch(`${ORIGIN}/operator`, { headers: { cookie: cookies } });
  expect(before.status).toBe(200);

  // ADR 0086: the session lives in Durable Object SQLite, so re-creating the object's instance does not sign the
  // operator out. `abortAllDurableObjects` tears the instance down without deleting durable storage.
  await abortAllDurableObjects();
  const after = await SELF.fetch(`${ORIGIN}/operator`, { headers: { cookie: cookies } });
  expect(after.status).toBe(200);
}, 30000);

test("10b AC5: the alarm sweeps notifications and reschedules itself", async () => {
  const { stub } = await provision(TENANT);
  // A first request builds the runtime and schedules the initial sweep.
  await stub.fetch(`${ORIGIN}/healthz`, { headers: { "cf-connecting-ip": "203.0.113.10" } });

  await runInDurableObject(stub, async (instance, ctx) => {
    await instance.alarm();
    expect(await ctx.storage.getAlarm()).not.toBeNull();
  });
});
