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
  - Scope note (11 Oct 2026, human-approved; see Comments): the app has no SSE or other stream, so the criterion is met by refusing the other device's next turn. The original wording above is kept unchanged.
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
- 11 Oct 2026, implementation (branch `ga-06-sign-in-sessions`, stacked on PRs #100 and #99; base `ga-base-05-99`): AC1-AC14 implemented and each has named tests in `test/guest-account-sign-in.test.ts` (40 tests) and `test/guest-sign-in-code-notification.test.ts` (3). The Chromium test `test/guest-account-sign-in-chromium.test.ts` is written but was not run here (no Chrome in this sandbox); it runs in the `browser` job.
- 11 Oct 2026, notification routing (coordinator decision 1): `guest.sign_in_code` is now a `NotificationKind`, and `guestSignInCodeMessage` in `apps/pilot/src/notifications/pilot-notifier.ts` builds the message (idempotency key `guest.sign_in_code:<challengeId>`, code in the body only). The message is sent directly through the `EmailSender` when the code is issued. It is NOT routed through the pilot notifier sweep and NOT recorded in `pilot_notifications`, because that sweep works from database state and a request-time code send has no sweep to run in. Recording would only store a key and a status (never the code), so an audit row is an open question for the human, not a requirement that the code be stored.
- 11 Oct 2026, AC11 and AC14 wording (coordinator decision 2): AC11 names `findGuestThreadForOffer` and `bindBrowserThread`; both authorize through the linked-principal set and are tested (refusal of an unlinked thread, refusal of a missing tenant). AC14 says the records are "shown over HTTP"; the committed-work listing (`/api/committed-work`, and the no-JavaScript conversation page) shows them for linked principals and claimed requests, and tests assert that. NOT covered: the conventional detail pages (`/booking-requests/...`, `/conditional-offers/...`, `/payments/offers/...`) still authorize by the session principal, so a second device can see a listing entry whose detail page is not openable. The AC wording does not require those pages to open for linked principals, so this is recorded as a follow-up for issue 07 or 08, with a decision needed on whether AC14 should be read as "openable". No test asserts that they open.
- 11 Oct 2026, probes (ADR-free test quality check): every security guard was removed in turn and `test/guest-account-sign-in.test.ts` run. Results are in the PR body. Two return-path guards (g2 `//` and `/\\` prefixes, g4 same-origin URL resolution) are equivalent mutants: each is redundant with the other for every input, so removing either alone changes nothing observable. Both stay as defence in depth.
- 11 Oct 2026, UI evidence NOT captured: no Chrome in this sandbox, so no 320/390/768/1280 screenshots, overflow or 44px evidence were produced by this agent. The Chromium test asserts overflow and 44px targets at those widths and runs in the `browser` job. Screenshots under `.scratch/guest-accounts/screenshots/06/` are handed to issue 11.
- 11 Oct 2026, copy (not final, needs human approval): `GUEST_ACCOUNT_COPY` in `apps/web-agent/src/guest-content.ts` holds functional wording for the sign-in, code, account and error screens and the sign-in email (subject and body). It is not marketing copy and must be approved or replaced before issue 08 or launch.
- 11 Oct 2026, status: left `claimed`, not `resolved`. Reason: the UI evidence above is not captured, and the open follow-up on conventional detail pages needs a decision. Resolve only after the human decides both, and after CI is green on the final head.

### Needs human (provisioning; names chosen here, no values supplied)
- `SHORTLET_GUEST_CODE_HASHING_KEY`: the HMAC key for codes and rate scopes. Name chosen here. Sign-in is disabled without it.
- `RESEND_API_KEY` and `SHORTLET_NOTIFICATION_FROM`: existing notifier names, used for the sign-in email. Sign-in is disabled without them.
- `SHORTLET_TRUST_CF_CONNECTING_IP=true`: only for Cloudflare-fronted deployments. Name chosen here. Unset or any other value uses the socket address.
- Copy approval for `GUEST_ACCOUNT_COPY`.
- Decision: the conventional detail pages for linked principals (see above).
- Decision: whether a sign-in code send should record an audit row in `pilot_notifications` (the row would store only the idempotency key and status).

## Answer (provisional, not resolved)

- Pointer (11 Oct 2026): the AC4 scope decision recorded in the first Comments round as an orchestrator decision (T1) is HUMAN-APPROVED, see the Comments entry "HUMAN-APPROVED (AC4 scope, Q-b)". The Answer below does not restate it.

Implemented on `ga-06-sign-in-sessions`:
- Routes: `GET /account/sign-in`, `POST /account/sign-in`, `POST /account/sign-in/code`, `GET /account`, `POST /account/sign-out`, `POST /account/sign-out-everywhere` in `apps/local-guest/src/guest-server.ts`, with pages in `apps/local-guest/src/guest-account-pages.ts`. Plain forms, origin-checked, no JavaScript needed.
- Runtime and configuration: `apps/local-guest/src/guest-account-runtime.ts` (fail-closed loader, return-path sanitiser, client-address policy, sign-in, sign-out and identity over the existing authority, links and resolver).
- Cookies: `shortlet_guest_account` (`<sessionId>.<secret>`, HttpOnly, SameSite=Lax, Secure when configured); the interaction cookie rotates on sign-in and sign-out.
- Committed work and thread ownership: identity is resolved per request, the binding is re-checked on every request, and claimed requests list only their own conversation.
- WhatsApp: account intents redirect to the web (`domains/shortlet/src/whatsapp-adapter.ts`).
- No migration added. `apps/pilot/src/*` changed only for the `NotificationKind` and the message builder.
- 11 Oct 2026, orchestrator decision Q1: while open, the status is `ready-for-agent` (the canonical triage label). `claimed` is not a triage state and is no longer used here. It stays `ready-for-agent` until every DoD item is met, including the UI screenshots, which are handed to issue 11.
- 11 Oct 2026, security review of PR #102 (head `d9cfd8a`), fixes on `ga-06-sign-in-sessions`, each with a failing test first (red run in the PR body):
  - D1 (high, open redirect): `safeReturnPath` now re-validates the normalised output (single leading slash, not `//` or `/\`, no control characters or backslash) and falls back to `/`. Route tests POST the raw return values `/..//evil.example`, `/%2e%2e//x`, `/a/..//x`, `/.//x` and `/x/../..//x` to `/account/sign-in/code`, and check the 303 Location.
  - D2 (medium): a linked conversation is read only while its owner is in the identity resolved for that request. `/api/state` and the no-JavaScript conversation page check it on every request (`threadReadable`); a linked conversation is no longer served once the account session has expired.
  - D3 (medium): a browser whose interaction binding was retired (sign-out everywhere) gets a fresh, unlinked session on `/` and on the sign-in and code routes. Account pages stay gated; a fresh session never carries account identity.
  - Refused conflicting sign-in (M7 gap): a test asserts the session created by a refused link is revoked, and that no account cookie is set. Probe M13 removes the revoke and fails it.
  - Q4 (orchestrator decision): an account POST with no Origin and no same-origin Referer is refused (403). Tests cover no header, a foreign Referer and a same-origin Referer.
  - N3: with accounts disabled, the sign-out routes still expire the account cookie (303, `Max-Age=0`), and sign-in answers 503.
  - T1 (orchestrator decision, recorded here; superseded by the HUMAN-APPROVED entry of 11 Oct 2026 below): the AC4 test asserts that the second browser context's next turn is refused. The app has no SSE stream, so a refused next turn is the AC for "closes an open stream". Decided by the orchestrator on the human's behalf, not a human quote.
  - Q5 (orchestrator decision, recorded here): the per-email lockout in the authority (five code requests per email per hour, and the cooldown) is accepted as issue 01 policy.
  - Q7 (orchestrator decision, confirm or change): a code-hashing key shorter than 32 characters disables sign-in (fail closed, no default key). The 32 is a named constant (`GUEST_CODE_HASHING_KEY_MIN_LENGTH`), not a literal in the logic. Tests: a 31-character key is refused, and a 32-character key is accepted.
  - Q8 (orchestrator decision, recorded here): the sign-in code is in the email body, which is accepted as inherent to emailed codes (ADR 0093).
  - Route tests now send the Origin header a browser sends on a same-origin form POST (the test helper does this). The Chromium browser job sends a real Origin.
  - Probes: M1-M12 re-run on the new code (M2 split into the input, origin and output guards). M13-M19 added for the new fixes. Results are in the PR body. Two probes remain equivalent (input prefix guard and origin guard): removing either alone changes nothing, because the other guards reject the same inputs.

### Needs human (updated)
- `SHORTLET_GUEST_CODE_HASHING_KEY`: the HMAC key for codes and rate scopes. Name chosen here, no value supplied. Must be at least 32 characters (Q7, confirm or change); a shorter key disables sign-in.
- `RESEND_API_KEY` and `SHORTLET_NOTIFICATION_FROM`: existing notifier names. Sign-in is disabled without them.
- `SHORTLET_TRUST_CF_CONNECTING_IP=true` must be set in every Cloudflare-fronted deployment (Q6). Without it, every client shares the socket address, so the per-address budget becomes a global one. Name chosen here.
- Approval of `GUEST_ACCOUNT_COPY` (functional wording, not final).
- Decision: conventional detail pages for linked principals (follow-up for issues 07 and 08, Q3).
- Decision: whether a sign-in code send should record an audit row in `pilot_notifications` (key and status only, never the code).
- 11 Oct 2026, HUMAN-APPROVED (AC4 scope, Q-b). The orchestrator asked: "Issue 06, AC4: the criterion says sign-out-everywhere closes an open stream; the app has no stream; the agent implemented the other device's next turn is refused; accept or reject?" The human replied: "Accept" (11 Oct 2026). The AC4 wording is kept; the scope note under AC4 records that the criterion is met by refusing the other device's next turn. This replaces the earlier "awaiting human approval" entry.
- 11 Oct 2026, orchestrator decisions (delegated by the human, NOT human quotes): Q-a, a device's own conversation under its OWN principal is not account history and stays served from its interaction cookie (ADR 0093 concerns other linked principals' history). Q-c, the key minimum is a length check only; entropy cannot be checked here; 32 is kept and listed as "confirm or change" in Needs human. Q-d, docs/agents/issue-tracker.md is left alone. Q-f (UX), skipped.
- 11 Oct 2026, security re-review of PR #102 (head 7f80e82), fixes with failing tests first:
  - Item 1 (high): a linked read rewrote a saved conversation's owner. `#persistThread` wrote the reading session's principal. Fix: a write never changes ownership, and a runtime that does not own a saved conversation does not write it. Audit of every write path: `bindBrowserThread` saves only the owner's own record; the binding and session writes are the session's own; `guestContactApp.submitPhone/submitEmail` write the session principal's own contact row (not another principal's); conventional routes use the session principal, which the domain checks against the request's primary guest; telemetry carries no ownership. OPEN follow-up: a linked device's turn on another principal's conversation runs under the device's own principal inside the domain; the domain's ownership checks are relied on, and no test asserts them for every command.
  - Item 2 (medium): sign-out everywhere with accounts disabled. Choice: the session hash needs no key, so the revocation goes through the store directly (`revokeGuestAccountWithoutKey`). If the credential does not resolve, sign-out everywhere refuses with 503, claims no success and keeps the cookie. A plain sign-out always clears the cookie and rotates the browser. Test: sign in, restart with accounts disabled on the same database, sign out everywhere, restart enabled; the old account cookie no longer authenticates and the linked device's cookie is retired.
  - Item 3 (medium): sign-in emptied the device's own conversation until restart. Fix: the rotated session carries only the same principal's saved conversations.
  - Item 4 (low): GET sign-in no longer writes a binding; the first POST that needs a session (sign-in and code) and the sign-out routes share the ADR 0093 per-address code-request budget (20 per address per hour, from policy defaults) before a binding is written. The pilot's own new-session limit still applies to the home page; this round does not change it.
  - Item 5 (fail-closed): a conversation with no saved record is not served.
  - Q-e (operations): production must set SHORTLET_PUBLIC_ORIGIN (required and HTTPS-only in `apps/pilot/src/pilot-config-core.ts`). It reaches the guest handler in `apps/pilot/src/pilot-server.ts` and `apps/cloudflare/src/shortlet-pilot-do.ts`. Without it, the Origin and Referer comparison falls back to the request host over http, so an HTTPS deployment refuses every account POST (fail closed).
  - Q-b (AC4) is recorded above.
