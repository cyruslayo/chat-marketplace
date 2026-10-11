import assert from "node:assert/strict";
import test from "node:test";
import { restartFixture } from "./helpers/guest-restart.js";
import { loadGuestAccountComposition, TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV } from "../apps/local-guest/src/guest-account-runtime.js";
import { WhatsAppChannelAdapter } from "../domains/shortlet/src/whatsapp-adapter.js";
import type { SqlDatabase } from "../packages/platform-core/src/sql-database.js";
import {
  advanceClock,
  ACCOUNT_COOKIE,
  CODE_REQUEST_COOLDOWN_MS,
  CapturingAuditSink,
  CapturingEmailSender,
  INTERACTION_COOKIE,
  accountComposition,
  accountFixture,
  advanceToPendingWithPhone,
  freshAnonymousCookie,
  cookieHeader,
  getJson,
  getPage,
  postForm,
  postJson,
  requestSignInCode,
  setCookieValue,
  signInDevice,
  wrongCodeFor,
} from "./helpers/guest-account-sign-in.js";

const EMAIL = "ada@example.test";
/** A key that meets the 32-character minimum (Q7). */
const TEST_KEY = "configured-test-key-0123456789abcdef";
const SIGN_IN_PATH = "/account/sign-in";
const CODE_PATH = "/account/sign-in/code";

/** Advances one device's clock (the authority reads the device's clock, so a second device needs its own call). */

/** Rows in one table of the fixture's database: the writes a refused request must not make (AC13). */
function countRows(fixture: { readonly environment: { readonly database: SqlDatabase } }, table: string): number {
  return (fixture.environment.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get([]) as { count: number }).count;
}

test("AC1: Without JavaScript, a Guest can request a code, enter it and land back on the page they came from, signed in.", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=/stays/search`, fixture.cookie);
    assert.equal(page.status, 200);
    assert.match(page.body, /<form[^>]*method="post"[^>]*action="\/account\/sign-in"/);
    assert.match(page.body, /name="email"[^>]*type="email"|type="email"[^>]*name="email"/);

    const { answer: codePage, challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie, "/stays/search");
    assert.equal(codePage.status, 200);
    assert.match(codePage.body, /name="code"/);
    assert.equal(sender.messages.length, 1);

    const done = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: sender.codeFor(EMAIL), return: "/stays/search" }, fixture.cookie);
    assert.equal(done.status, 303);
    assert.equal(done.location, "/stays/search");
    const account = setCookieValue(done, ACCOUNT_COOKIE);
    assert.ok(account, "the account cookie is set");

    const signedIn = await getPage(fixture.base, "/account", cookieHeader({ [ACCOUNT_COOKIE]: account }));
    assert.equal(signedIn.status, 200);
    assert.match(signedIn.body, /data-account-state="signed-in"/);
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path: a code request without a browser session still starts one, and a code cannot be checked without its challenge", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, "");
    assert.ok(challengeId, "the sign-in page issues a browser session when none exists");
    // A cookieless code POST starts a fresh session, as the sign-in page does; the empty challenge is then refused.
    const missing = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId: "", code: sender.codeFor(EMAIL), return: "/" }, "");
    assert.equal(missing.status, 400);
    assert.equal(setCookieValue(missing, ACCOUNT_COOKIE), undefined);
  } finally {
    await fixture.close();
  }
});

test("AC2: A wrong code shows an inline field error with role alert and keeps the email", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const wrong = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: wrongCodeFor(sender.codeFor(EMAIL)), return: "/" }, fixture.cookie);
    assert.equal(wrong.status, 200);
    assert.match(wrong.body, /class="ui-field__error"[^>]*role="alert"|role="alert"[^>]*class="ui-field__error"/);
    assert.match(wrong.body, /data-error-code="code_invalid"/);
    assert.match(wrong.body, new RegExp(`name="email"[^>]*value="${EMAIL.replace(/[.]/g, "\\.")}"|value="${EMAIL.replace(/[.]/g, "\\.")}"[^>]*name="email"`));
    assert.equal(setCookieValue(wrong, ACCOUNT_COOKIE), undefined);
  } finally {
    await fixture.close();
  }
});

test("AC2: After the attempt limit the code fails with its own message, even when the right code is entered", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const right = sender.codeFor(EMAIL);
    let last = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: wrongCodeFor(right), return: "/" }, fixture.cookie);
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      last = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: wrongCodeFor(right), return: "/" }, fixture.cookie);
    }
    assert.match(last.body, /data-error-code="code_attempts_exhausted"/);
    const afterLimit = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: right, return: "/" }, fixture.cookie);
    assert.match(afterLimit.body, /data-error-code="code_attempts_exhausted"/);
    assert.equal(setCookieValue(afterLimit, ACCOUNT_COOKIE), undefined);
  } finally {
    await fixture.close();
  }
});

test("AC2: An expired code fails with its own message and creates no session", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const code = sender.codeFor(EMAIL);
    advanceClock(fixture, 10 * 60 * 1000 + 1000);
    const expired = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code, return: "/" }, fixture.cookie);
    assert.match(expired.body, /data-error-code="code_expired"/);
    assert.equal(setCookieValue(expired, ACCOUNT_COOKIE), undefined);
    assert.equal(countRows(fixture, "guest_account_sessions"), 0);
  } finally {
    await fixture.close();
  }
});

test("AC3: The session secret changes at sign-in (the pre-sign-in cookie value no longer authenticates as the account)", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const before = fixture.cookie;
    const device = await signInDevice(fixture, sender, EMAIL, before);
    assert.notEqual(device.interaction, before, "the interaction cookie is rotated at sign-in");
    const preSignIn = await getJson(fixture.base, "/api/committed-work", before);
    assert.equal(preSignIn.status, 401, "the pre-sign-in cookie no longer authenticates");
    const rotated = await getJson(fixture.base, "/api/committed-work", device.interaction);
    assert.equal(rotated.status, 200);
  } finally {
    await fixture.close();
  }
});

test("AC3 failure path: a pre-sign-in cookie presented with the account cookie does not authenticate as the account", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const before = fixture.cookie;
    const device = await signInDevice(fixture, sender, EMAIL, before);
    // The browser that still holds the pre-sign-in interaction cookie, plus the newly issued account cookie.
    const replayed = await getPage(fixture.base, "/account", cookieHeader({ [INTERACTION_COOKIE]: before.split("=")[1], [ACCOUNT_COOKIE]: device.account.split("=")[1] }));
    assert.equal(replayed.status, 401);
    assert.match(replayed.body, /AUTHENTICATION_REQUIRED/);
  } finally {
    await fixture.close();
  }
});

test("AC4: Sign out everywhere closes an open stream in a second browser context: the second context's next turn is refused", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    // Device A and device B share one account. The conversation on B is open in its own browser context.
    const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const before = await postJson(second.fixture.base, "/api/turn", { threadId: second.fixture.threadId, text: "" }, deviceB.interaction);
      assert.equal(before.status, 400, "device B's conversation is authorized before sign-out everywhere");

      const out = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: deviceA.account.split("=")[1], [INTERACTION_COOKIE]: deviceA.interaction.split("=")[1] }));
      assert.equal(out.status, 303);

      const refused = await postJson(second.fixture.base, "/api/turn", { threadId: second.fixture.threadId, text: "I need an apartment in Ikoyi" }, deviceB.interaction);
      assert.equal(refused.status, 401);
      assert.equal(refused.body.code, "AUTHENTICATION_REQUIRED");
      const withAccount = await getPage(second.fixture.base, "/account", deviceB.account);
      assert.equal(withAccount.status, 401);
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC4 failure path: sign out everywhere requires a current account session", async () => {
  const { fixture } = await accountFixture();
  try {
    const anonymous = await postForm(fixture.base, "/account/sign-out-everywhere", {}, fixture.cookie);
    assert.equal(anonymous.status, 401);
  } finally {
    await fixture.close();
  }
});

test("AC5: Code requests over the limit get the standard rate-limited response", async () => {
  const { fixture } = await accountFixture();
  try {
    // Five requests per email per hour (ADR 0093); the cooldown between them is respected.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const { answer } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
      assert.equal(answer.status, 200, `request ${attempt} is within the limit`);
      advanceClock(fixture, CODE_REQUEST_COOLDOWN_MS);
    }
    const refused = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    assert.equal(refused.answer.status, 429);
    assert.match(refused.answer.body, /data-error-code="RATE_LIMITED"/);
    assert.ok(refused.answer.retryAfter && Number(refused.answer.retryAfter) >= 1, "the standard Retry-After header is set");
  } finally {
    await fixture.close();
  }
});

test("AC5 failure path: a second code request inside the cooldown is refused", async () => {
  const { fixture } = await accountFixture();
  try {
    assert.equal((await requestSignInCode(fixture.base, EMAIL, fixture.cookie)).answer.status, 200);
    const tooSoon = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    assert.equal(tooSoon.answer.status, 429);
    assert.match(tooSoon.answer.body, /data-error-code="RATE_LIMITED"/);
  } finally {
    await fixture.close();
  }
});

test("AC6: A return value that is absolute, protocol-relative or off-site is ignored", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    for (const hostile of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "http://127.0.0.1:1/"]) {
      const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${encodeURIComponent(hostile)}`, fixture.cookie);
      assert.match(page.body, /name="return" value="\/"/, `${hostile} is not carried into the form`);
    }
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie, "//evil.example/x");
    const done = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: sender.codeFor(EMAIL), return: "//evil.example/x" }, fixture.cookie);
    assert.equal(done.status, 303);
    assert.equal(done.location, "/");
  } finally {
    await fixture.close();
  }
});

