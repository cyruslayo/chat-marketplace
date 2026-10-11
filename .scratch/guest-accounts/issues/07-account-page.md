# Account page: contact details, sign out everywhere, identity status

Status: ready-for-agent
Type: task
Blocked by: 06, 09
Requested: 2 Oct 2026

## Why

A signed-in Guest needs one place to see and manage the account (user stories 10 to 12).

## What to build

- `GET /account` (signed-in only; signed-out Guests are sent to `/account/sign-in?return=/account`). Built with `pageShell` and kit components only: `.ui-page__header`, `.ui-panel`, `.ui-facts` for email, phone and identity status, `.ui-field`, `.ui-button`, `.ui-banner--*` for outcomes.
- **Email.** "Change email" sends a `change_email` code to the new address (issue 04 `changeEmail`); the page shows the code step. A changed email lowers or resets assurance per ADR 0094. Email change is a web-only platform command (ADR 0067, ADR 0072): it is not offered through WhatsApp, the concierge or any other agent channel.
- **Phone.** Edit with `normalizeNigerianPhoneNumber` (`domains/shortlet/src/guest-contact.ts`); validation errors use its existing messages. Phone is stored, not verified (phone verification is out of scope).
- **Identity status.** Read-only line using the labels from issue 01 (e.g. "Email confirmed"). No ID upload, form or provider link (ADR 0085).
- **Sessions.** "Sign out" and "Sign out of all devices", each a POST form.
- Contact details shown here and the contact used for Booking Requests (`SqliteGuestContactRepository`) must agree: decide in `## Answer` whether the account is the source and the repository a projection, or the reverse, and keep one writer.
- Copy in `apps/web-agent/src/guest-content.ts`. Chat parity: the concierge answers "my account" with a link to this page, not a second editor (ADR 0080).

## Acceptance criteria

- AC1: A signed-in Guest sees their email, phone and identity status. Failure path: a signed-out request redirects to sign-in and shows no account data.
- AC2: Changing email takes effect only after the code sent to the new address is entered; a wrong code leaves the old email in place.
- AC3: An invalid phone shows the field error and keeps the typed value (ADR 0078: inputs survive errors).
- AC4: "Sign out of all devices" signs out a second browser context.
- AC5: The page works without JavaScript, reflows at 320px with no horizontal scroll, and every control is at least 44px.
- AC6: The contact email used in the next Booking Request is the account email.

## Tests to add/update

New `test/guest-account-page.test.ts` and a Chromium test using `withStagePage`.

## ADR compliance

0067, 0070, 0072, 0075, 0078, 0080, 0084, 0085, 0093, 0094. Guest UI rules in `AGENTS.md`.

## Comments

- 11 Oct 2026, requirement from issue 09 (orchestrator decision, delegated by the human; not a human quote): the identity resolver (`domains/shortlet/src/guest-identity.ts`, `GuestAssurance`) still hardcodes `email-verified`. The account page must surface the government-ID level from the identity-assurance result (`currentAssurance`, issue 09) and must not treat it as an account gate (ADR 0085).

## Comments

- 11 Oct 2026, implementation (branch `ga-07-account-page`, from origin/main 5700cd4). Red run before implementation: `test/guest-account-page.test.ts` had 14 failing tests and the AC5 guard had 2 failing. Full evidence is in the PR body.
- 11 Oct 2026, delegated decisions (orchestrator, NOT human-approved):
  - (a) The 06 AC9 failure path for `GET /account` is superseded by this issue's AC1: a signed-out or stale-cookie request redirects 303 to `/account/sign-in?return=/account`. The 06 test assertions were updated. The redirect target is a constant, so there is no user-influenced return value on that path. Recorded in the 06 Comments too.
  - (b) Contact single writer: the Guest Account owns the email. The only account-email writer is `changeEmail`, which is code-verified. `GuestAccountContacts` (domains/shortlet/src/guest-account-contacts.ts) is the one contact view: a linked principal's contact email is the account's active email, and `saveEmail` refuses for linked principals (`GuestContactOwnedByAccountError`). Existing requests keep their snapshot (ADR 0004).
  - (c) The `/guest/contact` email form is still reachable for linked devices. It refuses with `GUEST_ACCOUNT_COPY.errors.emailOwnedByAccount`. Hiding it is a follow-up for issue 08.
  - (d) The concierge "my account" chat link (ADR 0080 parity) is NOT built. No acceptance criterion covers it, and the concierge has no account intent. Follow-up.
  - (e) Phone display: the account phone is read from the account's contact row first, then falls back to the principal's own row. This matches what the next Booking Request uses. For human confirmation.
