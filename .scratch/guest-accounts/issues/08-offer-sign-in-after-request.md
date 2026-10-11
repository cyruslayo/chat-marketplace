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
- 11 Oct 2026, delegated, not human-approved (coordinator): the browser job builds the guest client before the real-browser tests (`npm run build`, CI workspace only). The local server serves `apps/local-guest/dist/client.js` from disk and the committed copy is not rebuilt per change, so without the build the Chromium chat cannot show any client change. The built file is not committed (commit f60b9f9 reverted a rebuilt bundle that carried another checkout's paths). Built output checked: the offer code is present and no absolute paths are embedded.
- 11 Oct 2026, delegated, not human-approved: the chat JSON for request-sent and confirmation responses carries the Guest's own contact email in `signInOffer`. It is acceptable under ADR 0075 (the Guest's own email, already in their conversation, `Cache-Control: no-store`, not persisted). Grep of the source: `signInOffer` and the offer helper appear only in the route (`guest-server.ts`), the kit helper (`guest-kit.ts`) and the chat renderer (`client.ts`). No operator surface, telemetry event, audit record or transcript carries the key. Node test "AC1 failure path: the sign-in offer's email reaches only the browser that owns the conversation, and the offer is never stored with the conversation": a stranger gets no email and no offer, and the database holds no `signInOffer` key.
- 11 Oct 2026, delegated, not human-approved: the no-JavaScript `/conversation` page is not part of AC1. AC1 names "the page and the chat workspace"; the workspace is the JavaScript client. That page shows each request or booking as a link to its standalone page, which carries the offer, so no-JS parity holds through the page. Follow-up, not implemented: render the offer on `/conversation` if the human wants it there.
- 11 Oct 2026, Needs human: copy approval. The three new strings are functional wording, not final: `offerTitle` "Sign in to see this booking on your other devices"; `offerIntro` "We will email you a six-digit code. Signing in is optional, and your booking stays as it is."; `offerButton` "Send me a code" (the action label this issue names). The issue's quoted "Keep this booking on all your devices" is not in the repo and was not used.
- 11 Oct 2026, Chromium: a confirmation-screen test was added (the standalone confirmed booking page, reached by setting the device's session cookie with the new `setCookie` helper, reflow and 44px at four widths). It is written but not run locally (no Chrome); CI is the first run.
- 11 Oct 2026, probes on the final code (node, each guard changed then restored by hash): P1-P13 killed; P14 (chat session-null check) survived and is equivalent (routes resolve the session first); P15 (thread-readable check removed) survived the new privacy test (the stranger's session has its own app) and is killed by the existing issue 06 suite (D2 tests).
- 11 Oct 2026, review of PR #104 (head 69cb545), fixes on `ga-08-sign-in-offer`:
  - D1 (MEDIUM, ADR 0093/0075): the offer was decided from the account cookie, so a linked interaction cookie with no account session (cookie cleared, session expired, or revoked) got the offer pre-filled with the account email. Fixed fail closed: `signInOfferFor` returns no offer when the principal is linked to any account (`linkedAccountOf`), and the pre-fill reads the principal's own request contact row (`SqliteGuestContactRepository`), never the account-aware view. Red before the fix: "D1: a linked interaction cookie with no account session gets no offer and no account email" failed on "the page shows no offer". Tests after the fix: that test, "D1: after sign-out everywhere ..." and "D1: after the account session expires ..." (the expiry case now ends the account session in the database, not the clock, because moving the clock also expires the request). Probe P16 (linked guard removed) kills the first and third; sign-out everywhere is closed by the binding deletion (401), so it is a regression check, not a probe kill.
  - T1 (LOW): route-level tests for `/api/turn` and `/api/event`: the offer is in the JSON and the response is `Cache-Control: no-store`. Probes P9a (turn route plain sendJson) and P9b (event route plain sendJson) are killed.
  - T2 (LOW): escaping tests: a hostile contact email (`a"><script>x@example.test`, accepted by the normalizer) and a hostile return path are escaped in the offer. Probes P17 (email not escaped) and P18 (return path not escaped) are killed.
  - T3: the AC4 test is renamed to what it asserts: "AC4: Declining or ignoring the offer leaves the booking state unchanged, and the Guest's payment page still returns 200."
- 11 Oct 2026, Cloudflare Worker (delegated, from code reading): `apps/cloudflare/src/shortlet-pilot-do.ts` calls `createGuestRequestHandler` without `guestAccounts`, so the composition is read from `process.env` by `loadGuestAccountComposition`. The Worker config supplies `RESEND_API_KEY` as a secret binding (`apps/cloudflare/cloudflare.config.ts`), not in `process.env`, and no code-hashing key is supplied to `process.env` in the repo. As written, sign-in is disabled in the Worker, so the offer is hidden (the disabled-path guard, test "AC1 failure path: the offer is not shown when sign-in is disabled"). It would be enabled only if a deployment put the key and sender into `process.env`.

## Needs human
- Copy approval (once). These three strings are new and functional wording, not final: `GUEST_ACCOUNT_COPY.offerTitle` "Sign in to see this booking on your other devices"; `offerIntro` "We will email you a six-digit code. Signing in is optional, and your booking stays as it is."; `offerButton` "Send me a code" (the action label this issue names). The issue's quoted "Keep this booking on all your devices" is not in the repo and was not used.
- Screenshots: 320, 390, 768 and 1280 captures, and the overflow and 44px sweep, are handed to issue 11. The Chromium tests assert reflow and 44px at those widths in CI (the browser job passed on 69cb545), but no images were captured.
- Concierge mention (What to build, fourth bullet): NOT built. The concierge's one-time mention with a link to the page form and the concierge "my account" link need wording that no criterion defines; model text.
- ADR 0075 (decided acceptable, delegated): the chat JSON for request-sent and confirmation responses carries the Guest's own request contact email, and only to the browser that holds the anonymous interaction session for that request. The D1 fix above tightens this: a linked principal, or a browser with no live session, gets no email. Responses are `Cache-Control: no-store`; the offer is never stored with the conversation; no operator surface, telemetry, audit or transcript reads it.
- Deploy requirement (Q1, delegated): `apps/local-guest/dist/client.js` is not rebuilt per change. Any Node pilot or local deployment that serves `dist/` must run `npm run build` first, or the offer (client code) will not show in the chat. The browser job runs the build (ci.yml). The Cloudflare public bundles are generated and git-ignored.
- No-JS `/conversation` offer: not built (follow-up). AC1 names the page and the chat workspace; the no-JS page links each request to its standalone page, which carries the offer.
- Follow-ups (no AC): (a) `/guest/contact` form still visible to linked devices; (b) conventional conditional-offer pages and booking pages for a linked second device or the offer's own Guest on the same device (issue 06 Q3); (c) the concierge mention and "my account" link above.

## Manual cleanup for the human
- Remote branch `ga-08-main-baseline-probe` (commit 0308291, a three-line workflow change on top of origin/main, used only to test main's browser behaviour) still exists on origin. Deletion is refused from this environment (git push --delete and the GitHub API both refuse). Delete it manually.

## Delegated decisions (orchestrator; not human-approved)
- Q2/Q3: placement under the request-sent and confirmation screens is covered by the Chromium chat and confirmation tests, which passed in CI on 69cb545 (browser run 38136385099, https://github.com/cyruslayo/chat-marketplace/actions/runs/38136385099). The assumption that the client's active payload is the last surface is accepted and recorded.
- Q4/Q5 nits accepted: `test/ci-browser-build.test.ts` pins the exact `run: npm run build`; five older Chromium files keep inline overflow checks (follow-up: reuse `assertReflowAndTargets`).
