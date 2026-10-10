# Guest server: sign-in, sign-out and account session cookie

Status: ready-for-agent
Type: task
Blocked by: 05
Requested: 2 Oct 2026

## Why

The authority (04) and linking (05) exist in the domain; the Guest app must let a person use them, in a browser with or without JavaScript, and must end sessions properly.

## What to build

- Routes in `apps/local-guest/src/guest-server.ts`, all plain forms (ADR 0080) built from `pageShell` and the kit helpers in `apps/local-guest/src/guest-kit.ts`:
  - `GET /account/sign-in` (email field) → `POST /account/sign-in` sends a code, shows the code page.
  - `POST /account/sign-in/code` verifies, links the current principal (05), issues the account session, redirects with 303 to a safe local `return` path (validate it: same-origin path only).
  - `POST /account/sign-out` and `POST /account/sign-out-everywhere`.
- Cookie: keep `shortlet_guest_session` for the interaction session. Add account columns to `guest_session_bindings` additively (`account_guest_id`, `expires_at`, `revoked_at`) or a dedicated account cookie; choose one consistent with ADR 0093 and record why in `## Answer`. Rotate the secret on sign-in. `HttpOnly`, `SameSite=Lax`, `Secure` when `secureCookie`.
- Sign out everywhere ends attached streams (ADR 0070): the SSE/turn streams of every session of the account close and further turns get `AUTHENTICATION_REQUIRED`.
- Origin checks: reuse `browserOriginAccepted` on every POST.
- Rate limits: reuse `SlidingWindowRateLimiter` (`apps/pilot/src/rate-limiter.ts`) and `sendRateLimited` in `apps/pilot/src/pilot-server.ts` for code requests and verifications per address and per email; send limits come from issue 01 Answer, while verification limits are 25/email/hour and 100/address/hour from issue 01 Comments (4 Oct 2026). Configure through `apps/pilot/src/pilot-config.ts` like `SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR`; checking limits are shared across purposes.
- Delivery: new `NotificationKind` `guest.sign_in_code` in `apps/pilot/src/notifications/pilot-notifier.ts`, sent through the existing `EmailSender` (`ResendEmailSender`). The code is in the body only; the notification record does not store it (ADR 0075). Local and test runs use the existing fake sender.
- App bar: a signed-in indicator and "Sign in" entry using `.ui-appbar` and `.ui-link`. Copy comes from `apps/web-agent/src/guest-content.ts`.
- The beta invite gate (`betaInviteCode`) still applies before any session exists.

## Acceptance criteria

- AC1: Without JavaScript, a Guest can request a code, enter it and land back on the page they came from, signed in. Real Chromium with JS disabled.
- AC2: A wrong code shows an inline `.ui-field__error` with `role="alert"` and keeps the email; the attempt limit and expired code each show their own message.
- AC3: The session secret changes at sign-in (the pre-sign-in cookie value no longer authenticates as the account).
- AC4: Sign out everywhere closes an open stream in a second browser context and its next turn is refused.
- AC5: Code requests over the limit get the standard rate-limited response.
- AC6: A `return` value that is absolute, protocol-relative or off-site is ignored.
- AC7: No server log, notification record or audit entry contains the email, the code or the cookie value.
- AC8: Searching, requesting and paying work unchanged without signing in (existing booking tests stay green).

## Tests to add/update

New `test/guest-account-sign-in.test.ts` (server) and `test/guest-account-sign-in-chromium.test.ts` (real Chrome, use `withStagePage` from `test/helpers/`). Update `test/guest-retired-classes.test.ts` only if a class is added.

## ADR compliance

0070, 0075, 0078, 0080, 0085, 0086 (pattern), 0093. Guest UI rules in `AGENTS.md`: kit components only, semantic tokens, no page-level `style:` strings, do not reformat `shortlet-foundations.css`.
