import { env } from "cloudflare:workers";
import { SELF, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { createPlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { seedIssue01Units } from "../../../domains/shortlet/src/browse.js";
import { createProvisionedOperator } from "../../../domains/shortlet/src/operator.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { LocalApartmentOwnerEnvironment } from "../../local-owner/src/local-owner-environment.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { R2ReceiptBlobStore } from "../src/r2-receipt-blob-store.js";

// Production-launch issue 09 AC6 — the pilot metrics page reads the Durable Object store and serves on the Worker.

const ORIGIN = "https://pilot.example.test";
const TENANT = "tenant-synthetic";
const ACTOR = "production-session-actor";

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function provisionTenant() {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));
  const ids = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const units = new SqliteUnitRepository(database);
    if (units.findAll().length === 0) seedIssue01Units(units);
    const unitList = units.findAll();
    const operators = new SqliteOperatorRepository(database, { clock: () => new Date() });
    for (const [id, name] of new Map(unitList.map((unit) => [unit.operator.id, unit.operator.name]))) {
      if (!operators.findById(id)) operators.create(createProvisionedOperator({ id, tenantId: TENANT, name: name?.trim() || "Fixture Operator", now: new Date() }));
    }
    const unit = unitList[0]!;
    return { operatorId: unit.operator.id, unitId: unit.id, propertyId: unit.propertyId };
  });
  return { stub, ...ids };
}

test("AC6 — The page works on the Worker", async () => {
  const { stub, operatorId, unitId, propertyId } = await provisionTenant();
  const token = await runInDurableObject(stub, (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    const owner = new LocalApartmentOwnerEnvironment(
      {
        tenantId: TENANT,
        operatorId,
        operatorName: "Fixture Operator",
        representativePersonId: ACTOR,
        representativePersonName: "Production Operator Representative",
        adminId: "production-operations",
        unitId,
        propertyId,
        seedFixture: false,
        production: true,
        conditionalOfferSigningKey: env.SHORTLET_CONDITIONAL_OFFER_KEY,
        clock: () => new Date(),
      },
      {
        database,
        unitRepository: new SqliteUnitRepository(database),
        operatorRepository: new SqliteOperatorRepository(database),
        receiptBlobs: new R2ReceiptBlobStore(env.RECEIPTS),
      },
    );
    if (!owner.grantStore.canActForOperator({ actorId: ACTOR, operatorId, tenantId: TENANT })) {
      owner.grantStore.createGrant(createPlatformCommandEnvelope({
        commandName: "operator_representative.grant",
        principal: { id: "production-operations", role: "admin", tenantId: TENANT },
        payload: {
          actorId: ACTOR,
          operatorId,
          expiresAtIso: "2027-01-01T00:00:00Z",
          responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z",
          verificationReference: "verification-pilot-metrics",
        },
        idempotencyKey: `seed-grant-${operatorId}`,
      }));
    }
    // A disclosed, confirmed Booking Request written straight to the authoritative table: the page must count it.
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO guest_booking_requests
      (request_id, draft_id, unit_id, tenant_id, operator_id, primary_guest_id, primary_guest_name, occupants_json,
       check_in, check_out, nights, quote_json, inventory_commitment_id, disclosed_at, delivery_deadline_at,
       operator_response_deadline_at, delivered, delivered_at, status, confirmed_at, declined_at, decline_reason, phone_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
      "metrics-request-1", "metrics-draft-1", unitId, TENANT, operatorId, "metrics-guest-1", "Metrics Guest",
      JSON.stringify([{ name: "Metrics Guest" }]), "2026-12-10", "2026-12-12", 2, JSON.stringify({}),
      "metrics-commitment-1", now, now, now, 1, now, "confirmed", now, null, null, null,
    ]);
    return owner.provisionOperatorAccessToken(ACTOR, TENANT);
  });

  // Build the served runtime, then sign in through the Worker as the Operator representative.
  const health = await SELF.fetch(`${ORIGIN}/healthz`);
  expect(health.status).toBe(200);

  const anonymous = await SELF.fetch(`${ORIGIN}/operator/metrics`, { redirect: "manual" });
  expect(anonymous.status).toBe(303);
  expect(anonymous.headers.get("location")).toBe("/operator/login");

  const login = await SELF.fetch(`${ORIGIN}/operator/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": "203.0.113.31" },
    body: `token=${encodeURIComponent(token)}`,
    redirect: "manual",
  });
  expect(login.status).toBe(302);
  const cookie = login.headers.getSetCookie().map((value: string) => value.split(";")[0]).join("; ");

  const page = await SELF.fetch(`${ORIGIN}/operator/metrics`, { headers: { cookie } });
  expect(page.status).toBe(200);
  const text = visibleText(await page.text());
  expect(text).toContain("Pilot metrics");
  expect(text).toContain("Requests received 1");
  // An unavailable metric says so instead of showing zero (relocation has no durable production record).
  expect(text).toContain("Relocations Not available");
}, 30000);
