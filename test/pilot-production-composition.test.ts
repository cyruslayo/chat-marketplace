import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { loadPilotConfiguration } from "../apps/pilot/src/pilot-config.js";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { SqliteOperatorRepresentativeGrantStore, SqliteOperatorSessionAuthority, type PaystackClient, type Unit } from "../domains/shortlet/src/index.js";

const PUBLIC_ORIGIN = "https://pilot.example.com";

interface ProductionFixture {
  readonly directory: string;
  readonly configuration: ReturnType<typeof loadPilotConfiguration>;
  readonly paystack: PaystackClient;
}

async function productionFixture(): Promise<ProductionFixture> {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-pilot-composition-"));
  const source = new LocalGuestEnvironment({ databasePath: join(directory, "source.sqlite") });
  const units = source.unitRepository.findAll() as Unit[];
  source.close();
  const unit = units[0]!;
  const operator = {
    id: unit.operator.id,
    tenantId: "tenant-pilot",
    name: unit.operator.name,
    status: unit.operator.status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const inventoryPath = join(directory, "inventory.json");
  const operatorsPath = join(directory, "operators.json");
  await writeFile(inventoryPath, JSON.stringify(units), "utf8");
  await writeFile(operatorsPath, JSON.stringify([operator]), "utf8");
  const configuration = loadPilotConfiguration({
    SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    SHORTLET_DB_PATH: join(directory, "pilot.sqlite"),
    SHORTLET_INVENTORY_PATH: inventoryPath,
    SHORTLET_OPERATORS_PATH: operatorsPath,
    PAYSTACK_SECRET_KEY: "sk_live_test-only",
    PAYSTACK_ENVIRONMENT: "live",
  });
  const paystack: PaystackClient = {
    configuration: { environment: "live", callbackBaseUrl: PUBLIC_ORIGIN },
    initializeTransaction: async () => { throw new Error("Paystack network is not part of this test"); },
    verifyTransaction: async () => { throw new Error("Paystack network is not part of this test"); },
    verifyWebhookSignature: () => false,
  };
  return { directory, configuration, paystack };
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0]!;
}

async function setupAuthority(fixture: ProductionFixture): Promise<{ readonly token: string; readonly actorId: string }> {
  const actorId = "pilot-operator-actor";
  const grants = new SqliteOperatorRepresentativeGrantStore(fixture.configuration.databasePath, { clock: () => new Date("2026-09-21T10:00:00Z") });
  grants.createGrant(createPlatformCommandEnvelope({
    commandName: "operator_representative.grant",
    principal: { id: "pilot-admin", role: "admin", tenantId: fixture.configuration.tenantId },
    payload: {
      actorId,
      operatorId: fixture.configuration.operatorId,
      expiresAtIso: "2027-01-01T00:00:00Z",
      responsiblePersonVerifiedAtIso: "2026-01-01T00:00:00Z",
      verificationReference: "pilot-verification-reference",
    },
    idempotencyKey: "pilot-test-grant",
  }));
  const sessions = new SqliteOperatorSessionAuthority(fixture.configuration.databasePath, { clock: () => new Date("2026-09-21T10:00:00Z") });
  const token = sessions.provisionAccessToken({ actorId, tenantId: fixture.configuration.tenantId, representativeAuthorized: true }).token;
  sessions.close();
  grants.close();
  return { token, actorId };
}

