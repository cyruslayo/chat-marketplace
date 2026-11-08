import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restartFixture } from "./helpers/guest-restart.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteAuditLog } from "../packages/platform-core/src/sqlite-audit-log.js";
import { redactSensitiveData } from "../packages/platform-core/src/redaction.js";

// Production-launch issue 11 — server-generated guest thread ids (wraps shortlet-concierge-launch/53).
// ADR 0070 (interaction identity), 0075 (minimisation/redaction), 0106 (closed codes).

const V4 = /^g-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function postConversation(base: string, cookie: string, threadId: string): Promise<Response> {
  return fetch(`${base}/conversation`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: base },
    body: new URLSearchParams({ threadId, message: "Hello" }),
    redirect: "manual",
  });
}

test("AC1 — A guest conversation form submitted with a client-chosen threadId is refused and creates no thread", async () => {
  const fixture = await restartFixture();
  try {
    const clientChosen = `g-${crypto.randomUUID()}`;
    const response = await postConversation(fixture.base, fixture.cookie, clientChosen);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /INVALID_CONVERSATION|problem with this conversation/i);
    assert.equal(await fixture.environment.guestData.findThread(clientChosen), null, "no thread was created");
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path — a threadId that matches the old pattern but was not issued by the server is refused, with no audit row written", async () => {
  const fixture = await restartFixture();
  try {
    // Same shape the old THREAD_ID_PATTERN accepted, but this session was never issued it.
    const patternMatching = "g-0123456789abcdef";
    assert.match(patternMatching, /^g-[a-f0-9-]{6,64}$/);
    const before = fixture.environment.audit.entries().length;
    const response = await postConversation(fixture.base, fixture.cookie, patternMatching);
    assert.equal(response.status, 400);
    assert.equal(fixture.environment.audit.entries().length, before, "no audit row was written");
    assert.equal(await fixture.environment.guestData.findThread(patternMatching), null);
  } finally {
    await fixture.close();
  }
});

test("AC2 — Every guest thread id issued by the server is g- plus a v4 UUID generated with crypto.randomUUID() on the server", async () => {
  const fixture = await restartFixture();
  try {
    // The served page carries the id the client must use.
    const page = await fetch(`${fixture.base}/`, { headers: { cookie: fixture.cookie } });
    const html = await page.text();
    const meta = /<meta name="shortlet-thread-id" content="([^"]+)">/.exec(html)?.[1];
    assert.ok(meta, "the page carries a server-issued thread id");
    assert.match(meta!, V4);

    // The no-JavaScript conversation route mints one too.
    const conversation = await fetch(`${fixture.base}/conversation`, { headers: { cookie: fixture.cookie }, redirect: "manual" });
    assert.equal(conversation.status, 303);
    const location = conversation.headers.get("location") ?? "";
    const minted = new URL(location, fixture.base).searchParams.get("threadId");
    assert.ok(minted, "the redirect carries the minted id");
    assert.match(minted!, V4);
  } finally {
    await fixture.close();
  }
});

test("AC3 — The client never generates a thread id; the client flow in client.ts obtains it from the server response", () => {
  const source = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /crypto\.randomUUID/, "the client mints no id");
  assert.doesNotMatch(source, /`g-\$\{/, "the client builds no g- id");
  assert.match(source, /meta\[name="shortlet-thread-id"\]/, "the client reads the server-issued id from the page");
  assert.match(source, /function getThreadId\(\): string \| null/, "there is no client fallback mint");
});

test("AC4 — After the change, a g-<uuid> thread id under threadId is exempt in the redactor, and a card number placed in a threadId value is still masked", () => {
  const threadId = `g-${crypto.randomUUID()}`;
  assert.deepEqual(redactSensitiveData({ threadId }), { threadId });
  const cardShaped = redactSensitiveData({ threadId: "g-4111111111111111" }) as { readonly threadId?: unknown };
  assert.notEqual(cardShaped.threadId, "g-4111111111111111");
  assert.match(String(cardShaped.threadId), /\[REDACTED\]/);
});

test("AC5 — The human-handoff audit rows for a guest thread keep the thread id intact", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    const audit = new SqliteAuditLog(database);
    const threadId = `g-${crypto.randomUUID()}`;
    audit.record({ type: "handoff.requested", threadId, handoffVersion: 1 });
    const [entry] = audit.entries();
    assert.equal(entry?.threadId, threadId, "the handoff audit keeps its correlation id");
  } finally {
    database.close();
  }
});
