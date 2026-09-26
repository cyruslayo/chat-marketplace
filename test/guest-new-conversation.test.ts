import test from "node:test";
import assert from "node:assert/strict";
import { guestNewConversationCopy } from "../apps/web-agent/src/index.js";
import { renderGuestShellHtml, type GuestCommittedWork, type GuestStateSnapshot } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";

type Fixture = Awaited<ReturnType<typeof restartFixture>>;

async function committedWork(fixture: Fixture, cookie: string = fixture.cookie): Promise<{ status: number; body: { ok: boolean; committedWork?: GuestCommittedWork[]; code?: string } }> {
  const response = await fetch(`${fixture.base}/api/committed-work`, { headers: { cookie } });
  return { status: response.status, body: await response.json() as { ok: boolean; committedWork?: GuestCommittedWork[]; code?: string } };
}

async function stateOf(fixture: Fixture, threadId: string): Promise<GuestStateSnapshot> {
  const response = await fetch(`${fixture.base}/api/state?threadId=${threadId}`, { headers: { cookie: fixture.cookie } });
  const body = await response.json() as GuestStateSnapshot;
  assert.equal(body.ok, true);
  return body;
}

test("AC1: Starting a new conversation doesn't withdraw or cancel an existing Booking Request, and says so", async () => {
  const fixture = await restartFixture();
  try {
    const pending = await fixture.advance("pending");
    const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
    const before = await stateOf(fixture, fixture.threadId);

    // The new conversation is only a new thread id: a turn on it runs discovery.
    const newThreadId = `g-${crypto.randomUUID()}`;
    const fresh = await fetch(`${fixture.base}/api/state?threadId=${newThreadId}`, { headers: { cookie: fixture.cookie } });
    assert.deepEqual(await fresh.json(), { ok: true, threadId: newThreadId, timeline: [], surfaces: [] });
    const turn = await fetch(`${fixture.base}/api/turn`, { method: "POST", headers: { "content-type": "application/json", cookie: fixture.cookie }, body: JSON.stringify({ threadId: newThreadId, text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" }) });
    assert.equal((await turn.json() as { ok: boolean }).ok, true);

    // ADR-0079: the Booking Request is untouched and can still be confirmed.
    const guest = fixture.environment.guestPrincipal();
    assert.equal(fixture.environment.bookingRequestApp.getArtifact(requestId, guest).facts.status, "disclosed");
    const after = await stateOf(fixture, fixture.threadId);
    assert.deepEqual(after.timeline, before.timeline);
    assert.equal(after.journey?.current, "request");
    assert.equal(after.journey?.outcome, undefined);

    // It says so: the live request is listed with its conventional page.
    const listed = await committedWork(fixture);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.committedWork?.length, 1);
    const work = listed.body.committedWork![0]!;
    assert.equal(work.kind, "request");
    assert.equal(work.threadId, fixture.threadId);
    assert.equal(work.route, `/booking-requests/${encodeURIComponent(requestId)}`);
    assert.ok(work.unitTitle);
    const copy = guestNewConversationCopy(work.kind, work.unitTitle);
    assert.match(copy.confirm, /^Starting a new conversation doesn't withdraw or cancel your Booking Request for .+\./);
    assert.match(copy.stillActive, /^Your Booking Request for .+ is still active\./);
    const page = await fetch(`${fixture.base}${work.route}`, { headers: { cookie: fixture.cookie, accept: "text/html" } });
    assert.equal(page.status, 200);
    await page.text();

    // The Operator can still confirm the request after the new conversation.
    const { offerId } = fixture.environment.simulateOperatorAcceptance(requestId);
    // The original conversation's tab picks up the offer on its next read.
    assert.equal((await stateOf(fixture, fixture.threadId)).journey?.current, "offer");
    const offered = await committedWork(fixture);
    assert.deepEqual(offered.body.committedWork?.map((entry) => [entry.kind, entry.route]), [["offer", `/conditional-offers/${encodeURIComponent(offerId)}`]]);

    // The no-JavaScript route starts an empty conversation and says the same.
    const redirect = await fetch(`${fixture.base}/conversation`, { headers: { cookie: fixture.cookie }, redirect: "manual" });
    assert.equal(redirect.status, 303);
    const location = redirect.headers.get("location") ?? "";
    assert.match(location, /^\/conversation\?threadId=g-[a-f0-9-]+$/);
    const noJs = await (await fetch(`${fixture.base}${location}`, { headers: { cookie: fixture.cookie } })).text();
    assert.match(noJs, /is still active\. Starting this conversation didn(?:'|&#39;|&#x27;)t change it\./);
    assert.ok(noJs.includes(`/conditional-offers/${encodeURIComponent(offerId)}`));
    assert.equal(fixture.environment.conditionalOfferApp.getArtifact(offerId, guest).facts.status, "issued");
  } finally { await fixture.close(); }
});

test("AC1 failure path: without live work there is nothing to confirm", async () => {
  const fixture = await restartFixture();
  try {
    assert.deepEqual((await committedWork(fixture)).body.committedWork, []);
    // A Request Draft is not committed work (CONTEXT.md: it blocks nothing).
    await fixture.advance("draft");
    assert.deepEqual((await committedWork(fixture)).body.committedWork, []);
  } finally { await fixture.close(); }
});

test("AC1 failure path: a declined or expired Booking Request is not listed as live", async () => {
  const declined = await restartFixture();
  try {
    const pending = await declined.advance("pending");
    declined.environment.simulateOperatorDecline(pending.surfaces[0]!.surfaceId.split(":").at(-1)!);
    assert.deepEqual((await committedWork(declined)).body.committedWork, []);
  } finally { await declined.close(); }
  const expired = await restartFixture();
  try {
    await expired.advance("pending");
    expired.setTime("2026-09-03T10:31:00Z");
    assert.deepEqual((await committedWork(expired)).body.committedWork, []);
  } finally { await expired.close(); }
});

test("AC1 failure path: committed work is never listed for another principal or without a session", async () => {
  const fixture = await restartFixture();
  try {
    await fixture.advance("pending");
    const tenantId = fixture.environment.config.tenantId;
    assert.deepEqual(fixture.app.committedWork({ id: "guest-someone-else", role: "guest", tenantId }), []);
    assert.deepEqual(fixture.app.committedWork({ id: fixture.environment.guestPrincipal().id, role: "operator", tenantId }), []);
    assert.deepEqual(fixture.app.committedWork({ id: fixture.environment.guestPrincipal().id, role: "guest", tenantId: "tenant-other" }), []);
    const forged = await committedWork(fixture, "shortlet_guest_session=forged");
    assert.equal(forged.status, 401);
    assert.equal(forged.body.committedWork, undefined);
    const missing = await fetch(`${fixture.base}/api/committed-work`);
    assert.equal(missing.status, 401);
    await missing.text();
  } finally { await fixture.close(); }
});

test("The shell offers a named New conversation control and a labelled in-page confirmation", () => {
  const html = renderGuestShellHtml();
  assert.match(html, /<button id="new-conversation" class="contact-link" type="button"><span class="header-plus" aria-hidden="true">\+<\/span><span>New<span class="header-long"> conversation<\/span><\/span><\/button>/);
  assert.match(html, /<section id="new-conversation-confirm" role="group" aria-labelledby="new-conversation-heading" hidden>/);
  assert.match(html, /<button id="new-conversation-start"[^>]*>Start new conversation<\/button>/);
  assert.match(html, /<button id="new-conversation-cancel"[^>]*>Stay here<\/button>/);
  assert.ok(!html.includes("/api/reset"), "the control never uses the fixture-only reset");
});