test("AC7: No server log, notification record or audit entry contains the email, the code or the cookie value", async () => {
  const audit = new CapturingAuditSink();
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender, audit });
  const captured: string[] = [];
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const capture = (...parts: unknown[]) => { captured.push(parts.map(String).join(" ")); };
  console.log = capture; console.info = capture; console.warn = capture; console.error = capture;
  process.stdout.write = ((chunk: string | Uint8Array) => { captured.push(String(chunk)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { captured.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const code = sender.codeFor(EMAIL);
    await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: wrongCodeFor(code), return: "/" }, fixture.cookie);
    const done = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code, return: "/" }, fixture.cookie);
    const account = setCookieValue(done, ACCOUNT_COOKIE)!;
    await getPage(fixture.base, "/account", cookieHeader({ [ACCOUNT_COOKIE]: account }));
    await postForm(fixture.base, "/account/sign-out", {}, cookieHeader({ [ACCOUNT_COOKIE]: account }));
    const secret = account.split(".").slice(1).join(".");
    const sensitive = [EMAIL, code, wrongCodeFor(code), secret, setCookieValue(done, INTERACTION_COOKIE) ?? "", account];
    const surfaces = [...captured, JSON.stringify(audit.entries), JSON.stringify(sender.messages.map((entry) => ({ subject: entry.subject, idempotencyKey: entry.idempotencyKey })))];
    for (const surface of surfaces) {
      for (const value of sensitive) {
        if (value !== "") assert.equal(surface.includes(value), false, "no log, notification record or audit entry carries a credential or email");
      }
    }
    assert.ok(audit.entries.length > 0, "the audit sink received the sign-in events it is given");
  } finally {
    console.log = originals.log; console.info = originals.info; console.warn = originals.warn; console.error = originals.error;
    process.stdout.write = originals.out as typeof process.stdout.write;
    process.stderr.write = originals.err as typeof process.stderr.write;
    await fixture.close();
  }
});

test("AC8: Searching, requesting and paying work unchanged without signing in", async () => {
  const { fixture } = await accountFixture();
  try {
    const search = await getPage(fixture.base, "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2", fixture.cookie);
    assert.equal(search.status, 200);
    const turn = await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" });
    assert.equal(turn.ok, true);
    const listed = await getJson(fixture.base, "/api/committed-work", fixture.cookie);
    assert.equal(listed.status, 200);
  } finally {
    await fixture.close();
  }
});

test("AC9: Sign-out rotates the browser to a fresh unlinked anonymous interaction principal: after POST /account/sign-out the old account cookie does not authenticate, and the previous principal's account history is not shown (ADR 0093)", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    // The live request is made on the device before it signs in; sign-in keeps the principal and rotates the cookie.
    await advanceToPendingWithPhone(fixture);
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const beforeOut = await getJson(fixture.base, "/api/committed-work", device.interaction + "; " + device.account);
    assert.equal(beforeOut.status, 200);
    assert.equal((beforeOut.body.committedWork as unknown[]).length, 1, "the account shows its live request before sign-out");

    const out = await postForm(fixture.base, "/account/sign-out", {}, cookieHeader({ [ACCOUNT_COOKIE]: device.account.split("=")[1], [INTERACTION_COOKIE]: device.interaction.split("=")[1] }));
    assert.equal(out.status, 303);
    const freshInteraction = setCookieValue(out, INTERACTION_COOKIE);
    assert.ok(freshInteraction && `${INTERACTION_COOKIE}=${freshInteraction}` !== device.interaction, "the browser gets a fresh interaction cookie");
    assert.match(out.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "", /Max-Age=0/);

    const oldAccount = await getPage(fixture.base, "/account", device.account);
    assert.equal(oldAccount.status, 401, "the old account cookie does not authenticate");
    const fresh = await getJson(fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: freshInteraction }));
    assert.equal(fresh.status, 200);
    assert.deepEqual(fresh.body.committedWork, [], "the previous principal's account history is not shown");
    const oldCookie = await getJson(fixture.base, "/api/committed-work", device.interaction);
    assert.equal(oldCookie.status, 401, "the signed-out interaction cookie is retired");
  } finally {
    await fixture.close();
  }
});

test("AC9 failure path: a signed-out request to /account is refused", async () => {
  const { fixture } = await accountFixture();
  try {
    const page = await getPage(fixture.base, "/account", fixture.cookie);
    assert.equal(page.status, 401);
    assert.match(page.body, /data-error-code="AUTHENTICATION_REQUIRED"/);
  } finally {
    await fixture.close();
  }
});

