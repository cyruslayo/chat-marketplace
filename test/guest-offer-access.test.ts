import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceClock,
  ACCOUNT_COOKIE,
  CODE_REQUEST_COOLDOWN_MS,
  CapturingEmailSender,
  INTERACTION_COOKIE,
  accountFixture,
  advanceToPendingWithPhone,
  cookieHeader,
  freshAnonymousCookie,
  getJson,
  getPage,
  postForm,
  postJson,
  signInDevice,
} from "./helpers/guest-account-sign-in.js";

const EMAIL = "owner@example.test";


/** A device that holds a Booking Request awaiting the operator, then an accepted Conditional Booking Offer. */
async function deviceWithOffer(fixture: Parameters<typeof advanceToPendingWithPhone>[0], email?: string) {
  const pending = await advanceToPendingWithPhone(fixture, email === undefined ? {} : { email });
  const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
  fixture.environment.simulateOperatorAcceptance(requestId);
  const offer = fixture.environment.interactionStore.findConditionalOfferByRequestId(requestId);
  assert.ok(offer, "the operator accepted the request, so an offer exists");
  const title = fixture.environment.conditionalOfferApp.manager.getOffer(offer.offerId).unit.title;
  return { offerId: offer.offerId, title };
}

// The payment page of an offer is readable only by the offer's own guest
// (the primary guest, or the distinct payer), through the session's identity. Missing and foreign offers are refused
// the same way.
test("Offer access: the offer's own guest reads the payment page with the stay details", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const page = await getPage(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, fixture.cookie);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes(title), "the owner sees the stay");
  } finally {
    await fixture.close();
  }
});

test("Offer access: an anonymous session that presents the offer id gets no stay details", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const page = await getPage(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, stranger);
    assert.equal(page.status, 404);
    assert.equal(page.body.includes(title), false, "no stay detail is shown to a foreign session");
    assert.match(page.body, /data-error-code="PAYMENT_OFFER_NOT_FOUND"/);
  } finally {
    await fixture.close();
  }
});

test("Offer access failure path: a missing offer and a foreign offer get the same refusal", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const foreign = await getPage(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, stranger);
    const missing = await getPage(fixture.base, `/payments/offers/${encodeURIComponent("offer-does-not-exist")}`, fixture.cookie);
    assert.equal(missing.status, 404);
    assert.equal(foreign.status, 404);
    assert.equal(missing.body, foreign.body, "the two refusals are the same page, with no offer id echoed");
    assert.match(foreign.body, /href="\/account\/sign-in"/, "the refusal carries plain sign-in guidance");
  } finally {
    await fixture.close();
  }
});

test("Offer access: a linked device reads the payment page while the account is live, and nothing after the account expires", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const owner = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const linked = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const linkedCookies = cookieHeader({ [INTERACTION_COOKIE]: linked.interaction.split("=")[1], [ACCOUNT_COOKIE]: linked.account.split("=")[1] });
      const live = await getPage(second.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, linkedCookies);
      assert.equal(live.status, 200);
      assert.ok(live.body.includes(title), "the linked device sees the stay while the account is live");
      // The account session expires; the device's interaction cookie stays.
      advanceClock(second.fixture, 31 * 24 * 60 * 60 * 1000);
      const cookieOnly = cookieHeader({ [INTERACTION_COOKIE]: linked.interaction.split("=")[1] });
      const expired = await getPage(second.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, cookieOnly);
      assert.equal(expired.body.includes(title), false, "after expiry the linked device sees no stay");
      assert.ok(owner.account);
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("Offer access: sign out everywhere ends a linked device's access to the payment page", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const owner = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const linked = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const out = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: owner.account.split("=")[1], [INTERACTION_COOKIE]: owner.interaction.split("=")[1] }));
      assert.equal(out.status, 303);
      const linkedCookies = cookieHeader({ [INTERACTION_COOKIE]: linked.interaction.split("=")[1], [ACCOUNT_COOKIE]: linked.account.split("=")[1] });
      const after = await getPage(second.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, linkedCookies);
      assert.equal(after.body.includes(title), false, "the linked device sees nothing after sign out everywhere");
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("Offer access: an anonymous session cannot start a payment method on someone else's offer", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const posted = await postForm(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, { method: "card" }, stranger);
    assert.equal(posted.status, 404);
    assert.equal(posted.location, null, "no redirect starts a checkout");
  } finally {
    await fixture.close();
  }
});

