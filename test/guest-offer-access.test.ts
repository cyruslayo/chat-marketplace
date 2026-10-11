import assert from "node:assert/strict";
import test from "node:test";
import {
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

function advance(fixture: { setTime(value: string): void; environment: { clock(): Date } }, milliseconds: number): void {
  fixture.setTime(new Date(fixture.environment.clock().getTime() + milliseconds).toISOString());
}

/** A device that holds a Booking Request awaiting the operator, then an accepted Conditional Booking Offer. */
async function deviceWithOffer(fixture: Parameters<typeof advanceToPendingWithPhone>[0]) {
  const pending = await advanceToPendingWithPhone(fixture);
  const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
  fixture.environment.simulateOperatorAcceptance(requestId);
  const offer = fixture.environment.interactionStore.findConditionalOfferByRequestId(requestId);
  assert.ok(offer, "the operator accepted the request, so an offer exists");
  const title = fixture.environment.conditionalOfferApp.manager.getOffer(offer.offerId).unit.title;
  return { offerId: offer.offerId, title };
}

// Re-review 6 (high, pre-existing on main): the payment page of an offer is readable only by the offer's own guest
// (the primary guest, or the distinct payer), through the session's identity. Missing and foreign offers are refused
// the same way.
test("Re-review 6: the offer's own guest reads the payment page with the stay details", async () => {
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

test("Re-review 6: an anonymous session that presents the offer id gets no stay details", async () => {
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

test("Re-review 6 failure path: a missing offer and a foreign offer get the same refusal", async () => {
  const { fixture } = await accountFixture();
  try {
    const { offerId } = await deviceWithOffer(fixture);
    const stranger = await freshAnonymousCookie(fixture.base);
    const foreign = await getPage(fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, stranger);
    const missing = await getPage(fixture.base, `/payments/offers/${encodeURIComponent("offer-does-not-exist")}`, fixture.cookie);
    assert.equal(missing.status, foreign.status);
    assert.equal(missing.body.match(/data-error-code="[^"]+"/)?.[0], foreign.body.match(/data-error-code="[^"]+"/)?.[0]);
  } finally {
    await fixture.close();
  }
});

test("Re-review 6: a linked device reads the payment page while the account is live, and nothing after the account expires", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const owner = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advance(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const linked = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const linkedCookies = cookieHeader({ [INTERACTION_COOKIE]: linked.interaction.split("=")[1], [ACCOUNT_COOKIE]: linked.account.split("=")[1] });
      const live = await getPage(second.fixture.base, `/payments/offers/${encodeURIComponent(offerId)}`, linkedCookies);
      assert.equal(live.status, 200);
      assert.ok(live.body.includes(title), "the linked device sees the stay while the account is live");
      // The account session expires; the device's interaction cookie stays.
      advance(second.fixture, 31 * 24 * 60 * 60 * 1000);
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

test("Re-review 6: sign out everywhere ends a linked device's access to the payment page", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const { offerId, title } = await deviceWithOffer(fixture);
    const owner = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advance(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
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

test("Re-review 6: an anonymous session cannot start a payment method on someone else's offer", async () => {
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

// Re-review 4 (low): a conversation with no session cookie is saved only under the guest principal's own record.
test("Re-review 4: a cookieless turn never re-owns a conversation saved for another principal", async () => {
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
