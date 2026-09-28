import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { PILOT_LIMIT_DEFAULTS } from "../apps/pilot/src/pilot-config.js";
import { SlidingWindowRateLimiter } from "../apps/pilot/src/rate-limiter.js";
import { ModelCallBudget } from "../apps/local-guest/src/assistant/model-call-budget.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { PUBLIC_ORIGIN, arrivalNextWeek, cookieFrom, productionFixture, type ProductionFixture } from "./helpers/pilot-fixture.js";

// Launch-readiness issue 19: guardrails on the production pilot.

async function withPilot(
  environment: Readonly<Record<string, string>>,
  run: (base: string, context: { readonly fixture: ProductionFixture; readonly server: ReturnType<typeof startPilotServer> }) => Promise<void>,
  options: { readonly modelClient?: AssistantModelClient; readonly clock?: () => Date } = {},
): Promise<void> {
  const fixture = await productionFixture({ environment });
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack, ...options });
  try {
    await run(`http://127.0.0.1:${await server.listen()}`, { fixture, server });
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
}

function turn(base: string, cookie: string, text: string, address?: string, threadId = `g-${crypto.randomUUID()}`): Promise<Response> {
  return fetch(`${base}/api/turn`, {
    method: "POST",
    headers: { cookie, origin: PUBLIC_ORIGIN, "content-type": "application/json", ...(address ? { "x-forwarded-for": address } : {}) },
    body: JSON.stringify({ threadId, text }),
  });
}

async function newSession(base: string, address?: string): Promise<Response> {
  return fetch(`${base}/`, { headers: address ? { "x-forwarded-for": address } : {} });
}

