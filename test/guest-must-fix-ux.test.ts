import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { viewResultIntent } from "../apps/local-guest/src/concierge.js";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { PUBLIC_ORIGIN, arrivalNextWeek, cookieFrom, productionFixture } from "./helpers/pilot-fixture.js";
import { approvingPaystack, guestEvent, postJson, provisionOperatorToken, surfaceAction } from "./helpers/guest-journey.js";
import { operatorCookieFrom, postOperatorLogin } from "./helpers/operator-session.js";

// Launch-readiness issue 10: must-fix guest and back-office UX before real guests see the app.

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

const surfaceIds = (result: { readonly surfaces: readonly { readonly surfaceId: string }[] }) => result.surfaces.map((surface) => surface.surfaceId);

test("The concierge never invents check-in dates", async () => {
  const fixture = await restartFixture();
  try {
    const nightsOnly = success(await fixture.send("/api/turn", { text: "Lagos for 2 nights for 2 people" }));
    assert.deepEqual(nightsOnly.surfaces, [], "no search runs without a date the guest gave");
    assert.match(nightsOnly.messages.join(" "), /what date you arrive/i);

    const dated = success(await fixture.send("/api/turn", { text: "from 10 Sept" }));
    assert.equal(dated.criteria?.when?.checkIn, "2026-09-10", "the date used is the one the guest typed");
    assert.match(surfaceIds(dated)[0] ?? "", /:discovery:results$/);
  } finally { await fixture.close(); }
});

test("The concierge understands everyday requests such as \"this weekend\", \"me and my wife\" and \"show me the apartment\", or asks rather than ignoring them", async () => {
  const fixture = await restartFixture();
  try {
    // The fixed clock is Thursday 3 Sept 2026, so this weekend is Friday 4 to Sunday 6 Sept.
    const weekend = success(await fixture.send("/api/turn", { text: "me and my wife need a place in Lagos this weekend" }));
    assert.equal(weekend.criteria?.guests?.count, 2);
    assert.equal(weekend.criteria?.when?.checkIn, "2026-09-04");
    assert.equal(weekend.criteria?.when?.nights, 2);

    const results = weekend.surfaces.length > 0 ? weekend : success(await fixture.send("/api/turn", { text: "yes" }));
    assert.match(surfaceIds(results)[0] ?? "", /:discovery:results/);

    // Several results and none named: the concierge asks which one, with choices, instead of ignoring the request.
    const ask = success(await fixture.send("/api/turn", { text: "Show me the apartment." }));
    assert.deepEqual(ask.surfaces, []);
    assert.match(ask.messages.join(" "), /Which one would you like to see\?/);
    assert.deepEqual(ask.quickReplies?.slice(0, 2), ["The first one", "The second one"]);

    // Choosing with the offered quick reply opens that apartment, the same as its View button.
    const opened = success(await fixture.send("/api/turn", { text: "The first one" }));
    assert.match(surfaceIds(opened)[0] ?? "", /:unit:detail:/);
    assert.match(opened.messages.join(" "), /^Here are the details for /);

    // Parser failure paths: a list request refines rather than opening one result, and small talk is not a request.
    assert.deepEqual(viewResultIntent("show me the second one"), { position: 2 });
    assert.deepEqual(viewResultIntent("tell me more about the last one"), { position: "last" });
    assert.deepEqual(viewResultIntent("open option 3"), { position: 3 });
    assert.deepEqual(viewResultIntent("Show me the apartment."), { position: null });
    assert.equal(viewResultIntent("show me other apartments"), undefined);
    assert.equal(viewResultIntent("show me cheaper places"), undefined);
    assert.equal(viewResultIntent("thanks, that's great"), undefined);
  } finally { await fixture.close(); }

  // With a single result, "show me the apartment" opens it directly.
  const single = await restartFixture();
  try {
    success(await single.send("/api/turn", { text: "Lekki from 10 Sept for 2 nights for 2 people" }));
    const opened = success(await single.send("/api/turn", { text: "Show me the apartment." }));
    assert.match(surfaceIds(opened)[0] ?? "", /:unit:detail:/);
    // A position beyond the results asks again instead of guessing.
    const lekki = success(await single.send("/api/turn", { text: "Lekki from 12 Sept for 2 nights for 2 people" }));
    assert.match(surfaceIds(lekki)[0] ?? "", /:discovery:results/);
    const beyond = success(await single.send("/api/turn", { text: "show me the third one" }));
    assert.deepEqual(beyond.surfaces, []);
    assert.match(beyond.messages.join(" "), /This search has 1 place\. Which one would you like to see\?/);
  } finally { await single.close(); }
});

