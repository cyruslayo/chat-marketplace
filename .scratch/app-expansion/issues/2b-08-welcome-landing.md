# Phase 2b-08: Move the /welcome landing page to the Xenia brand layer

Status: resolved
Type: task
Blocked by: 07, 09, 2b-01, 2b-02

## Why

`/welcome` already carries the Adire Indigo tokens (issue 07) and the self-hosted type (issue 09), but its brand layer is still Shortlet: the retired speech-bubble logomark, the "Shortlet" wordmark in the app bar, phone bars, footer, title and FAQ, and a plain "Concierge" speaker label. The owner asked (26 Nov 2026) for the landing page to follow the Xenia design system ([XH7yVkfLzKG357Gxqc1F3d](https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d), version `1795649802-fe7c`) and the Xenia Guest App Boards ([3SJdAGNjUAKt4Um228zZgB](https://claude.ai/artifact/3SJdAGNjUAKt4Um228zZgB), version `1795652116-1a8b`). Both are still at the versions pinned in `design/round-12/`.

Owner choices, 26 Nov 2026:
- Visual refactor plus the Xenia name (app bar, footer, title, every user-facing "Shortlet" on the page) and the "Concierge · Stays" persona label. No other copy changes.
- Keep the hero typing and the pinned phone, restyled only.
- Layout from the design-system docs and the boards. There is no landing board: `Handover.dc.html` calls the "Guest demo frames" a landing showcase, not product screens.

## What to build

- **Wordmark.** Per `design-system/art-direction.md` ("Shape"), the speech bubble with a roof peak is retired. Until the logo exists, "Xenia" is set in Newsreader 500 as the wordmark. Remove `brandMarkSvg` from the app bar and footer, the `.landing-mark*` CSS and the `--landing-mark*` tokens.
- **Mockup bars.** The phone and chat-window bars show the "Xenia" wordmark and the mode label `.ui-mode-label` ("Concierge · Stays", shipped in 2b-02), as in the AppBar README's Conversation variant.
- **Persona label.** The example chat's speaker label reads "Concierge · Stays" with the mode word in `--mode-accent` (ChatMessage README). The page root takes `data-mode="stays"` so the mode tokens resolve.
- **Step numerals.** The `#how` beat eyebrows ("1 · Search") set the number as a Newsreader 500 numeral in `sand-ink` (Steps README). The text content stays the same.
- **Copy.** `landing-copy.ts` brand strings only: page title, footer nav heading, copyright, the FAQ question that names the service.
- **Scope.** This is the page layer only. Phone and chat mockups keep the foundations `ui-*` components and inherit the bundle shapes when 2b-03, 2b-04 and 2b-05 land. No landing overrides that fight the bundle. Routes, forms, motion timings, asset names and the section order are unchanged.
- Not here: `/partners` (on main only; merging main into this line hits a schema migration version clash, see Comments).

## Acceptance criteria

- AC1: The app bar and footer show the wordmark "Xenia" in Newsreader 500 with no logomark. The brand link is named "Xenia".
- AC2: Every phone and chat-window bar shows "Xenia" and a `.ui-mode-label` reading "Concierge · Stays"; no "Shortlet" remains in the rendered page.
- AC3: Every concierge speaker label reads "Concierge · Stays"; the mode word uses `--mode-accent`.
- AC4: The five `#how` step numerals render in `--landing-font-display` with `--landing-accent-ink` (sand-ink), and the eyebrow text is unchanged.
- AC5: Captures at 320/390/768/1280, light and dark, plus 200% zoom, in `.scratch/landing-page/screenshots/2b-08/`; findings report zero overflow, zero controls under 44px and no text under 12px.

## Integrity checks (`kickoff.md` §4)

- **I2 (Token parity):** semantic tokens only; no hex outside the `landing-brand-tokens` block.
- **I3 (Class parity):** `ui-mode-label` from `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** brand strings come from `landing-copy.ts`; other copy unchanged.
- **I8 (Captures):** as AC5.
- **I10 (Scope):** Stays only; no price, deadline or refund changes.

## ADR compliance

0078 (contrast, targets, reflow), 0107 (one brand, persona label), 0108 (shared components, no landing duplicates).

## Tests

`npm run check`; `npx tsx --test` on the landing unit tests; `test/landing-page-chromium.test.ts` solo; `npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts`; `capture-landing.ts 2b-08`.

## Comments

- 26 Nov 2026, implementation (branch `feat/app-expansion-2b-08` from 06a9997, worktree `chat-marketplace-ae-welcome`).
  - Merging `main` into this line was tried and aborted: `apps/cloudflare/src/schema.ts` has migration version 6 on both sides (main: founding partner applications, issue 17; this line: durable cancellation cases, issue 05). Main's 6 may already be on staging, so this line's 6 likely has to become 7. That is a decision for the app-expansion merge, not this issue. `/partners` is therefore not on this branch, and the footer has no partners link yet.
  - Done:
    - the Xenia wordmark in the app bar, footer and mockup bars;
    - the mode label and persona label "Concierge · Stays", with `data-mode="stays"` on the root;
    - the step numerals;
    - the brand strings in `landing-copy.ts`: new `brandName`, `conciergeName` and `modeName`, and `footerShortlet` renamed to `footerBrand`;
    - the retired mark removed: `landing-brand.ts` is deleted, along with the `.landing-mark*` rules and the `--landing-mark*` tokens;
    - the phone text snapshot `test/fixtures/landing-phone-text.json`, updated for the brand and persona text only.
  - Two real-Chrome failures existed at 06a9997, before this change (checked by running them there). Both are fixed here:
    - Issue 10 AC3: the photo scrim at 0.73 left the sand hero eyebrow at 4.43:1 and the dark closing reassurance at 4.32:1 over the lightest point of the photo. `--landing-scrim` is now 0.78, and the lowest pair is 5.19:1.
    - Issue 07 AC2 asserted that no Hanken Grotesk appears inside the phones. Issue 09 made Hanken the app's UI face, so the test now rules out only Newsreader.
  - Issue 04 AC7 had been passing by accident: its lazy regex reached the phone bar's `--font-display`. It now checks the h1/h2 rule blocks for `--landing-font-display`.
  - Commands and counts:
    - `npm run check`: clean.
    - `npx tsx --test test/landing-page.test.ts test/landing-handoff.test.ts test/demo-mode-landing.test.ts test/landing-port.test.ts test/landing-monthly-copy.test.ts test/landing-page-motion.test.ts test/landing-chip-limit.test.ts test/round12-class-parity.test.ts`: 71 tests, 71 pass.
    - `npx tsx --test test/landing-page-chromium.test.ts` (solo): 44 tests, 43 pass, 1 skipped, 0 fail.
    - `npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts`: 3/3 pass.
    - `npx tsx .scratch/landing-page/capture-landing.ts 2b-08`: 320/390/768/1280, light and dark, plus 200% zoom. 0 overflow, 0 controls under 44px, 0 text under 12px, 0 rail breaks. The baseline from before the change is in `screenshots/2b-08-before/`.
  - Live check in the browser pane on a local server (`.scratch/landing-page/serve-2b-08.ts`):
    - the footer and closing are indigo-deep `rgb(17, 30, 71)`;
    - the root carries `data-mode="stays"`;
    - the persona mode word takes the Stays accent;
    - no console errors.
  - Not done here: the full `npm test` and `test:workers` (they run at the batch gate), and aligning `/partners` (waits for the main merge).