test("AC10: Account changes (email change, data export, deletion) are reachable only from authenticated web surfaces; WhatsApp and other agent channels redirect to the web (ADR 0067)", () => {
  const adapter = new WhatsAppChannelAdapter();
  for (const intent of ["change_account_email", "export_account_data", "delete_account", "sign_out_everywhere"]) {
    const result = adapter.executeAction({ intent, payload: {} }) as { redirectedToWeb?: boolean; webUrl?: string };
    assert.equal(result.redirectedToWeb, true, `${intent} is redirected to the web`);
    assert.match(result.webUrl ?? "", /^https:\/\//);
  }
});

test("AC10 failure path: an account change from WhatsApp is answered with the web link and is not executed", () => {
  const adapter = new WhatsAppChannelAdapter();
  const result = adapter.executeAction({ intent: "change_account_email", payload: { email: "new@example.test" } }) as { redirectedToWeb?: boolean; replyMessage?: string };
  assert.equal(result.redirectedToWeb, true);
  assert.match(result.replyMessage ?? "", /secure web portal/);
});

test("AC11: a thread owned by an unlinked principal is refused over HTTP even with a valid account cookie", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    // An anonymous device creates a conversation. It is owned by its own principal.
    const stranger = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      await stranger.fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" });
      const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
      const refused = await postJson(fixture.base, "/api/turn", { threadId: stranger.fixture.threadId, text: "" }, cookieHeader({ [INTERACTION_COOKIE]: device.interaction.split("=")[1], [ACCOUNT_COOKIE]: device.account.split("=")[1] }));
      assert.equal(refused.status, 401);
      assert.equal(refused.body.code, "AUTHENTICATION_REQUIRED");
      // Control: the signed-in device's own conversation is still authorized.
      const own = await postJson(fixture.base, "/api/turn", { threadId: fixture.threadId, text: "" }, device.interaction);
      assert.equal(own.status, 400);
    } finally {
      await stranger.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC11 failure path: a thread whose record has a missing tenant is refused over HTTP with a valid account cookie", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" }, device.interaction);
    const own = fixture.environment.interactionStore.findThread(fixture.threadId);
    assert.ok(own);
    fixture.environment.interactionStore.saveThread({ threadId: "g-missing-tenant", principalId: own.principalId, tenantId: "", threadJson: own.threadJson });
    const refused = await postJson(fixture.base, "/api/turn", { threadId: "g-missing-tenant", text: "" }, device.interaction);
    assert.equal(refused.status, 401);
  } finally {
    await fixture.close();
  }
});

test("AC12: the committedWork callers pass the resolved identity, so the union of live work from the account's linked principals is shown over HTTP, and only from them", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    await advanceToPendingWithPhone(fixture);
    const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const shown = await getJson(second.fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: deviceB.interaction.split("=")[1], [ACCOUNT_COOKIE]: deviceB.account.split("=")[1] }));
      assert.equal(shown.status, 200);
      assert.equal((shown.body.committedWork as unknown[]).length, 1, "device B shows the live request made on device A");
      const stranger = await getJson(second.fixture.base, "/api/committed-work", await freshAnonymousCookie(second.fixture.base));
      assert.deepEqual(stranger.body.committedWork, [], "an unlinked session on the same database shows none of it");
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC12 failure path: an account cookie that does not resolve shows no committed work", async () => {
  const { fixture } = await accountFixture();
  try {
    const forged = await getJson(fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: fixture.cookie.split("=")[1], [ACCOUNT_COOKIE]: "gass-forged.forged" }));
    assert.equal(forged.status, 200);
    assert.deepEqual(forged.body.committedWork, []);
  } finally {
    await fixture.close();
  }
});

test("AC13: sign-in passes the authority's verified session to linkSignedInPrincipal; a plain email or an unverified session cannot link a principal over HTTP, and the route writes nothing in that case", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const before = { principals: countRows(fixture, "guest_account_principals"), claims: countRows(fixture, "guest_account_request_claims") };
    // A plain email with no code: the sign-in code page cannot link.
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const guessed = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: wrongCodeFor(sender.codeFor(EMAIL)), return: "/" }, fixture.cookie);
    assert.equal(setCookieValue(guessed, ACCOUNT_COOKIE), undefined);
    // A forged account cookie (an email-shaped value, a wrong secret) is never a verified session.
    const forged = await getJson(fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: fixture.cookie.split("=")[1], [ACCOUNT_COOKIE]: `gass-${EMAIL}.secret` }));
    assert.deepEqual(forged.body.committedWork, []);
    assert.deepEqual({ principals: countRows(fixture, "guest_account_principals"), claims: countRows(fixture, "guest_account_request_claims") }, before, "the route wrote nothing");
  } finally {
    await fixture.close();
  }
});

test("AC13 failure path: a verified sign-in links the device's principal to exactly one account", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    assert.equal(countRows(fixture, "guest_account_principals"), 1);
  } finally {
    await fixture.close();
  }
});

test("AC14: after a second device signs into the account, the Booking Requests, Conditional Booking Offers and Reservations of the account's linked principals (and claimed requests) are shown over HTTP, and nothing from an unlinked principal is shown", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const pending = await advanceToPendingWithPhone(fixture);
    // The operator accepts the request (the same step the fixture's own offer stage takes).
    fixture.environment.simulateOperatorAcceptance(pending.surfaces[0]!.surfaceId.split(":").at(-1)!);
    const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      const shown = await getJson(second.fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: deviceB.interaction.split("=")[1], [ACCOUNT_COOKIE]: deviceB.account.split("=")[1] }));
      const kinds = (shown.body.committedWork as { kind: string }[]).map((entry) => entry.kind);
      assert.ok(kinds.includes("offer"), "device B shows the conditional offer made on device A");
      assert.ok(deviceA.account);
      const stranger = await getJson(second.fixture.base, "/api/committed-work", await freshAnonymousCookie(second.fixture.base));
      assert.deepEqual(stranger.body.committedWork, [], "an unlinked principal sees none of the account's work");
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC14 (claimed requests): a Booking Request claimed by its recorded email is shown over HTTP on the new device, and nothing else of the old device is", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    // The lost device made the request with an email; it never signed in.
    const pending = await advanceToPendingWithPhone(fixture, { email: EMAIL });
    const requestId = pending.surfaces[0]!.surfaceId.split(":").at(-1)!;
    const replacement = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(replacement.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const device = await signInDevice(replacement.fixture, sender, EMAIL, replacement.fixture.cookie);
      const shown = await getJson(replacement.fixture.base, "/api/committed-work", cookieHeader({ [INTERACTION_COOKIE]: device.interaction.split("=")[1], [ACCOUNT_COOKIE]: device.account.split("=")[1] }));
      const listed = shown.body.committedWork as { kind: string; route: string }[];
      assert.deepEqual(listed.map((entry) => [entry.kind, entry.route.includes(requestId)]), [["request", true]]);
      // Failure path: a session that did not sign in to this account sees none of the claimed request.
      const stranger = await getJson(replacement.fixture.base, "/api/committed-work", await freshAnonymousCookie(replacement.fixture.base));
      assert.deepEqual(stranger.body.committedWork, []);
    } finally {
      await replacement.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path: a cross-origin sign-in form post is refused and sends no code", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    const response = await fetch(`${fixture.base}${SIGN_IN_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", cookie: fixture.cookie, origin: "https://attacker.example" },
      body: new URLSearchParams({ email: EMAIL, return: "/" }).toString(),
    });
    assert.equal(response.status, 403);
    assert.equal(sender.messages.length, 0, "no code is sent for a refused origin");
  } finally {
    await fixture.close();
  }
});