test("The guest can see what the agent understood (city, dates, guests, budget) and change it", async () => {
  const fixture = await restartFixture();
  try {
    const understood = success(await fixture.send("/api/turn", { text: "Old Ikoyi from 10 Sept for 3 nights for 2 guests, budget 500k" }));
    assert.equal(understood.criteria?.where?.label, "Old Ikoyi, Lagos");
    assert.equal(understood.criteria?.when?.label, "10–13 Sept 2026 · 3 nights");
    assert.equal(understood.criteria?.guests?.label, "2 guests");
    assert.ok(understood.criteria?.budget?.label, "the budget is shown back");
    assert.equal(understood.criteria?.editable, true);

    const edited = success(await fixture.send("/api/event", { name: CRITERIA_EDIT_EVENT, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "criteria-strip", timestamp: new Date().toISOString(), context: { field: "guests", partySize: 3, basedOn: understood.criteria!.key } }));
    assert.equal(edited.criteria?.guests?.count, 3);
    assert.match(surfaceIds(edited)[0] ?? "", /:discovery:results:2$/);

    // Failure path: an edit based on stale criteria is refused rather than applied.
    const stale = await fixture.send("/api/event", { name: CRITERIA_EDIT_EVENT, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "criteria-strip", timestamp: new Date().toISOString(), context: { field: "guests", partySize: 4, basedOn: understood.criteria!.key } });
    assert.equal(stale.ok, false);
  } finally { await fixture.close(); }
});

/** One production journey, request → Operator confirmation → payment, observed once for the two title criteria. */
interface JourneyProof {
  readonly unitTitle: string;
  readonly ownerName: string;
  readonly requestId: string;
  readonly statusScreen: string;
  readonly confirmationScreen: string;
  readonly operatorInbox: string;
  readonly operatorRequestPage: string;
  readonly operatorHome: string;
}
let journeyProof: JourneyProof | undefined;

