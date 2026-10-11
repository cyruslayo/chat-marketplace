import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { GUEST_ACCOUNT_COPY } from "../apps/web-agent/src/guest-content.js";
import { ACCOUNT_COOKIE, freshAnonymousCookie, getJson, getPage, postForm, requestSignInCode, setCookieValue, signInDevice, wrongCodeFor, type HttpAnswer } from "./helpers/guest-account-sign-in.js";
import { OFFER_TEST_EMAIL, offeredSurfaceOf, offerFieldsOf, offerOf, routeFor, withOfferStageDevice, type OfferedSurface } from "./helpers/sign-in-offer.js";
import { surfacesWithSignInOffer, type GuestSurfacePayload } from "../apps/local-guest/src/guest-server.js";
import type { RestartStage } from "./helpers/guest-restart.js";

/** Visible text only: the markup's tags and attributes removed, so a parity check compares what a Guest reads. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The chat state's surfaces for a thread, from the same response a browser reads. */
async function chatSurfaces(base: string, threadId: string, cookies: string): Promise<readonly OfferedSurface[]> {
  const state = await getJson(base, `/api/state?threadId=${threadId}`, cookies);
  assert.equal(state.status, 200);
  return state.body.surfaces as readonly OfferedSurface[];
}

/** The booking page's path prefix for a stage: a sent request, or a confirmed booking. */
function pagePrefixFor(stage: RestartStage): "/booking-requests/" | "/booking-contracts/" {
  return stage === "confirmed" ? "/booking-contracts/" : "/booking-requests/";
}

test("AC1: An anonymous Guest sees the offer on the request-sent and confirmation screens, in both the page and the chat workspace, with the same text. Parity test.", async () => {
  for (const stage of ["pending", "confirmed"] as const) {
    await withOfferStageDevice(stage, async ({ fixture, cookie, routes, turn }) => {
      const path = routeFor(routes, pagePrefixFor(stage));
      const page = await getPage(fixture.base, path, cookie);
      assert.equal(page.status, 200, `${stage}: the page opens for its owner`);
      const section = offerOf(page.body);
      assert.ok(section, `${stage}: the standalone page offers sign-in`);
      const fields = offerFieldsOf(section);
      assert.equal(fields.email, OFFER_TEST_EMAIL, `${stage}: the offer is pre-filled from the contact already given`);
      assert.equal(fields.returnPath, path, `${stage}: the offer returns to the same page`);
      for (const copy of [GUEST_ACCOUNT_COPY.offerTitle, GUEST_ACCOUNT_COPY.offerIntro, GUEST_ACCOUNT_COPY.offerButton]) {
        assert.ok(textOf(section).includes(copy), `${stage}: the page shows "${copy}"`);
      }

      const surfaces = await chatSurfaces(fixture.base, fixture.threadId, cookie);
      const offered = offeredSurfaceOf(surfaces as readonly GuestSurfacePayload[]);
      assert.ok(offered?.signInOffer, `${stage}: the chat workspace offers sign-in`);
      assert.ok(offeredSurfaceOf(turn.surfaces), `${stage}: the turn that completes the stage carries the offer too`);
      assert.equal(offered.signInOffer.email, OFFER_TEST_EMAIL, `${stage}: the chat offer carries the same contact email`);
      assert.equal(offered.signInOffer.returnPath, `/?threadId=${fixture.threadId}`, `${stage}: the chat offer returns to the same conversation`);

      // Parity: the page and the chat render the same visible text from the same kit helper (the browser runs that helper).
      const kit: Record<string, unknown> = await import("../apps/local-guest/src/guest-kit.js");
      const signInOfferHtml = kit.signInOfferHtml as (content: { readonly email: string; readonly returnPath: string }) => string;
      const fromChat = signInOfferHtml(offered.signInOffer);
      assert.equal(textOf(fromChat), textOf(section), `${stage}: the page and the chat show the same text`);
    });
  }
});

test("AC1 failure path: the offer is not shown before a request is sent, on the review screen (page and chat)", async () => {
  await withOfferStageDevice("review", async ({ fixture, cookie, routes }) => {
    assert.ok(routes.length > 0, "the review stage has a standalone page to check");
    for (const route of routes) {
      const page = await getPage(fixture.base, route, cookie);
      assert.equal(offerOf(page.body), null, `${route}: no offer before the request is sent`);
    }
    const surfaces = await chatSurfaces(fixture.base, fixture.threadId, cookie);
    assert.equal(offeredSurfaceOf(surfaces as readonly GuestSurfacePayload[]), undefined, "the chat shows no offer before the request is sent");
  });
});

test("AC1 failure path: the offer is not shown when sign-in is disabled, because a Guest could not complete it", async () => {
  await withOfferStageDevice("pending", async ({ fixture, cookie, routes }) => {
    const page = await getPage(fixture.base, routeFor(routes, "/booking-requests/"), cookie);
    assert.equal(offerOf(page.body), null, "the page shows no offer while sign-in is disabled");
    const surfaces = await chatSurfaces(fixture.base, fixture.threadId, cookie);
    assert.equal(offeredSurfaceOf(surfaces as readonly GuestSurfacePayload[]), undefined, "the chat shows no offer while sign-in is disabled");
  }, { accounts: false });
});

