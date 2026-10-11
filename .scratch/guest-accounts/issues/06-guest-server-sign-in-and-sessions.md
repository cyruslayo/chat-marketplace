# Guest server: sign-in, sign-out and account session cookie

Status: ready-for-agent
Type: task
Blocked by: 05
Requested: 2 Oct 2026

## Why

The authority (04) and linking (05) exist in the domain; the Guest app must let a person use them, in a browser with or without JavaScript, and must end sessions properly.

## What to build

- Routes in `apps/local-guest/src/guest-server.ts`, all plain forms (ADR 0080) built from `pageShell` (`apps/web/src/ui-kit.ts`) and the kit helpers in `apps/local-guest/src/guest-kit.ts`:
  - `GET /account/sign-in` (email field) → `POST /account/sign-in` sends a code, shows the code page.
  - `POST /account/sign-in/code` verifies, links the current principal (05), issues the account session, redirects with 303 to a safe local `return` path (validate it: same-origin path only).
  - `POST /account/sign-out` revokes the current account session, clears its cookie and rotates the browser to a fresh unlinked anonymous interaction principal (ADR 0093).
  - `POST /account/sign-out-everywhere` revokes all account sessions and their attached interaction authority (ADR 0093, ADR 0070).
- Cookie: keep `shortlet_guest_session` for the interaction session. Add account columns to `guest_session_bindings` additively (`account_guest_id`, `expires_at`, `revoked_at`) or a dedicated account cookie; **Recommended decision, pending human confirmation: a dedicated opaque account cookie**, as ADR 0093 states ("The account cookie is opaque, HttpOnly and SameSite=Lax"), not extra account columns on `guest_session_bindings`. Record the confirmed choice and reason in `## Answer`. Rotate the secret on sign-in. `HttpOnly`, `SameSite=Lax`, `Secure` when `secureCookie`.
- Sign out everywhere ends attached streams (ADR 0070): the SSE/turn streams of every session of the account close and further turns get `AUTHENTICATION_REQUIRED`.
- Origin checks: reuse `browserOriginAccepted` on every POST. It is a file-local function in `apps/local-guest/src/guest-server.ts`; reuse it there rather than copying it.
- Rate limits: reuse `SlidingWindowRateLimiter` (`apps/pilot/src/rate-limiter.ts`) and `sendRateLimited` in `apps/pilot/src/pilot-request-handler.ts` for code requests and verifications per address and per email; send limits come from issue 01 Answer, while verification limits are 25/email/hour and 100/address/hour from issue 01 Comments (4 Oct 2026). Configure through the environment names in `apps/pilot/src/pilot-config-core.ts` (re-exported by `apps/pilot/src/pilot-config.ts`), like `SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR`; checking limits are shared across purposes.
- Delivery: new `NotificationKind` `guest.sign_in_code` in `apps/pilot/src/notifications/pilot-notifier.ts`, sent through the existing `EmailSender` (`ResendEmailSender`, in `apps/pilot/src/notifications/email-sender.ts`). `guest.sign_in_code` is not yet in the `NotificationKind` union (`apps/pilot/src/notifications/pilot-notifier.ts`). The code is in the body only; the notification record does not store it (ADR 0075). Local and test runs use the existing fake sender.
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
- AC9: Sign-out rotates the browser to a fresh unlinked principal: after `POST /account/sign-out` the old account cookie does not authenticate, and the previous principal's account history is not shown (ADR 0093). Failure path: a signed-out request to `/account` is refused.
- AC10: Account changes (email change, data export, deletion) are reachable only from authenticated web surfaces; WhatsApp and other agent channels redirect to the web (ADR 0067).
- AC11 (moved from issue 05 AC5, route level; approved 11 Oct 2026): a request carrying a valid account cookie resolves the identity (account and Linked Principals) in `resolveBrowserSession`, and `findGuestThreadForOffer` and `bindBrowserThread` authorize through the linked-principal set. A thread or offer owned by an unlinked principal is refused over HTTP even with a valid account cookie; a record with a missing tenant is refused.
- AC12 (moved from issue 05 AC4, route level; approved 11 Oct 2026): the `committedWork` callers pass the resolved identity, so the union of live work from the account's linked principals is shown over HTTP, and only from them.
- AC13 (moved from issue 05 AC7 and proof decision 2, approved 11 Oct 2026): sign-in passes the authority's verified session (the `GuestAccountSession` returned by `verifyCode`) to `linkSignedInPrincipal`. A plain email or an unverified session cannot link a principal over HTTP, and the route writes nothing in that case.
- AC14 (moved from issue 05 AC1, bookings part; Human decision 2, approved 11 Oct 2026): after a second device signs into the account, the Booking Requests, Conditional Booking Offers and Reservations of the account's linked principals (and claimed requests) are shown over HTTP, and nothing from an unlinked principal is shown.

## Tests to add/update

New `test/guest-account-sign-in.test.ts` (server) and `test/guest-account-sign-in-chromium.test.ts` (real Chrome, use `withStagePage` from `test/helpers/`). Update `test/guest-retired-classes.test.ts` only if a class is added.

## ADR compliance

0067, 0070, 0075, 0078, 0080, 0085, 0086 (pattern), 0093. Guest UI rules in `AGENTS.md`: kit components only, semantic tokens, no page-level `style:` strings, do not reformat `shortlet-foundations.css`.

## Comments

- 10 Oct 2026 doc review (paths verified against `origin/main`): `pageShell` is in `apps/web/src/ui-kit.ts`; `sendRateLimited` is in `apps/pilot/src/pilot-request-handler.ts` (not `pilot-server.ts`); the rate-limit environment names are in `apps/pilot/src/pilot-config-core.ts`; `EmailSender` and `ResendEmailSender` are in `apps/pilot/src/notifications/email-sender.ts`; `guest.sign_in_code` is not yet in `NotificationKind` (`apps/pilot/src/notifications/pilot-notifier.ts`). `SlidingWindowRateLimiter` (`apps/pilot/src/rate-limiter.ts`) is correct as written.
- 10 Oct 2026: ADR 0093 requires sign-out to rotate to a fresh unlinked principal (AC9) and ADR 0067 keeps account changes on authenticated web surfaces (AC10). Both are added as acceptance criteria.
- 10 Oct 2026, **open decision (needs human confirmation)**: account cookie shape. Recommended: a dedicated account cookie (ADR 0093 wording). The alternative, account columns on `guest_session_bindings`, is not recommended because it mixes account state into the interaction binding. Not confirmed.
- 11 Oct 2026, moved from issue 05 (Human decision 2, "go with your recommendations"): the route-level parts of issue 05 AC4 and AC5 are acceptance criteria AC11 and AC12 here, the sign-in proof is AC13, and the bookings part of issue 05 AC1 is AC14. Issue 05 is `resolved` at store and authorization-decision level. Issue 05's linking now requires the verified sign-in session, so the route must pass it.