test("AC1 failure path: sign-in is disabled with no code sent when the code-hashing key is missing (fail closed)", async () => {
  const sender = new CapturingEmailSender();
  const fixture = await restartFixture({}, { sessionScopedGuestPrincipals: true, guestAccounts: { codeHashingKey: "", sender } });
  try {
    const page = await getPage(fixture.base, SIGN_IN_PATH, fixture.cookie);
    assert.equal(page.status, 503);
    assert.match(page.body, /data-error-code="ACCOUNT_SIGN_IN_UNAVAILABLE"/);
    const posted = await postForm(fixture.base, SIGN_IN_PATH, { email: EMAIL, return: "/" }, fixture.cookie);
    assert.equal(posted.status, 503);
    assert.equal(sender.messages.length, 0);
  } finally {
    await fixture.close();
  }
  // Configuration reads the key and the sender only from the environment: nothing is defaulted.
  const unset = loadGuestAccountComposition({});
  assert.equal(unset.codeHashingKey, null);
  assert.equal(unset.sender, null);
});

test("AC3: The account cookie is HttpOnly and SameSite=Lax, and Secure when secure cookies are configured", async () => {
  const sender = new CapturingEmailSender();
  const fixture = await restartFixture({}, { sessionScopedGuestPrincipals: true, secureCookie: true, guestAccounts: accountComposition({ sender }) });
  try {
    const { challengeId } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    const done = await postForm(fixture.base, CODE_PATH, { email: EMAIL, challengeId, code: sender.codeFor(EMAIL), return: "/" }, fixture.cookie);
    const line = done.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "";
    assert.match(line, /HttpOnly/);
    assert.match(line, /SameSite=Lax/);
    assert.match(line, /; Secure/);
    assert.match(line, /Max-Age=\d+/);
  } finally {
    await fixture.close();
  }
});

test("AC5 failure path: a forged client-address header is ignored unless Cloudflare trust is configured", async () => {
  // Only the per-address limit can fire here: every request is for a different email, and each carries a rotating header.
  const forged = (attempt: number) => ({ "cf-connecting-ip": `203.0.113.${attempt}` });
  const send = (base: string, cookie: string, attempt: number) =>
    fetch(`${base}${SIGN_IN_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: new URL(base).origin, cookie, ...forged(attempt) },
      body: new URLSearchParams({ email: `guest${attempt}@example.test`, return: "/" }).toString(),
    });
  const { fixture } = await accountFixture();
  try {
    // Twenty code requests per client address per hour (ADR 0093), from one socket address.
    for (let attempt = 1; attempt <= 20; attempt += 1) assert.equal((await send(fixture.base, fixture.cookie, attempt)).status, 200, `request ${attempt}`);
    assert.equal((await send(fixture.base, fixture.cookie, 21)).status, 429, "the socket address is limited; the forged header is not trusted");
  } finally {
    await fixture.close();
  }
  const trusted = await accountFixture({ trustCloudflareClientAddress: true });
  try {
    // With Cloudflare trust configured, each forwarded address has its own allowance.
    for (let attempt = 1; attempt <= 21; attempt += 1) assert.equal((await send(trusted.fixture.base, trusted.fixture.cookie, attempt)).status, 200, `trusted request ${attempt}`);
  } finally {
    await trusted.fixture.close();
  }
});

// AC6 (return validation): each hostile class is ignored on its own and in combination. The return value reaches the
// form only through the sanitiser, so the hidden field is the observable.
const HOSTILE_RETURNS: readonly [string, string][] = [
  ["https://evil.example/x", "absolute URL"],
  ["//evil.example/x", "protocol-relative"],
  ["/\\evil.example", "backslash"],
  ["javascript:alert(1)", "javascript scheme"],
  ["http://127.0.0.1:1/", "loopback absolute"],
  ["evil.example", "no leading slash"],
];

for (const [hostile, label] of HOSTILE_RETURNS) {
  test(`AC6: A return value that is absolute, protocol-relative or off-site is ignored (${label})`, async () => {
    const { fixture } = await accountFixture();
    try {
      const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${encodeURIComponent(hostile)}`, fixture.cookie);
      assert.match(page.body, /name="return" value="\/"/, `${hostile} is not carried into the form`);
    } finally {
      await fixture.close();
    }
  });
}

test("AC6 failure path: encoded-slash and encoded-backslash variants of a protocol-relative path are ignored", async () => {
  const { fixture } = await accountFixture();
  try {
    // Raw query text, so the server decodes the percent-encodings itself.
    for (const raw of ["/%2F%2Fevil.example", "/%5C%5Cevil.example", "/%2F%5Cevil.example"]) {
      const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${raw}`, fixture.cookie);
      assert.match(page.body, /name="return" value="\/"/, `${raw} is not carried into the form`);
    }
  } finally {
    await fixture.close();
  }
});

test("AC6 failure path: a CR, LF or tab in the return value is ignored, so no header or path is injected", async () => {
  const { fixture } = await accountFixture();
  try {
    for (const raw of ["/%0D%0ASet-Cookie:%20x=1", "/%0Aevil", "/%09/evil.example"]) {
      const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${raw}`, fixture.cookie);
      assert.match(page.body, /name="return" value="\/"/, `${raw} is not carried into the form`);
      assert.equal(page.setCookies.length, 0, "no cookie is injected by a return value");
    }
  } finally {
    await fixture.close();
  }
});

test("AC6: A valid same-origin path with a query is kept", async () => {
  const { fixture } = await accountFixture();
  try {
    const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${encodeURIComponent("/stays/search?area=old-ikoyi&partySize=2")}`, fixture.cookie);
    assert.match(page.body, /name="return" value="\/stays\/search\?area=old-ikoyi&amp;partySize=2"/);
  } finally {
    await fixture.close();
  }
});

test("AC5 failure path: the configuration loader leaves Cloudflare address trust off unless SHORTLET_TRUST_CF_CONNECTING_IP is exactly true", async () => {
  const base = { SHORTLET_GUEST_CODE_HASHING_KEY: TEST_KEY, RESEND_API_KEY: "re_test_key", SHORTLET_NOTIFICATION_FROM: "Shortlet <notify@example.test>" };
  assert.equal(loadGuestAccountComposition(base).trustCloudflareClientAddress, false, "unset means the socket address");
  assert.equal(loadGuestAccountComposition({ ...base, [TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV]: "yes" }).trustCloudflareClientAddress, false, "only the exact value enables it");
  // The server built from the loader's output: a rotating forged header is ignored by default and honoured when configured.
  const sign = (base_: string, cookie: string, attempt: number) =>
    fetch(`${base_}${SIGN_IN_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: new URL(base_).origin, cookie, "cf-connecting-ip": `198.51.100.${attempt}` },
      body: new URLSearchParams({ email: `loader${attempt}@example.test`, return: "/" }).toString(),
    });
  for (const [configured, expectedAt21] of [[false, 429], [true, 200]] as const) {
    const loaded = loadGuestAccountComposition(configured ? { ...base, [TRUST_CLOUDFLARE_CLIENT_ADDRESS_ENV]: "true" } : base);
    const sender = new CapturingEmailSender();
    const fixture = await restartFixture({}, { sessionScopedGuestPrincipals: true, guestAccounts: { ...loaded, codeHashingKey: TEST_KEY, sender } });
    try {
      for (let attempt = 1; attempt <= 20; attempt += 1) assert.equal((await sign(fixture.base, fixture.cookie, attempt)).status, 200, `request ${attempt}`);
      assert.equal((await sign(fixture.base, fixture.cookie, 21)).status, expectedAt21, `trust configured: ${configured}`);
    } finally {
      await fixture.close();
    }
  }
});

