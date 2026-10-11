import { appBarHtml, errorPage, escapeHtml, pageShell } from "../../web/src/ui-kit.js";
import { GUEST_ACCOUNT_COPY } from "../../web-agent/src/guest-content.js";

/** Account responses carry personal data, so the browser and any cache must not keep them (review D5). */
export const ACCOUNT_PAGE_HEADERS = Object.freeze({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });

/** A form error: the reason code is kept on the page for support and tests, and the copy is shown inline (ADR 0078). */
export interface AccountFormError {
  readonly code: string;
  readonly message: string;
}

const SIGN_IN_PATH = "/account/sign-in";
const CODE_PATH = "/account/sign-in/code";
const SIGN_OUT_PATH = "/account/sign-out";
const SIGN_OUT_EVERYWHERE_PATH = "/account/sign-out-everywhere";
const ACCOUNT_PATH = "/account";
const EMAIL_PATH = "/account/email";
const EMAIL_CODE_PATH = "/account/email/code";

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

/** The one-line notice shown after a completed change: a fixed allowlist of values, and their copy (review D3). */
const NOTICES = {
  "email-changed": GUEST_ACCOUNT_COPY.emailChangedNotice,
  "phone-saved": GUEST_ACCOUNT_COPY.phoneSavedNotice,
} as const;
export type AccountNotice = keyof typeof NOTICES;

/** The notice for a query value: only an allowlisted value is recognised, anything else is ignored and never reflected. */
export function accountNoticeFrom(value: string | null): AccountNotice | undefined {
  return value === "email-changed" || value === "phone-saved" ? value : undefined;
}

export interface AccountPageInput {
  readonly email: string;
  readonly phone: string | null;
  readonly governmentIdVerified: boolean;
  readonly notice?: AccountNotice;
  readonly emailDraft?: string;
  readonly emailError?: AccountFormError;
  readonly phoneDraft?: string;
  readonly phoneError?: AccountFormError;
}

/**
 * The account page (issue 07): the details as facts, the email change and the phone forms, and the two sign-out actions. Every
 * control is a plain POST form (ADR 0080), and the identity status is copy from issue 01 (never a gate, ADR 0085).
 */
export function renderAccountHtml(input: AccountPageInput): string {
  const identity = input.governmentIdVerified ? GUEST_ACCOUNT_COPY.identityIdChecked : GUEST_ACCOUNT_COPY.identityIdNotChecked;
  const emailInvalid = input.emailError === undefined ? "" : ` aria-invalid="true" aria-describedby="new-email-error"`;
  // One attribute naming the help and, when present, the error (review D2).
  const phoneDescribedBy = input.phoneError === undefined ? "phone-help" : "phone-help phone-error";
  const phoneInvalid = input.phoneError === undefined ? "" : ` aria-invalid="true"`;
  const notice = input.notice === undefined ? "" : `<p class="ui-banner ui-banner--success" role="status" data-notice="${input.notice}">${escapeHtml(NOTICES[input.notice])}</p>`;
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.accountTitle} · Shortlet`,
    width: "narrow",
    frame: appBar("/", "Back to your conversation", { href: "/account", label: GUEST_ACCOUNT_COPY.appBarAccount, icon: "users" }),
    body: `<header class="ui-page__header"><p class="ui-eyebrow">${GUEST_ACCOUNT_COPY.brandEyebrow}</p><h1>${GUEST_ACCOUNT_COPY.accountTitle}</h1><p>${escapeHtml(GUEST_ACCOUNT_COPY.accountIntro)}</p></header>` +
      notice +
      `<section class="ui-panel" data-account-state="signed-in"><h2>${GUEST_ACCOUNT_COPY.detailsHeading}</h2>` +
      `<dl class="ui-facts ui-facts--stacked">` +
      `<div><dt>${escapeHtml(GUEST_ACCOUNT_COPY.emailLabel)}</dt><dd data-fact="email">${escapeHtml(input.email)}</dd></div>` +
      `<div><dt>${escapeHtml(GUEST_ACCOUNT_COPY.phoneLabel)}</dt><dd data-fact="phone">${escapeHtml(input.phone ?? GUEST_ACCOUNT_COPY.phoneNotAdded)}</dd></div>` +
      `<div><dt>${escapeHtml(GUEST_ACCOUNT_COPY.identityLabel)}</dt><dd data-fact="identity">${escapeHtml(GUEST_ACCOUNT_COPY.identityEmailConfirmed)}</dd><dd data-fact="identity-id">${escapeHtml(identity)}</dd></div>` +
      `</dl></section>` +
      `<form class="ui-panel" method="post" action="/account/email"><h2>${GUEST_ACCOUNT_COPY.changeEmailHeading}</h2><p>${escapeHtml(GUEST_ACCOUNT_COPY.changeEmailIntro)}</p>` +
      `<div class="ui-field"><label class="ui-field__label" for="new-email">${escapeHtml(GUEST_ACCOUNT_COPY.emailLabel)}</label>` +
      `<input id="new-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="254" required value="${escapeHtml(input.emailDraft ?? "")}"${emailInvalid}>` +
      `${inlineError("new-email-error", input.emailError)}</div>` +
      `<button class="ui-button ui-button--primary ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.changeEmailButton)}</button></form>` +
      `<form class="ui-panel" method="post" action="/account/phone"><h2>${GUEST_ACCOUNT_COPY.phoneLabel}</h2>` +
      `<div class="ui-field"><label class="ui-field__label" for="phone">${escapeHtml(GUEST_ACCOUNT_COPY.phoneLabel)}</label>` +
      `<p class="ui-field__hint" id="phone-help">${escapeHtml(GUEST_ACCOUNT_COPY.phoneHint)}</p>` +
      `<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="32" aria-describedby="${phoneDescribedBy}" value="${escapeHtml(input.phoneDraft ?? "")}"${phoneInvalid}>` +
      `${inlineError("phone-error", input.phoneError)}</div>` +
      `<button class="ui-button ui-button--primary ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.savePhone)}</button></form>` +
      `<section class="ui-panel"><h2>${GUEST_ACCOUNT_COPY.sessionsHeading}</h2>` +
      `<form method="post" action="${SIGN_OUT_PATH}"><button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.signOut)}</button></form>` +
      `<form method="post" action="${SIGN_OUT_EVERYWHERE_PATH}"><p>${escapeHtml(GUEST_ACCOUNT_COPY.signOutEverywhereIntro)}</p>` +
      `<button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.signOutEverywhere)}</button></form></section>`,
  });
}

