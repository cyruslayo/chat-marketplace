# 09 · Motion for the new layout: hero chat window and one pinned phone

Status: resolved
Type: task
Blocked by: 08

## What to build

Adapt `apps/local-guest/src/landing-motion.ts` (from issue 02) to the new structure (direction doc, "Motion").

- **Hero:** the chat window plays the hero sequence once on load, as the hero phone did: the message, chips, typing, then results. Same stage contract and play-on-enter ratio.
- **How it works, 64rem and up:**
  - the phone frame pins beside the steps;
  - as each step crosses the middle of the viewport it becomes active: full opacity and expanded, while the other steps dim;
  - the phone shows that step's beat screen and plays its existing beat sequence once;
  - scrolling back reactivates earlier steps without replaying finished sequences.
- **Below 64rem, under `prefers-reduced-motion`, or without JavaScript:** no pinning, no dimming and no playback; every step shows its own screen in its final state.
- The sticky app bar switches from "on photo" to "solid" when the hero leaves the viewport. This is a class toggle only, with no scroll listener work beyond an IntersectionObserver.
- Nothing loops, nothing types itself out after the first play, and the money timeline never animates.

## Acceptance criteria

1. On load, the hero chat window plays its sequence once and ends in the same final state as the no-JavaScript page
2. At 1280 wide, scrolling through how it works shows each step's screen in the pinned phone while that step is active
3. Steps that aren't active are dimmed but stay readable and in the accessibility tree
4. With reduced motion, or below 64rem, every step's screen is visible and nothing animates
5. The app bar changes from its on-photo style to solid once the hero has scrolled out of view

## Rules

- Follow the AGENTS.md protocol: one named `test()` per criterion, in `test/landing-page-motion.test.ts` or the Chromium file.
- No animation library. Respect the timings from issue 02.
- Run the landing test files (one browser run at a time), `npm run build` and `npm run check`.

## Comments

**14 Oct 2026, orchestrator:** Claimed. Issue 08 is built: the chat window carries the hero stage contract; the steps are `ol.landing-steps > li.landing-beat` with the screens inline; sub-task B already sets `data-state` on steps in pinned mode; `.landing-appbar--on-photo` exists but is not yet applied. One agent does this issue; the orchestrator reviews it.

### Implementation note (implementation agent, 14 Oct 2026)

Status stays `claimed`. Nothing committed.

