import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SqliteGuestIdentityAssurance } from "../domains/shortlet/src/guest-identity-assurance.js";
import { GUEST_ACCOUNT_COPY } from "../apps/web-agent/src/guest-content.js";
import { guestAction } from "./helpers/guest-restart.js";
import type { GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { recordLocalVerifiedIdentity } from "./helpers/identity-assurance-fixture.js";
import {
  ACCOUNT_COOKIE,
  CapturingEmailSender,
  CODE_REQUEST_COOLDOWN_MS,
  TEST_GUEST_PHONE,
  accountFixture,
  advanceClock,
  cookieHeader,
  getPage,
  postForm,
  requestSignInCode,
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

// Review fixes (issue 07, PR #103 security review). Each test below is red on the code before its fix.

/** A raw GET with the given cookie header, to read response headers the page helpers do not return. */
async function rawGet(base: string, path: string, cookies: string): Promise<Response> {
  return await fetch(`${base}${path}`, { redirect: "manual", headers: { accept: "text/html", cookie: cookies } });
}

test("AC3 (review D2): the phone input names its help and its error in one aria-describedby attribute", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const answer = await postForm(fixture.base, "/account/phone", { phone: "12345" }, deviceCookies(device));
    const phoneTag = /<input id="phone"[^>]*>/.exec(answer.body)?.[0] ?? "";
    assert.ok(phoneTag, "the phone input is rendered");
    assert.equal((phoneTag.match(/aria-describedby=/g) ?? []).length, 1, "the input carries one aria-describedby attribute");
    assert.match(phoneTag, /aria-describedby="phone-help phone-error"/, "the one attribute names both the help and the error");
  } finally {
    await fixture.close();
  }
});

test("AC1 (review D3): a saved phone number shows its success notice on the account page", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const saved = await postForm(fixture.base, "/account/phone", { phone: TEST_GUEST_PHONE }, deviceCookies(device));
    assert.equal(saved.location, "/account?notice=phone-saved");
    const page = await getPage(fixture.base, "/account?notice=phone-saved", deviceCookies(device));
    assert.ok(page.body.includes(GUEST_ACCOUNT_COPY.phoneSavedNotice), "the notice from the copy block is rendered");
    assert.match(page.body, /role="status"/);
  } finally {
    await fixture.close();
  }
});

test("AC2 (review D3): a completed email change shows its success notice on the account page", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const changed = await changeEmailOverHttp(fixture.base, deviceCookies(device), sender, NEW_EMAIL);
    assert.equal(changed.location, "/account?notice=email-changed");
    const page = await getPage(fixture.base, "/account?notice=email-changed", deviceCookies(device));
    assert.ok(page.body.includes(GUEST_ACCOUNT_COPY.emailChangedNotice));
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path (review D3): an unknown notice value is ignored and never reflected into the page", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const probe = "<script>alert(1)</script>";
    const page = await getPage(fixture.base, `/account?notice=${encodeURIComponent(probe)}`, deviceCookies(device));
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes("alert(1)"), "the notice value is not reflected");
    assert.ok(!/role="status"/.test(page.body), "no notice banner is shown for an unknown value");
  } finally {
    await fixture.close();
  }
});

/** Two accounts on one database: device A signed in as Ada, device B signed in as another address (review D4). */
async function twoAccounts(sender: CapturingEmailSender) {
  const a = await accountFixture({ sender });
  const b = await accountFixture({ sender, databasePath: a.fixture.databasePath });
  const deviceA = await signInDevice(a.fixture, sender, EMAIL, a.fixture.cookie);
  const deviceB = await signInDevice(b.fixture, sender, OTHER_EMAIL, b.fixture.cookie);
  return { a, b, deviceA, deviceB };
}

test("AC1 failure path (review D4): an interaction cookie of one account with the account cookie of another shows no account data", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    const mixed = `${deviceA.interaction}; ${deviceB.account}`;
    const page = await getPage(a.fixture.base, "/account", mixed);
    assert.equal(page.status, 303, "the mismatched browser is sent to sign-in");
    assert.equal(page.location, SIGN_IN_RETURN);
    assert.ok(!page.body.includes(EMAIL), "Ada's email is not shown");
    assert.ok(!page.body.includes(OTHER_EMAIL), "the other account's email is not shown either");
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});

