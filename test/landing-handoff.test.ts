import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";

// Issue 14 (landing-to-concierge handoff). Decision 13.1(a): the message travels only in a POST body.
const MESSAGE = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
const INVITE = "beta-test-invite";

async function withServer<T>(
  options: { betaInviteCode?: string },
  run: (base: string, server: ReturnType<typeof startLocalGuestServer>) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "landing-handoff-"));
  const server = startLocalGuestServer({
    port: 0,
    environment: LocalGuestEnvironment.openNode({
      databasePath: join(directory, "guest.sqlite"),
      clock: () => new Date("2026-09-03T10:00:00Z"),
    }),
    ...options,
  });
  try {
    return await run(`http://127.0.0.1:${await server.listen()}`, server);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function start(base: string, fields: Record<string, string>, cookie = "", origin = base): Promise<Response> {
  return fetch(`${base}/welcome/start`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin, ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return /shortlet_guest_session=gs-[a-f0-9-]+/.exec(header)?.[0] ?? "";
}

async function view(base: string, location: string, cookie: string): Promise<string> {
  const response = await fetch(`${base}${location}`, { headers: { accept: "text/html", cookie } });
  assert.equal(response.status, 200);
  return response.text();
}

function userTurns(html: string): number {
  return (html.match(/data-role="user"/g) ?? []).length;
}

test("Landing 14 AC1: Sending from the hero or the closing composer opens a conversation whose first Guest message is the text typed, followed by the concierge's reply", async () => {
  const forms = [...renderLandingHtml().matchAll(/<form class="landing-composer"[^>]*>[\s\S]*?<\/form>/g)].map((match) => match[0]);
  assert.equal(forms.length, 2, "the hero and the closing composer");
  for (const form of forms) {
    assert.match(form, /method="post"/);
    assert.match(form, /action="\/welcome\/start"/);
    assert.match(form, /<input[^>]*name="message"[^>]*>/);
    assert.match(form, /<input[^>]*maxlength="2000"[^>]*>/);
    assert.doesNotMatch(form, /method="get"/);
  }
  await withServer({}, async (base) => {
    // The text is kept exactly, including surrounding spaces.
    const typed = `  ${MESSAGE}  `;
    const response = await start(base, { message: typed });
    assert.equal(response.status, 303);
    const cookie = sessionCookie(response);
    assert.notEqual(cookie, "", "a session is issued as GET / does");
    const location = response.headers.get("location") ?? "";
    assert.match(location, /^\/conversation\?threadId=g-[a-f0-9-]+$/);
    const html = await view(base, location, cookie);
    assert.equal(userTurns(html), 1);
    assert.ok(html.indexOf(`>${typed}<`) > 0, "the first Guest message is the exact text typed");
    assert.ok(html.indexOf('data-role="user"') < html.indexOf('data-role="assistant"'), "the concierge reply follows");
    assert.match(html, /I found 1 eligible place in Lagos/);
  });
  await withServer({}, async (base) => {
    // Failure path: an empty or over-long message is rejected with the composer's own validation and the text is kept.
    for (const message of ["   ", "x".repeat(2001)]) {
      const rejected = await start(base, { message });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.headers.get("cache-control"), "no-store");
      assert.equal(sessionCookie(rejected), "", "nothing is started for a rejected message");
      const html = await rejected.text();
      assert.match(html, /role="alert"/);
      assert.ok(html.includes(`value="${message.slice(0, 2000)}"`), "the text is kept in the composer");
    }
    assert.equal((await start(base, { message: MESSAGE }, "", "https://evil.example")).status, 403, "the same origin rule as the other forms");
    assert.equal((await start(base, {})).status, 400, "a missing message field is the same validation");
  });
});

test("Landing 14 AC1: A failed first concierge turn keeps the message and lets the Guest retry", async () => {
  await withServer({}, async (base, server) => {
    const original = server.app.handleTurn.bind(server.app);
    server.app.handleTurn = async () => ({ ok: false, message: "The concierge could not answer just now." }) as never;
    const failed = await start(base, { message: MESSAGE });
    assert.equal(failed.status, 422);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    const cookie = sessionCookie(failed);
    assert.notEqual(cookie, "", "the session exists so the retry can use it");
    const html = await failed.text();
    assert.match(html, /The concierge could not answer just now\./);
    assert.ok(html.includes(`value="${MESSAGE}"`), "the message is kept");
    const threadId = /name="threadId" value="(g-[a-f0-9-]+)"/.exec(html)?.[1];
    assert.ok(threadId, "the retry posts to the same thread");
    server.app.handleTurn = original;
    const retry = await fetch(`${base}/conversation`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: base, cookie },
      body: new URLSearchParams({ message: MESSAGE, threadId }).toString(),
    });
    assert.equal(retry.status, 303);
    assert.equal(userTurns(await view(base, retry.headers.get("location")!, cookie)), 1);
  });
});

