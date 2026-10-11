import assert from "node:assert/strict";
import test from "node:test";
import { SqliteGuestIdentityAssurance } from "../domains/shortlet/src/guest-identity-assurance.js";
import { guestAction } from "./helpers/guest-restart.js";
import type { GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { recordLocalVerifiedIdentity } from "./helpers/identity-assurance-fixture.js";
import {
  ACCOUNT_COOKIE,
  CapturingEmailSender,
  TEST_GUEST_PHONE,
  accountFixture,
  advanceClock,
  cookieHeader,
  getPage,
  postForm,
  signInDevice,
  wrongCodeFor,
} from "./helpers/guest-account-sign-in.js";
import {
  accountGuestIdOf,
  accountPage,
  changeEmailOverHttp,
  challengeIdOf,
  deviceCookies,
  requestEmailChange,
} from "./helpers/guest-account-page.js";

const EMAIL = "ada@example.test";
const NEW_EMAIL = "ada.new@example.test";
const OTHER_EMAIL = "other@example.test";
/** Copy the account page shows (issue 01 labels; functional wording awaiting human approval). */
const EMAIL_CONFIRMED = "Email confirmed";
const ID_CHECKED = "ID checked";
const ID_NOT_CHECKED = "ID not checked yet – we'll do this before check-in";
/** The page escapes the apostrophe (ADR 0078 copy is rendered through escapeHtml), so the markup carries the entity. */
const ID_NOT_CHECKED_HTML = ID_NOT_CHECKED.replace(/'/g, "&#39;");
const PHONE_NOT_ADDED = "No phone added yet";
const INVALID_PHONE_MESSAGE = "Enter a valid Nigerian mobile number";
const SIGN_IN_RETURN = "/account/sign-in?return=/account";
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** A current government-ID result for an account, recorded through the test-only fake (issue 09). */
function recordCurrentIdentity(fixture: Awaited<ReturnType<typeof accountFixture>>["fixture"], accountGuestId: string, expiresInMs = YEAR_MS): void {
  const now = fixture.environment.clock();
  const assurance = new SqliteGuestIdentityAssurance(fixture.environment.database, {
    clock: () => fixture.environment.clock(),
    allowFixtureMethods: true,
  });
  recordLocalVerifiedIdentity(assurance, {
    tenantId: fixture.environment.config.tenantId,
    accountGuestId,
    verifiedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
  });
}

// AC1 ------------------------------------------------------------------------------------------------------------------

test("AC1: a signed-in Guest sees their email, phone and identity status on the account page", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const before = await accountPage(fixture.base, deviceCookies(device));
    assert.equal(before.status, 200);
    assert.match(before.body, /data-account-state="signed-in"/);
    assert.ok(before.body.includes(EMAIL), "the account email is shown");
    assert.ok(before.body.includes(PHONE_NOT_ADDED), "a phone not yet added is shown as such");
    assert.ok(before.body.includes(EMAIL_CONFIRMED), "the identity status shows the email as confirmed");
    assert.ok(before.body.includes(ID_NOT_CHECKED_HTML), "an account without a government-ID result says the ID is not checked yet");

    const phone = await postForm(fixture.base, "/account/phone", { phone: TEST_GUEST_PHONE }, deviceCookies(device));
    assert.equal(phone.status, 303);
    const after = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(after.body.includes(TEST_GUEST_PHONE), "the saved phone number is shown");
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path: a signed-out request to /account redirects to sign-in and shows no account data", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const signedOut = await getPage(fixture.base, "/account", fixture.cookie);
    assert.equal(signedOut.status, 303, "a browser without an account cookie is sent to sign-in");
    assert.equal(signedOut.location, SIGN_IN_RETURN);
    assert.ok(!signedOut.body.includes(EMAIL), "no account email appears without a session");

    const forged = await getPage(fixture.base, "/account", cookieHeader({ [ACCOUNT_COOKIE]: "gass-forged.not-the-secret" }));
    assert.equal(forged.status, 303, "a forged account cookie is sent to sign-in too");
    assert.ok(!forged.body.includes(EMAIL));
    assert.equal((await accountPage(fixture.base, deviceCookies(device))).status, 200, "the real session still reads the page");
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path: an identity outcome past its explicit expiry is not shown as ID checked", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    recordCurrentIdentity(fixture, accountGuestIdOf(fixture, EMAIL), 60_000);
    assert.ok((await accountPage(fixture.base, deviceCookies(device))).body.includes(ID_CHECKED), "a current result is shown as checked");
    advanceClock(fixture, 120_000);
    const expired = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(!expired.body.includes(ID_CHECKED), "an expired result is not shown as checked");
    assert.ok(expired.body.includes(ID_NOT_CHECKED_HTML), "an expired result reads as not checked yet, read lazily at the next request");
  } finally {
    await fixture.close();
  }
});