// ---- Security review of PR #102 (D1, D2, D3, M7 gap, Q4, N3, Q7). Written before the fixes; red evidence in scratchpad. ----

// D1: return values that URL normalisation turns into a protocol-relative path. The form value arrives raw.
const D1_INPUTS = ["/..//evil.example", "/%2e%2e//x", "/a/..//x", "/.//x", "/x/../..//x"] as const;
for (const raw of D1_INPUTS) {
  test(`D1: POST /account/sign-in/code never redirects to a protocol-relative location (${raw})`, async () => {
    const email = `d1-${raw.length}-${raw.charCodeAt(1)}@example.test`;
    const { fixture, sender } = await accountFixture();
    try {
      const page = await getPage(fixture.base, `${SIGN_IN_PATH}?return=${raw}`, fixture.cookie);
      assert.match(page.body, /name="return" value="\/"/, "the sign-in form carries the sanitised path");
      const { challengeId } = await requestSignInCode(fixture.base, email, fixture.cookie, raw);
      const done = await postForm(fixture.base, CODE_PATH, { email, challengeId, code: sender.codeFor(email), return: raw }, fixture.cookie);
      assert.equal(done.status, 303);
      assert.equal(done.location, "/", `${raw} is replaced by the default path`);
    } finally {
      await fixture.close();
    }
  });
}

test("D1 control: a same-origin path whose dot segments resolve inside the site is kept", async () => {
  const email = "d1-control@example.test";
  const { fixture, sender } = await accountFixture();
  try {
    const { challengeId } = await requestSignInCode(fixture.base, email, fixture.cookie, "/stays/../stays/search");
    const done = await postForm(fixture.base, CODE_PATH, { email, challengeId, code: sender.codeFor(email), return: "/stays/../stays/search" }, fixture.cookie);
    assert.equal(done.location, "/stays/search");
  } finally {
    await fixture.close();
  }
});

// D2: a linked conversation is not readable with the interaction cookie alone once the account session has expired.
test("D2: a linked conversation is not readable with the interaction cookie alone after the account session expires", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const bText = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      await second.fixture.send("/api/turn", { text: bText });
      const bThread = second.fixture.threadId;
      const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      advanceClock(fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
      const bothCookies = cookieHeader({ [INTERACTION_COOKIE]: deviceA.interaction.split("=")[1], [ACCOUNT_COOKIE]: deviceA.account.split("=")[1] });
      // Device A binds B's conversation through a request (an empty turn is refused after binding, so it changes nothing).
      assert.equal((await postJson(fixture.base, "/api/turn", { threadId: bThread, text: "" }, bothCookies)).status, 400);
      // While the account is live, A lists its linked work (this loads B's conversation into the server's cache), then reads it.
      assert.equal((await getJson(fixture.base, "/api/committed-work", bothCookies)).status, 200);
      // Before expiry device A's account reads B's conversation (control).
      const during = await getJson(fixture.base, `/api/state?threadId=${bThread}`, bothCookies);
      assert.equal((during.body.timeline as unknown[]).length > 0, true, "the linked conversation is readable while the account session is live");
      // The account session expires (30 days, absolute); the interaction cookie stays.
      advanceClock(fixture, 31 * 24 * 60 * 60 * 1000);
      const interactionOnly = cookieHeader({ [INTERACTION_COOKIE]: deviceA.interaction.split("=")[1] });
      const after = await getJson(fixture.base, `/api/state?threadId=${bThread}`, interactionOnly);
      assert.deepEqual(after.body.timeline, [], "the expired account reads no timeline for the linked conversation");
      assert.deepEqual(after.body.surfaces, []);
      const page = await getPage(fixture.base, `/conversation?threadId=${bThread}`, interactionOnly);
      assert.equal(page.body.includes("Ikoyi"), false, "the conversation page does not render the linked conversation");
      assert.ok(deviceB.account);
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

// D3: a browser whose interaction binding was retired gets a fresh, unlinked session on / and on the sign-in page.
test("D3: a browser whose interaction binding was retired by sign-out everywhere starts a fresh unlinked session on / and on the sign-in page", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const stale = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceB = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      // Device A signs out everywhere: device B's binding is retired.
      const out = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: stale.account.split("=")[1], [INTERACTION_COOKIE]: stale.interaction.split("=")[1] }));
      assert.equal(out.status, 303);
      const staleB = deviceB.interaction;
      const home = await getPage(second.fixture.base, "/", staleB);
      assert.equal(home.status, 200, "the home page starts a fresh session instead of refusing");
      const freshHome = setCookieValue(home, INTERACTION_COOKIE);
      assert.ok(freshHome, "a new interaction cookie is issued");
      assert.notEqual(`${INTERACTION_COOKIE}=${freshHome}`, staleB);
      const freshCookie = `${INTERACTION_COOKIE}=${freshHome}`;
      const page = await getPage(second.fixture.base, SIGN_IN_PATH, staleB);
      assert.equal(page.status, 200, "the sign-in page renders for a browser with a retired binding");
      assert.equal(setCookieValue(page, INTERACTION_COOKIE), undefined, "rendering the form writes no binding (item 4)");
      // The fresh session has no account identity: no account page, and no committed work.
      assert.equal((await getPage(second.fixture.base, "/account", freshCookie)).status, 401);
      assert.deepEqual((await getJson(second.fixture.base, "/api/committed-work", freshCookie)).body.committedWork, []);
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

// M7 gap: a refused conflicting sign-in revokes the session it created and sets no account cookie.
test("AC13 failure path: a refused conflicting sign-in revokes the session it created and sets no account cookie", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const first = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const other = "other-account@example.test";
    advanceClock(fixture, CODE_REQUEST_COOLDOWN_MS * 2);
    const { challengeId } = await requestSignInCode(fixture.base, other, first.interaction);
    const refused = await postForm(fixture.base, CODE_PATH, { email: other, challengeId, code: sender.codeFor(other), return: "/" }, first.interaction);
    assert.equal(refused.status, 409);
    assert.equal(setCookieValue(refused, ACCOUNT_COOKIE), undefined, "no account cookie for the refused sign-in");
    const active = fixture.environment.database.prepare("SELECT COUNT(*) AS count FROM guest_account_sessions WHERE revoked_at IS NULL").get([]) as { count: number };
    assert.equal(active.count, 1, "only the first device's session is usable");
  } finally {
    await fixture.close();
  }
});