test("Production journey for the title and name criteria", async () => {
  const fixture = await productionFixture({ noDeposit: true });
  // Frozen inside Operator Active Hours (ADR 0042: disclosure only 8:00 AM - 7:30 PM WAT), so the test never depends on the time of day.
  const frozen = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00.000Z`);
  const clock = () => frozen;
  const operatorToken = provisionOperatorToken(fixture, clock, "issue-10-journey");
  const { provider, initializedReference } = approvingPaystack(fixture);
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: provider, clock });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const guestCookie = cookieFrom(await fetch(`${base}/`));
    await fetch(`${base}/guest/contact/phone`, { method: "POST", headers: { cookie: guestCookie, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ phoneNumber: "+2348090001111", expectedRevision: "0" }), redirect: "manual" });
    const threadId = `g-${crypto.randomUUID()}`;
    let body = (await postJson(base, "/api/turn", guestCookie, { threadId, text: `I need an apartment in Lagos from ${arrivalNextWeek()} for 2 nights for 2 people` })).body;
    for (const label of ["View apartment", "Request to Book", "Review request", "Submit Booking Request"]) { body = await guestEvent(base, guestCookie, threadId, surfaceAction(body, label)); }
    const statusScreen = JSON.stringify(body);

    const login = await postOperatorLogin({ base }, operatorToken, { origin: PUBLIC_ORIGIN });
    const operatorCookie = operatorCookieFrom(login);
    const database = new DatabaseSync(fixture.configuration.databasePath);
    const requestId = (database.prepare("SELECT request_id FROM guest_booking_requests LIMIT 1").get() as { request_id: string }).request_id;
    database.close();
    const operatorInbox = await (await fetch(`${base}/operator/requests`, { headers: { cookie: operatorCookie } })).text();
    const operatorHome = await (await fetch(`${base}/operator`, { headers: { cookie: operatorCookie } })).text();
    const requestPath = `/operator/requests/${encodeURIComponent(requestId)}`;
    const operatorRequestPage = await (await fetch(`${base}${requestPath}`, { headers: { cookie: operatorCookie } })).text();
    const basedOnVersion = operatorRequestPage.match(/name="basedOnVersion" value="(\d+)"/)?.[1] ?? "";
    const confirmed = await fetch(`${base}${requestPath}/confirm`, { method: "POST", headers: { cookie: operatorCookie, origin: PUBLIC_ORIGIN }, body: new URLSearchParams({ basedOnVersion, attest: "yes" }), redirect: "manual" });
    assert.equal(confirmed.status, 303);

    const offerState = await (await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } })).json();
    await guestEvent(base, guestCookie, threadId, surfaceAction(offerState, "Accept"));
    await fetch(`${base}/guest/contact/email`, { method: "POST", headers: { cookie: guestCookie, origin: PUBLIC_ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ contactEmail: "issue10@example.test", expectedRevision: "1" }), redirect: "manual" });
    const paymentState = await (await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } })).json() as { surfaces?: readonly { conventionalRoute?: string }[] };
    const paymentRoute = paymentState.surfaces?.at(-1)?.conventionalRoute ?? "";
    assert.equal((await fetch(`${base}${paymentRoute}/continue`, { headers: { cookie: guestCookie }, redirect: "manual" })).status, 303);
    assert.equal((await fetch(`${base}/payments/paystack/callback?reference=${encodeURIComponent(initializedReference())}`, { headers: { cookie: guestCookie }, redirect: "manual" })).status, 303);
    const finalState = await (await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, { headers: { cookie: guestCookie } })).json() as { surfaces?: readonly { summary?: string }[] };
    assert.equal(finalState.surfaces?.at(-1)?.summary, "Reservation confirmed");

    const unit = server.guest.environment.unitRepository.findById(fixture.configuration.unitId) as { title: string; operator: { name: string } };
    journeyProof = { unitTitle: unit.title, ownerName: unit.operator.name, requestId, statusScreen, confirmationScreen: JSON.stringify(finalState.surfaces?.at(-1)), operatorInbox, operatorRequestPage, operatorHome };
  } finally {
    await server.close();
    try { await rm(fixture.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* keep the primary failure visible */ }
  }
});

test("Booking request status and confirmation screens show the apartment title, not the unit id", () => {
  assert.ok(journeyProof, "the production journey ran");
  const { unitTitle, statusScreen, confirmationScreen } = journeyProof;
  assert.match(statusScreen, new RegExp(`"id":"booking-request-unit","component":"Text","text":"${unitTitle}"`));
  assert.match(confirmationScreen, new RegExp(`"id":"booking-contract-unit","component":"Text","text":"${unitTitle}"`));
  assert.match(confirmationScreen, new RegExp(`Booking confirmed for ${unitTitle}\\.`));
  for (const screen of [statusScreen, confirmationScreen]) {
    assert.doesNotMatch(screen, /Unit: unit-|"text":"unit-[a-z0-9-]+"/, "no raw unit id is shown as text");
    assert.doesNotMatch(screen, /Your selected apartment|"text":"Your stay"/, "the generic fallback is not used when the title is known");
  }
});

test("The back office shows apartment and owner names, not raw ids", () => {
  assert.ok(journeyProof, "the production journey ran");
  const { unitTitle, ownerName, requestId, operatorInbox, operatorRequestPage, operatorHome } = journeyProof;
  const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const [page, html] of [["inbox", operatorInbox], ["request", operatorRequestPage], ["home", operatorHome]] as const) {
    assert.ok(visible(html).includes(unitTitle), `${page} names the apartment`);
    assert.ok(visible(html).includes(ownerName), `${page} names the owner`);
    assert.ok(!visible(html).includes(requestId), `${page} never shows the raw request id as text`);
    assert.doesNotMatch(visible(html), /\bunit-[a-z]+-[a-z0-9-]+\b/, `${page} never shows a raw unit id as text`);
  }
});

test("Conventional search and booking pages work where chat fails", async () => {
  // The AI concierge is down: every model call fails as if the provider were unreachable.
  const failingModel: AssistantModelClient = { generate: async () => { throw Object.assign(new Error("provider down"), { status: 503 }); } };
  const fixture = await productionFixture({ environment: { CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "gemini-offline" } });
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack, modelClient: failingModel });
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const guestCookie = cookieFrom(await fetch(`${base}/`));
    const chat = await postJson(base, "/api/turn", guestCookie, { threadId: `g-${crypto.randomUUID()}`, text: "Lagos next week" });
    assert.equal(chat.body.ok, false, "chat fails");

    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const search = await fetch(`${base}/stays/search?location=Lagos&checkIn=${day(7)}&checkOut=${day(9)}&partySize=2`, { headers: { cookie: guestCookie, accept: "text/html" } });
    assert.equal(search.status, 200);
    const searchHtml = await search.text();
    const unitHref = searchHtml.match(/href="(\/stays\/[^"?]+)[^"]*"/)?.[1];
    assert.ok(unitHref, "search results link to each apartment's page");
    const unitPage = await fetch(`${base}${unitHref}`, { headers: { cookie: guestCookie, accept: "text/html" } });
    assert.equal(unitPage.status, 200);
    assert.match(await unitPage.text(), /Request to Book/);
    // Every page of the booking journey has a conventional route; the pages themselves are covered in
    // test/guest-conventional-booking-pages.test.ts. Here: they do not depend on the model at all.
    assert.equal((await fetch(`${base}/stays/search?partySize=abc`, { headers: { cookie: guestCookie, accept: "text/html" } })).status, 400, "an invalid search is refused with a page, not a crash");
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
