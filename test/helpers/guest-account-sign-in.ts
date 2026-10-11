import assert from "node:assert/strict";
import type { EmailMessage, EmailSender } from "../../apps/pilot/src/notifications/email-sender.js";
import { EmailProviderError } from "../../apps/pilot/src/notifications/email-sender.js";
import type { GuestAccountComposition } from "../../apps/local-guest/src/guest-account-runtime.js";
import { guestAction, restartFixture } from "./guest-restart.js";
import type { GuestTurnSuccess } from "../../apps/local-guest/src/guest-server.js";
import { TEST_GUEST_CODE_HASHING_KEY } from "./guest-account-authority.js";

/** The account cookie name and the interaction cookie name, as the server sets them (issue 06). */
export const ACCOUNT_COOKIE = "shortlet_guest_account";
export const INTERACTION_COOKIE = "shortlet_guest_session";

/** A fake Resend sender: keeps every message in memory and can be told to fail the next sends. */
export class CapturingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];
  #failures = 0;

  failNext(count = 1): void {
    this.#failures = count;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.#failures > 0) {
      this.#failures -= 1;
      throw new EmailProviderError(503);
    }
    this.messages.push(message);
  }

  /** The six-digit code in the most recent message sent to `email`. */
  codeFor(email: string): string {
    const message = [...this.messages].reverse().find((entry) => entry.to.includes(email));
    assert.ok(message, `no sign-in code was sent to ${email}`);
    const code = /\b(\d{6})\b/.exec(message.text)?.[1];
    assert.ok(code, "the sign-in email carries a six-digit code");
    return code;
  }
}

/** A capturing audit sink, so tests can assert over every audit entry (AC7). */
export class CapturingAuditSink {
  readonly entries: Record<string, string | number>[] = [];
  record(entry: Record<string, string | number>): void {
    this.entries.push(entry);
  }
}

export interface AccountFixtureOptions {
  readonly sender?: CapturingEmailSender;
  readonly audit?: CapturingAuditSink;
  readonly codeHashingKey?: string;
  readonly databasePath?: string;
  /** Trust `CF-Connecting-IP` for the client address (SHORTLET_TRUST_CF_CONNECTING_IP); off unless a test sets it. */
  readonly trustCloudflareClientAddress?: boolean;
}

/** The composition the tests inject: the test hashing key and the fake sender (no provider, no secrets). */
export function accountComposition(options: AccountFixtureOptions = {}): GuestAccountComposition {
  return {
    codeHashingKey: options.codeHashingKey ?? TEST_GUEST_CODE_HASHING_KEY,
    sender: options.sender ?? new CapturingEmailSender(),
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.trustCloudflareClientAddress ? { trustCloudflareClientAddress: true } : {}),
  };
}

/**
 * A local Guest server with account sign-in enabled, session-scoped principals (a device is one principal), and a
 * fake sender. A second device can share the database file by passing the first fixture's `databasePath`.
 */
export async function accountFixture(options: AccountFixtureOptions = {}) {
  const composition = accountComposition(options);
  const fixture = await restartFixture(
    options.databasePath ? { databasePath: options.databasePath } : {},
    { sessionScopedGuestPrincipals: true, guestAccounts: composition },
  );
  return { fixture, sender: composition.sender as CapturingEmailSender, composition };
}

export interface HttpAnswer {
  readonly status: number;
  readonly location: string | null;
  readonly body: string;
  readonly setCookies: readonly string[];
  readonly retryAfter: string | null;
}

/** The cookie value (`name=value`) set by the response, or undefined. */
export function setCookieValue(answer: HttpAnswer, name: string): string | undefined {
  const line = answer.setCookies.find((cookie) => cookie.startsWith(`${name}=`));
  return line?.split(";")[0]?.slice(name.length + 1);
}

/** A `Cookie` header carrying the given name/value pairs, skipping absent values. */
export function cookieHeader(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Reads a response without following redirects, so the 303 target is what the test sees. */
async function toAnswer(response: Response): Promise<HttpAnswer> {
  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
    setCookies: response.headers.getSetCookie(),
    retryAfter: response.headers.get("retry-after"),
  };
}

/** A plain HTML form post, exactly as a no-JavaScript browser sends it. */
export async function postForm(base: string, path: string, fields: Record<string, string>, cookies: string = ""): Promise<HttpAnswer> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
  return await toAnswer(response);
}

export async function getPage(base: string, path: string, cookies: string = ""): Promise<HttpAnswer> {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: { accept: "text/html", ...(cookies ? { cookie: cookies } : {}) },
  });
  return await toAnswer(response);
}

