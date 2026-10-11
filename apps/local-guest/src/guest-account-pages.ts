import { appBarHtml, errorPage, escapeHtml, pageShell } from "../../web/src/ui-kit.js";
import { GUEST_ACCOUNT_COPY } from "../../web-agent/src/guest-content.js";

/** A form error: the reason code is kept on the page for support and tests, and the copy is shown inline (ADR 0078). */
export interface AccountFormError {
  readonly code: string;
  readonly message: string;
}

const SIGN_IN_PATH = "/account/sign-in";
const CODE_PATH = "/account/sign-in/code";
const SIGN_OUT_PATH = "/account/sign-out";
const SIGN_OUT_EVERYWHERE_PATH = "/account/sign-out-everywhere";

function appBar(backHref: string, backLabel: string, action: { href: string; label: string; icon: "info" | "users" }): string {
  return appBarHtml({ backHref, backLabel, action });
}

function inlineError(id: string, error: AccountFormError | undefined): string {
  return error === undefined
    ? ""
    : `<p id="${id}" class="ui-field__error" role="alert" data-error-code="${escapeHtml(error.code)}">${escapeHtml(error.message)}</p>`;
}

/** The sign-in page: an email field and one submit. A plain POST form, so it works without JavaScript (ADR 0080). */
export function renderSignInHtml(input: { readonly returnPath: string; readonly email?: string; readonly error?: AccountFormError }): string {
  const invalid = input.error === undefined ? "" : ` aria-invalid="true" aria-describedby="email-error"`;
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.signInTitle} · Shortlet`,
    width: "narrow",
    frame: appBar("/", "Back to your conversation", { href: SIGN_IN_PATH, label: GUEST_ACCOUNT_COPY.appBarSignIn, icon: "info" }),
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet</p><h1>${GUEST_ACCOUNT_COPY.signInTitle}</h1><p>${escapeHtml(GUEST_ACCOUNT_COPY.signInIntro)}</p></header>` +
      `<form class="ui-panel" method="post" action="${SIGN_IN_PATH}">` +
      `<div class="ui-field"><label class="ui-field__label" for="email">${escapeHtml(GUEST_ACCOUNT_COPY.emailLabel)}</label>` +
      `<input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="254" required value="${escapeHtml(input.email ?? "")}"${invalid}>` +
      `${inlineError("email-error", input.error)}</div>` +
      `<input type="hidden" name="return" value="${escapeHtml(input.returnPath)}">` +
      `<button class="ui-button ui-button--primary ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.sendCode)}</button>` +
      `</form>`,
  });
}

/** The code page: the six-digit code, with the challenge and the email carried in hidden fields (ADR 0080). */
export function renderSignInCodeHtml(input: {
  readonly email: string;
  readonly challengeId: string;
  readonly returnPath: string;
  readonly minutes: number;
  readonly error?: AccountFormError;
}): string {
  const invalid = input.error === undefined ? "" : ` aria-invalid="true" aria-describedby="code-error"`;
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.codeTitle} · Shortlet`,
    width: "narrow",
    frame: appBar("/", "Back to your conversation", { href: SIGN_IN_PATH, label: GUEST_ACCOUNT_COPY.appBarSignIn, icon: "info" }),
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet</p><h1>${GUEST_ACCOUNT_COPY.codeTitle}</h1><p>${escapeHtml(GUEST_ACCOUNT_COPY.codeIntro)} It expires in ${input.minutes} minutes.</p></header>` +
      `<form class="ui-panel" method="post" action="${CODE_PATH}">` +
      `<input type="hidden" name="email" value="${escapeHtml(input.email)}">` +
      `<input type="hidden" name="challengeId" value="${escapeHtml(input.challengeId)}">` +
      `<input type="hidden" name="return" value="${escapeHtml(input.returnPath)}">` +
      `<div class="ui-field"><label class="ui-field__label" for="code">${escapeHtml(GUEST_ACCOUNT_COPY.codeLabel)}</label>` +
      `<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required${invalid}>` +
      `${inlineError("code-error", input.error)}</div>` +
      `<button class="ui-button ui-button--primary ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.checkCode)}</button>` +
      `</form>` +
      `<form class="ui-panel" method="post" action="${SIGN_IN_PATH}">` +
      `<input type="hidden" name="email" value="${escapeHtml(input.email)}">` +
      `<input type="hidden" name="return" value="${escapeHtml(input.returnPath)}">` +
      `<button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.requestNewCode)}</button>` +
      `</form>`,
  });
}

/** The account page: the signed-in state and the two sign-out actions. Account details arrive with issue 07. */
export function renderAccountHtml(): string {
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.appBarAccount} · Shortlet`,
    width: "narrow",
    frame: appBar("/", "Back to your conversation", { href: "/account", label: GUEST_ACCOUNT_COPY.appBarAccount, icon: "users" }),
    body: `<section class="ui-panel" data-account-state="signed-in"><h1>${GUEST_ACCOUNT_COPY.appBarAccount}</h1><p>${escapeHtml(GUEST_ACCOUNT_COPY.signedInIntro)}</p>` +
      `<form method="post" action="${SIGN_OUT_PATH}"><button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.signOut)}</button></form>` +
      `<form method="post" action="${SIGN_OUT_EVERYWHERE_PATH}"><p>${escapeHtml(GUEST_ACCOUNT_COPY.signOutEverywhereIntro)}</p>` +
      `<button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.signOutEverywhere)}</button></form></section>`,
  });
}

/** The standard rate-limited page: the same status, code and recovery as the pilot's (ADR 0093). */
export function renderRateLimitedHtml(): string {
  return errorPage({
    status: 429,
    code: "RATE_LIMITED",
    title: GUEST_ACCOUNT_COPY.rateLimitedTitle,
    message: GUEST_ACCOUNT_COPY.rateLimitedMessage,
    action: { href: SIGN_IN_PATH, label: "Try again" },
  });
}

/** Sign-in is disabled because its configuration is missing (fail closed). Discovery and booking are unaffected (ADR 0093). */
export function renderSignInUnavailableHtml(): string {
  return errorPage({
    status: 503,
    code: "ACCOUNT_SIGN_IN_UNAVAILABLE",
    title: GUEST_ACCOUNT_COPY.signInTitle,
    message: GUEST_ACCOUNT_COPY.unavailable,
    action: { href: "/", label: "Back to your conversation" },
  });
}

/**
 * The refusal for an offer or payment link this browser may not open (Q2). The same page for a missing and a foreign
 * offer: it names no offer and carries plain sign-in guidance (copy awaiting human approval).
 */
export function renderOfferNotFoundHtml(): string {
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.offerNotFoundTitle} · Shortlet`,
    width: "narrow",
    frame: appBar("/", "Back to your conversation", { href: SIGN_IN_PATH, label: GUEST_ACCOUNT_COPY.appBarSignIn, icon: "info" }),
    body: `<section class="ui-panel ui-empty" data-error-code="PAYMENT_OFFER_NOT_FOUND" data-status="404"><h1>${escapeHtml(GUEST_ACCOUNT_COPY.offerNotFoundTitle)}</h1>` +
      `<p>${escapeHtml(GUEST_ACCOUNT_COPY.offerNotFoundMessage)}</p>` +
      `<a class="ui-button ui-button--primary ui-button--block" href="${SIGN_IN_PATH}">${escapeHtml(GUEST_ACCOUNT_COPY.signInTitle)}</a>` +
      `<a class="ui-button ui-button--block" href="/">Back to your conversation</a></section>`,
  });
}