Files changed:
- `apps/local-guest/src/landing-page.ts`: the hero plays once (`watchHero`, no replay after scrolling away or on resize); beats are mounted only in the pinned phone (desktop width, enough scroll), each beat plays once per pinned session, and scrolling back shows its final state; `enhanceAppBar()` adds `landing-appbar--sticky` and toggles `landing-appbar--on-photo` from one IntersectionObserver (rootMargin = bar height, so the bar turns solid once the hero's bottom edge is under it); the app bar is set up before the reduced-motion return; `beforeprint` also stops re-pinning.
- `apps/web/src/shortlet-landing.css` (tokens only): on-photo mark and focus colours; `.landing-appbar--sticky` (sticky, z-index 20, `margin-block-end: calc(-4rem - 1px)`) with the hero's inner padding taking the same height, so nothing moves; pinned phone sticks below the bar; a 250 ms background fade only under `no-preference`.
- `test/landing-page-chromium.test.ts`: five new tests, `Issue 09 AC1` to `AC5` (AC5 has a second test for reduced motion), and four Issue 02 tests changed (below).
- `.scratch/landing-page/capture-landing.ts`: the 390 px beat-4 capture waited for inline playback, which issue 09 removes; it now captures beat 4 pinned at 1280 (`landing-beat4-reviewing-1280.png`).
- `.scratch/landing-page/capture-09-extra.ts` and `check-09-nojs.ts` (new, scratch).

Test changes (old to new; file `test/landing-page-chromium.test.ts`):
- `Issue 02 AC1 "an off-screen beat is already in its reset state…"` renamed `AC1 — below desktop width the beats keep their final state…`: at 390 px, beat 3 pending before scrolling becomes shown, nothing pending, nothing revealed.
- `AC2 "the page height does not change while the hero or any beat plays"`: 390 px inline scrolling becomes 1280 px pinned scrolling (the only place beats play now).
- `AC4 "a beat plays its stages in order when it scrolls into view and replays after leaving the view"` renamed `…when it becomes active, and scrolling back does not replay it`: 390 px inline becomes 1280 px pinned; the replay expectation becomes no replay.
- `AC5 "every landing sequence finishes in under five seconds"`: 390 px beat 5 becomes 1280 px pinned beat 5.
- `AC6 "transient elements are visible only during their own stage"`: 390 px beat 4 becomes 1280 px pinned beat 4 (checks the pinned copy).
- Unchanged: AC2 reduced motion, AC7 pinned, AC8 (both), AC9 beforeprint, all Issue 04 to 08 tests.

Red then green (Chromium, `node --import tsx --test test/landing-page-chromium.test.ts`):
- Red, after writing the tests and before the implementation: 34 pass, 6 fail. Failing: Issue 02 AC1 (beat 3 stage 1 pending at 390), Issue 02 AC4 (replayed beat 2 on scroll back), Issue 09 AC1 (hero replays: pending 4 after scrolling back), Issue 09 AC4 (390 px: beat `leftover` 21 elements playing), Issue 09 AC5 both tests (no `landing-appbar--on-photo` class). Issue 09 AC2 and AC3 already passed on the old code (the pinned machinery from issue 02 does what they check); they were not made artificially red.
- Green: 40 of 40, exit 0.
- Two test-side corrections during green, both recorded here: the solid-bar background is read after the 250 ms fade (the test waited for the class only); and the reduced-motion transition check accepts under 1 ms, because the foundations' reduced-motion reset sets 0.00001 ms rather than 0 s.

Other runs (final): `npm run build` exit 0; non-browser `test/landing-page.test.ts` + `test/landing-page-motion.test.ts` 40 of 40; `npm run check` exit 0.

Captures (`.scratch/landing-page/screenshots/09/`):
- `capture-landing.ts 09`: no document overflow at 320, 390, 768 or 1280 (light and dark), no control under 44x44, no text under 12px. Longest prose line 45 / 52 / 74 / 74 characters. The only elements past the viewport edge are the example chips in their own scroll row at 320 to 390 (as in issue 08). First viewport: composer at the same positions as the issue 08 capture (390: 418 to 512; 360: 337 to 431; 320: 393 to 487).
- Headline and composer positions are identical with JavaScript on and off at 1280 and 390 (`check-09-nojs.ts`: H1 document top 167 and 118; bar height 65 in both).
- `top-bar-on-photo-1280.png`, `scrolled-bar-solid-1280.png`, `pinned-step2-1280.png`, `pinned-step4-1280.png`, `landing-beat4-reviewing-1280.png`, `landing-pinned-1280.png`.

Problem found and fixed while capturing: the sticky pinned phone sat under the sticky bar (top offset 24 px, bar 65 px). It now sticks at 65 px + 24 px.

Open questions for the orchestrator:
1. "Expanded": inactive steps keep their full text (AC3 forbids hiding it), so the active step differs only by full opacity against 0.45 for the others. Confirm that is what "expanded" means.
2. Opacity 0.45 is the floor the issue sets. Measured contrast of dimmed captions on the dark ground is low; the owner may want a higher floor.
3. A step first reached and left before its sequence finishes shows its final state when reactivated (no resumed or replayed sequence).
4. Below 64rem the beats no longer play at all (issue 02 had them playing inline). That follows issue 09's "no playback below 64rem" and the 2 tests changed above.
5. The screenshots were taken with the headless default theme (dark); light and dark are covered by the findings sweep, not by the extra captures.

### Correction: inactive steps dim by colour, not opacity (implementation agent, 14 Oct 2026)

The orchestrator's review found that opacity 0.45 fails contrast on inactive step text. Changed:
- `shortlet-landing.css`: `.landing-caption.is-dim { opacity: 0.45 }` removed. Inactive steps now set `color: var(--landing-ink-muted)` on the eyebrow, heading, body and pain line. The active step keeps `--landing-ink`. Transition under no-preference is now `color 300ms` on the text (was opacity). No token value changed.
- `test/landing-page-chromium.test.ts` "Issue 09 AC3": opacity check replaced. It runs in light and dark (cookie `shortlet_theme`), asserts no text opacity below 1, computed colours equal the ink-muted token for inactive heading, body and pain, contrast of every step text against its computed background is at least 4.5:1, and keeps the accessibility-tree heading checks. Failure path: the old treatment (ink at 45% over the ground) is asserted below 4.5:1.
- Red run (AC3 against the opacity CSS): `light: step 1 eyebrow has no opacity below 1` (0.45 !== 1). Green after the CSS change.
- Measured, computed backgrounds (`capture-09-extra.ts`, inactive steps): light heading/body/pain `rgb(85, 98, 90)` on `rgb(246, 245, 240)` = 5.86:1; dark `rgb(163, 175, 167)` on `rgb(17, 24, 20)` = 7.94:1. Note the section canvas is the foundations canvas `#F6F5F0`, not the landing ground token `#F4EFE6`; the test measures against what the text actually sits on.
- Old treatment for comparison (computed here, same backgrounds): ink at 0.45 alpha is 2.75:1 in light and 3.93:1 in dark.
- Recaptured: `pinned-step2-1280-light.png`, `pinned-step2-1280-dark.png`, `pinned-step4-1280-light.png`, `pinned-step4-1280-dark.png` (and top-bar / scrolled-bar captures per theme). The unsuffixed opacity-era captures were deleted.
- Runs: build 0; non-browser landing + motion 40/40; Chromium landing 40/40 exit 0; `npm run check` exit 0; `capture-landing.ts 09` exit 0.

**14 Oct 2026, orchestrator: reviewed and accepted.**
- The hero plays once, the phone pins (it now clears the sticky bar), and the bar goes from on-photo to solid with no layout shift.
- Correction made in review: inactive steps were dimmed with opacity 0.45 (2.75:1 light, 3.93:1 dark), which fails AA for content that stays in the accessibility tree. They are now dimmed with `--landing-ink-muted` (5.86:1 light, 7.94:1 dark), and AC3 measures this in both themes.
- Behaviour change: below 64rem the beats no longer play; they show their final states, as this issue specifies. Five Issue 02 tests were updated to match (listed above).
- Runs: build 0; non-browser 40/40; Chromium 40/40; check 0; `screenshots/09/` findings clean.
- Status stays `claimed` until issue 10.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Motion for the new layout: hero once, pinned phone on desktop, app bar over the hero, colour-only dimming. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