- 11 Oct 2026, probes on the final code (each guard removed, the account test file run, file restored by hash): see the PR body. Equivalent mutants: the input prefix guard and the origin guard (return path), and the record-less guard (M21), which is defence in depth because the app already returns nothing without a saved record.
- 11 Oct 2026, screenshots: still not captured (no Chrome here); handed to issue 11. Status stays `ready-for-agent`.

### Needs human (updated)
- `SHORTLET_GUEST_CODE_HASHING_KEY`: at least 32 characters (confirm or change; Q-c). Name chosen here, no value supplied.
- `RESEND_API_KEY` and `SHORTLET_NOTIFICATION_FROM`: existing names.
- `SHORTLET_TRUST_CF_CONNECTING_IP=true` in every Cloudflare-fronted deployment (Q6).
- `SHORTLET_PUBLIC_ORIGIN` must be set in production (Q-e); it is already required there.
- Approval of `GUEST_ACCOUNT_COPY`.
- Decision: conventional detail pages for linked principals (follow-up for issues 07 and 08).
- Decision: whether a code send records an audit row in `pilot_notifications`.
- 11 Oct 2026, round 3 security re-review of PR #102 (head 6e1fa81), base merged with origin/main (3533010):
  - Item 1 (HIGH, pre-existing on main): `GET /payments/offers/:id` returned the stay, total and payment window to any session presenting the offer id. ADR 0075 says opaque identifiers confer no access, and the booking routes already require the owner's session. No ADR, CONTEXT.md entry or test makes the offer id a bearer link, so it is not one. Fix: a dispatch-level gate for `/payments/offers/:id[...]` and `/conditional-offers/:id[...]` checks that the session's identity holds the offer's primary guest (through its request, so its own, linked or claimed principals) or its distinct payer, before any read. A missing offer, a foreign one and one with no tenant get the same 404 `PAYMENT_OFFER_NOT_FOUND`. Tests: owner 200; anonymous session gets no stay details; missing and foreign refusals match; linked device 200 while live and nothing after expiry; sign-out everywhere then nothing; anonymous POST starts no payment.
  - Audit of sibling routes (what each does now):
    - `GET|POST /payments/offers/:id` (payment page and method form): gated by the offer check; the handler also checks the session.
    - `/payments/offers/:id/manual-transfer` and `/receipt` (GET, POST): gated; the receipt is evidence only (ADR 0090).
    - `/payments/offers/:id/transfer` (GET, POST): gated; starts bank transfer.
    - `/payments/offers/:id/continue` (GET): gated.
    - `POST /conditional-offers/:id/(accept|conversation|search)`: gated at dispatch; the conventional offer functions still check the principal against the offer's primary guest, so a linked device gets 404 (follow-up for issues 07 and 08).
    - `GET|POST /booking-requests/(drafts/)?:id/...` and the booking-page GET: not gated by this change. They check the principal against the record's primary guest and return 404 to others (existing tests); linked devices get 404 (same follow-up). Draft ids are not offer ids.
    - `/payments/paystack/callback` (GET): requires a session; a return signal only, the transition needs provider verification (ADR 0087). Not offer-keyed; not changed here.
    - `/payments/local/checkout`, `/payments/local/complete`, `/payments/local/transfer/complete`: only with the explicit local-pilot composition (`localPayment`), which production refuses; session-gated. Not changed here.
    - `/api/state`, `/api/turn`, `/api/event`, `/conversation`, `/api/committed-work`: thread-owner checks from rounds 1 and 2.
    - `/guest/contact*`: the session principal's own contact row only.
  - Item 2 (MEDIUM): sign-out routes are never rate limited (orchestrator decision, not a human quote). The per-address budget now meters only code sends and new-binding creation. Test: 20 cookieless sign-outs, then the signed-in sign-out and sign-out everywhere both succeed and revoke.
  - Item 3 (LOW test gaps): M4 (tenant check in the key-free revocation) has a two-tenant test that only that check refuses. M7 (foreign ids carried at rotation): a test asserts the rotated interaction cookie alone reads nothing of a linked principal's conversation; this is EQUIVALENT under current invariants, because a non-linked id cannot enter the set (bind is owner-gated) and a linked id is readable only while its account is live. M3 (`threadReadable` record-less guard): EQUIVALENT, `app.getState` already returns nothing without a saved record; kept as defence in depth, with a comment.
  - Item 4 (LOW): the cookieless branch of `bindBrowserThread` saves only the guest principal's own conversation; a foreign one is refused (401) and its owner row is unchanged.
  - Q-a, Q-c, Q-d, Q-f: unchanged decisions from round 2.
  - Probes (final code): see the PR body.