- 11 Oct 2026, 06 Q3 (conventional booking and offer detail pages for linked devices): not covered by these ACs, so left for issue 08.
- 11 Oct 2026, UI evidence: the Chromium test (`test/guest-account-page-chromium.test.ts`) is written and was NOT run locally (no Chrome). It runs in the CI `browser` job. Screenshots at 320/390/768/1280 are NOT captured and are handed to issue 11. The issue stays `ready-for-agent`.

## Answer (contact details decision, AC6 and the single writer)

- The Guest Account is the source for the email. The repository (`guest_contacts`) keeps phone and name, and it is read through the account-aware view `GuestAccountContacts`. For a linked principal the view returns the account's active email, so the account page and the next Booking Request agree (AC6, tested by "AC6: the contact email used in the next Booking Request is the account email").
- The only account-email writer is the code-verified `changeEmail` (AC2). A changed email removes the current identity-assurance result (ADR 0094, trigger in the store schema).
- Identity status: the account page reads the real level through `apps/local-guest/src/guest-identity-status.ts`, a read-only reader (`currentAssurance` only). It is not a traversal leaf: the AC5 guard pins its importer (the account runtime), and the runtime is reachable only through the local guest server gateway (`GATEWAY_IMPORTERS`, the five composition entrypoints). The resolver reports `government-ID-verified` only for a current result. Labels are copy from issue 01. Assurance is display only, never a gate (ADR 0085).
- Status: left `ready-for-agent`. See the Needs-human list in the PR body: copy approval, the 06 AC9 change, the single-writer decision, and the phone fallback.

- 11 Oct 2026, security review of PR #103 (head ff0153f), fixes on `ga-07-account-page` (delegated, not human-approved, except where stated):
  - D1 (AC5 guard, MEDIUM): the status reader is no longer a traversal leaf. The local guest server is the gateway (a leaf), its five direct importers are pinned, and only the server may import the runtime and only the runtime the reader. Probe A (a booking-style module importing the runtime) and A2 (importing the server) now fail the guard, and probe B (importing the reader) stays killed.
  - D2: one `aria-describedby` on the phone input naming the help and the error.
  - D3: success notices are read from a fixed allowlist (`accountNoticeFrom`); unknown values are ignored and never reflected. Copy comes from `GUEST_ACCOUNT_COPY`.
  - D4: GET /account, and the POST routes, refuse (303 to sign-in, nothing written) when the presented interaction session is linked to a different account than the account cookie.
  - D5: account responses and the account form-error pages send `Cache-Control: no-store`.
  - T1 and T2: authority tests for the change-email session and revision check and for the session and account binding of the verify step. T1 also covers the same-address refusal. Probes M1, M2, M3, M5 and M6 are killed.
  - T3: route tests for a replayed code, a code after the session is revoked, the per-address cooldown at the route, and an address held by another account (identical code step at the request step, `email_in_use` at confirm).
  - T4: the Chromium file has one criterion per test (AC3, AC5 phone error, AC2, AC5 code step, plus the account page reflow test). Their red state is not applicable: the file runs only in the CI browser job.
  - T5: the 06 AC9 failure-path test name now says it redirects (303).
  - Nits: the code step's back link, brand eyebrow and lifetime sentence come from `GUEST_ACCOUNT_COPY`; `invalid_input` from the authority is answered as the same-address page (Q6). Q6 cannot be triggered from HTTP without fault injection, so it has no direct test.