test("Chat turns are rate-limited per session and per client address", async () => {
  await withPilot({ SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "2", SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR: "3" }, async (base) => {
    const first = cookieFrom(await newSession(base, "198.51.100.1"));
    assert.equal((await turn(base, first, "Hello", "198.51.100.1")).status, 200);
    assert.equal((await turn(base, first, "Hello", "198.51.100.1")).status, 200);
    const perSession = await turn(base, first, "Hello", "198.51.100.1");
    assert.equal(perSession.status, 429);
    assert.ok(Number(perSession.headers.get("retry-after")) >= 1);
    assert.deepEqual(await perSession.json(), { ok: false, code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." });

    // A second session on the same address shares the address allowance: the refused turn above was not counted.
    const second = cookieFrom(await newSession(base, "198.51.100.1"));
    assert.equal((await turn(base, second, "Hello", "198.51.100.1")).status, 200);
    assert.equal((await turn(base, second, "Hello", "198.51.100.1")).status, 429);

    // Another address is unaffected, and the rightmost X-Forwarded-For entry (the proxy's view) is the key.
    const third = cookieFrom(await newSession(base, "203.0.113.7"));
    assert.equal((await turn(base, third, "Hello", "198.51.100.1, 203.0.113.7")).status, 200);

    // The no-JavaScript composer counts as a turn too.
    const form = await fetch(`${base}/conversation`, { method: "POST", headers: { cookie: second, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.1" }, body: "message=Hello", redirect: "manual" });
    assert.equal(form.status, 429);
    assert.match(await form.text(), /Please slow down/);
  });
});

test("New guest sessions and operator login attempts are rate-limited per client address", async () => {
  await withPilot({ SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR: "2", SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR: "2" }, async (base) => {
    assert.equal((await newSession(base, "198.51.100.2")).status, 200);
    const existing = cookieFrom(await newSession(base, "198.51.100.2"));
    const refused = await newSession(base, "198.51.100.2");
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get("set-cookie"), null);
    assert.match(refused.headers.get("content-type") ?? "", /text\/html/);
    // A returning Guest with a session is not a new session.
    assert.equal((await fetch(`${base}/`, { headers: { cookie: existing, "x-forwarded-for": "198.51.100.2" } })).status, 200);
    assert.equal((await newSession(base, "203.0.113.8")).status, 200);

    const login = (address: string) => fetch(`${base}/operator/login`, { method: "POST", headers: { origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": address }, body: "token=not-a-real-token" });
    assert.equal((await login("198.51.100.3")).status, 401);
    assert.equal((await login("198.51.100.3")).status, 401);
    const locked = await login("198.51.100.3");
    assert.equal(locked.status, 429);
    assert.match(await locked.text(), /Please slow down/);
    assert.equal((await login("203.0.113.9")).status, 401);
  });

  // Defaults apply when nothing is configured, and a bad value fails startup.
  const fixture = await productionFixture();
  try {
    assert.deepEqual(fixture.configuration.limits, PILOT_LIMIT_DEFAULTS);
    await assert.rejects(productionFixture({ environment: { SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR: "0" } }), /positive whole number/);
    await assert.rejects(productionFixture({ environment: { SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR: "ten" } }), /positive whole number/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
  assert.throws(() => new SlidingWindowRateLimiter({ limit: 0, windowMs: 1000 }), /positive/);
});

test("A daily model-call cap degrades the concierge to deterministic replies instead of erroring", async () => {
  let modelCalls = 0;
  const modelClient: AssistantModelClient = { generate: async () => { modelCalls++; return { text: "Which city are you visiting?" }; } };
  await withPilot({ CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "gemini-offline", CONCIERGE_DAILY_MODEL_CALL_CAP: "1" }, async (base) => {
    const guest = cookieFrom(await newSession(base));
    const answered = await turn(base, guest, "Hello");
    assert.equal(answered.status, 200);
    assert.deepEqual((await answered.json() as { messages: string[] }).messages, ["Which city are you visiting?"]);
    assert.equal(modelCalls, 1);

    const degraded = await turn(base, guest, `I need an apartment in Lagos from ${arrivalNextWeek()} for 2 nights for 2 people`);
    assert.equal(degraded.status, 200);
    const body = await degraded.json() as { ok: boolean; messages: string[] };
    assert.equal(body.ok, true);
    assert.ok(body.messages.length > 0);
    assert.equal(modelCalls, 1, "the model is not called once the cap is spent");
  }, { modelClient });

  // The cap resets at midnight Africa/Lagos (23:00 UTC).
  let now = new Date("2026-10-10T22:59:59.000Z");
  const budget = new ModelCallBudget(2, () => now);
  budget.record();
  budget.record();
  assert.equal(budget.hasCapacity(), false);
  now = new Date("2026-10-10T23:00:00.000Z");
  assert.equal(budget.hasCapacity(), true);
  assert.equal(budget.callsToday, 0);
  assert.throws(() => new ModelCallBudget(0), /positive whole number/);
});

test("JSON bodies, the operator login form and the webhook body are size-limited", async () => {
  await withPilot({}, async (base) => {
    const guest = cookieFrom(await newSession(base));
    const oversizedTurn = await turn(base, guest, "x".repeat(70 * 1024));
    assert.equal(oversizedTurn.status, 413);
    assert.equal((await oversizedTurn.json() as { code: string }).code, "BODY_TOO_LARGE");
    // Control: an ordinary turn on the same session still works.
    assert.equal((await turn(base, guest, "Hello")).status, 200);

    const webhook = await fetch(`${base}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": "0" }, body: JSON.stringify({ event: "charge.success", padding: "x".repeat(300 * 1024) }) });
    assert.equal(webhook.status, 413);
    const smallWebhook = await fetch(`${base}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": "0" }, body: "{}" });
    assert.equal(smallWebhook.status, 401, "a normal-sized webhook still reaches signature verification");

    const login = await fetch(`${base}/operator/login`, { method: "POST", headers: { origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: `token=${"x".repeat(5 * 1024)}` });
    assert.equal(login.status, 413);
  });
});

test("Idle session runtimes are closed and evicted", async () => {
  let now = new Date("2026-10-10T09:00:00.000Z");
  await withPilot({ SHORTLET_GUEST_RUNTIME_IDLE_MINUTES: "1" }, async (base, { server }) => {
    const first = cookieFrom(await newSession(base));
    const saved = await fetch(`${base}/guest/contact/phone`, { method: "POST", headers: { cookie: first, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: "phoneNumber=%2B2348011111111&expectedRevision=0", redirect: "manual" });
    assert.equal(saved.status, 303);
    assert.equal(server.guest.activeSessionRuntimes, 1);

    now = new Date(now.getTime() + 30_000);
    cookieFrom(await newSession(base));
    assert.equal(server.guest.activeSessionRuntimes, 2, "a session used within the idle time is kept");

    now = new Date(now.getTime() + 2 * 60_000);
    cookieFrom(await newSession(base));
    assert.equal(server.guest.activeSessionRuntimes, 1, "both idle runtimes were closed and evicted");

    // The evicted Guest carries on: durable state is rebuilt from SQLite, as after a restart.
    const contact = await fetch(`${base}/guest/contact`, { headers: { cookie: first } });
    assert.equal(contact.status, 200);
    assert.match(await contact.text(), /\+2348011111111/);
    assert.equal(server.guest.activeSessionRuntimes, 2);
  }, { clock: () => now });
});

test("/api/turn 500 responses carry a generic message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-guardrails-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  Object.defineProperty(environment, "discoveryQuery", { value: { search: () => { throw new Error("SECRET-DETAIL sk_live_internal"); } } });
  const server = startLocalGuestServer({ port: 0, environment, conciergeMode: "deterministic" });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const guest = cookieFrom(await fetch(`${base}/`));
    const failed = await fetch(`${base}/api/turn`, { method: "POST", headers: { cookie: guest, origin: base, "content-type": "application/json" }, body: JSON.stringify({ threadId: `g-${crypto.randomUUID()}`, text: `I need an apartment in Lagos from ${arrivalNextWeek()} for 2 nights for 2 people` }) });
    assert.equal(failed.status, 500);
    const text = await failed.text();
    assert.deepEqual(JSON.parse(text), { ok: false, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
    assert.doesNotMatch(text, /SECRET-DETAIL|sk_live/);

    const malformed = await fetch(`${base}/api/turn`, { method: "POST", headers: { cookie: guest, origin: base, "content-type": "application/json" }, body: "{not json" });
    assert.equal(malformed.status, 400);
  } finally {
    await server.close();
    environment.close();
    await rm(directory, { recursive: true, force: true });
  }
});
