import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crossOriginPost, operatorGet, operatorPost, revokeOperatorSession, revokeRepresentativeGrant, signOutOperator, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { localPilotStartupLines, productionPilotStartupLines } from "../apps/pilot/src/startup-banner.js";

// B1 — back-office shell and "waiting on you" home (scratch/operator-dashboard/issues/01-back-office-home.md).

const MINUTE = 60_000;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";
const YOU = "Babatunde Adeleke";

let guests = 0;
function request(f: SignedInOperator, checkIn: string, checkOut: string): string {
  guests += 1;
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `home-guest-${guests}`, checkIn, checkOut }).facts.requestId;
}

/** Visible text: markup and attribute values (hrefs, data-*, ids) removed. */
function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function header(html: string): string {
  const match = html.match(/<header class="bo-header"[\s\S]*?<\/header>/);
  assert.ok(match, "page has the shared back-office header");
  return match[0];
}

function mainHeading(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(match, "page has a main heading");
  return visibleText(match[1]!).trim();
}

test("AC1 — Every back-office page shares one header with your name, navigation and Log out, and no page uses an actor, tenant, request or unit id as its main label", async () => {
  const f = await startSignedInOperator();
  try {
    const requestId = request(f, "2026-09-10", "2026-09-13");
    const { representativePersonId, tenantId, unitId, operatorId } = f.server.environment.config;
    const ids = [representativePersonId, tenantId, unitId, operatorId, requestId];
    for (const path of ["/operator", "/operator/requests", `/operator/requests/${requestId}`]) {
      const response = await operatorGet(f.session, path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      const shared = header(html);
      assert.equal(html.match(/<header class="bo-header"/g)?.length, 1, `${path} has exactly one shared header`);
      assert.match(visibleText(shared), new RegExp(YOU), `${path} names you`);
      assert.match(shared, /<nav[^>]*aria-label="Back office"/);
      assert.match(shared, /href="\/operator"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Home<\/a>/);
      assert.match(shared, /href="\/operator\/requests"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Requests<\/a>/);
      assert.match(shared, /<form method="post" action="\/operator\/logout">[\s\S]*Log out/);
      const heading = mainHeading(html);
      const text = visibleText(html);
      for (const id of ids) {
        assert.ok(!heading.includes(id), `${path} main heading does not use ${id}`);
        assert.ok(!text.includes(id), `${path} shows no raw id ${id}`);
      }
    }
    assert.equal(mainHeading(await (await operatorGet(f.session, `/operator/requests/${requestId}`)).text()), APARTMENT);
  } finally { await f.close(); }
});

test("AC2 — Home lists what is waiting on you, soonest deadline first, each with its owner, apartment and absolute WAT deadline, linking to the item; with nothing waiting it says so", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const empty = await (await operatorGet(f.session, "/operator")).text();
    assert.match(visibleText(empty), /Nothing is waiting on you/);
    assert.doesNotMatch(empty, /class="bo-waiting__item"/);

    const first = request(f, "2026-09-10", "2026-09-13"); // deadline 10:30Z = 11:30 WAT
    f.advance(5 * MINUTE);
    const second = request(f, "2026-09-20", "2026-09-22"); // deadline 10:35Z = 11:35 WAT
    f.advance(MINUTE);
    const decided = request(f, "2026-09-25", "2026-09-27");
    f.server.environment.confirmBookingRequest(decided);

    const html = await (await operatorGet(f.session, "/operator")).text();
    const items = [...html.matchAll(/<li class="bo-waiting__item"[\s\S]*?<\/li>/g)].map((match) => match[0]);
    assert.equal(items.length, 2, "only undecided requests are waiting");
    assert.ok(items[0]!.includes(`href="/operator/requests/${first}"`), "soonest deadline first");
    assert.ok(items[1]!.includes(`href="/operator/requests/${second}"`));
    for (const [item, deadline] of [[items[0]!, "11:30"], [items[1]!, "11:35"]] as const) {
      const text = visibleText(item);
      assert.match(text, new RegExp(OWNER));
      assert.match(text, new RegExp(APARTMENT));
      assert.match(text, new RegExp(`${deadline}.*WAT`), "absolute WAT deadline");
      assert.match(item, /<time datetime="2026-09-03T10:3\d:00.000Z"/, "deadline is the projected instant (ADR 0077)");
    }
    assert.doesNotMatch(visibleText(html), /Nothing is waiting on you/);

    // A request whose window has passed is no longer waiting on you (lazy expiry, no background job).
    f.advance(30 * MINUTE);
    assert.match(visibleText(await (await operatorGet(f.session, "/operator")).text()), /Nothing is waiting on you/);
  } finally { await f.close(); }
});