test("AC1: the identity status shows ID checked for a current government-ID result on this account", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    recordCurrentIdentity(fixture, accountGuestIdOf(fixture, EMAIL));
    const page = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(page.body.includes(ID_CHECKED), "a current government-ID result is shown as ID checked");
    assert.ok(!page.body.includes(ID_NOT_CHECKED_HTML));
    assert.ok(!page.body.includes("government-ID"), "the level name is not shown as a status (copy only)");
  } finally {
    await fixture.close();
  }
});

// AC2 ------------------------------------------------------------------------------------------------------------------

test("AC2: changing email takes effect only after the code sent to the new address is entered", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    const requested = await requestEmailChange(fixture.base, cookies, NEW_EMAIL);
    assert.equal(requested.status, 200, "the code step is shown");
    assert.match(requested.body, /name="code"/);
    assert.equal(sender.codeFor(NEW_EMAIL).length, 6, "the code went to the new address");
    const stillOld = await accountPage(fixture.base, cookies);
    assert.ok(stillOld.body.includes(EMAIL) && !stillOld.body.includes(NEW_EMAIL), "the old email stays until the code is entered");

    const done = await postForm(fixture.base, "/account/email/code", { email: NEW_EMAIL, challengeId: challengeIdOf(requested), code: sender.codeFor(NEW_EMAIL) }, cookies);
    assert.equal(done.status, 303, "the correct code completes the change");
    const changed = await accountPage(fixture.base, cookies);
    assert.ok(changed.body.includes(NEW_EMAIL), "the new email is shown once the code is entered");
    assert.ok(!changed.body.includes(EMAIL), "the old email is no longer shown");
  } finally {
    await fixture.close();
  }
});

test("AC2 failure path: a wrong code leaves the old email in place and keeps the new address on the code step", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    const requested = await requestEmailChange(fixture.base, cookies, NEW_EMAIL);
    const wrong = await postForm(fixture.base, "/account/email/code", { email: NEW_EMAIL, challengeId: challengeIdOf(requested), code: wrongCodeFor(sender.codeFor(NEW_EMAIL)) }, cookies);
    assert.equal(wrong.status, 200);
    assert.match(wrong.body, /role="alert"/);
    assert.match(wrong.body, /data-error-code="code_invalid"/);
    assert.ok(wrong.body.includes(`value="${NEW_EMAIL}"`) || wrong.body.includes(`name="email" value="${NEW_EMAIL}"`), "the new address is kept on the code step");
    const page = await accountPage(fixture.base, cookies);
    assert.ok(page.body.includes(EMAIL) && !page.body.includes(NEW_EMAIL), "the old email is still the account email");
  } finally {
    await fixture.close();
  }
});