test("AC2: Completing the code step from that panel returns to the same screen, now signed in, and the panel is gone.", async () => {
  await withOfferStageDevice("pending", async ({ fixture, sender, cookie, routes }) => {
    const path = routeFor(routes, "/booking-requests/");
    const section = offerOf((await getPage(fixture.base, path, cookie)).body);
    assert.ok(section, "the device is offered sign-in before it signs in");
    const { email, returnPath } = offerFieldsOf(section);

    // The panel's own fields drive the same two POSTs a no-JavaScript Guest makes (ADR 0080).
    const signedIn = await signInDevice(fixture, sender, email, cookie, returnPath);
    assert.equal(signedIn.answer.location, path, "the code step returns to the same screen");
    const cookies = [signedIn.interaction, signedIn.account].join("; ");

    const account = await getPage(fixture.base, "/account", cookies);
    assert.equal(account.status, 200, "the device is now signed in");
    const page = await getPage(fixture.base, path, cookies);
    assert.equal(page.status, 200, "the same booking page opens after sign-in");
    assert.match(page.body, /data-page="booking-record"/, "the booking is still shown");
    assert.equal(offerOf(page.body), null, "the panel is gone once signed in");
    assert.equal(offeredSurfaceOf(await chatSurfaces(fixture.base, fixture.threadId, cookies) as readonly GuestSurfacePayload[]), undefined, "the chat no longer offers sign-in");
  });
});

test("AC2 failure path: a wrong code keeps the Guest on the code step, signs no one in and keeps the panel", async () => {
  await withOfferStageDevice("pending", async ({ fixture, sender, cookie, routes }) => {
    const path = routeFor(routes, "/booking-requests/");
    const { email, returnPath } = offerFieldsOf(offerOf((await getPage(fixture.base, path, cookie)).body) ?? "");
    const { answer, challengeId } = await requestSignInCode(fixture.base, email, cookie, returnPath);
    assert.equal(answer.status, 200, "the code step opens");
    const wrong: HttpAnswer = await postForm(fixture.base, "/account/sign-in/code", { email, challengeId, code: wrongCodeFor(sender.codeFor(email)), return: returnPath }, cookie);
    assert.match(wrong.body, /id="code"/, "the Guest stays on the code step");
    assert.equal(setCookieValue(wrong, ACCOUNT_COOKIE), undefined, "no account cookie is set");
    const page = await getPage(fixture.base, path, cookie);
    assert.ok(offerOf(page.body), "the panel stays while the Guest is signed out");
  });
});

test("AC3: A signed-in Guest never sees the panel.", async () => {
  for (const stage of ["pending", "confirmed"] as const) {
    await withOfferStageDevice(stage, async ({ fixture, sender, cookie, routes }) => {
      const path = routeFor(routes, pagePrefixFor(stage));
      assert.ok(offerOf((await getPage(fixture.base, path, cookie)).body), `${stage}: the panel is shown before sign-in, so the change is real`);
      const signedIn = await signInDevice(fixture, sender, OFFER_TEST_EMAIL, cookie, path);
      const cookies = [signedIn.interaction, signedIn.account].join("; ");
      const page = await getPage(fixture.base, path, cookies);
      assert.equal(offerOf(page.body), null, `${stage}: a signed-in page has no panel`);
      assert.equal(offeredSurfaceOf(await chatSurfaces(fixture.base, fixture.threadId, cookies) as readonly GuestSurfacePayload[]), undefined, `${stage}: the chat has no panel`);
    });
  }
});

test("AC4: Declining or ignoring the offer changes nothing in the booking flow (existing booking and payment tests stay green).", async () => {
  await withOfferStageDevice("pending", async ({ fixture, cookie, routes }) => {
    const path = routeFor(routes, "/booking-requests/");
    const before = await fixture.state(cookie);
    assert.ok(offerOf((await getPage(fixture.base, path, cookie)).body), "the offer is shown");
    // The Guest ignores it: the booking state is unchanged by showing it.
    assert.deepEqual(await fixture.state(cookie), before, "showing the offer changes no booking state");

    // The booking continues exactly as before: the Operator accepts and the Guest's own payment page opens.
    const requestId = (before as { surfaces: readonly { surfaceId: string }[] }).surfaces[0]!.surfaceId.split(":").at(-1)!;
    fixture.environment.simulateOperatorAcceptance(requestId);
    const after = await fixture.state(cookie) as { surfaces: readonly { conventionalRoute?: string }[] };
    const offerRoute = after.surfaces.map((surface) => surface.conventionalRoute).find((route) => route?.startsWith("/conditional-offers/"));
    assert.ok(offerRoute, "the accepted request produces its offer");
    const offerId = offerRoute.split("/")[2]!;
    const payment = await getPage(fixture.base, `/payments/offers/${offerId}`, cookie);
    assert.equal(payment.status, 200, "the Guest's payment page still opens for this device");
  });
});

