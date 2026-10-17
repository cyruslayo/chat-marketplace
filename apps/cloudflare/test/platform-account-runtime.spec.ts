import { env } from "cloudflare:workers";
import { SELF, runInDurableObject } from "cloudflare:test";
import { expect, test, vi } from "vitest";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
import { SHORTLET_SCHEMA_MIGRATIONS } from "../src/schema.js";
import { GUEST_ACCOUNT_COOKIE } from "../../local-guest/src/guest-account-runtime.js";
import { ORIGIN, TENANT, provisionTenant } from "./ops-test-helpers.js";

test("Shortlet schema upgrades preserve populated legacy Guest tables until owner-routed migration verifies them", async () => {
  const stub = env.SHORTLET.get(env.SHORTLET.idFromName(`legacy-preservation-${crypto.randomUUID()}`));
  const preserved = await runInDurableObject(stub, (_instance, ctx) => {
    const db = new DurableObjectSqlDatabase(ctx.storage);
    db.exec(`CREATE TABLE guest_contacts (guest_id TEXT NOT NULL, tenant_id TEXT NOT NULL, phone_number TEXT, contact_email TEXT, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guest_id, tenant_id));
      CREATE TABLE guest_threads (thread_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL, thread_json TEXT NOT NULL);
      CREATE TABLE guest_session_bindings (session_id TEXT PRIMARY KEY, session_secret_hash TEXT NOT NULL, principal_id TEXT NOT NULL, tenant_id TEXT NOT NULL);
      INSERT INTO guest_contacts VALUES ('legacy-guest', 'legacy-tenant', '+2348012345678', 'legacy@example.test', 3);
      INSERT INTO guest_threads VALUES ('legacy-thread', 'legacy-guest', 'legacy-tenant', '{"v":1}');
      INSERT INTO guest_session_bindings VALUES ('legacy-session', 'opaque-hash', 'legacy-guest', 'legacy-tenant');
      DELETE FROM schema_migrations WHERE version = 4;`);
    applySchemaMigrations(db, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString());
    return {
      contact: db.prepare("SELECT phone_number, contact_email, revision FROM guest_contacts WHERE guest_id = ?").get(["legacy-guest"]),
      thread: db.prepare("SELECT thread_id, thread_json FROM guest_threads WHERE thread_id = ?").get(["legacy-thread"]),
      session: db.prepare("SELECT session_secret_hash FROM guest_session_bindings WHERE session_id = ?").get(["legacy-session"]),
    };
  });
  expect(preserved.contact).toEqual({ phone_number: "+2348012345678", contact_email: "legacy@example.test", revision: 3 });
  expect(preserved.thread).toEqual({ thread_id: "legacy-thread", thread_json: '{"v":1}' });
  expect(preserved.session).toEqual({ session_secret_hash: "opaque-hash" });
});

function cookieValue(response: Response, name: string): string {
  const cookies = response.headers.getSetCookie().join("; ");
  const value = new RegExp(`(?:^|[,;]\\s*)${name}=([^;,]+)`).exec(cookies)?.[1];
  if (!value) throw new Error(`Missing ${name} cookie`);
  return value;
}

function form(fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams(fields).toString();
}