test("AC2 (ADR 0094): changing the account email removes the current identity outcome, so re-verification is needed", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    recordCurrentIdentity(fixture, accountGuestIdOf(fixture, EMAIL));
    assert.ok((await accountPage(fixture.base, deviceCookies(device))).body.includes(ID_CHECKED));
    const changed = await changeEmailOverHttp(fixture.base, deviceCookies(device), sender, NEW_EMAIL);
    assert.equal(changed.status, 303);
    const page = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(page.body.includes(ID_NOT_CHECKED_HTML), "the email change removed the verified result");
    assert.ok(!page.body.includes(ID_CHECKED));
  } finally {
    await fixture.close();
  }
});

// AC3 ------------------------------------------------------------------------------------------------------------------

test("AC3: an invalid phone shows the field error and keeps the typed value", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const typed = "12345";
    const answer = await postForm(fixture.base, "/account/phone", { phone: typed }, deviceCookies(device));
    assert.equal(answer.status, 400);
    assert.match(answer.body, /role="alert"/);
    assert.ok(answer.body.includes(INVALID_PHONE_MESSAGE), "the existing phone validation message is shown");
    assert.match(answer.body, new RegExp(`name="phone"[^>]*value="${typed}"|value="${typed}"[^>]*name="phone"`), "the typed value is kept in the field");
    assert.match(answer.body, /aria-invalid="true"/);
  } finally {
    await fixture.close();
  }
});

test("AC3 failure path: an invalid phone is not saved, and the page still shows no phone", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const phonesBefore = (fixture.environment.database.prepare("SELECT phone_number FROM guest_contacts ORDER BY guest_id").all([]) as { phone_number: string | null }[]).map((row) => row.phone_number);
    const refused = await postForm(fixture.base, "/account/phone", { phone: "+44 20 7946 0958" }, deviceCookies(device));
    assert.equal(refused.status, 400);
    const page = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(page.body.includes(PHONE_NOT_ADDED), "nothing was stored");
    const phonesAfter = (fixture.environment.database.prepare("SELECT phone_number FROM guest_contacts ORDER BY guest_id").all([]) as { phone_number: string | null }[]).map((row) => row.phone_number);
    assert.deepEqual(phonesAfter, phonesBefore, "no contact row changed its phone number");
  } finally {
    await fixture.close();
  }
});

// AC4 ------------------------------------------------------------------------------------------------------------------

test("AC4: Sign out of all devices signs out a second browser context", async () => {
  const { fixture, sender } = await accountFixture();
  const second = await accountFixture({ sender, databasePath: fixture.databasePath });
  try {
    const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    advanceClock(second.fixture, 61_000);
    const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
    assert.equal((await accountPage(second.fixture.base, deviceCookies(deviceB))).status, 200, "device B is signed in before the sign-out");

    const everywhere = await postForm(fixture.base, "/account/sign-out-everywhere", {}, deviceCookies(deviceA));
    assert.equal(everywhere.status, 303);
    const refused = await accountPage(second.fixture.base, deviceCookies(deviceB));
    assert.equal(refused.status, 303, "the second context no longer reads the account page");
    assert.equal(refused.location, SIGN_IN_RETURN);
    // The account session itself is revoked, not only the second device's interaction binding (ADR 0093).
    const accountAlone = await accountPage(second.fixture.base, deviceB.account);
    assert.equal(accountAlone.status, 303, "the second context's account cookie no longer authenticates");
  } finally {
    await second.fixture.close();
    await fixture.close();
  }
});

test("AC4 failure path: sign out of all devices needs a current account session and changes nothing", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const anonymous = await postForm(fixture.base, "/account/sign-out-everywhere", {}, fixture.cookie);
    assert.equal(anonymous.status, 401, "a browser with no account session is refused");
    assert.match(anonymous.body, /AUTHENTICATION_REQUIRED/);
    assert.equal((await accountPage(fixture.base, deviceCookies(device))).status, 200, "the signed-in device is not signed out");
  } finally {
    await fixture.close();
  }
});

// AC5 ------------------------------------------------------------------------------------------------------------------