test("AC4 failure path: a sign-in that is started and abandoned changes no booking state and signs no one in", async () => {
  await withOfferStageDevice("pending", async ({ fixture, cookie, routes }) => {
    const path = routeFor(routes, "/booking-requests/");
    const { email, returnPath } = offerFieldsOf(offerOf((await getPage(fixture.base, path, cookie)).body) ?? "");
    const before = await fixture.state(cookie);
    const started = await requestSignInCode(fixture.base, email, cookie, returnPath);
    assert.equal(started.answer.status, 200, "the code request is accepted");
    // The Guest never enters the code.
    assert.deepEqual(await fixture.state(cookie), before, "an abandoned sign-in changes no booking state");
    assert.equal(setCookieValue(started.answer, ACCOUNT_COOKIE), undefined, "no account cookie is set");
    assert.ok(offerOf((await getPage(fixture.base, path, cookie)).body), "the panel is still offered");
  });
});

test("AC1 failure path: a response that carries the offer is never kept by the browser or a cache (Cache-Control no-store)", async () => {
  await withOfferStageDevice("pending", async ({ fixture, cookie, routes }) => {
    const path = routeFor(routes, "/booking-requests/");
    const page = await fetch(`${fixture.base}${path}`, { headers: { cookie } });
    assert.ok(offerOf(await page.text()), "the page carries the offer");
    assert.equal(page.headers.get("cache-control"), "no-store", "the page with the Guest's email is not kept");
    const chat = await fetch(`${fixture.base}/api/state?threadId=${fixture.threadId}`, { headers: { cookie } });
    const body = await chat.json() as { surfaces: readonly GuestSurfacePayload[] };
    assert.ok(offeredSurfaceOf(body.surfaces), "the chat state carries the offer");
    assert.equal(chat.headers.get("cache-control"), "no-store", "the chat state with the Guest's email is not kept");
  });
});

/** A request-sent surface with the minimum screen content the offer rule reads (its state, and its status). */
function sentSurface(surfaceId: string, status?: GuestSurfacePayload["status"]): GuestSurfacePayload {
  return {
    surfaceId,
    a2uiMessages: [],
    ...(status === undefined ? {} : { status }),
    requestScreen: { state: "sent", title: "Booking Request", status: "Sent", tone: "warning", steps: [], notes: [], primary: { path: "/x", label: "Back" } },
  };
}

test("AC1 failure path: the offer is never attached to a superseded request-sent screen", () => {
  const surfaces = [sentSurface("live", "active"), sentSurface("old", "superseded")];
  const result = surfacesWithSignInOffer(surfaces, () => ({ email: OFFER_TEST_EMAIL, returnPath: "/?threadId=g-test" }));
  assert.equal(result.offered, true, "the live screen is offered sign-in");
  assert.equal(result.surfaces[0]!.signInOffer?.email, OFFER_TEST_EMAIL, "the live screen carries the offer");
  assert.equal(result.surfaces[1]!.signInOffer, undefined, "the superseded screen never carries it");
});

test("AC1 failure path: the offer appears once per response, beneath the last live request-sent screen", () => {
  const surfaces = [sentSurface("first", "active"), sentSurface("second", "active")];
  const result = surfacesWithSignInOffer(surfaces, () => ({ email: OFFER_TEST_EMAIL, returnPath: "/?threadId=g-test" }));
  assert.equal(result.surfaces.filter((surface) => surface.signInOffer !== undefined).length, 1, "one panel per response");
  assert.equal(result.surfaces[1]!.signInOffer?.returnPath, "/?threadId=g-test", "the panel rides on the last live screen");
});

test("AC1 failure path: the sign-in offer's email reaches only the browser that owns the conversation, and the offer is never stored with the conversation", async () => {
  await withOfferStageDevice("pending", async ({ fixture, cookie }) => {
    // Another browser that asks for the same conversation gets nothing of it, so it gets no offer and no email.
    const stranger = await freshAnonymousCookie(fixture.base);
    const other = await getJson(fixture.base, `/api/state?threadId=${fixture.threadId}`, stranger);
    assert.equal(JSON.stringify(other.body).includes(OFFER_TEST_EMAIL), false, "a stranger never receives the email");
    assert.equal(JSON.stringify(other.body).includes("signInOffer"), false, "a stranger never receives the offer");
    // The owner does receive it in the response.
    assert.ok(offeredSurfaceOf(await chatSurfaces(fixture.base, fixture.threadId, cookie) as readonly GuestSurfacePayload[]), "the owner is offered sign-in");
    // The offer is computed per response: the stored conversation never carries the key (ADR 0075).
    const stored = [fixture.databasePath, `${fixture.databasePath}-wal`].filter((path) => existsSync(path)).map((path) => readFileSync(path).toString("latin1"));
    assert.ok(stored.length > 0, "the conversation database is on disk");
    for (const bytes of stored) assert.equal(bytes.includes("signInOffer"), false, "the offer key is not persisted");
  });
});
