import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { loadPilotConfiguration } from "../apps/pilot/src/pilot-config.js";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { DirectPaystackClient, SqliteOperatorRepresentativeGrantStore, SqliteOperatorSessionAuthority, type PaystackClient, type PaystackHttpFetcher, type Unit } from "../domains/shortlet/src/index.js";

const PUBLIC_ORIGIN = "https://pilot.example.com";

interface ProductionFixture {
  readonly directory: string;
  readonly configuration: ReturnType<typeof loadPilotConfiguration>;
  readonly paystack: PaystackClient;
}

async function productionFixture(options: { readonly noDeposit?: boolean } = {}): Promise<ProductionFixture> {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-pilot-composition-"));
  const source = new LocalGuestEnvironment({ databasePath: join(directory, "source.sqlite") });
  const units = source.unitRepository.findAll() as Unit[];
  source.close();
  const unit = options.noDeposit
    ? { ...units[0]!, price: { ...units[0]!.price, refundableSecurityDepositKobo: 0 } }
    : units[0]!;
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
  await writeFile(inventoryPath, JSON.stringify([unit]), "utf8");
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

function cookieFromSetCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0]!;
}

function operatorCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(",").map((part) => part.trim().split(";", 1)[0]).join("; ");
}

function surfaceAction(body: unknown, label: string): { readonly surfaceId: string; readonly name: string; readonly context: Record<string, unknown>; readonly sourceComponentId: string } {
  assert.ok(body !== null && typeof body === "object");
  const surfaces = (body as { surfaces?: unknown }).surfaces;
  assert.ok(Array.isArray(surfaces) && surfaces.length > 0);
  const surface = surfaces.at(-1);
  assert.ok(surface !== null && typeof surface === "object");
  const record = surface as { surfaceId?: unknown; a2uiMessages?: unknown };
  assert.equal(typeof record.surfaceId, "string");
  assert.ok(Array.isArray(record.a2uiMessages));
  for (const message of record.a2uiMessages) {
    if (message === null || typeof message !== "object") continue;
    const update = (message as { updateComponents?: { components?: unknown } }).updateComponents;
    if (!update || !Array.isArray(update.components)) continue;
    const components = update.components.filter((component): component is Record<string, unknown> => component !== null && typeof component === "object");
    const textById = new Map(components.filter((component) => component.component === "Text" && typeof component.id === "string").map((component) => [component.id as string, typeof component.text === "string" ? component.text : ""]));
    const button = components.find((component) => component.component === "Button" && typeof component.id === "string" && typeof component.child === "string" && (textById.get(component.child) ?? "").includes(label));
    const event = button?.action;
    if (!button || event === null || typeof event !== "object") continue;
    const eventValue = (event as { event?: unknown }).event;
    if (eventValue === null || typeof eventValue !== "object") continue;
    const name = (eventValue as { name?: unknown }).name;
    const context = (eventValue as { context?: unknown }).context;
    if (typeof name === "string" && context !== null && typeof context === "object" && !Array.isArray(context)) {
      return { surfaceId: record.surfaceId as string, name, context: context as Record<string, unknown>, sourceComponentId: button.id as string };
    }
  }
  throw new Error(`A2UI action not found: ${label}`);
}