test("AC4 (review D4): a phone POST with a mismatched interaction cookie is refused and saves nothing", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    const snapshot = () => (a.fixture.environment.database.prepare("SELECT guest_id, tenant_id, phone_number, contact_email, revision FROM guest_contacts ORDER BY guest_id, tenant_id").all([]) as unknown[]);
    const before = snapshot();
    const refused = await postForm(a.fixture.base, "/account/phone", { phone: "+2348099999999" }, `${deviceA.interaction}; ${deviceB.account}`);
    assert.equal(refused.status, 303, "the mismatched browser is sent to sign-in");
    assert.deepEqual(snapshot(), before, "no contact row changed");
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});

test("AC5 (review D5): the account page and its form-error pages send Cache-Control no-store", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    const page = await rawGet(fixture.base, "/account", cookies);
    assert.match(page.headers.get("cache-control") ?? "", /no-store/, "the account page is not cached");
    const badPhone = await fetch(`${fixture.base}/account/phone`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(fixture.base).origin, cookie: cookies }, body: "phone=12345" });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.headers.get("cache-control") ?? "", /no-store/, "the phone error page is not cached");
    const emailForm = await fetch(`${fixture.base}/account/email`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(fixture.base).origin, cookie: cookies }, body: `email=${encodeURIComponent(NEW_EMAIL)}` });
    assert.equal(emailForm.status, 200);
    assert.match(emailForm.headers.get("cache-control") ?? "", /no-store/, "the code step is not cached");
  } finally {
    await fixture.close();
  }
});

test("T3: a replayed change-email code is refused and does not change the email again", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    const requested = await requestEmailChange(fixture.base, cookies, NEW_EMAIL);
    const code = sender.codeFor(NEW_EMAIL);
    const challengeId = challengeIdOf(requested);
    assert.equal((await postForm(fixture.base, "/account/email/code", { email: NEW_EMAIL, challengeId, code }, cookies)).status, 303);
    const replay = await postForm(fixture.base, "/account/email/code", { email: NEW_EMAIL, challengeId, code }, cookies);
    assert.equal(replay.status, 200);
    assert.ok(replay.body.includes('data-error-code="code_consumed"'), "the replay reads as consumed");
    assert.ok((await accountPage(fixture.base, cookies)).body.includes(NEW_EMAIL), "the first change stands");
  } finally {
    await fixture.close();
  }
});

test("T3: a change-email code presented after the account session is revoked is refused and changes nothing", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    const requested = await requestEmailChange(fixture.base, cookies, NEW_EMAIL);
    const code = sender.codeFor(NEW_EMAIL);
    const revoked = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookies);
    assert.equal(revoked.status, 303);
    const after = await postForm(fixture.base, "/account/email/code", { email: NEW_EMAIL, challengeId: challengeIdOf(requested), code }, cookies);
    assert.equal(after.status, 401, "the revoked session cannot confirm the change");
    const row = fixture.environment.database.prepare("SELECT email_normalized FROM guest_accounts").get([]) as { email_normalized: string };
    assert.equal(row.email_normalized, EMAIL, "the account email is unchanged");
  } finally {
    await fixture.close();
  }
});

test("T3: a second email-change request for the same address is rate limited at the route with Retry-After", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = deviceCookies(device);
    assert.equal((await requestEmailChange(fixture.base, cookies, NEW_EMAIL)).status, 200);
    const sent = sender.messages.length;
    const again = await requestEmailChange(fixture.base, cookies, NEW_EMAIL);
    assert.equal(again.status, 429, "the cooldown answers 429");
    assert.ok(again.retryAfter && Number(again.retryAfter) >= 1, "Retry-After is set");
    assert.equal(sender.messages.length, sent, "no second code was sent");
  } finally {
    await fixture.close();
  }
});

