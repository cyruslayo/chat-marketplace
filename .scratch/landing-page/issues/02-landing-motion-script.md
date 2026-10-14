# 02 · Landing motion script

Status: resolved
Type: task
Blocked by: 01

## What to build

`apps/local-guest/src/landing-page.ts`, bundled by `apps/local-guest/scripts/build-client.mjs` to
`apps/local-guest/dist/landing.js` (iife, same options as the other entries), served publicly at
`GET /landing.js` and loaded by the landing page with `defer`. It enhances the issue 01 markup
through the stage contract in `01-static-landing-page.md` and never changes text content except the
hero message box while typing.

- **Start-up:** if `prefers-reduced-motion: reduce` matches, or `IntersectionObserver` is missing, do
  nothing (the server HTML already shows the final states).
- **Reset and play:** to play a container, hide every `[data-landing-stage]` and `[data-landing-only]`
  inside it, then step through stages 1…N on timers. Show `[data-landing-stage="k"]` from stage k on;
  show `[data-landing-only="k"]` only during stage k. The final stage leaves the final state.
  Toggle the `hidden` attribute; no inline styles.
- **When to play:** each `[data-landing-play]` plays when at least 35% of it enters the viewport, and
  plays again on re-entry after it has fully left.
- **Hero:** before stage 1, type the message into `[data-landing-field]` one character every 26 ms,
  starting after 300 ms, then a 250 ms send "press" (add then remove a class), then 200 ms later
  stage 1 (the bubble appears and the field returns to its placeholder). Then stage 2 after +500 ms,
  stage 3 after +600 ms, stage 4 after +900 ms (about 4.1 s in all).
- **Beat gaps (ms before each stage):** beat-1 [300, 700, 700, 1000]; beat-2 [300, 900, 500, 500];
  beat-3 [300, 500, 700, 600]; beat-4 [300, 600, 900, 1100]; beat-5 [300, 500, 350, 350, 700, 700].
  Every sequence ends in under 5 s (WCAG 2.2.2: no pause control is needed); assert this in a test.
- **Desktop pinning:** only when `window.innerWidth` ≥ 1024, the document is taller than 1.5 ×
  the window, and IntersectionObserver exists. Then build one sticky phone beside the captions, clone
  the active beat's `[data-landing-screen]` into it, hide the inline screens, and dim inactive captions.
  The active caption is the one crossing the middle band (`rootMargin: -45% 0px -45% 0px`). On
  activation, play that beat inside the sticky phone. Re-check on `resize`; undo pinning when the
  conditions stop holding. Keep a polite live region announcing only the active beat's name.
- An entrance class for newly shown elements (opacity/translate, ≤ 350 ms) lives in
  `shortlet-landing.css` inside `@media (prefers-reduced-motion: no-preference)`.

## Acceptance criteria

1. The landing script is built to dist and served publicly at /landing.js
2. With reduced motion the landing page shows every final state and nothing animates
3. The hero types the message into the message box, then posts it as a bubble, and ends on the priced results
4. Each beat plays its stages in order when it scrolls into view and replays after leaving the view
5. Every landing sequence finishes in under five seconds
6. Transient elements are visible only during their own stage
7. At desktop width on a scrolling page the phone pins beside the captions and shows the active beat
8. Below desktop width, or when the page does not scroll, beats stay inline with their own screens

## Tests

Pure step logic (timelines, stage visibility, the pinning decision) goes in an exported, DOM-free
module so it can be unit tested in `test/landing-page-motion.test.ts`. Behaviour in a real browser goes
in `test/landing-page-chromium.test.ts`, following the existing `*-chromium.test.ts` files and helpers.

## Rules

AGENTS.md protocol; `npm run check` clean; run only the targeted tests. Do not commit. Do not run the
full `npm test`.

## Comments

### Claim and ADR table (implementation agent, 11 Oct 2026)

