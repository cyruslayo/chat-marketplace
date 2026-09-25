import test from "node:test";
import assert from "node:assert/strict";
import { restartFixture } from "./helpers/guest-restart.js";
import type { CommandPrincipal } from "../packages/platform-core/src/index.js";
import type { ConventionalBookingPageKind } from "../apps/local-guest/src/guest-server.js";

const BOOKING_ROUTES: readonly (readonly [ConventionalBookingPageKind, RegExp])[] = [
  ["draft", /^\/booking-requests\/drafts\/([^/?]+)$/],
  ["request", /^\/booking-requests\/(?!drafts\/)([^/?]+)$/],
  ["offer", /^\/conditional-offers\/([^/?]+)$/],
  ["contract", /^\/booking-contracts\/([^/?]+)$/],
];

function bookingKind(route: string): readonly [ConventionalBookingPageKind, string] | null {
  for (const [kind, pattern] of BOOKING_ROUTES) {
    const match = pattern.exec(route);
    if (match) return [kind, decodeURIComponent(match[1]!)];
  }
  return null;
}

async function page(url: string, cookie?: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { headers: { accept: "text/html", ...(cookie ? { cookie } : {}) } });
  return { status: response.status, body: await response.text() };
}

type Fixture = Awaited<ReturnType<typeof restartFixture>>;
type EmittedSurface = { readonly conventionalRoute?: string; readonly summary?: string };

/**
 * Walks the whole journey and returns every booking conventionalRoute the
 * guest app emitted. `onEmit` sees each route while its surface is current.
 */
async function emittedBookingRoutes(fixture: Fixture, onEmit?: (route: string, summary: string) => Promise<void>): Promise<Set<string>> {
  const routes = new Set<string>();
  const collect = async (surfaces: readonly EmittedSurface[]) => {
    for (const surface of surfaces) {
      if (!surface.conventionalRoute || !bookingKind(surface.conventionalRoute)) continue;
      routes.add(surface.conventionalRoute);
      await onEmit?.(surface.conventionalRoute, surface.summary ?? "");
    }
  };
  await fixture.advance("confirmed", (_stage, result) => collect(result.surfaces));
  const current = await fixture.state();
  if (current.ok) await collect(current.surfaces);
  return routes;
}

test("AC1 (booking part): each booking conventionalRoute the guest app emits returns 200 for its owner", async () => {
  const fixture = await restartFixture();
  try {
    const routes = await emittedBookingRoutes(fixture, async (route, summary) => {
      // Checked when emitted: the page matches the surface the guest is looking at.
      const response = await page(`${fixture.base}${route}`, fixture.cookie);
      assert.equal(response.status, 200, route);
      assert.match(response.body, /data-page="booking-record"/, route);
      assert.ok(response.body.includes(summary), `${route} shows "${summary}"`);
      assert.ok(response.body.includes(`href="/?threadId=${fixture.threadId}"`), `${route} links back to its conversation`);
    });
    const kinds = new Set([...routes].map((route) => bookingKind(route)![0]));
    assert.deepEqual([...kinds].sort(), ["contract", "draft", "offer", "request"]);
    // Earlier links keep working after the journey moves on.
    for (const route of routes) assert.equal((await page(`${fixture.base}${route}`, fixture.cookie)).status, 200, route);
    // Failure path: without the owner's browser session the page is never served.
    const [anyRoute] = routes;
    const anonymous = await page(`${fixture.base}${anyRoute}`);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.body, /data-error-code="AUTHENTICATION_REQUIRED"/);
  } finally { await fixture.close(); }
});

test("AC4: A route for someone else's draft or offer fails closed", async () => {
  // Application level: every booking page re-authorizes against the principal.
  const fixture = await restartFixture();
  try {
    const routes = await emittedBookingRoutes(fixture);
    const owner = fixture.environment.guestPrincipal() as CommandPrincipal;
    const intruders: readonly CommandPrincipal[] = [
      { ...owner, id: "guest-intruder" },
      { ...owner, id: "" },
      { id: owner.id, role: "guest" },
      { ...owner, tenantId: "tenant-other" },
      { ...owner, role: "operator" },
    ];
    for (const route of routes) {
      const [kind, id] = bookingKind(route)!;
      assert.ok(fixture.app.conventionalBookingPage(kind, id, owner), `${kind} is served to its owner`);
      for (const intruder of intruders) {
        assert.equal(fixture.app.conventionalBookingPage(kind, id, intruder), null, `${kind} fails closed for ${JSON.stringify(intruder)}`);
      }
      assert.equal(fixture.app.conventionalBookingPage(kind, `${id}-unknown`, owner), null, `unknown ${kind} fails closed`);
    }
  } finally { await fixture.close(); }

  // HTTP level: a second guest's browser session cannot open the first guest's draft.
  const scoped = await restartFixture({}, { sessionScopedGuestPrincipals: true });
  try {
    const draft = await scoped.advance("draft");
    const draftRoute = draft.surfaces.map((surface) => surface.conventionalRoute).find((route) => route && bookingKind(route)?.[0] === "draft");
    assert.ok(draftRoute);
    assert.equal((await page(`${scoped.base}${draftRoute}`, scoped.cookie)).status, 200);
    const home = await fetch(scoped.base);
    const otherGuest = home.headers.get("set-cookie")?.split(";")[0];
    await home.text();
    assert.ok(otherGuest && otherGuest !== scoped.cookie);
    const foreign = await page(`${scoped.base}${draftRoute}`, otherGuest);
    assert.equal(foreign.status, 404);
    assert.match(foreign.body, /data-error-code="BOOKING_RECORD_NOT_FOUND"/);
    assert.doesNotMatch(foreign.body, /data-page="booking-record"/);
    // Failure paths: missing session, unknown id and malformed encoding.
    assert.equal((await page(`${scoped.base}${draftRoute}`)).status, 401);
    assert.equal((await page(`${scoped.base}/conditional-offers/offer-unknown`, scoped.cookie)).status, 404);
    assert.equal((await page(`${scoped.base}/conditional-offers/%E0%A4%A`, scoped.cookie)).status, 400);
  } finally { await scoped.close(); }
});
