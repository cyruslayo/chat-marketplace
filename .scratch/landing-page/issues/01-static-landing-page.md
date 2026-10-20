# 01 · Static landing page at /welcome

Status: resolved
Type: task
Blocked by: none

## What to build

The landing page described in `../PRD.md`, rendered on the server, complete without JavaScript.

- `apps/local-guest/src/landing-page-html.ts`: `export function renderLandingHtml(): string`
  returns the whole document. Use the guest-kit helpers in `apps/local-guest/src/guest-kit.ts` where
  their markup matches a beat element (`ticketHtml`, `breakdownHtml`, `statusHtml`,
  `resultRowPartsHtml`, …; read their signatures first), and the strings in
  `apps/web-agent/src/guest-content.ts` where one exists. Escape all text with the existing escape
  helper. Every beat screen is in its **final** state.
- `apps/web/src/shortlet-landing.css`: the landing layout plus the chat pieces the foundations do not
  have (bubbles, criteria chips, composer, phone frame). Mobile-first; desktop rows from `64rem`.
  Semantic `var(--color-…)`/`var(--space-…)`/`var(--radius-…)` tokens only, no hex literals. Dark mode
  must come from the tokens (see the `[data-theme]` blocks in the foundations). Do not touch
  `shortlet-foundations.css`.
- Photos: copy the four files in
  `C:\Users\Cyrus\AppData\Local\Temp\claude\C--AI2026-chat-marketplace\20b506e8-1af3-4ff7-a5a8-81ff228e3caf\scratchpad\photos\`
  (`ikoyi-living.jpg`, `ikoyi-bedroom.jpg`, `lekki-living.jpg`, `lekki-bedroom.jpg`) to
  `apps/local-guest/assets/landing/`, with a `CREDITS.md` there: temporary Unsplash placeholders to
  be replaced by the owner; Aalo Lens (ikoyi-living), Spacejoy (ikoyi-bedroom, lekki-bedroom),
  EZcurtain Life (lekki-living); Unsplash License.
- `apps/local-guest/src/guest-server.ts`: public routes, reachable with no session, with a malformed
  session cookie, and when a beta invite code is configured:
  - `GET /welcome` → `renderLandingHtml()` (reuse the existing guest HTML headers)
  - `GET /shortlet-landing.css` (read once at start-up, like `SHORTLET_FOUNDATION_CSS`)
  - `GET /landing/photos/<name>.jpg` for exactly the four names above (an allow-list, never a path
    built from the URL); anything else → 404
  - add these to `PUBLIC_GUEST_PATHS` (or the equivalent check) so a stale session never blocks them.
  `GET /` is unchanged.

### Stage markup contract (issue 02 depends on this exactly)

- Each animated container carries `data-landing-play="hero"` or `data-landing-play="beat-1"` …
  `"beat-5"`, plus `data-landing-stages="<N>"`.
- An element revealed from stage *k* onwards carries `data-landing-stage="k"` (k ≥ 1).
- An element shown **only during** stage *k* (typing dots, "The Operator is reviewing") carries
  `data-landing-only="k"` and the `hidden` attribute in the server HTML.
- Hero: the phone's message box text element has `data-landing-field`, with the placeholder text
  "Ask about these stays…"; the guest bubble has `data-landing-message` and contains the full message
  "An apartment in Lagos from 10 Sept, 3 nights, 2 of us".
- Each beat's caption block carries `data-landing-caption="1"` … `"5"`; each beat's screen carries
  `data-landing-screen="1"` … `"5"`.
- Stage assignments (N in brackets):
  - hero [4]: 1 guest bubble · 2 chips · 3 typing dots (`only`) · 4 concierge reply + both result rows
  - beat-1 [4]: 1 guest bubble · 2 chips · 3 typing dots (`only`) · 4 concierge reply
  - beat-2 [4]: 1 typing dots (`only`) · 2 concierge reply · 3 Old Ikoyi row + its deposit line · 4 Lekki row + its deposit line
  - beat-3 [4]: 1 "Draft created" · 2 photo strip + ticket · 3 "Not sent yet" + "Send Booking Request" · 4 re-check hint
  - beat-4 [4]: 1 "Booking Request sent" · 2 waiting message · 3 "The Operator is reviewing" (`only`) · 4 deadline banner
  - beat-5 [6]: 1 "Your offer is ready" · 2 breakdown with the All-In Stay Total row · 3 deposit row · 4 "Total to complete booking" row · 5 "Payment verified" · 6 "Reservation confirmed" banner

## Acceptance criteria

1. GET /welcome returns the landing page with no guest session, with a malformed session cookie, and when a beta invite code is configured
2. The landing page has one h1, a skip link to main, header, main and footer landmarks, and the same lang as the other guest pages
3. Without JavaScript every beat shows its final screen: the message and chips, both priced results, the stay ticket and send button, the reply deadline, and the confirmed Reservation
4. Money and booking labels use the guest vocabulary and no forbidden guest terms appear
5. Every call to action links to the guest app and no form sends message text in a URL
6. Landing photos and the landing stylesheet are served publicly, and unknown or traversal photo paths return 404
7. The stage markup follows the contract: every staged element is inside a play container, stage numbers do not exceed the declared count, and transient elements are hidden in the server HTML
8. The landing stylesheet uses design tokens only and the foundations stylesheet is unchanged
9. The example booking is labelled as an example and the unapproved answers stay visible placeholders

## ADRs to read

0005, 0015, 0016, 0041, 0044, 0066, 0077, 0078, 0080. Record the ADR table in `## Comments`.