test("AC1/AC2/AC3 — Production Guest sessions create distinct server-owned principals", async () => {
  const fixture = await productionFixture();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
  try {
    const port = await server.listen();
    const first = await fetch(`http://127.0.0.1:${port}/`);
    const second = await fetch(`http://127.0.0.1:${port}/`);
    const firstCookie = cookieFrom(first);
    const secondCookie = cookieFrom(second);
    assert.notEqual(firstCookie, secondCookie);
    assert.match(firstCookie, /^shortlet_guest_session=gs-/);
    assert.deepEqual(server.guest.environment.grantStore.listGrants(), []);
    const forged = await fetch(`http://127.0.0.1:${port}/api/state?threadId=g-${crypto.randomUUID()}`, { headers: { Cookie: "shortlet_guest_session=gs-forged" } });
    assert.equal(forged.status, 401);
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("AC4/AC5/AC7/AC9/AC10/AC11/AC12/AC13 — Production Guest isolation, cookie, Origin, and fixture-route boundaries hold", async () => {
  const fixture = await productionFixture();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    const guestA = cookieFrom(await fetch(`${base}/`));
    const guestB = cookieFrom(await fetch(`${base}/`));
    const contact = new URLSearchParams({ phoneNumber: "+2348011111111", expectedRevision: "0" });
    const saved = await fetch(`${base}/guest/contact/phone`, { method: "POST", headers: { Cookie: guestA, Origin: PUBLIC_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: contact, redirect: "manual" });
    assert.equal(saved.status, 303);
    const ownContact = await fetch(`${base}/guest/contact`, { headers: { Cookie: guestA } });
    const otherContact = await fetch(`${base}/guest/contact`, { headers: { Cookie: guestB } });
    assert.match(await ownContact.text(), /\+2348011111111/);
    assert.doesNotMatch(await otherContact.text(), /\+2348011111111/);
    const mismatch = await fetch(`${base}/guest/contact/phone`, { method: "POST", headers: { Cookie: guestA, Origin: "https://attacker.example", "Content-Type": "application/x-www-form-urlencoded" }, body: contact });
    assert.equal(mismatch.status, 403);
    assert.match((await fetch(`${base}/api/reset`, { method: "POST", headers: { Cookie: guestA, Origin: PUBLIC_ORIGIN } })).status.toString(), /^404$/);
    assert.equal((await fetch(`${base}/action/demo-request`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/action/reset`, { method: "POST" })).status, 404);
    const guestCookie = (await fetch(`${base}/`)).headers.get("set-cookie") ?? "";
    assert.match(guestCookie, /Secure/);
    assert.match(guestCookie, /HttpOnly/);
    assert.match(guestCookie, /SameSite=Lax/);
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("AC8/AC18/AC19/AC20/AC22/AC23/AC24/AC26/AC27 — Production Operator shares durable state and configured files", async () => {
  const fixture = await productionFixture();
  const authority = await setupAuthority(fixture);
  const first = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
  let cookie = "";
  try {
    const port = await first.listen();
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await jsonResponse(health), { ok: true });
    const login = await fetch(`${base}/operator/login`, { method: "POST", headers: { Origin: PUBLIC_ORIGIN }, body: new URLSearchParams({ token: authority.token }), redirect: "manual" });
    assert.equal(login.status, 302);
    const operatorCookieHeader = login.headers.get("set-cookie") ?? "";
    assert.match(operatorCookieHeader, /Secure/);
    assert.match(operatorCookieHeader, /HttpOnly/);
    assert.match(operatorCookieHeader, /SameSite=Lax/);
    cookie = operatorCookieHeader.split(",").map((value) => value.trim().split(";", 1)[0]).join("; ");
    assert.equal((await fetch(`${base}/operator/requests`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/`, { headers: { Cookie: cookie } })).status, 200);
    const healthBody = JSON.stringify(await jsonResponse(await fetch(`${base}/healthz`)));
    assert.doesNotMatch(healthBody, /sk_live|session|guest|path/i);
    await first.close();
    const second = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
    try {
      const secondPort = await second.listen();
      assert.equal((await fetch(`http://127.0.0.1:${secondPort}/operator`, { headers: { Cookie: cookie } })).status, 200);
    } finally {
      await second.close();
    }
  } finally {
    if (first) {
      try { await first.close(); } catch { /* already closed after restart assertion */ }
    }
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("AC14/AC15/AC16/AC17/AC28 — Production configuration rejects deterministic or unsafe startup", async () => {
  const fixture = await productionFixture();
  try {
    const base = {
      SHORTLET_DB_PATH: fixture.configuration.databasePath,
      SHORTLET_INVENTORY_PATH: fixture.configuration.inventoryPath,
      SHORTLET_OPERATORS_PATH: fixture.configuration.operatorsPath,
    };
    assert.throws(() => loadPilotConfiguration({ ...base, SHORTLET_PUBLIC_ORIGIN: "http://pilot.example.com", PAYSTACK_SECRET_KEY: "secret", PAYSTACK_ENVIRONMENT: "live" }), /HTTPS/);
    assert.throws(() => loadPilotConfiguration({ ...base, SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN, PAYSTACK_ENVIRONMENT: "live" }), /PAYSTACK_SECRET_KEY/);
    assert.throws(() => loadPilotConfiguration({ ...base, SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN, PAYSTACK_SECRET_KEY: "secret", PAYSTACK_ENVIRONMENT: "test" }), /live/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