/** The code step for an email change (issue 07 AC2): the new address and challenge are carried in hidden fields. */
export function renderEmailChangeCodeHtml(input: { readonly newEmail: string; readonly challengeId: string; readonly minutes: number; readonly error?: AccountFormError }): string {
  const invalid = input.error === undefined ? "" : ` aria-invalid="true" aria-describedby="code-error"`;
  return pageShell({
    title: `${GUEST_ACCOUNT_COPY.changeEmailCodeTitle} · Shortlet`,
    width: "narrow",
    frame: appBar(ACCOUNT_PATH, GUEST_ACCOUNT_COPY.backToAccount, { href: ACCOUNT_PATH, label: GUEST_ACCOUNT_COPY.appBarAccount, icon: "users" }),
    body: `<header class="ui-page__header"><p class="ui-eyebrow">${GUEST_ACCOUNT_COPY.brandEyebrow}</p><h1>${GUEST_ACCOUNT_COPY.changeEmailCodeTitle}</h1>` +
      `<p>${escapeHtml(GUEST_ACCOUNT_COPY.changeEmailCodeIntro)} ${escapeHtml(GUEST_ACCOUNT_COPY.codeExpiresIn(input.minutes))}</p></header>` +
      `<form class="ui-panel" method="post" action="${EMAIL_CODE_PATH}">` +
      `<input type="hidden" name="email" value="${escapeHtml(input.newEmail)}">` +
      `<input type="hidden" name="challengeId" value="${escapeHtml(input.challengeId)}">` +
      `<div class="ui-field"><label class="ui-field__label" for="code">${escapeHtml(GUEST_ACCOUNT_COPY.codeLabel)}</label>` +
      `<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required${invalid}>` +
      `${inlineError("code-error", input.error)}</div>` +
      `<button class="ui-button ui-button--primary ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.changeEmailCheckButton)}</button>` +
      `</form>` +
      `<form class="ui-panel" method="post" action="${EMAIL_PATH}">` +
      `<input type="hidden" name="email" value="${escapeHtml(input.newEmail)}">` +
      `<button class="ui-button ui-button--block" type="submit">${escapeHtml(GUEST_ACCOUNT_COPY.requestNewCode)}</button>` +
      `</form>`,
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