## Rules

- Follow the AGENTS.md implementation protocol: one named `test()` per criterion in
  `test/landing-page.test.ts` (non-browser, `node:test` like the neighbouring guest tests), failure
  paths included; `npm run check` clean; targeted tests pass.
- Do not commit. Do not run the browser suite or the full `npm test`. Do not format
  `shortlet-foundations.css`.

## Comments

### Claim and ADR table (implementation agent, 11 Oct 2026)

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0005 Request to Book only | A Booking Request is never shown as a Reservation; "Reservation confirmed" appears only in beat 5 after payment is verified; the FAQ says sending a request reserves nothing | Beat 3/4 screens (`Booking Request sent`, `Not sent yet`), beat 5 stage 6, "Does sending a request reserve the dates?" |
| 0015 All-in pricing | Every result and the breakdown lead with the All-In Stay Total, never a base or nightly rate; the label is not shortened | `resultRow()` uses `stayTotalLabel(true, 3)`; `breakdown` rows in beat 5 |
| 0016 Refundable security deposit | Deposit is named "Refundable Security Deposit (separate)", shown on its own line, and excluded from the stay total; the total to complete booking is stay plus deposit | `depositLine()` under each result; beat 5 stages 3 and 4 (₦390,000 = ₦370,000 + ₦20,000) |
| 0041 Thirty-minute request block | The reply deadline is shown as an absolute WAT time with its consequence; no countdown or invented timer on the static page | Beat 4 stage 4 banner (`<time datetime="2026-09-03T10:45:00+01:00">`) |
| 0044 Payment window | No payment countdown or payment deadline is rendered on the landing page | Beat 5 has no deadline element; the offer step shows no timer |
| 0066 Ranking and trust | No Verified badge, rating, sponsored order or full address is invented; results are example rows, labelled as an example | Result rows (`resultRowPartsHtml`), "Example booking · real app screens" label |
| 0077 Canonical artifacts | Screens render from the shared kit helpers and the `guest-content` vocabulary, not new copy per screen; the page computes no prices | `resultRowPartsHtml`, `ticketHtml`, `statusHtml`, `GUEST_RECEIPTS`, `GUEST_GLOSSARY`, `GUEST_FACT_LABELS` |
| 0078 Accessible launch profile | One h1, skip link, header/main/footer, `lang="en-NG"`, 44px targets (`--control-min-target` / `--control-min-field`), 3-column rail under 23rem, no motion in the markup, WAT times, no external requests | `renderLandingHtml()` head/body; `shortlet-landing.css` |
| 0080 Deterministic parity | Every call to action is a plain link to `/`; the page has no form, no action URL and no state-changing control; the send button in the preview is a decorative `aria-hidden` span | `landing-composer` links, app bar and beat 5 CTAs; beat 3 `landing-send__button` |

Acceptance criteria 1-9 are each one `test()` in `test/landing-page.test.ts`.

### Work log (11 Oct 2026)

Files created or changed (nothing committed; branch `feat/landing-page`):

- `apps/local-guest/src/landing-page-html.ts` (new): `renderLandingHtml()`.
- `apps/web/src/shortlet-landing.css` (new): layout plus chat pieces; tokens only; no `shortlet-foundations.css` change.
- `apps/local-guest/assets/landing/ikoyi-living.jpg`, `ikoyi-bedroom.jpg`, `lekki-living.jpg`, `lekki-bedroom.jpg`, `CREDITS.md` (new).
- `apps/local-guest/src/guest-server.ts`: imports `renderLandingHtml`; reads `shortlet-landing.css` and the four photos once at start-up into an allow-list map; `/welcome`, `/shortlet-landing.css` and the four photo paths added to `PUBLIC_GUEST_PATHS`; routes added after the foundations route. `GET /` is unchanged.
- `test/landing-page.test.ts` (new): 9 tests, one per acceptance criterion.
- `.scratch/landing-page/issues/01-static-landing-page.md`: status set to claimed; this comment.