test("Slice 17 AC1: SELF account sign-in and sign-out use PLATFORM state through the routed Shortlet UI", async () => {
  await provisionTenant();
  // Test isolation only: vitest can retain this named DO across runs. Clear prior-run fixtures before exercising the
  // freshly-started runtime so the final assertion detects tables created by this traffic, not stale test storage.
  const shortlet = env.SHORTLET.get(env.SHORTLET.idFromName(TENANT));
  await runInDurableObject(shortlet, (_instance, ctx) => {
    const db = new DurableObjectSqlDatabase(ctx.storage);
    db.exec("DROP TABLE IF EXISTS guest_contacts; DROP TABLE IF EXISTS guest_threads; DROP TABLE IF EXISTS guest_session_bindings;");
  });
  const noShortletGuestTables = async () => runInDurableObject(shortlet, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('guest_contacts', 'guest_threads', 'guest_session_bindings') ORDER BY name").all([]));
  expect(await noShortletGuestTables(), "fresh Shortlet schema must not initialize platform tables").toEqual([]);
  const email = `platform-runtime-${crypto.randomUUID()}@example.test`;
  let deliveredCode = "";
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { text?: string };
    deliveredCode = /\b(\d{6})\b/.exec(payload.text ?? "")?.[1] ?? "";
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const invited = await SELF.fetch(`${ORIGIN}/?invite=synthetic-invite`, { redirect: "manual" });
    expect(invited.status).toBe(303);
    expect(await noShortletGuestTables(), JSON.stringify(await runInDurableObject(shortlet, (_instance, ctx) => {
      const db = new DurableObjectSqlDatabase(ctx.storage);
      return db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('guest_contacts', 'guest_threads', 'guest_session_bindings') ORDER BY name").all([]);
    }))).toEqual([]);
    const interactionCookie = cookieValue(invited, "shortlet_guest_session");
    const platform = env.PLATFORM.get(env.PLATFORM.idFromName(TENANT));
    const bindingRows = await runInDurableObject(platform, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT COUNT(*) AS n FROM guest_session_bindings WHERE tenant_id = ?").get([TENANT])?.n);
    expect(Number(bindingRows)).toBeGreaterThan(0);
    const guestHome = await SELF.fetch(`${ORIGIN}/`, { headers: { Cookie: `shortlet_guest_session=${interactionCookie}` } });
    expect(guestHome.status, await guestHome.clone().text()).toBe(200);
    const threadId = `g-${crypto.randomUUID()}`;
    const turn = await SELF.fetch(`${ORIGIN}/api/turn`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${interactionCookie}`, "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, text: "Show me available stays" }),
    });
    expect(turn.status, await turn.clone().text()).toBe(200);
    const contact = await SELF.fetch(`${ORIGIN}/guest/contact/phone`, {
      redirect: "manual",
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${interactionCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ phoneNumber: "08012345678" }),
    });
    expect(contact.status).toBe(303);
    const requested = await SELF.fetch(`${ORIGIN}/account/sign-in`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${interactionCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ email, return: "/account" }),
    });
    expect(requested.status, await requested.clone().text()).toBe(200);
    expect(deliveredCode).toMatch(/^\d{6}$/);
    const challengeId = /name="challengeId"[^>]*value="([^"]+)"/.exec(await requested.text())?.[1];
    expect(challengeId).toBeTruthy();

    const verified = await SELF.fetch(`${ORIGIN}/account/sign-in/code`, {
      redirect: "manual",
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${interactionCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ email, challengeId: challengeId!, code: deliveredCode, return: "/account" }),
    });
    expect(verified.status, await verified.clone().text()).toBe(303);
    const accountCookie = cookieValue(verified, GUEST_ACCOUNT_COOKIE);
    const renewedInteraction = cookieValue(verified, "shortlet_guest_session");
    const changedEmail = `platform-runtime-changed-${crypto.randomUUID()}@example.test`;
    const changeRequested = await SELF.fetch(`${ORIGIN}/account/email`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${renewedInteraction}; ${GUEST_ACCOUNT_COOKIE}=${accountCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ email: changedEmail }),
    });
    expect(changeRequested.status).toBe(200);
    expect(deliveredCode).toMatch(/^\d{6}$/);
    const changeChallenge = /name="challengeId"[^>]*value="([^"]+)"/.exec(await changeRequested.text())?.[1];
    expect(changeChallenge).toBeTruthy();
    const changed = await SELF.fetch(`${ORIGIN}/account/email/code`, {
      redirect: "manual",
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${renewedInteraction}; ${GUEST_ACCOUNT_COOKIE}=${accountCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ email: changedEmail, challengeId: changeChallenge!, code: deliveredCode }),
    });
    expect(changed.status).toBe(303);
    const platformState = await runInDurableObject(platform, (_instance, ctx) => {
      const db = new DurableObjectSqlDatabase(ctx.storage);
      return {
        account: db.prepare("SELECT account_guest_id, email_revision FROM guest_accounts WHERE tenant_id = ? AND email_normalized = ?").get([TENANT, changedEmail]),
        sessionCount: db.prepare("SELECT COUNT(*) AS n FROM guest_account_sessions WHERE tenant_id = ? AND revoked_at IS NULL").get([TENANT])?.n,
        linkCount: db.prepare("SELECT COUNT(*) AS n FROM guest_account_principals WHERE tenant_id = ?").get([TENANT])?.n,
      };
    });
    expect(platformState.account).toBeTruthy();
    expect(platformState.account?.email_revision).toBe(1);
    expect(Number(platformState.sessionCount)).toBeGreaterThan(0);
    expect(Number(platformState.linkCount)).toBeGreaterThan(0);
    const platformGuestData = await runInDurableObject(platform, (_instance, ctx) => {
      const db = new DurableObjectSqlDatabase(ctx.storage);
      return {
        bindings: Number(db.prepare("SELECT COUNT(*) AS n FROM guest_session_bindings WHERE tenant_id = ?").get([TENANT])?.n ?? 0),
        threads: Number(db.prepare("SELECT COUNT(*) AS n FROM guest_threads WHERE tenant_id = ? AND thread_id = ?").get([TENANT, threadId])?.n ?? 0),
        contacts: Number(db.prepare("SELECT COUNT(*) AS n FROM guest_contacts WHERE tenant_id = ? AND phone_number = ?").get([TENANT, "+2348012345678"])?.n ?? 0),
      };
    });
    expect(platformGuestData.bindings).toBeGreaterThan(0);
    expect(platformGuestData.threads).toBe(1);
    expect(platformGuestData.contacts).toBe(1);

    const shortletAccountTables = await runInDurableObject(shortlet, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('guest_accounts', 'guest_sign_in_codes', 'guest_account_sessions', 'guest_account_principals', 'guest_account_request_claims', 'guest_account_email_commands', 'guest_account_rate_events', 'guest_contacts', 'guest_threads', 'guest_session_bindings') ORDER BY name")
      .all([]));
    expect(shortletAccountTables, JSON.stringify(await runInDurableObject(shortlet, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT * FROM schema_migrations ORDER BY version").all([])))).toEqual([]);
    const platformShortletTables = await runInDurableObject(platform, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('booking_requests', 'conditional_offers', 'booking_state', 'card_checkout_sessions', 'manual_transfer_sessions', 'live_payment_attempts') ORDER BY name")
      .all([]));
    expect(platformShortletTables).toEqual([]);

    const signedOut = await SELF.fetch(`${ORIGIN}/account/sign-out`, {
      redirect: "manual",
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `shortlet_guest_session=${cookieValue(verified, "shortlet_guest_session")}; ${GUEST_ACCOUNT_COOKIE}=${accountCookie}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(signedOut.status).toBe(303);
    const revoked = await runInDurableObject(platform, (_instance, ctx) => new DurableObjectSqlDatabase(ctx.storage)
      .prepare("SELECT revoked_at FROM guest_account_sessions WHERE session_id = (SELECT session_id FROM guest_account_sessions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1)")
      .get([TENANT]));
    expect(revoked?.revoked_at).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
}, 30000);