test("AC5: the account page is plain forms that need no JavaScript, one POST per action", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const page = await accountPage(fixture.base, deviceCookies(device));
    assert.match(page.body, /<form[^>]*method="post"[^>]*action="\/account\/email"/);
    assert.match(page.body, /<form[^>]*method="post"[^>]*action="\/account\/phone"/);
    assert.match(page.body, /<form[^>]*method="post"[^>]*action="\/account\/sign-out"/);
    assert.match(page.body, /<form[^>]*method="post"[^>]*action="\/account\/sign-out-everywhere"/);
    assert.ok(!/<script\b/i.test(page.body), "the page carries no script");
    assert.ok(!/\son[a-z]+=/i.test(page.body), "no inline event handler");
  } finally {
    await fixture.close();
  }
});

test("AC5 failure path: the account page carries no inline style, hex colour or page-level style string", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const page = await accountPage(fixture.base, deviceCookies(device));
    assert.ok(!/\sstyle\s*=/i.test(page.body), "no style attribute");
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(page.body), "no hex colour (tokens only, AGENTS guest UI)");
  } finally {
    await fixture.close();
  }
});

// Guards added with the account forms (security review of the change, probed in the PR body).

test("AC5 failure path: a cross-origin POST to the account forms is refused and changes nothing", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const before = (await accountPage(fixture.base, deviceCookies(device))).body;
    for (const [path, fields] of [["/account/phone", { phone: TEST_GUEST_PHONE }], ["/account/email", { email: NEW_EMAIL }]] as const) {
      const response = await fetch(`${fixture.base}${path}`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", cookie: deviceCookies(device) },
        body: new URLSearchParams(fields).toString(),
      });
      assert.equal(response.status, 403, `${path} refuses a cross-origin POST`);
    }
    assert.equal(sender.messages.length, 1, "no change-email code was sent");
    assert.equal((await accountPage(fixture.base, deviceCookies(device))).body, before, "the account is unchanged");
  } finally {
    await fixture.close();
  }
});

test("AC2 failure path: an email change or phone POST without a live account session is refused and sends no code", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const sent = sender.messages.length;
    const email = await postForm(fixture.base, "/account/email", { email: NEW_EMAIL }, fixture.cookie);
    assert.equal(email.status, 401, "an interaction cookie alone cannot start an email change");
    const phone = await postForm(fixture.base, "/account/phone", { phone: TEST_GUEST_PHONE }, fixture.cookie);
    assert.equal(phone.status, 401, "an interaction cookie alone cannot save a phone number");
    const bareEmail = await postForm(fixture.base, "/account/email", { email: NEW_EMAIL }, "");
    assert.equal(bareEmail.status, 401, "a browser with no account session cannot start an email change");
    const barePhone = await postForm(fixture.base, "/account/phone", { phone: TEST_GUEST_PHONE }, "");
    assert.equal(barePhone.status, 401, "a browser with no account session cannot save a phone number");
    assert.equal(sender.messages.length, sent, "no code was sent");
  } finally {
    await fixture.close();
  }
});

test("AC2 failure path: changing to the account's own address is refused before any code is sent", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const sent = sender.messages.length;
    const same = await requestEmailChange(fixture.base, deviceCookies(device), EMAIL);
    assert.equal(same.status, 400);
    assert.ok(same.body.includes(`data-error-code="same_email"`));
    assert.equal(sender.messages.length, sent, "no code was sent to the same address");
  } finally {
    await fixture.close();
  }
});

// AC6 ------------------------------------------------------------------------------------------------------------------

/**
 * The review stage with the phone saved on the device's own (pre-sign-in) cookie. Sign-in rotates the interaction cookie but keeps
 * the device's own conversation, so the request is then sent on the rotated cookie (sign-in keeps the device's own conversation).
 */
