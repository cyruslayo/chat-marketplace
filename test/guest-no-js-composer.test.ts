import test from "node:test";
import assert from "node:assert/strict";
import { restartFixture } from "./helpers/guest-restart.js";

const SEARCH_PROMPT = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";

function htmlDecode(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

test("AC3: With JavaScript disabled, posting the composer produces a server-rendered reply", async () => {
  const fixture = await restartFixture();
  const base = fixture.base;
  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(`${base}/conversation`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: base, cookie: fixture.cookie, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
  const view = async (location: string) => {
    const response = await fetch(`${base}${location}`, { headers: { accept: "text/html", cookie: fixture.cookie } });
    return { status: response.status, body: await response.text() };
  };
  try {
    // The shell's composer posts without JavaScript.
    const shell = await (await fetch(base, { headers: { cookie: fixture.cookie } })).text();
    assert.match(shell, /<form id="composer"[^>]*method="post"[^>]*action="\/conversation"/);
    assert.match(shell, /<input type="hidden" name="threadId"/);

    const first = await post({ message: SEARCH_PROMPT, threadId: "" });
    assert.equal(first.status, 303);
    const location = first.headers.get("location") ?? "";
    assert.match(location, /^\/conversation\?threadId=g-[a-f0-9-]+$/);
    const threadId = new URL(location, base).searchParams.get("threadId")!;

    const transcript = await view(location);
    assert.equal(transcript.status, 200);
    assert.match(transcript.body, /data-page="conversation"/);
    assert.ok(transcript.body.includes(SEARCH_PROMPT), "the guest's message is in the transcript");
    assert.match(transcript.body, /I found 1 eligible place in Lagos/);
    assert.ok(transcript.body.includes(`name="threadId" value="${threadId}"`), "the composer continues the same conversation");
    const searchLink = /href="(\/stays\/search\?[^"]+)"/.exec(transcript.body)?.[1];
    assert.ok(searchLink, "the reply links to the conventional search page");
    assert.equal((await view(htmlDecode(searchLink))).status, 200);

    // A second turn continues the same server-rendered conversation.
    const second = await post({ message: "is there parking?", threadId });
    assert.equal(second.status, 303);
    assert.equal(second.headers.get("location"), location);
    const continued = await view(location);
    assert.ok(continued.body.includes("is there parking?"));
    const userTurns = (continued.body.match(/data-role="user"/g) ?? []).length;
    assert.equal(userTurns, 2);

    // Failure paths.
    const empty = await post({ message: "   ", threadId });
    assert.equal(empty.status, 400);
    const emptyBody = await empty.text();
    assert.match(emptyBody, /role="alert"/);
    assert.equal(((await view(location)).body.match(/data-role="user"/g) ?? []).length, userTurns, "an empty message runs no turn");

    const noSession = await fetch(`${base}/conversation`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: base }, body: new URLSearchParams({ message: SEARCH_PROMPT, threadId }).toString() });
    assert.equal(noSession.status, 401);
    assert.match(await noSession.text(), /data-error-code="AUTHENTICATION_REQUIRED"/);

    assert.equal((await post({ message: SEARCH_PROMPT, threadId }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ message: SEARCH_PROMPT, threadId: "not-a-thread" })).status, 400);
    assert.equal((await post({ message: "x".repeat(2001), threadId })).status, 400);

    const anonymousView = await fetch(`${base}${location}`, { headers: { accept: "text/html" } });
    assert.equal(anonymousView.status, 401);
    assert.doesNotMatch(await anonymousView.text(), /I found 1 eligible place/);
  } finally { await fixture.close(); }
});