test("T3: an address held by another account gets the same code step at the request step as a free address", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    const free = await requestEmailChange(a.fixture.base, deviceCookies(deviceA), NEW_EMAIL);
    advanceClock(a.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
    const held = await requestEmailChange(a.fixture.base, deviceCookies(deviceA), OTHER_EMAIL);
    assert.equal(free.status, 200);
    assert.equal(held.status, 200, "an address held elsewhere is not disclosed at the request step");
    // The whole normalised body must match: only the typed address and the per-request challenge may differ.
    const shape = (body: string) => body.replace(/value="[^"]*"/g, 'value=""').replace(/gacct-[A-Za-z0-9_-]+/g, "");
    assert.equal(shape(held.body), shape(free.body), "the code step is the same page for a held address and a free one");
    assert.ok(deviceB.account);
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});

test("T3 failure path: confirming an address held by another account is refused with email_in_use and changes nothing", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    // The other address's sign-in code was requested a moment ago on the shared database: wait out its cooldown first.
    advanceClock(a.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
    const requested = await requestEmailChange(a.fixture.base, deviceCookies(deviceA), OTHER_EMAIL);
    assert.equal(requested.status, 200, `the request step answers (got ${requested.status}: ${requested.body.slice(0, 160).replace(/\s+/g, " ")})`);
    const refused = await postForm(a.fixture.base, "/account/email/code", { email: OTHER_EMAIL, challengeId: challengeIdOf(requested), code: sender.codeFor(OTHER_EMAIL) }, deviceCookies(deviceA));
    assert.equal(refused.status, 400);
    assert.ok(refused.body.includes('data-error-code="email_in_use"'));
    assert.ok((await accountPage(a.fixture.base, deviceCookies(deviceA))).body.includes(EMAIL), "Ada keeps her email");
    assert.ok(deviceB.interaction);
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});

test("Nit: the code step shows its back link and its lifetime from GUEST_ACCOUNT_COPY", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const requested = await requestEmailChange(fixture.base, deviceCookies(device), NEW_EMAIL);
    // The literal wording the copy block produces; the page must render it from GUEST_ACCOUNT_COPY, not from inline strings.
    assert.ok(requested.body.includes("Back to your account"), "the back link text comes from the copy block");
    assert.ok(requested.body.includes("It expires in 10 minutes."), "the lifetime sentence comes from the copy block");
  } finally {
    await fixture.close();
  }
});

// Delta review (issue 07): no-store on every account-route response that can carry an email, phone or typed value.

test("AC5 (delta 2): every account sign-in response sends Cache-Control no-store (sign-in form, code page, errors, conflict)", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    const noStore = (answer: Response, label: string) => assert.match(answer.headers.get("cache-control") ?? "", /no-store/, `${label} is not cached`);
    const get = await fetch(`${a.fixture.base}/account/sign-in`, { redirect: "manual", headers: { accept: "text/html" } });
    assert.equal(get.status, 200);
    noStore(get, "GET /account/sign-in");
    const badEmail = await fetch(`${a.fixture.base}/account/sign-in`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(a.fixture.base).origin, accept: "text/html" }, body: "email=not-an-email" });
    assert.equal(badEmail.status, 400);
    noStore(badEmail, "POST /account/sign-in with an invalid email");
    // A fresh browser: the code page carries the typed email in a hidden field.
    const sent = await postForm(a.fixture.base, "/account/sign-in", { email: "fresh@example.test" }, "");
    assert.equal(sent.status, 200);
    const sentHeaders = await fetch(`${a.fixture.base}/account/sign-in`, { redirect: "manual", headers: { accept: "text/html" } });
    noStore(sentHeaders, "the sign-in form after a request");
    // Wrong code on the code step (the typed email and challenge come back in the body).
    const wrong = await fetch(`${a.fixture.base}/account/sign-in/code`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(a.fixture.base).origin, accept: "text/html" }, body: new URLSearchParams({ email: "fresh@example.test", challengeId: /name="challengeId" value="([^"]+)"/.exec(sent.body)?.[1] ?? "", code: "000000" }).toString() });
    assert.equal(wrong.status, 200);
    noStore(wrong, "POST /account/sign-in/code with a wrong code");
    // Conflict: device A is linked to Ada and signs in as another address (the request names that address).
    advanceClock(a.fixture, CODE_REQUEST_COOLDOWN_MS * 2); // the other address's code was requested for device B moments ago
    const other = await requestSignInCode(a.fixture.base, OTHER_EMAIL, deviceA.interaction);
    assert.ok(other.challengeId, "the conflicting sign-in gets a challenge");
    const conflict = await fetch(`${a.fixture.base}/account/sign-in/code`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(a.fixture.base).origin, accept: "text/html", cookie: deviceA.interaction }, body: new URLSearchParams({ email: OTHER_EMAIL, challengeId: other.challengeId, code: sender.codeFor(OTHER_EMAIL) }).toString() });
    assert.equal(conflict.status, 409, "the account conflict answers 409");
    noStore(conflict, "POST /account/sign-in/code on a conflicting link");
    assert.ok(deviceB.account);
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});