Claimed. The ADRs below were read in full; 0077 and 0078 are the ones that bind this issue directly.

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 Accessible launch profile | Reduced motion means no motion at all and the final states stay visible; every sequence is under 5 s (WCAG 2.2.2 without a pause control); no focus or content changes are made by the script except the hero field while typing; dynamic changes are announced politely, and only the active beat's name | `landing-page.ts` returns before mounting on `prefers-reduced-motion: reduce`; `landing-motion.ts` sums every sequence and the test asserts < 5000 ms; the live region announces the active caption eyebrow only |
| 0077 Canonical artifacts | The script never recalculates prices, deadlines or states and only toggles the markup that issue 01 renders; text is never rewritten (the hero field is the only text change, and it is restored to the server placeholder) | `landing-page.ts` toggles `hidden` and classes; the message text is read from `[data-landing-message]`, not restated |
| 0005 Request to Book only | Stage order must keep "Reservation confirmed" last in beat 5 and the request states before confirmation | Beat timelines in `landing-motion.ts` keep the order defined by the stage contract |
| 0015 All-in pricing | No price is shown or changed by the script | No money text is touched |
| 0016 Refundable security deposit | The deposit line appears with its result row, not separately | Stage assignments are read from the markup |
| 0041 Thirty-minute request block | The deadline banner is revealed as written (absolute WAT time); no countdown is added | Beat 4 stage 4 only shows the banner |
| 0044 Payment window | No payment countdown is started | No timers are shown; the script only schedules stage reveals |
| 0066 Ranking and trust | No badges or ordering change | Result rows are revealed in the markup order |
| 0080 Deterministic parity | The script adds no controls, no links and no state change; the composer and CTAs are still plain links to `/` | Only `hidden`, classes and the hero field text change |

Also applied from the stage contract in issue 01 and the PRD: the pinning decision uses `innerWidth >= 1024` (64rem), `documentHeight > 1.5 x innerHeight`, and `IntersectionObserver` presence. Missing IntersectionObserver or reduced motion means nothing is mounted.

### Work log (implementation agent, 11 Oct 2026)

Files created or changed (nothing committed; branch `feat/landing-page`):