/** A JSON API call (turns, committed work), used to show what a browser may act on. */
export async function getJson(base: string, path: string, cookies: string = ""): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, { headers: cookies ? { cookie: cookies } : {} });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

export async function postJson(base: string, path: string, body: unknown, cookies: string = ""): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookies ? { cookie: cookies } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** Starts a sign-in for `email` and returns the challenge fields the code page carries. */
export async function requestSignInCode(base: string, email: string, cookies: string, returnPath = "/"): Promise<{ answer: HttpAnswer; challengeId: string }> {
  const answer = await postForm(base, "/account/sign-in", { email, return: returnPath }, cookies);
  const challengeId = /name="challengeId" value="([^"]+)"/.exec(answer.body)?.[1] ?? "";
  return { answer, challengeId };
}

/** Advances the server clock by one code-request cooldown (ADR 0093) so a second request is permitted. */
export const CODE_REQUEST_COOLDOWN_MS = 61_000;

/** A wrong code for a six-digit code: the same length, guaranteed different. */
export function wrongCodeFor(code: string): string {
  return code === "999999" ? "000000" : "999999";
}

export interface SignedInDevice {
  /** The interaction cookie after sign-in (rotated at sign-in, ADR 0093). */
  readonly interaction: string;
  /** The account cookie value, `<sessionId>.<secret>`. */
  readonly account: string;
  readonly answer: HttpAnswer;
}

/**
 * A complete no-JavaScript sign-in on one device: request a code, read it from the fake sender, submit it. The device's
 * interaction cookie is rotated by the sign-in, so the returned `interaction` replaces the one the device had.
 */
export async function signInDevice(
  fixture: { readonly base: string },
  sender: CapturingEmailSender,
  email: string,
  interaction: string,
  returnPath = "/",
): Promise<SignedInDevice> {
  const { challengeId } = await requestSignInCode(fixture.base, email, interaction, returnPath);
  const code = sender.codeFor(email);
  const answer = await postForm(fixture.base, "/account/sign-in/code", { email, challengeId, code, return: returnPath }, interaction);
  const account = setCookieValue(answer, ACCOUNT_COOKIE);
  const rotated = setCookieValue(answer, INTERACTION_COOKIE);
  assert.ok(account, "a verified sign-in sets the account cookie");
  assert.ok(rotated, "a verified sign-in rotates the interaction cookie");
  return { interaction: `${INTERACTION_COOKIE}=${rotated}`, account: `${ACCOUNT_COOKIE}=${account}`, answer };
}

/** A Nigerian mobile number in the +234 form the contact step accepts (ADR 0078). */
export const TEST_GUEST_PHONE = "+2348012345678";

export type AccountFixture = Awaited<ReturnType<typeof accountFixture>>["fixture"];

/**
 * Drives a session-scoped device to a sent Booking Request (`pending`). A session-scoped runtime has no seeded phone, so
 * the device enters one on the review screen first, as a Guest does (the contact step's own event).
 */
export async function advanceToPendingWithPhone(fixture: AccountFixture, options: { readonly email?: string } = {}): Promise<GuestTurnSuccess> {
  const review = await fixture.advance("review");
  const phoneSurface = review.surfaces.find((surface) => surface.surfaceId.includes(":contact:phone"));
  assert.ok(phoneSurface, "the review stage asks for a phone number");
  const save = guestAction(phoneSurface);
  const saved = await fixture.send("/api/event", { ...save, context: { ...save.context, contactValue: TEST_GUEST_PHONE } }) as GuestTurnSuccess;
  assert.ok(saved.ok);
  if (options.email !== undefined) {
    // The contact email is recorded before disclosure, so the request keeps it as its contact snapshot (ADR 0093).
    const principalId = fixture.environment.interactionStore.findThread(fixture.threadId)?.principalId;
    assert.ok(principalId, "the conversation has an owning principal");
    const principal = { id: principalId, role: "guest" as const, tenantId: fixture.environment.config.tenantId };
    const revision = fixture.environment.guestContactApp.get(principal)?.revision ?? 0;
    fixture.environment.guestContactApp.submitEmail({ contactEmail: options.email, expectedRevision: revision }, principal);
  }
  const pending = await fixture.send("/api/event", guestAction(saved.surfaces[0]!)) as GuestTurnSuccess;
  assert.ok(pending.ok);
  return pending;
}

/** A brand-new anonymous browser session on the server: an unlinked principal that shares the database (AC12, AC14). */
export async function freshAnonymousCookie(base: string): Promise<string> {
  const answer = await getPage(base, "/");
  const value = setCookieValue(answer, INTERACTION_COOKIE);
  assert.ok(value, "the home page issues a browser session");
  return `${INTERACTION_COOKIE}=${value}`;
}