async function reviewWithPhoneBeforeSignIn(fixture: Awaited<ReturnType<typeof accountFixture>>["fixture"]): Promise<GuestTurnSuccess> {
  const review = await fixture.advance("review");
  const phoneSurface = review.surfaces.find((surface) => surface.surfaceId.includes(":contact:phone"));
  assert.ok(phoneSurface, "the review stage asks for a phone number");
  const save = guestAction(phoneSurface);
  const saved = await fixture.send("/api/event", { ...save, context: { ...save.context, contactValue: TEST_GUEST_PHONE } }) as GuestTurnSuccess;
  assert.ok(saved.ok);
  return saved;
}

/** Sends the request from the review stage on the given (rotated) browser cookie. */
async function sendRequestOn(fixture: Awaited<ReturnType<typeof accountFixture>>["fixture"], saved: GuestTurnSuccess, cookie: string): Promise<void> {
  const pending = await fixture.send("/api/event", guestAction(saved.surfaces[0]!), cookie) as GuestTurnSuccess;
  assert.ok(pending.ok, "the request is sent");
}

test("AC6: the contact email used in the next Booking Request is the account email", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const saved = await reviewWithPhoneBeforeSignIn(fixture);
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const changed = await changeEmailOverHttp(fixture.base, deviceCookies(device), sender, NEW_EMAIL);
    assert.equal(changed.status, 303);
    await sendRequestOn(fixture, saved, device.interaction);
    const tenantId = fixture.environment.config.tenantId;
    assert.equal(fixture.environment.interactionStore.findBookingRequestIdsByContactEmail(NEW_EMAIL, tenantId).length, 1, "the new Booking Request carries the account email");
    assert.equal(fixture.environment.interactionStore.findBookingRequestIdsByContactEmail(EMAIL, tenantId).length, 0, "the replaced email is not the request's contact");
  } finally {
    await fixture.close();
  }
});

test("AC6 failure path: a Booking Request made before the email change keeps its own contact email snapshot", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const saved = await reviewWithPhoneBeforeSignIn(fixture);
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    await sendRequestOn(fixture, saved, device.interaction);
    const tenantId = fixture.environment.config.tenantId;
    assert.equal(fixture.environment.interactionStore.findBookingRequestIdsByContactEmail(EMAIL, tenantId).length, 1, "the first request carries the account email");
    const changed = await changeEmailOverHttp(fixture.base, deviceCookies(device), sender, NEW_EMAIL);
    assert.equal(changed.status, 303);
    assert.equal(fixture.environment.interactionStore.findBookingRequestIdsByContactEmail(EMAIL, tenantId).length, 1, "the earlier request keeps its immutable snapshot (ADR 0004)");
    assert.equal(fixture.environment.interactionStore.findBookingRequestIdsByContactEmail(NEW_EMAIL, tenantId).length, 0);
  } finally {
    await fixture.close();
  }
});

test("AC6 failure path: a linked principal's contact email cannot be saved separately from the account", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    await fixture.advance("discovery");
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const principalId = fixture.environment.interactionStore.findThread(fixture.threadId)?.principalId;
    assert.ok(principalId, "the conversation has an owning principal");
    const principal = { id: principalId, role: "guest" as const, tenantId: fixture.environment.config.tenantId };
    assert.throws(() => fixture.environment.guestContactApp.submitEmail({ contactEmail: OTHER_EMAIL }, principal), /account email/);
    assert.equal(fixture.environment.guestContactApp.get(principal)?.contactEmail, EMAIL, "the account email is the contact email");
    assert.ok(device.account);
  } finally {
    await fixture.close();
  }
});

test("AC6 control: an anonymous principal's contact email is saved as before (no account, no projection)", async () => {
  const { fixture } = await accountFixture();
  try {
    const principal = fixture.environment.guestPrincipal();
    fixture.environment.guestContactApp.submitEmail({ contactEmail: OTHER_EMAIL }, principal);
    assert.equal(fixture.environment.guestContactApp.get(principal)?.contactEmail, OTHER_EMAIL);
  } finally {
    await fixture.close();
  }
});