- Q1 (delegated, not human-approved): closed accounts are not reachable yet (no closure code). The fallback for a linked principal whose account is closed (no contact email; `saveEmail` refused, a dead end at the contact prompts) is owned by issue 10 (account closure). Recorded in issue 10 Comments.
- Q2 (delegated, accepted risk): the resolver reads the assurance store on every account-authenticated request, so a malformed verified row makes every account request fail (500). This fails closed and is accepted here; the row is written only through the validated paths of issue 09.
- Q5 (delegated): the Chromium test uses `launchRealBrowser` rather than `withStagePage`. Acceptable; the browser helper is the one the other Chromium account test uses.
- Probe results on this branch: see the PR body.
- The phone display fallback to the principal's own row when no account contact row exists remains for human confirmation (decision (e)).

- 11 Oct 2026, delta review of PR #103 (head f98cb7f), fixes on `ga-07-account-page` (delegated, not human-approved; corrections to the entries above):
  - The "read-only leaf" wording in the Answer above is superseded: `guest-identity-status.ts` is a traversed module, not a leaf (see the corrected Answer sentence).
  - AC5 guard (delta 1): the leaf stops now apply only where each leaf's importers are pinned exactly (`LEAF_IMPORTERS`: ops-import is imported by `ops-routes.ts` and `scripts/export-node-sqlite.ts`; schema by `ops-routes.ts`, `shortlet-pilot-do.ts` and the export script; the gateway by its five composition entrypoints, each with its reason in the test). Probes: a module importing `ops-import.js` or `schema.js` fails the leaf pin, and a booking-style module reaching the store through any of them fails the reachability test.
  - AC5 guard (delta 4): `require()` and `import x = require()` are module edges; the sweep covers `apps/*/scripts`; a `test` directory is walked and only `.test.` files are skipped; a non-literal `import()` or `require()` in a non-test module fails (empty allowlist; comments are removed before matching, and a `//` inside a string literal can hide a call on the same line, accepted for this detection guard); a directory-style import resolves to its `index` module (no EISDIR); a query-suffixed asset import (`?raw`) is not read as a module. Each probe was run on its own and killed, and a directory-style import passes.
  - D5 (delta 2): `Cache-Control: no-store` on the sign-in form, the sign-in code page, the sign-in errors, the conflict page and every account-route refusal (`sendPageError(..., true)`). Tests: "AC5 (delta 2)" and "AC4 (delta 2)".
  - Copy (delta 3): "Back to your conversation", "Try again", the brand name and the lifetime sentence on the account pages come from `GUEST_ACCOUNT_COPY` (`backToConversation`, `tryAgain`, `brandName`, `brandEyebrow`, `codeExpiresIn`). The wording is unchanged. The same label is still written inline in `apps/web/src/ui-kit.ts`, `apps/local-guest/src/guest-kit.ts` and `guest-server.ts`: no shared constant exists for it, so the account pages do not split one. Consolidating those is a follow-up for the ADR 0078 copy pass. A test scans `guest-account-pages.ts` for inline text.
  - Tests (delta 5): the held-address request compares the full normalised code-step body; a phone input with no error names only the help text; the mirror of D4 (interaction cookie of B, account cookie of A) refuses on GET and POST with no writes; the verifyCode isolation test (the issuing session id with another account id is refused).
  - Redundancy (delta 5): in `verifyCode`, the account comparison (`row.account_guest_id !== expectedAccount`) and the missing-account check (`!account`) are redundant with `sessionIsValid`, which already requires an active account of the same tenant and the same account id. The stale-revision check and the session-id binding are not redundant (M6 is killed by the T2 test). Both redundant checks stay as defence in depth, with the probes recorded as equivalent.
  - Screenshots: there is no `.scratch/guest-accounts/screenshots/07/` directory. No screenshots were taken for issue 07 (no Chrome in the sandbox). Reflow at 320, 390, 768 and 1280 and the 44px targets are checked only by the Chromium tests in the CI browser job, and the screenshot evidence is handed to issue 11.
  - Orchestrator decisions (delegated, not human-approved): a change-email request to an address held by another account sends a code to that holder (anti-enumeration design, bounded by the issue 01 quota of 5 requests per address per hour). Accepted; flagged under Needs human. Q2 (a malformed verified assurance row fails every account request closed): accepted. The closed-account fallback belongs to issue 10 (delegated).