test("AC3 — An expired or revoked session lands on sign-in with a plain reason, and an action for an owner whose grant was revoked is denied", async () => {
  // Expired: the 12-hour session lifetime (ADR 0086) has passed.
  const expired = await startSignedInOperator();
  try {
    expired.advance(12 * 60 * MINUTE);
    for (const path of ["/operator", "/operator/requests", "/operator/requests/any"]) {
      const response = await operatorGet(expired.session, path);
      assert.equal(response.status, 303, path);
      assert.equal(response.headers.get("location"), "/operator/login?reason=expired", path);
    }
    const login = await (await operatorGet(expired.session, "/operator/login?reason=expired", "")).text();
    assert.match(visibleText(login), /Your session has ended\. Sign in again/);
  } finally { await expired.close(); }

  // Revoked: signed out here or in another tab.
  const revoked = await startSignedInOperator();
  try {
    revokeOperatorSession(revoked.server.environment, revoked.session.cookie);
    const response = await operatorGet(revoked.session, "/operator");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/operator/login?reason=signed-out");
    assert.match(visibleText(await (await operatorGet(revoked.session, "/operator/login?reason=signed-out", "")).text()), /You were signed out\. Sign in again/);
  } finally { await revoked.close(); }

  const f = await startSignedInOperator();
  try {
    const requestId = request(f, "2026-09-10", "2026-09-13");
    const status = () => f.server.environment.bookingRequestApp.manager.getRequest(requestId).status;

    // No session fails closed: GETs go to sign-in without a reason, actions are refused.
    const anonymous = await operatorGet(f.session, "/operator", "");
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get("location"), "/operator/login");
    assert.equal((await operatorPost(f.session, `/operator/requests/${requestId}/confirm`, "")).status, 401);
    // A forged session secret is treated as no session, never as a reason that leaks session state.
    const forged = f.session.cookie.replace(/shortlet_operator_secret=[^;]+/, "shortlet_operator_secret=forged");
    assert.equal((await operatorGet(f.session, "/operator", forged)).headers.get("location"), "/operator/login");
    // Only fixed reason codes are shown; anything else is ignored.
    const unknown = await (await operatorGet(f.session, "/operator/login?reason=%3Cscript%3E", "")).text();
    assert.doesNotMatch(unknown, /<script>|role="alert"/);

    // Cross-origin POST is rejected and changes nothing.
    assert.equal((await crossOriginPost(f.session, `/operator/requests/${requestId}/confirm`)).status, 403);
    assert.equal((await crossOriginPost(f.session, "/operator/logout")).status, 403);
    assert.equal(status(), "disclosed");

    // A stale target: an unknown request renders a not-found page inside the layout.
    const missing = await operatorGet(f.session, "/operator/requests/not-a-request");
    assert.equal(missing.status, 404);
    header(await missing.text());

    // Revoked grant (ADR 0082): the owner's work leaves home and the action is denied.
    revokeRepresentativeGrant(f.server.environment);
    assert.match(visibleText(await (await operatorGet(f.session, "/operator")).text()), /Nothing is waiting on you/);
    assert.equal((await operatorPost(f.session, `/operator/requests/${requestId}/confirm`)).status, 409);
    assert.equal(status(), "disclosed");

    // Logout still works and lands on sign-in.
    const out = await signOutOperator(f.session);
    assert.equal(out.headers.get("location"), "/operator/login");
  } finally { await f.close(); }
});

test("AC4 — Pages reflow at 320px with 44px targets, and the pilot startup banner prints the `/operator/login` URL", async () => {
  const f = await startSignedInOperator();
  try {
    const requestId = request(f, "2026-09-10", "2026-09-13");
    for (const path of ["/operator", "/operator/requests", `/operator/requests/${requestId}`]) {
      const html = await (await operatorGet(f.session, path)).text();
      assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
      // Every header control is a 44px target, and the header wraps rather than overflowing.
      assert.match(html, /\.bo-header__nav a,\s*\.bo-header \.ui-button\{[^}]*min-block-size:var\(--control-min-target\)/);
      assert.match(html, /\.bo-header\{[^}]*flex-wrap:wrap/);
      assert.doesNotMatch(html, /ui-button--small/);
    }
    const css = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
    assert.match(css, /--control-min-target:\s*2\.75rem/, "44px target token");
  } finally { await f.close(); }

  const local = localPilotStartupLines({ port: 3000, dataDirectory: "/tmp/pilot" }).join("\n");
  assert.match(local, /http:\/\/127\.0\.0\.1:3000\/operator\/login/);
  assert.doesNotMatch(local, /\/operator\/\n/);
  const production = productionPilotStartupLines({ publicOrigin: "https://stays.example", paystackEnvironment: "test", port: 8080 }).join("\n");
  assert.match(production, /https:\/\/stays\.example\/operator\/login/);
});