test("AC4 (delta 2): the account route's 401 and 403 refusals send Cache-Control no-store", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const unauthenticated = await fetch(`${fixture.base}/account/email`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(fixture.base).origin, accept: "text/html" }, body: `email=${encodeURIComponent(NEW_EMAIL)}` });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("cache-control") ?? "", /no-store/, "the 401 is not cached");
    const crossOrigin = await fetch(`${fixture.base}/account/phone`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", accept: "text/html", cookie: deviceCookies(device) }, body: "phone=12345" });
    assert.equal(crossOrigin.status, 403);
    assert.match(crossOrigin.headers.get("cache-control") ?? "", /no-store/, "the 403 is not cached");
  } finally {
    await fixture.close();
  }
});

test("Delta 3 (ADR 0078): no hard-coded English copy remains in the account pages module; every label comes from GUEST_ACCOUNT_COPY", () => {
  const source = readFileSync(join(process.cwd(), "apps", "local-guest", "src", "guest-account-pages.ts"), "utf8");
  // Text between tags, and quoted sentences: the two places a label can hide in this module.
  const textNodes = [...source.matchAll(/>([A-Za-z][^<>${}`]*)</g)].map((match) => match[1]!.trim());
  const quoted = [...source.matchAll(/"([A-Z][a-z]+(?: [^"\n]*)?)"/g)].map((match) => match[1]!).filter((text) => text.includes(" "));
  assert.deepEqual(textNodes, [], "no text node is written inline");
  assert.deepEqual(quoted, [], "no quoted sentence is written inline");
  assert.ok(!source.includes("Back to your conversation"), "the back-link label is copy");
  assert.ok(!source.includes("Try again"), "the retry label is copy");
});

test("AC3 (delta 5): a phone input with no error names only its help text in aria-describedby", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const page = await accountPage(fixture.base, deviceCookies(device));
    const phoneTag = /<input id="phone"[^>]*>/.exec(page.body)?.[0] ?? "";
    assert.match(phoneTag, /aria-describedby="phone-help"/, "only the help text is named when there is no error");
    assert.ok(!/aria-invalid/.test(phoneTag), "no error state is claimed");
  } finally {
    await fixture.close();
  }
});

test("AC4 (delta 5, mirror of D4): an interaction cookie of account B with the account cookie of account A shows nothing and writes nothing", async () => {
  const sender = new CapturingEmailSender();
  const { a, b, deviceA, deviceB } = await twoAccounts(sender);
  try {
    const mixed = `${deviceB.interaction}; ${deviceA.account}`;
    const page = await getPage(a.fixture.base, "/account", mixed);
    assert.equal(page.status, 303, "the mismatched browser is sent to sign-in");
    assert.ok(!page.body.includes(EMAIL) && !page.body.includes(OTHER_EMAIL), "no account email is shown");
    const before = (a.fixture.environment.database.prepare("SELECT guest_id, tenant_id, phone_number, revision FROM guest_contacts ORDER BY guest_id, tenant_id").all([]) as unknown[]);
    const refused = await postForm(a.fixture.base, "/account/phone", { phone: "+2348099999999" }, mixed);
    assert.equal(refused.status, 303);
    const after = (a.fixture.environment.database.prepare("SELECT guest_id, tenant_id, phone_number, revision FROM guest_contacts ORDER BY guest_id, tenant_id").all([]) as unknown[]);
    assert.deepEqual(after, before, "no contact row changed");
  } finally {
    await b.fixture.close();
    await a.fixture.close();
  }
});
