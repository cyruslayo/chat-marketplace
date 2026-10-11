import assert from "node:assert/strict";
import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";
import { CapturingEmailSender, getPage, postForm, setCookieValue, type HttpAnswer, type SignedInDevice } from "./guest-account-sign-in.js";

/** The cookie header a signed-in device sends: its rotated interaction cookie and its account cookie (issue 07). */
export function deviceCookies(device: SignedInDevice): string {
  return `${device.interaction}; ${device.account}`;
}

/** The Account Guest Id of an email's account, read from the fixture database (the page shows the email, not the id). */
export function accountGuestIdOf(fixture: { readonly environment: { readonly database: SqlDatabase } }, email: string): string {
  const row = fixture.environment.database.prepare("SELECT account_guest_id FROM guest_accounts WHERE email_normalized = ?").get([email]) as
    | { account_guest_id: string }
    | undefined;
  assert.ok(row, `an account exists for ${email}`);
  return row.account_guest_id;
}

/** The fields the email-change code page carries: the challenge id the code is checked against. */
export function challengeIdOf(answer: HttpAnswer): string {
  const challengeId = /name="challengeId" value="([^"]+)"/.exec(answer.body)?.[1];
  assert.ok(challengeId, "the code page carries its challenge");
  return challengeId;
}

/** Starts an email change to `newEmail` from a signed-in device (issue 07 AC2). The code goes to the new address. */
export async function requestEmailChange(base: string, cookies: string, newEmail: string): Promise<HttpAnswer> {
  return await postForm(base, "/account/email", { email: newEmail }, cookies);
}

/** A complete email change over HTTP: request, read the code sent to the new address, and submit it. */
export async function changeEmailOverHttp(base: string, cookies: string, sender: CapturingEmailSender, newEmail: string, code?: string): Promise<HttpAnswer> {
  const requested = await requestEmailChange(base, cookies, newEmail);
  assert.equal(requested.status, 200, "the email-change request shows the code step");
  const challengeId = challengeIdOf(requested);
  return await postForm(base, "/account/email/code", { email: newEmail, challengeId, code: code ?? sender.codeFor(newEmail) }, cookies);
}

/** The account page as a browser with these cookies sees it. */
export async function accountPage(base: string, cookies: string): Promise<HttpAnswer> {
  return await getPage(base, "/account", cookies);
}

/** The account cookie value for a device whose sign-in set it (for the header of a request). */
export function accountCookieOf(answer: HttpAnswer): string | undefined {
  return setCookieValue(answer, "shortlet_guest_account");
}