// Q4: an account POST with no Origin and no same-origin Referer is refused.
test("Q4: an account POST with no Origin and no same-origin Referer is refused and changes nothing", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const cookies = cookieHeader({ [ACCOUNT_COOKIE]: device.account.split("=")[1], [INTERACTION_COOKIE]: device.interaction.split("=")[1] });
    const bare = await fetch(`${fixture.base}/account/sign-out`, { method: "POST", redirect: "manual", headers: { accept: "text/html", cookie: cookies, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    assert.equal(bare.status, 403, "no Origin and no Referer is refused");
    assert.equal((await getPage(fixture.base, "/account", device.account)).status, 200, "the refused sign-out changed nothing");
    const foreign = await fetch(`${fixture.base}/account/sign-out`, { method: "POST", redirect: "manual", headers: { accept: "text/html", cookie: cookies, referer: "https://attacker.example/page", "content-type": "application/x-www-form-urlencoded" }, body: "" });
    assert.equal(foreign.status, 403, "a foreign Referer is refused");
    const sameOrigin = await fetch(`${fixture.base}/account/sign-out`, { method: "POST", redirect: "manual", headers: { accept: "text/html", cookie: cookies, referer: `${fixture.base}/account`, "content-type": "application/x-www-form-urlencoded" }, body: "" });
    assert.equal(sameOrigin.status, 303, "a same-origin Referer is accepted");
  } finally {
    await fixture.close();
  }
});

// N3: with accounts disabled, sign-out still expires the account cookie.
test("N3: with accounts disabled, sign-out still expires the account cookie instead of failing with a bare 503", async () => {
  const fixture = await restartFixture({}, { sessionScopedGuestPrincipals: true, guestAccounts: null });
  try {
    const out = await postForm(fixture.base, "/account/sign-out", {}, cookieHeader({ [ACCOUNT_COOKIE]: "gass-stale.stale", [INTERACTION_COOKIE]: fixture.cookie.split("=")[1] }));
    assert.equal(out.status, 303);
    assert.match(out.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "", /Max-Age=0/);
    assert.equal((await getPage(fixture.base, SIGN_IN_PATH, fixture.cookie)).status, 503);
  } finally {
    await fixture.close();
  }
});

// Q7: the code-hashing key must be at least 32 characters; a shorter key disables sign-in (no default).
test("Q7: a code-hashing key shorter than 32 characters disables sign-in and sends no code (fail closed)", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender, codeHashingKey: "x".repeat(31) });
  try {
    assert.equal((await getPage(fixture.base, SIGN_IN_PATH, fixture.cookie)).status, 503);
    assert.equal((await postForm(fixture.base, SIGN_IN_PATH, { email: EMAIL, return: "/" }, fixture.cookie)).status, 503);
    assert.equal(sender.messages.length, 0);
  } finally {
    await fixture.close();
  }
  assert.equal(loadGuestAccountComposition({ SHORTLET_GUEST_CODE_HASHING_KEY: "x".repeat(31) }).codeHashingKey, null);
});

test("Q7: a code-hashing key of exactly 32 characters enables sign-in", async () => {
  const { fixture, sender } = await accountFixture({ codeHashingKey: "k".repeat(32) });
  try {
    const { answer } = await requestSignInCode(fixture.base, EMAIL, fixture.cookie);
    assert.equal(answer.status, 200);
    assert.equal(sender.messages.length, 1);
  } finally {
    await fixture.close();
  }
  assert.equal(loadGuestAccountComposition({ SHORTLET_GUEST_CODE_HASHING_KEY: "k".repeat(32) }).codeHashingKey, "k".repeat(32));
});

// ---- Security re-review of PR #102 (7f80e82). Written before the fixes; red evidence in the PR body. ----

const bindingIds = (fixture: { readonly environment: { readonly database: SqlDatabase } }): string[] =>
  (fixture.environment.database.prepare("SELECT session_id FROM guest_session_bindings").all([]) as { session_id: string }[]).map((row) => row.session_id);
const SESSION_BINDING_COUNT = (fixture: { readonly environment: { readonly database: SqlDatabase } }): number =>
  (fixture.environment.database.prepare("SELECT COUNT(*) AS count FROM guest_session_bindings").get([]) as { count: number }).count;

// Item 1 (high): a linked read must not rewrite a pending-stage conversation's owner; after expiry the linked device's
// cookie alone is refused on every route that reads or writes the conversation.
test("Linked read keeps owner: a linked read never rewrites a pending-stage conversation's owner, and after expiry the device's cookie alone is refused", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      await advanceToPendingWithPhone(second.fixture);
      const bThread = second.fixture.threadId;
      const bPrincipal = second.fixture.environment.interactionStore.findThread(bThread)?.principalId;
      assert.ok(bPrincipal, "device B owns a saved pending conversation");
      await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      advanceClock(fixture, CODE_REQUEST_COOLDOWN_MS * 2);
      const deviceA = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
      const bothA = cookieHeader({ [INTERACTION_COOKIE]: deviceA.interaction.split("=")[1], [ACCOUNT_COOKIE]: deviceA.account.split("=")[1] });
      // Device A binds B's conversation (an empty turn is refused after binding), lists committed work, then reads B's conversation.
      assert.equal((await postJson(fixture.base, "/api/turn", { threadId: bThread, text: "" }, bothA)).status, 400);
      assert.equal((await getJson(fixture.base, "/api/committed-work", bothA)).status, 200);
      assert.equal((await getJson(fixture.base, `/api/state?threadId=${bThread}`, bothA)).status, 200);
      // (a) the owner row is unchanged by the linked read.
      const owner = () => (fixture.environment.database.prepare("SELECT principal_id FROM guest_threads WHERE thread_id = ?").get([bThread]) as { principal_id: string }).principal_id;
      assert.equal(owner(), bPrincipal, "the linked read does not re-own the conversation");
      // The account expires (31 days); device A's interaction cookie stays.
      advanceClock(fixture, 31 * 24 * 60 * 60 * 1000);
      const cookieOnly = cookieHeader({ [INTERACTION_COOKIE]: deviceA.interaction.split("=")[1] });
      // (b) after expiry the cookie alone reads and writes nothing of B's conversation.
      const state = await getJson(fixture.base, `/api/state?threadId=${bThread}`, cookieOnly);
      assert.deepEqual(state.body.timeline, [], "the state read is empty");
      const conversation = await getPage(fixture.base, `/conversation?threadId=${bThread}`, cookieOnly);
      assert.equal(conversation.body.includes("Ikoyi"), false, "the conversation page does not show the transcript");
      const posted = await postForm(fixture.base, "/conversation", { threadId: bThread, message: "Hello there" }, cookieOnly);
      assert.notEqual(posted.status, 303, "a message to the conversation is not accepted");
      assert.equal(posted.status, 401);
      assert.equal((await postJson(fixture.base, "/api/turn", { threadId: bThread, text: "I need an apartment in Ikoyi" }, cookieOnly)).status, 401);
      assert.equal((await postJson(fixture.base, "/api/event", { threadId: bThread, name: "shortlet.noop", context: {} }, cookieOnly)).status, 401);
      assert.equal(owner(), bPrincipal, "no refused request re-owns the conversation either");
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

// Item 2 (medium): sign out everywhere with accounts disabled must revoke server-side, or it must not claim success.
test("Disabled sign-out everywhere: sign out everywhere while accounts are disabled revokes the account, so a restart with accounts enabled refuses the old cookie", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const databasePath = fixture.databasePath;
  const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
  const second = await accountFixture({ sender, databasePath });
  advanceClock(second.fixture, CODE_REQUEST_COOLDOWN_MS * 2);
  const linked = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
  // Stop both servers without deleting the database directory (fixture.close() would delete it).
  await second.fixture.close();
  await fixture.server.close();
  // Restart with accounts disabled on the same database, then sign out everywhere.
  const disabled = await restartFixture({ databasePath: databasePath }, { sessionScopedGuestPrincipals: true, guestAccounts: null });
  try {
    const out = await postForm(disabled.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: device.account.split("=")[1], [INTERACTION_COOKIE]: device.interaction.split("=")[1] }));
    assert.equal(out.status, 303, "the revocation is possible without the key, so it succeeds");
    assert.match(out.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "", /Max-Age=0/);
  } finally {
    await disabled.close();
  }
  // Restart with accounts enabled on the same database.
  const enabled = await accountFixture({ sender, databasePath: databasePath });
  try {
    assert.equal((await getPage(enabled.fixture.base, "/account", device.account)).status, 401, "the old account cookie no longer authenticates");
    assert.equal((await getJson(enabled.fixture.base, "/api/committed-work", linked.interaction)).status, 401, "the linked device's cookie is retired");
    const fresh = await getJson(enabled.fixture.base, "/api/committed-work", await freshAnonymousCookie(enabled.fixture.base));
    assert.deepEqual(fresh.body.committedWork, []);
  } finally {
    await enabled.fixture.close();
    await fixture.close();
  }
});