Kit helpers reused: `ticketHtml`, `resultRowPartsHtml`, `statusHtml`; from `guest-content.ts`: `GUEST_GLOSSARY` (allInStayTotal, requestDraftStatus, revalidation, offerReadyHeading, conditionalBookingOffer), `GUEST_RECEIPTS` (draftCreated, requestSent, paymentVerified), `GUEST_JOURNEY` (rail labels), `GUEST_FACT_LABELS` (refundableSecurityDeposit, allInStayTotal, amountDueNow), `stayTotalLabel`; `formatNgnKobo`, `formatStayFoot`, `formatTicketDate`, `escapeHtml`, `icon`. `ui-*` classes for banners, breakdown, rail, appbar, buttons, status, eyebrow and field hints come from the foundations.

Deviations from the issue or design comp, and why:

1. Breakdown rows in beat 5 are written by hand with the same `ui-price-breakdown` classes and the "label: value" form `breakdownHtml` uses. `breakdownHtml` emits one section with no per-row hooks, and the stage contract needs the All-In Stay Total, deposit and total rows separately addressable.
2. Result rows use `stayTotalLabel(true, 3)`, so the label reads "All-In Stay Total for 3 nights", not the comp's "all-in · 3 nights". ADR-0015 and the glossary say the label is never shortened.
3. The ticket date is `formatTicketDate`'s app format ("Thu, 10 Sept 2026"), not the comp's "Thu, Sept". The foot reads "3 nights · 2 guests · ₦370,000 All-In Stay Total".
4. The phone rail is `ol.ui-rail` with `data-state` and `aria-hidden`, not `railHtml`. `railHtml` emits a labelled `nav` per phone, which would repeat a landmark six times.
5. The reply deadline banner is fixed example copy with a `<time datetime>`, not `deadlineBannerHtml`. That helper computes minutes left from a clock, and the landing page is static.
6. The document shell is written directly, not with `pageShell`. `pageShell` wraps the whole body in `<main>`, so the header and footer would not be landmarks of their own. The head and `lang="en-NG" data-theme="system"` match `pageShell`.
7. Result rows and the phone are served with `href="/"` links (the kit helper always emits an anchor). The beat-3 "Send Booking Request" is a decorative `aria-hidden` span, not a control.
8. `lekki-bedroom.jpg` is served (allow-listed) but no beat in the comp displays it. Left for the owner's photo replacement.
9. `<script src="/landing.js" defer>` is in the head. The file does not exist until issue 02, so the browser logs a 404 there; the page is complete without it.
10. The footer placeholders "[Support · once staffed]" and "[Privacy · Terms]" are plain text, not links, so no dead link is shipped.

Test results:

- `npx tsx --test test/landing-page.test.ts`: 9 of 9 pass.
  - AC1 GET /welcome returns the landing page with no guest session, with a malformed session cookie, and when a beta invite code is configured: pass
  - AC2 The landing page has one h1, a skip link to main, header, main and footer landmarks, and the same lang as the other guest pages: pass
  - AC3 Without JavaScript every beat shows its final screen: pass
  - AC4 Money and booking labels use the guest vocabulary and no forbidden guest terms appear: pass
  - AC5 Every call to action links to the guest app and no form sends message text in a URL: pass
  - AC6 Landing photos and the landing stylesheet are served publicly, and unknown or traversal photo paths return 404: pass
  - AC7 The stage markup follows the contract: pass
  - AC8 The landing stylesheet uses design tokens only and the foundations stylesheet is unchanged: pass
  - AC9 The example booking is labelled as an example and the unapproved answers stay visible placeholders: pass
- `npm run check`: clean (`tsc --noEmit` and the cloudflare configs, no errors).
- Not run, as instructed: `npm test`, the browser suite, and the capture sweeps.

Open items:

- Nothing blocks issue 02. The stage contract is exactly as specified; the test in AC7 enforces it.
- `CONTEXT.md` terms were not separately re-checked beyond the guest vocabulary in `guest-content.ts`.
- The pre-existing uncommitted change to `docs/design/shortlet-landing-page-direction.md` is untouched.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Static landing page at /welcome, complete without JavaScript (landing-page-html.ts, guest-server.ts routes, shortlet-landing.css). Later restructured by 08. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
