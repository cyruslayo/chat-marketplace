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
- Identity status: the account page reads the real level from the read-only leaf `apps/local-guest/src/guest-identity-status.ts` (the only assurance-store importer outside schema and ops import, per the AC5 guard). The resolver reports `government-ID-verified` only for a current result. Labels are copy from issue 01. Assurance is display only, never a gate (ADR 0085).
- Status: left `ready-for-agent`. See the Needs-human list in the PR body: copy approval, the 06 AC9 change, the single-writer decision, and the phone fallback.