// Item 3 (medium): signing in keeps the device's own conversation readable from its new cookie, as before sign-in.
test("Sign-in keeps own conversation: after sign-in the device's own conversation is served from its new cookie, with the same timeline as before, and after a restart", async () => {
  const { fixture, sender } = await accountFixture();
  try {
    await advanceToPendingWithPhone(fixture);
    const threadId = fixture.threadId;
    const before = await getJson(fixture.base, `/api/state?threadId=${threadId}`, fixture.cookie);
    const beforeCount = (before.body.timeline as unknown[]).length;
    assert.ok(beforeCount > 0, "the conversation has a timeline before sign-in");
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const after = await getJson(fixture.base, `/api/state?threadId=${threadId}`, device.interaction);
    assert.equal((after.body.timeline as unknown[]).length, beforeCount, "the timeline is kept at sign-in");
    await fixture.restart();
    const restarted = await getJson(fixture.base, `/api/state?threadId=${threadId}`, device.interaction);
    assert.equal((restarted.body.timeline as unknown[]).length, beforeCount, "and after a restart");
  } finally {
    await fixture.close();
  }
});

// Item 4 (low): unauthenticated GETs create no session bindings; cookieless POSTs are limited before a binding is issued.
test("Binding budget: 30 unauthenticated GETs of the sign-in page create no session bindings", async () => {
  const { fixture } = await accountFixture();
  try {
    const before = SESSION_BINDING_COUNT(fixture);
    for (let attempt = 1; attempt <= 30; attempt += 1) assert.equal((await getPage(fixture.base, SIGN_IN_PATH)).status, 200);
    assert.equal(SESSION_BINDING_COUNT(fixture), before, "no binding is written by a GET");
  } finally {
    await fixture.close();
  }
});

test("Binding budget: cookieless sign-in POSTs beyond the per-address budget are refused before a binding is issued", async () => {
  const { fixture } = await accountFixture();
  try {
    const before = SESSION_BINDING_COUNT(fixture);
    // The per-address budget for sign-in requests is the ADR 0093 code-request budget (20 per address per hour).
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const answer = await postForm(fixture.base, SIGN_IN_PATH, { email: `budget${attempt}@example.test`, return: "/" }, "");
      assert.equal(answer.status, 200, `request ${attempt} is within the budget`);
    }
    assert.equal(SESSION_BINDING_COUNT(fixture), before + 20);
    const refused = await postForm(fixture.base, SIGN_IN_PATH, { email: "budget21@example.test", return: "/" }, "");
    assert.equal(refused.status, 429);
    assert.match(refused.body, /data-error-code="RATE_LIMITED"/);
    assert.equal(SESSION_BINDING_COUNT(fixture), before + 20, "the refused POST issued no binding");
  } finally {
    await fixture.close();
  }
});

// Item 5 (fail-closed): a conversation id bound without a saved record reads as empty, never as content.
test("Record-less conversation: a conversation id bound without a saved record reads as empty, not as content", async () => {
  const { fixture } = await accountFixture();
  try {
    const id = `g-${crypto.randomUUID()}`;
    assert.equal((await postJson(fixture.base, "/api/turn", { threadId: id, text: "" }, fixture.cookie)).status, 400, "the binding is accepted");
    const state = await getJson(fixture.base, `/api/state?threadId=${id}`, fixture.cookie);
    assert.deepEqual(state.body.timeline, []);
    assert.deepEqual(state.body.surfaces, []);
  } finally {
    await fixture.close();
  }
});

// Disabled sign-out everywhere failure path: without the key, a forged secret revokes nothing; the real cookie still works afterwards.
test("Disabled sign-out everywhere failure path: with accounts disabled a forged session secret revokes nothing, and the real cookie still authenticates", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const databasePath = fixture.databasePath;
  const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
  await fixture.server.close();
  const disabled = await restartFixture({ databasePath }, { sessionScopedGuestPrincipals: true, guestAccounts: null });
  try {
    const [sessionId] = device.account.split("=")[1]!.split(".");
    const forged = await postForm(disabled.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: `${sessionId}.forged-secret`, [INTERACTION_COOKIE]: device.interaction.split("=")[1] }));
    assert.equal(forged.status, 503, "nothing can be ended, so the page refuses and claims no success");
    assert.equal(setCookieValue(forged, ACCOUNT_COOKIE), undefined, "the real cookie is not expired by a forged one");
  } finally {
    await disabled.close();
  }
  const enabled = await accountFixture({ sender, databasePath });
  try {
    assert.equal((await getPage(enabled.fixture.base, "/account", device.account)).status, 200, "the real account session still works");
  } finally {
    await enabled.fixture.close();
    await fixture.close();
  }
});

