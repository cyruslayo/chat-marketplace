# Offer sign-in after a request and on confirmation

Status: ready-for-agent
Type: task
Blocked by: 06
Requested: 2 Oct 2026

## Why

Most Guests will arrive anonymous and book before thinking about an account. The moments when keeping their work matters most are just after sending a request and just after a booking is confirmed (user story 9). This must stay an offer, never a gate (ADR 0085).

## What to build

- On the "request sent" screen and the confirmation screen (page and chat workspace, from the same helper as required by the guest UI kit rule), an anonymous Guest sees a `.ui-panel` with copy like "Keep this booking on all your devices" (final copy in `guest-content.ts`, agreed with the user) and a "Send me a code" action.
- The email is pre-filled from the contact already given (`SqliteGuestContactRepository`), editable.
- Signed-in Guests do not see the panel.
- The concierge mentions it once after these moments, with a link to the page form (no sign-in inside the chat model's tools; ADR 0072 keeps consequential actions as platform commands).
- No change to request, offer or payment eligibility.

## Acceptance criteria

- AC1: An anonymous Guest sees the offer on the request-sent and confirmation screens, in both the page and the chat workspace, with the same text. Parity test.
- AC2: Completing the code step from that panel returns to the same screen, now signed in, and the panel is gone.
- AC3: A signed-in Guest never sees the panel.
- AC4: Declining or ignoring the offer changes nothing in the booking flow (existing booking and payment tests stay green).

## Tests to add/update

Extend the request-sent and confirmation tests (`capture-07.ts` / `capture-10.ts` screen groups) and add a parity test.

## ADR compliance

0072, 0078, 0080, 0085, 0093. Guest UI rules in `AGENTS.md`.

## Comments

- 11 Oct 2026, implementation (branch `ga-08-sign-in-offer`, base `origin/main` 1dbd45b). The offer is one kit helper, `signInOfferHtml` in `apps/local-guest/src/guest-kit.ts`, rendered beneath the request-sent screen (`requestScreenHtml`, state `sent`) and the confirmation screen (`confirmationScreenHtml`) on the standalone page, and appended beneath the same screens in the chat workspace from the same helper (`organizeSignInOffer` in `client.ts`). It is a plain POST form to `/account/sign-in` with the `return` path of the screen it sits on, so the code step returns there (ADR 0080). The server decides it per response (`signInOfferFor` and `surfacesWithSignInOffer` in `guest-server.ts`): only for a browser with no account, only while sign-in is enabled, and never stored with the thread (ADR 0075).
- 11 Oct 2026, status stays `ready-for-agent`. The DoD is not met: the 320, 390, 768 and 1280 screenshots and the overflow and 44px evidence are handed to issue 11 (no Chrome in this sandbox). The Chromium test `test/guest-sign-in-offer-chromium.test.ts` runs in the `browser` job.
- 11 Oct 2026, tests: `test/guest-sign-in-offer.test.ts` (node, 11 tests, one per criterion plus its failure paths) and `test/guest-sign-in-offer-chromium.test.ts` (browser). Shared helpers in `test/helpers/sign-in-offer.ts`; `test/helpers/guest-browser.ts` gained `assertReflowAndTargets` and a `beforeReview` hook.
- 11 Oct 2026, Needs human: copy approval. These strings are new and are functional wording, not final. The strings the issue quotes ("Keep this booking on all your devices") are not in the repo and were not used:
  - `GUEST_ACCOUNT_COPY.offerTitle`: "Sign in to see this booking on your other devices"
  - `GUEST_ACCOUNT_COPY.offerIntro`: "We will email you a six-digit code. Signing in is optional, and your booking stays as it is."
  - `GUEST_ACCOUNT_COPY.offerButton`: "Send me a code" (the action label this issue names)
- 11 Oct 2026, Needs human: the chat workspace's JSON for a request-sent or confirmation response now carries the Guest's own contact email in `signInOffer` (for an anonymous browser, its own principal only). It is not stored and not logged, and those responses are `Cache-Control: no-store`. Confirm this is acceptable under ADR 0075.
- 11 Oct 2026, Needs human: the no-JavaScript conversation page (`/conversation`) shows no offer, because it renders surfaces as text and has no request or confirmation screen helper. Confirm whether it should.
- 11 Oct 2026, remaining follow-ups (no acceptance criterion covers them, so not implemented here):
  - (a) `/guest/contact` email form is still reachable for linked devices (it refuses with `GUEST_ACCOUNT_COPY.errors.emailOwnedByAccount`). Hiding it is open (issue 07 Comments (c)).
  - (b) Conventional conditional-offer pages (`/conditional-offers/...`) and the booking-request pages for a linked second device, and for the offer's own Guest on the same device, still refuse (issue 06 Q3). Not part of the request-sent or confirmation screens this issue changes.
  - (c) The concierge's one-time mention with a link to the page (What to build, fourth bullet) and the concierge "my account" link (issue 07 Comments (d)). The concierge reply is model text; no criterion says what it should say.
- 11 Oct 2026, scope limits: the Chromium test drives the request-sent screen only. The confirmation screen's offer is covered in node by the same helper and the same parity assertion, not in a real browser.