// A conversation with no session cookie is saved only under the guest principal's own record.
test("Cookieless turn never re-owns a conversation saved for another principal", async () => {
  const { restartFixture } = await import("./helpers/guest-restart.js");
  const fixture = await restartFixture();
  try {
    const threadId = `g-${crypto.randomUUID()}`;
    const tenantId = fixture.environment.config.tenantId;
    fixture.environment.interactionStore.saveThread({ threadId, principalId: "guest-someone-else", tenantId, threadJson: "{}" });
    const refused = await postJson(fixture.base, "/api/turn", { threadId, text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" }, "");
    assert.equal(refused.status, 401, "the foreign conversation is refused");
    const owner = (fixture.environment.database.prepare("SELECT principal_id FROM guest_threads WHERE thread_id = ?").get([threadId]) as { principal_id: string }).principal_id;
    assert.equal(owner, "guest-someone-else", "the owner row is unchanged");
  } finally {
    await fixture.close();
  }
});

test("Offer access: a device whose account claimed the request by its recorded email sees the offer; a stranger does not", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    // The lost device makes the request with an email and never signs in.
    const { offerId, title } = await deviceWithOffer(fixture, EMAIL);
    const claimant = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(claimant.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const device = await signInDevice(claimant.fixture, sender, EMAIL, claimant.fixture.cookie);
      const cookies = cookieHeader({ [INTERACTION_COOKIE]: device.interaction.split("=")[1], [ACCOUNT_COOKIE]: device.account.split("=")[1] });
      const shown = await getPage(claimant.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, cookies);
      assert.equal(shown.status, 200, "the claimed request's offer is shown to the claiming account");
      assert.ok(shown.body.includes(title));
      const stranger = await freshAnonymousCookie(claimant.fixture.base);
      const refused = await getPage(claimant.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, stranger);
      assert.equal(refused.status, 404);
      assert.equal(refused.body.includes(title), false);
    } finally {
      await claimant.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

// Fail closed: a lookup that throws refuses the gate (unit level, so the handler's own catch cannot mask it).
test("Offer access: the gate refuses when the offer lookup throws (fail closed)", async () => {
  const { offerAuthorized } = await import("../apps/local-guest/src/guest-server.js");
  const { anonymousGuestIdentity } = await import("../domains/shortlet/src/index.js");
  const identity = anonymousGuestIdentity("guest-owner", "tenant-1");
  const session = { identity } as unknown as Parameters<typeof offerAuthorized>[1];
  const throwing = { conditionalOfferApp: { manager: { getOffer: () => { throw new Error("offer store unavailable"); } } } };
  assert.equal(offerAuthorized(throwing as unknown as Parameters<typeof offerAuthorized>[0], session, "offer-x"), false);
  // Positive control: the same gate admits the owner when the lookup works.
  const working = { conditionalOfferApp: { manager: { getOffer: () => ({ tenantId: "tenant-1", requestId: "req-x", parties: { primaryGuest: { id: "guest-owner" }, distinctPayer: null } }) } } };
  assert.equal(offerAuthorized(working as unknown as Parameters<typeof offerAuthorized>[0], session, "offer-x"), true);
});

// L2: an API client that does not ask for HTML gets the refusal as JSON, the same for a missing and a foreign offer.
test("Offer access JSON refusal: an API client gets the same application/json refusal for a missing and a foreign offer, with no offer id echoed", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const fetchJson = async (path: string, cookie: string) => {
      const response = await fetch(`${fixture.base}${path}`, { headers: { accept: "application/json", cookie } });
      return { status: response.status, contentType: response.headers.get("content-type") ?? "", text: await response.text() };
    };
    const missing = await fetchJson(`/payments/offers/${encodeURIComponent("offer-does-not-exist")}`, stranger);
    const foreign = await fetchJson(`/payments/offers/${encodeURIComponent(offerId)}`, stranger);
    for (const answer of [missing, foreign]) {
      assert.equal(answer.status, 404);
      assert.match(answer.contentType, /^application\/json/, "the refusal is JSON, not the HTML page");
      assert.deepEqual(JSON.parse(answer.text), { ok: false, code: "PAYMENT_OFFER_NOT_FOUND" });
      assert.equal(answer.text.includes(offerId), false, "no offer id is echoed");
    }
    assert.equal(missing.text, foreign.text, "the missing and foreign refusals are byte-identical");
  } finally {
    await fixture.close();
  }
});

// Copy: the refusal cannot tell a missing link from a foreign one, so it does not claim the link has expired, and it does not
// suggest that signing in shows the stays on the account of a different browser.
test("Offer access refusal copy: the refusal page says the link does not open here, names the booking's account, and does not claim expiry", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const page = await getPage(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, stranger);
    assert.equal(page.status, 404);
    assert.ok(page.body.includes("This link does not open here. Sign in with the account that made this booking, or return to your conversation."), "the refusal gives the neutral guidance");
    assert.equal(page.body.includes("has expired"), false, "the refusal does not claim the link expired");
    assert.equal(page.body.includes("Sign in to see the stays"), false, "the refusal does not promise the stays on this account");
  } finally {
    await fixture.close();
  }
});