// Re-review 7 (medium): sign-out routes are never rate limited; a flood of cookieless sign-outs cannot block the signed-in
// guest's own sign-out or sign-out everywhere.
test("Sign-out not rate limited: 20 cookieless sign-outs from one address never block a signed-in sign-out or sign-out everywhere", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const bindingsBefore = SESSION_BINDING_COUNT(fixture);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      assert.equal((await postForm(fixture.base, "/account/sign-out", {}, "")).status, 303, `cookieless sign-out ${attempt}`);
    }
    assert.equal(SESSION_BINDING_COUNT(fixture), bindingsBefore, "a cookieless sign-out writes no session binding");
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const out = await postForm(fixture.base, "/account/sign-out", {}, cookieHeader({ [ACCOUNT_COOKIE]: device.account.split("=")[1], [INTERACTION_COOKIE]: device.interaction.split("=")[1] }));
    assert.equal(out.status, 303, "the signed-in sign-out is not refused");
    assert.equal((await getPage(fixture.base, "/account", device.account)).status, 401, "and it revoked the account");
    fixture.setTime(new Date(fixture.environment.clock().getTime() + CODE_REQUEST_COOLDOWN_MS * 2).toISOString());
    const again = await signInDevice(fixture, sender, EMAIL, cookieHeader({ [INTERACTION_COOKIE]: setCookieValueOf(out, INTERACTION_COOKIE) }));
    const everywhere = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: again.account.split("=")[1], [INTERACTION_COOKIE]: again.interaction.split("=")[1] }));
    assert.equal(everywhere.status, 303, "the signed-in sign-out everywhere is not refused");
    assert.equal((await getPage(fixture.base, "/account", again.account)).status, 401, "and it revoked the account");
  } finally {
    await fixture.close();
  }
});

function setCookieValueOf(answer: { readonly setCookies: readonly string[] }, name: string): string {
  const line = answer.setCookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? "";
  return line.split(";")[0]!.slice(name.length + 1);
}

// Re-review 8 (LOW, probe M4 survived): the key-free revocation refuses a session of another tenant, even with a valid secret.
test("Tenant-checked revocation: the key-free revocation refuses a session of another tenant even when its secret is valid", async () => {
  const { createGuestAccountFixture, signInGuestAccount } = await import("./helpers/guest-account-authority.js");
  const { openNodeSqliteDatabase } = await import("../packages/platform-core/src/node-sqlite-database.js");
  const { revokeGuestAccountWithoutKey } = await import("../domains/shortlet/src/guest-account-authority.js");
  const accounts = await createGuestAccountFixture();
  try {
    const session = signInGuestAccount(accounts.authority, "tenant-check@example.test", "tenant-1");
    const database = openNodeSqliteDatabase(accounts.databasePath);
    try {
      assert.equal(revokeGuestAccountWithoutKey(database, { sessionId: session.sessionId, sessionSecret: session.sessionSecret, tenantId: "tenant-2", everywhere: true, now: accounts.now() }), null);
      assert.ok(accounts.authority.resolveSession(session.sessionId, session.sessionSecret), "the session is still live");
    } finally {
      database.close();
    }
  } finally {
    await accounts.close();
  }
});

// Re-review 9 (LOW, probe M7 survived): a conversation a linked device could read is not carried into the rotated session
// for the interaction cookie alone.
test("Rotation carries no linked conversation: a conversation of a linked principal is not carried into the rotated session for the interaction cookie alone", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    await advanceToPendingWithPhone(fixture);
    const ownerThread = fixture.threadId;
    const owner = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    const second = await accountFixture({ sender, databasePath: fixture.databasePath });
    try {
      second.fixture.setTime(new Date(second.fixture.environment.clock().getTime() + CODE_REQUEST_COOLDOWN_MS * 2).toISOString());
      const linked = await signInDevice(second.fixture, sender, EMAIL, second.fixture.cookie);
      // The linked device binds the owner's conversation through its account cookie, then the owner signs in again.
      const linkedCookies = cookieHeader({ [INTERACTION_COOKIE]: linked.interaction.split("=")[1], [ACCOUNT_COOKIE]: linked.account.split("=")[1] });
      assert.equal((await postJson(second.fixture.base, "/api/turn", { threadId: ownerThread, text: "" }, linkedCookies)).status, 400);
      second.fixture.setTime(new Date(second.fixture.environment.clock().getTime() + CODE_REQUEST_COOLDOWN_MS * 2).toISOString());
      const again = await signInDevice(second.fixture, sender, EMAIL, linked.interaction);
      assert.ok(again.interaction);
      const interactionOnly = cookieHeader({ [INTERACTION_COOKIE]: again.interaction.split("=")[1] });
      const state = await getJson(second.fixture.base, `/api/state?threadId=${ownerThread}`, interactionOnly);
      assert.deepEqual(state.body.timeline, [], "the rotated interaction cookie alone reads nothing of the owner's conversation");
      assert.ok(owner.account);
    } finally {
      await second.fixture.close();
    }
  } finally {
    await fixture.close();
  }
});

// Sign-out with no presented session writes no binding, on either composition (round 4 item 1).
test("Sign-out not rate limited: 40 cookieless sign-outs write no session binding (accounts enabled)", async () => {
  const { fixture } = await accountFixture();
  try {
    const before = SESSION_BINDING_COUNT(fixture);
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const answer = await postForm(fixture.base, "/account/sign-out", {}, "");
      assert.equal(answer.status, 303, `cookieless sign-out ${attempt} is not refused`);
      assert.match(answer.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "", /Max-Age=0/, "the account cookie is cleared");
    }
    assert.equal(SESSION_BINDING_COUNT(fixture), before, "no binding is written without a presented session");
  } finally {
    await fixture.close();
  }
});

test("Sign-out not rate limited: 40 cookieless sign-outs write no session binding (accounts disabled)", async () => {
  const { fixture } = await accountFixture();
  const databasePath = fixture.databasePath;
  await fixture.server.close();
  const disabled = await restartFixture({ databasePath }, { sessionScopedGuestPrincipals: true, guestAccounts: null });
  try {
    const before = SESSION_BINDING_COUNT(disabled);
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const answer = await postForm(disabled.base, "/account/sign-out", {}, "");
      assert.equal(answer.status, 303, `cookieless sign-out ${attempt} is not refused`);
      assert.match(answer.setCookies.find((cookie) => cookie.startsWith(`${ACCOUNT_COOKIE}=`)) ?? "", /Max-Age=0/, "the account cookie is cleared");
    }
    assert.equal(SESSION_BINDING_COUNT(disabled), before, "no binding is written without a presented session");
  } finally {
    await disabled.close();
    await fixture.close();
  }
});

test("Sign-out not rate limited: sign out everywhere with an account cookie and no interaction cookie writes no binding", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    const device = await signInDevice(fixture, sender, EMAIL, fixture.cookie);
    // Revocation deletes the linked device's binding, so compare identifiers: no binding may be new.
    const before = new Set(bindingIds(fixture));
    const out = await postForm(fixture.base, "/account/sign-out-everywhere", {}, cookieHeader({ [ACCOUNT_COOKIE]: device.account.split("=")[1] }));
    assert.equal(out.status, 303, "the account cookie alone ends the account");
    const created = bindingIds(fixture).filter((id) => !before.has(id));
    assert.deepEqual(created, [], "no binding is written without a presented interaction session");
    assert.equal((await getPage(fixture.base, "/account", device.account)).status, 401, "and it revoked the account");
  } finally {
    await fixture.close();
  }
});

