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