test("Landing 14 AC2: The typed text never appears in any URL, redirect location or log line", async () => {
  const secret = "My name is Ada Obi and my number is 08031234567";
  const logged: string[] = [];
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
    console[name] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  }
  const urls: string[] = [];
  try {
    await withServer({}, async (base) => {
      const response = await start(base, { message: secret });
      urls.push(response.url, response.headers.get("location") ?? "");
      const cookie = sessionCookie(response);
      assert.equal(response.status, 303);
      const headerText = [...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n");
      urls.push(headerText);
      assert.ok((await view(base, response.headers.get("location")!, cookie)).includes(secret), "it is in the transcript body only");
    });
  } finally {
    Object.assign(console, originals);
  }
  for (const text of urls) {
    assert.ok(!text.includes(secret) && !text.includes(encodeURIComponent(secret)) && !text.includes("08031234567"), "no URL, redirect or header carries the text");
  }
  // Only console output is captured: patching the process streams would swallow the test runner's own report.
  assert.ok(!logged.some((line) => line.includes("08031234567")), "no log line carries the text");
  // The page never uses a GET form with a named field.
  assert.doesNotMatch(renderLandingHtml(), /<form[^>]*method="get"/);
});

test("Landing 14 AC3: A visitor with an active conversation is offered to continue it first, and starting a new one leaves the existing work untouched", async () => {
  await withServer({}, async (base) => {
    const first = await start(base, { message: MESSAGE });
    const cookie = sessionCookie(first);
    const firstLocation = first.headers.get("location")!;
    const before = await view(base, firstLocation, cookie);

    const second = "Is there anything in Abuja for a week?";
    const offer = await start(base, { message: second }, cookie);
    assert.equal(offer.status, 200, "no thread is started yet");
    assert.equal(offer.headers.get("location"), null);
    assert.equal(offer.headers.get("cache-control"), "no-store", "a page that echoes the message is never cached");
    const offerHtml = await offer.text();
    assert.match(offerHtml, /Continue your conversation/);
    assert.ok(offerHtml.includes(`href="${firstLocation}"`), "the link opens the existing thread");
    assert.match(offerHtml, /Start a new conversation/);
    assert.match(offerHtml, /doesn(?:'|&#39;)t withdraw or cancel/);
    assert.ok(offerHtml.includes(`value="${second}"`), "the new message survives the offer in a hidden field, not a URL");
    assert.match(offerHtml, /<form[^>]*method="post"[^>]*action="\/welcome\/start"/);
    assert.equal(userTurns(await view(base, firstLocation, cookie)), 1, "the offer ran no turn");

    const confirmed = await start(base, { message: second, startNew: "1" }, cookie);
    assert.equal(confirmed.status, 303);
    const secondLocation = confirmed.headers.get("location")!;
    assert.notEqual(secondLocation, firstLocation);
    assert.equal(userTurns(await view(base, secondLocation, cookie)), 1);
    assert.equal(await view(base, firstLocation, cookie), before, "the existing conversation is unchanged");
  });
});

test("Landing 14 AC4: With the beta invite gate on, sending meets the gate exactly as / does, and the text survives the gate", async () => {
  await withServer({ betaInviteCode: INVITE }, async (base) => {
    const gated = await start(base, { message: MESSAGE });
    assert.equal(gated.status, 200);
    assert.equal(sessionCookie(gated), "", "no session without the code");
    assert.equal(gated.headers.get("cache-control"), "no-store", "a page that echoes the message is never cached");
    const gatedHtml = await gated.text();
    assert.match(gatedHtml, /Shortlet beta/);
    assert.match(gatedHtml, /<form[^>]*method="post"[^>]*action="\/welcome\/start"/);
    assert.ok(gatedHtml.includes(`name="message"`) && gatedHtml.includes(`value="${MESSAGE}"`), "the text is carried in a hidden body field");
    assert.match(gatedHtml, /name="invite"/);

    const wrong = await start(base, { message: MESSAGE, invite: "nope" });
    assert.equal(wrong.status, 403);
    assert.equal(sessionCookie(wrong), "");
    const wrongHtml = await wrong.text();
    assert.match(wrongHtml, /not valid/);
    assert.ok(wrongHtml.includes(`value="${MESSAGE}"`), "the text survives a wrong code");

    const accepted = await start(base, { message: MESSAGE, invite: INVITE });
    assert.equal(accepted.status, 303);
    const cookie = sessionCookie(accepted);
    assert.notEqual(cookie, "");
    const location = accepted.headers.get("location")!;
    assert.ok(!location.includes("invite") && !location.includes(INVITE), "the code is not left in the address");
    assert.equal(userTurns(await view(base, location, cookie)), 1);
    // A session that already exists does not need the code again, as with /.
    const again = await start(base, { message: "More please", startNew: "1" }, cookie);
    assert.equal(again.status, 303);
  });
});

test("Landing 14 AC5: Sending creates no Draft, Booking Request, hold, Reservation or payment attempt", async () => {
  await withServer({}, async (base) => {
    const response = await start(base, { message: MESSAGE });
    const cookie = sessionCookie(response);
    const location = response.headers.get("location")!;
    const threadId = new URL(location, base).searchParams.get("threadId")!;
    const work = await (await fetch(`${base}/api/committed-work`, { headers: { cookie } })).json() as { committedWork: unknown[] };
    assert.deepEqual(work.committedWork, [], "nothing committed");
    const state = await (await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie } })).json() as { surfaces: { kind?: string; surfaceId: string }[]; journey?: { current?: string } };
    assert.ok(state.surfaces.every((surface) => !/request|draft|offer|payment|reservation|hold/i.test(surface.surfaceId)), "discovery surfaces only");
    assert.notEqual(state.journey?.current, "request");
    assert.notEqual(state.journey?.current, "payment");
  });
});