async function postJson(base: string, path: string, cookie: string, body: unknown, origin = PUBLIC_ORIGIN): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function guestEvent(base: string, cookie: string, threadId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await postJson(base, "/api/event", cookie, { threadId, ...body });
  assert.equal(result.status, 200);
  return result.body;
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
  const clock = () => new Date();
  const grants = new SqliteOperatorRepresentativeGrantStore(fixture.configuration.databasePath, { clock });
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
  const sessions = new SqliteOperatorSessionAuthority(fixture.configuration.databasePath, { clock });
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

test("Production composition uses one live runtime clock across Guest and Operator environments", async () => {
  const fixture = await productionFixture();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
  try {
    await server.listen();
    const now = Date.now();
    assert.ok(Math.abs(server.guest.environment.clock().getTime() - now) < 5_000);
    assert.ok(Date.parse(`${server.guest.environment.config.demoCheckIn}T00:00:00Z`) > now);
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Production callback HTTP completion rehydrates the confirmed Reservation and Contract", async () => {
  const fixture = await productionFixture({ noDeposit: true });
  const clock = () => new Date("2026-09-21T10:00:00.000Z");
  const actorId = "production-session-actor";
  const grants = new SqliteOperatorRepresentativeGrantStore(fixture.configuration.databasePath, { clock });
  grants.createGrant(createPlatformCommandEnvelope({
    commandName: "operator_representative.grant",
    principal: { id: "pilot-admin", role: "admin", tenantId: fixture.configuration.tenantId },
    payload: {
      actorId,
      operatorId: fixture.configuration.operatorId,
      expiresAtIso: "2027-01-01T00:00:00Z",
      responsiblePersonVerifiedAtIso: "2026-01-01T00:00:00Z",
      verificationReference: "pilot-callback-regression",
    },
    idempotencyKey: "pilot-callback-regression-grant",
  }));
  const sessions = new SqliteOperatorSessionAuthority(fixture.configuration.databasePath, { clock });
  const operatorToken = sessions.provisionAccessToken({ actorId, tenantId: fixture.configuration.tenantId, representativeAuthorized: true }).token;
  sessions.close();
  grants.close();

  let initializedReference = "";
  let initializedAmount = 0;
  let initializedPayerId = "";
  const fetcher: PaystackHttpFetcher = async (url, init) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as { reference?: string; amount?: number; metadata?: string };
      initializedReference = body.reference ?? "";
      initializedAmount = body.amount ?? 0;
      initializedPayerId = typeof body.metadata === "string" ? ((JSON.parse(body.metadata) as { shortlet_guest_id?: string }).shortlet_guest_id ?? "") : "";
      return { status: 200, async json() { return { status: true, data: { authorization_url: "https://checkout.paystack.com/callback-regression", reference: initializedReference } }; } };
    }
    return {
      status: 200,
      async json() {
        return { status: true, data: { reference: initializedReference, amount: initializedAmount, currency: "NGN", status: "success", domain: "live", metadata: JSON.stringify({ shortlet_guest_id: initializedPayerId }) } };
      },
    };
  };
  const provider = new DirectPaystackClient(fixture.configuration.paystack, fetcher);
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: provider, clock });
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    const guestHome = await fetch(`${base}/`);
    const guestCookie = cookieFromSetCookie(guestHome);
    const phone = await fetch(`${base}/guest/contact/phone`, { method: "POST", headers: { cookie: guestCookie, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ phoneNumber: "+2348090001111", expectedRevision: "0" }), redirect: "manual" });
    assert.equal(phone.status, 303);
    const threadId = `g-${crypto.randomUUID()}`;
    // Production runs on the live clock, so the explicit arrival date is a week from today (issue 01: dates are never assumed).
    const arrival = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
    let turn = await postJson(base, "/api/turn", guestCookie, { threadId, text: `I need an apartment in Lagos from ${arrival} for 2 nights for 2 people` });
    assert.equal(turn.status, 200);
    let action = surfaceAction(turn.body, "View apartment");
    turn.body = await guestEvent(base, guestCookie, threadId, action);
    action = surfaceAction(turn.body, "Request to Book");
    turn.body = await guestEvent(base, guestCookie, threadId, action);
    action = surfaceAction(turn.body, "Review request");
    turn.body = await guestEvent(base, guestCookie, threadId, action);
    action = surfaceAction(turn.body, "Submit Booking Request");
    turn.body = await guestEvent(base, guestCookie, threadId, action);

    const login = await fetch(`${base}/operator/login`, { method: "POST", headers: { origin: PUBLIC_ORIGIN }, body: new URLSearchParams({ token: operatorToken }), redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(login.status, 302);
    const operatorCookieHeader = operatorCookie(login);
    const requestDatabase = new (await import("node:sqlite")).DatabaseSync(fixture.configuration.databasePath);
    const requestId = (requestDatabase.prepare("SELECT request_id FROM guest_booking_requests ORDER BY request_id DESC LIMIT 1").get() as { request_id: string }).request_id;
    requestDatabase.close();
    const requestPath = `/operator/requests/${encodeURIComponent(requestId)}`;
    const confirmed = await fetch(`${base}${requestPath}/confirm`, { method: "POST", headers: { cookie: operatorCookieHeader, origin: PUBLIC_ORIGIN }, redirect: "manual" });
    assert.equal(confirmed.status, 303);

    const afterConfirmation = await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } });
    const offerState = await afterConfirmation.json() as Record<string, unknown>;
    action = surfaceAction(offerState, "Accept");
    const accepted = await guestEvent(base, guestCookie, threadId, action);
    const acceptedAction = surfaceAction(accepted, "Continue to stay payment");
    assert.equal(acceptedAction.name, "shortlet.card-payment.initialize-checkout");
    const email = await fetch(`${base}/guest/contact/email`, { method: "POST", headers: { cookie: guestCookie, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ contactEmail: "callback.regression@example.test", expectedRevision: "1" }), redirect: "manual" });
    assert.equal(email.status, 303);

    const paymentState = await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } });
    const paymentProjection = await paymentState.json() as { surfaces?: readonly { conventionalRoute?: string }[] };
    const paymentRoute = paymentProjection.surfaces?.at(-1)?.conventionalRoute;
    assert.ok(paymentRoute?.includes("/payments/offers/"));
    const continuation = await fetch(`${base}${paymentRoute}/continue`, { headers: { cookie: guestCookie }, redirect: "manual" });
    assert.equal(continuation.status, 303, await continuation.text());
    assert.equal(initializedReference !== "", true);

    const callback = await fetch(`${base}/payments/paystack/callback?reference=${encodeURIComponent(initializedReference)}`, { headers: { cookie: guestCookie }, redirect: "manual" });
    assert.equal(callback.status, 303);
    const confirmedState = await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } });
    const confirmedProjection = await confirmedState.json() as { surfaces?: readonly { summary?: string }[] };
    assert.equal(confirmedProjection.surfaces?.at(-1)?.summary, "Reservation confirmed");

    const database = new (await import("node:sqlite")).DatabaseSync(fixture.configuration.databasePath);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM booking_reservations").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count, 1);
    database.close();

    const repeated = await fetch(`${base}/payments/paystack/callback?reference=${encodeURIComponent(initializedReference)}`, { headers: { cookie: guestCookie }, redirect: "manual" });
    assert.equal(repeated.status, 303);
    const databaseAfterReplay = new (await import("node:sqlite")).DatabaseSync(fixture.configuration.databasePath);
    assert.equal((databaseAfterReplay.prepare("SELECT COUNT(*) AS count FROM booking_reservations").get() as { count: number }).count, 1);
    assert.equal((databaseAfterReplay.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count, 1);
    databaseAfterReplay.close();

    const webhookBody = JSON.stringify({ event: "charge.success", data: { reference: initializedReference } });
    const webhookSignature = createHmac("sha512", fixture.configuration.paystack.secretKey).update(webhookBody).digest("hex");
    const webhook = await fetch(`${base}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": webhookSignature }, body: webhookBody });
    assert.equal(webhook.status, 200);
    const databaseAfterWebhook = new (await import("node:sqlite")).DatabaseSync(fixture.configuration.databasePath);
    assert.equal((databaseAfterWebhook.prepare("SELECT COUNT(*) AS count FROM booking_reservations").get() as { count: number }).count, 1);
    assert.equal((databaseAfterWebhook.prepare("SELECT COUNT(*) AS count FROM booking_contracts").get() as { count: number }).count, 1);
    databaseAfterWebhook.close();
  } finally {
    await server.close();
    try { await rm(fixture.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* diagnostics preserve the primary failure */ }
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