- `apps/local-guest/src/landing-motion.ts` (new): DOM-free timing (`cumulativeTimes`, `heroTypingSteps`, `heroSendPressAt`, `sequenceStageTimes`, `sequenceDurationMs`), visibility (`stageRevealed`, `onlyVisible`) and the pinning decision (`shouldPinPhone`), with the approved gap lists and constants.
- `apps/local-guest/src/landing-page.ts` (new): DOM entry. Returns at once on reduced motion or without IntersectionObserver. Plays each `[data-landing-play]` at 35% entry and resets it on full exit; mounts the pinned phone at desktop width; re-checks on `resize` and only rebuilds when the decision flips.
- `apps/local-guest/scripts/build-client.mjs`: new esbuild entry to `apps/local-guest/dist/landing.js` (iife, same options as the others).
- `apps/local-guest/src/guest-server.ts`: `GET /landing.js` (reads `dist/landing.js` from the same dist folder as `gallery.js`; 404 with "run npm run build" if missing); `/landing.js` added to `PUBLIC_GUEST_PATHS`.
- `apps/web/src/shortlet-landing.css`: `[hidden]{display:none!important}` (the transcript's `display:grid` rule otherwise shows the hidden typing dots); pinned layout under 64rem+ (`.is-pinned`, `.landing-pinned` sticky in column 2); `.is-dim` captions; `.landing-live` screen-reader-only region; entrance animation (`.landing-enter`), caption fade and send press (`.is-sending`) inside `@media (prefers-reduced-motion: no-preference)`. Tokens only. `shortlet-foundations.css` untouched; `landing-page-html.ts` untouched.
- `test/landing-page-motion.test.ts` (new): 7 tests (non-browser).
- `test/landing-page-chromium.test.ts` (new): 9 tests (browser; real Chromium through the existing `chrome-devtools` helper, own server per test).

Design decisions and deviations:

1. Beat screens are hidden with `hidden` on their `.landing-beat__screen` wrapper when pinned (the phone itself is `[data-landing-screen]`). The clone is `cloneNode(true)` of that phone, with `aria-hidden="true"`, so the pinned phone is not announced twice.
2. The active beat is the lowest-numbered caption crossing the `-45%` band. A beat plays inside the sticky phone each time it becomes active, so scrolling back replays it.
3. Pinned beats are `min-block-size: 18rem`, not `70vh`. With `vh`, the page height grows with the viewport, so the 1.5 x viewport rule always held and a tall window never unpinned (found by AC8, fixed in CSS).
4. The live region's text is the caption's eyebrow (for example "3 · Request"). This is a new element, not an edit of existing copy. It is the only text the script writes besides the hero field.
5. Reset on full exit: an element that has fully left the view is reset to its reset state (hidden), so re-entry replays it from stage 1. Beats that have never been in view keep the server's final state until first entry.
6. The hero's stage 1 is at 300 + 26 x length + 250 + 200 ms (4154 ms to stage 4 for the 54-character message). Typing starts from the placeholder and the placeholder is restored at stage 1.
7. Every sequence is checked at play time: the timeline must have one time per declared stage, under 5000 ms, or it does not play.

Tests (all run, all pass):

- `test/landing-page-motion.test.ts` (7/7): AC3 hero typing and send timing; AC4 beat gap lists and order; AC5 every sequence under 5000 ms; AC5 timeline length matches declared stages; AC6 stage/only visibility; AC7 pin decision at 1024 px with an IntersectionObserver; AC8 pin decision failure paths (1023 px, phone width, exactly 1.5 x, short page, no IntersectionObserver).
- `test/landing-page-chromium.test.ts` (9/9): AC1 `/landing.js` 200 with a stale session; AC2 reduced motion, nothing changes over 4.5 s; AC3 hero types, bubble and both results; AC4 beat plays in order and replays; AC5 beat 5 finishes in under 5 s in the browser; AC6 `only` element hidden after its stage; AC7 1280 x 800 sticky phone with active beat and inline screens hidden; AC8 390 px keeps five inline screens; AC8 a page that stops scrolling unpins on resize.
- `test/landing-page.test.ts` (16/16, unchanged, issue 01 still passes).

Commands: `npm run build` (ok, `dist/landing.js` emitted); `npm run check` (exit 0); the three test files above run individually, not the full `npm test`.

Open problems: none known. The Browser pane (preview) was not used; the Chromium tests cover the same behaviour. Photos and copy are still the issue 01 placeholders.

### Corrections after coordinator review (implementation agent, 11 Oct 2026)

- Staged elements (`data-landing-stage`) now use the `landing-pending` class (`visibility: hidden`, so they keep their layout space) instead of `hidden`. Transient `data-landing-only` elements keep `hidden`. Entrance (`landing-enter`) runs on reveal.
- At mount, a container already at least 35% in view plays at once; any other container is reset immediately, so off-screen beats never show their final state before they play.
- `beforeprint` tears down all motion and restores the final state; `afterprint` leaves it final.
- `[hidden]` is scoped to `.landing-transcript [hidden], .landing-beat__screen[hidden]`; the global `!important` rule is gone.
- Known limit: transient lines (`data-landing-only`, kept `hidden` as instructed) still change page height while they show. The height-stability test covers beats 3 and 5, which have none.
- Tests: `test/landing-page-chromium.test.ts` 12/12 (new: off-screen reset before scroll; height stable through beats 3 and 5; beforeprint). `test/landing-page-motion.test.ts` 7/7 and `test/landing-page.test.ts` 9/9 (the non-browser run reported 16 in total).

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Motion script landing-page.ts / landing-motion.ts (stage contract, timings, print). The behaviour was later changed by 09: the hero plays once, beats pin on desktop only. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
