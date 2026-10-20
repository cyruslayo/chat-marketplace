# 08 · Rebuild the landing page as "A + C · Lagos, in conversation"

Status: resolved
Type: task
Blocked by: 07, 06 (items 3, 4 and 6)

## What to build

Rebuild `renderLandingHtml()` (`apps/local-guest/src/landing-page-html.ts`) and `shortlet-landing.css` to the section order in the direction doc ("Page architecture", rows 1–10). Design source: the `Mix-Desktop` and `Mix-Phone` boards on <https://claude.ai/artifact/5ENjonAtFM3UMzBnvzGLrL>. Use the boards for **structure, order, copy and proportions only**. Don't copy their inline `style="…"` strings or hex values; use the landing tokens from issue 07.

Section by section:
1. **App bar**
   - Mark and wordmark; three anchor links; a 44px round theme icon button with an accessible name; one filled primary action.
   - It sits on the hero photo and becomes sticky and solid once scrolled.
   - Without JavaScript it is a plain static bar on solid ground.
   - The theme switch keeps its no-JS form post (`/welcome/theme`); only its look changes.
2. **Hero**
   - Photo with a solid scrim that paints first.
   - Centred eyebrow, H1 with one italic accent word, lede, composer with the visible label "Describe your stay", example chips and the reassurance line.
3. **Chat window**
   - The kit-drawn example conversation, two panes on desktop, overlapping the hero's bottom edge, labelled "Example booking · real app screens".
   - It carries the hero stage attributes (`data-landing-play="hero"` and stages). It replaces the small hero phone.
   - On a phone it is a card peeking up from the bottom of the first viewport.
4. **Trust strip:** four facts in one ruled row.
5. **Apartments:** three photo cards of published Units. A missing Unit is a labelled placeholder, and placeholders show on local builds only.
6. **How it works**
   - Progress line with the five steps. Each step has its eyebrow, H3, body and the approved pain line as plain text "Instead of …" (no `<s>`, no alert icon).
   - Desktop: one phone frame holding the five beat screens (existing `beatOneScreen()`…`beatFiveScreen()`), shown one at a time by issue 09.
   - Without JavaScript, and below 64rem: each step is followed by its own screen.
   - The `data-landing-*` stage contract is unchanged.
7. **Your money:** a deep green band with the three-card timeline. The "Nothing due yet" / "Due now" tags move here from the beat captions.
8. **Questions:** native `<details>`, first open. Questions whose answers are still bracketed placeholders are left out of the render. Keep them in `landing-copy.ts`, flagged.
9. **Closing:** photo with scrim, H2, composer, "Starting a conversation doesn't reserve or charge anything."
10. **Footer:** deep green; the Help column renders only once its links are configured.

Fix while rebuilding:
- "Reservation confirmed" + "Old Ikoyi · Thu 10 to Sun 13 Sept" runs together with no space (beat 5 banner).
- "Reply due by … 2026" + "Your dates are held…" runs together with no space (beat 4 banner).
- The hero composer is an `<a>` styled as an input. Make it a real `<form>` with a labelled `<input>` and a submit button. The form submits to the app (`/`) without the text, until the handoff seam is approved (direction doc, Handoff). Never put the text in a query string.
- All header, section and footer edges share one container (max 1200px, gutters clamp(16px, 4vw, 40px)).

## Acceptance criteria

1. The page renders the ten sections in the order of the direction doc, each with its approved copy from `landing-copy.ts`
2. The hero composer is a labelled text field with a submit button, and submitting it never places the typed text in the URL
3. The example conversation sits in one chat window that carries the hero stage contract, and no other hero phone is rendered
4. Each of the five steps shows its approved heading, body and pain line, and no pain line is struck through or marked with a warning icon
5. "Nothing due yet" and "Due now" appear only in the money timeline, each as text
6. No bracketed placeholder text appears on the page when placeholders are disabled
7. Banner headings and their following text are separated in both the rendered text and the accessible name
8. Every example chip describes a stay of 1–14 nights
9. Without JavaScript, every step's screen is visible next to or below its step
10. The app bar, every section container and the footer share the same left content edge at 1280 and 1440

## Rules

- Follow the AGENTS.md protocol: one named `test()` per criterion.
  - Update earlier landing tests only where they assert the old structure (six phones, struck pain lines, per-beat tags, the `<a>` composer), and list each change in the comments.
  - Keep the phone-screen text snapshot (`test/fixtures/landing-phone-text.json`) passing: the app-layer text does not change.
- ADRs to list and read before code: 0005, 0008, 0015, 0016, 0023, 0041, 0077, 0078. Write the ADR table in the comments.
- Run the landing test files (one browser run at a time), `npm run build` and `npm run check`.
- Do not touch `shortlet-foundations.css`. Do not commit until the wave verifies.

## Comments

**14 Oct 2026, orchestrator:** Claimed. Issue 06 items 3, 4 and 6 were approved today; item 5 (photography) is still open, so placeholder photos are used on local builds only. 07 is built but still claimed until the wave gate. The work is split into three sub-tasks, run one after another because they share files:
- A: copy module, app bar, hero, chat window, trust strip (AC2, AC3, AC8);
- B: how it works and the money timeline, plus the beat banner spacing bugs (AC4, AC5, AC7, AC9);
- C: apartments, questions, closing, footer, the placeholder switch and the shared content edge (AC1, AC6, AC10).

**Sub-task A (Haiku 5.5 implementer, 14 Oct 2026): copy module, app bar, hero, chat window, trust strip (AC2, AC3, AC8). Not committed.**

ADR table (ADR | constraint | code path / AC):

| ADR | Constraint | Code path / AC |
| --- | --- | --- |
| 0005 Request to Book | Nothing on the page says instant booking; the trust strip and window say the Operator confirms first | `landing-copy.ts` `trust[0]`; `landing-page-html.ts` `chatWindow()` |
| 0008 Inspection | No property or inspection claim; trust lines describe process only ("A verified company manages each apartment") | `landing-copy.ts` `trust[0].line` |
| 0015 All-In Stay Total | Result rows show the All-In Stay Total for the nights, via `stayTotalLabel`; copy says "Priced all-in for your dates" | `resultRow()` in `landing-page-html.ts`; `trust[1]`; AC2/AC3 |
| 0016 Refundable Security Deposit | Deposit shown on its own line under each window result | `depositLine()` inside `chatWindow()`; `trust[1].line` |
| 0023 Fourteen nights | Example chips describe 7, 3 and 14 nights; validator rejects anything outside 1 to 14 | `LANDING_COPY.exampleChips`, `validateExampleChips()`; AC8 |
| 0041 Thirty-minute hold | Trust line "Up to 30 minutes in active hours" only; no guarantee wording | `landing-copy.ts` `trust[2]` |
| 0077 Canonical artifacts | Window app layer uses guest kit helpers (`resultRowPartsHtml`, `.ui-rail`, `statusHtml`) and `guest-content.ts` wording; text unchanged except the deposit lines (see changes) | `chatWindow()`; `test/fixtures/landing-phone-text.json` |
| 0078 Accessible profile | Visible composer label; chips and icon button are real controls at 44px; composer button 48px on phones; hero text paints on solid forest before the photo; reduced motion and no-JS show final states | `composerHtml()`, `exampleChipButtons()`, `.landing-theme > button`, `.landing-hero` in `shortlet-landing.css`; AC2 Chromium |

Implementation notes:
- Composer: `<form class="landing-composer" action="/" method="get">`, input `id="describe-stay"` with no `name`, visible `<label for>`, submit button. Sub-task C reuses `composerHtml(id)` for the closing composer.
- Chat window: `role="group"` "An example booking conversation", `data-landing-play="hero"`, `data-landing-stages="4"`. The old hero phone is gone. The "Example booking · real app screens" label is under the window. Deviations: `landing-chat` has no area line under result titles, so the snapshot text is kept apart from the deposit lines.
- Motion (`landing-page.ts`): the hero starts on load at the top of the page even when the window peeks below the fold. Beats keep the 35% viewport rule.
- The `#money` and `#questions` anchors point at sections that sub-tasks B and C build.

Test changes (file: test name, old to new expectation):
- `test/landing-page.test.ts` AC1: H1 check was `<h1>{heroHeading}</h1>` as one string, now the three parts with `<em class="landing-hero__accent">settled</em>`.
- `test/landing-page.test.ts` AC5: forms were exactly one (theme switch), now two (theme switch and hero composer); action count 1 becomes 2; CTA `<a>` count >= 4 becomes >= 3 (the hero is a form).
- `test/landing-page.test.ts` Issue 04 AC7: the `max-inline-size` list used `16ch` for the H1, now `18ch`.
- `test/landing-page.test.ts` Issue 05 AC1: `heroHeading`, `heroLedeDesktop`, `heroLedeAlways` became `heroHeadingText()` and `heroLede`; composer field span count 2 became 1 span plus the hero placeholder; `S05` count 4 became 3 (the app bar now says Start a conversation).
- `test/landing-page.test.ts` Issue 05 AC4: phone-text helper also reads `<div class="landing-chat">`, so six texts still come out, the first being the chat window.
- `test/landing-page.test.ts` Issue 05 AC5: the forbidden-term, quote and length checks now use `heroHeadingText()` and `heroLede`; new slots from issue 06 added to the same checks.
- `test/landing-page-chromium.test.ts` Issue 04 review 1: hero result title selector moved to `.landing-chat`.
- `test/landing-page-chromium.test.ts` Issue 04 review 2: renamed "(Issue 08 AC2/AC3)"; now checks the hero form, reassurance inside 800 px and the window top inside the first viewport (was: hero phone message box).
- `test/landing-page-chromium.test.ts` Issue 04 review 3: renamed "(Issue 08 AC4 app bar)"; checks the single theme icon at every width, 1280 included (was: two buttons at 1280).
- `test/landing-page-chromium.test.ts` Issue 04 review 4 (rails), review 5 and review 6: rails read `.landing-phone` and `.landing-chat`; review 5 checks the composer and reassurance rather than the phone message box; review 6 uses the chat window box.
- `test/fixtures/landing-phone-text.json` entry 0 (hero): adds "+ ₦20,000 Refundable Security Deposit (separate)" and "+ ₦10,000 Refundable Security Deposit (separate)" after the two All-In totals. This is the only fixture change and it is a deliberate app-layer text change (ADR-0016 on the hero window). Owner or orchestrator may reject it and drop the deposit lines instead.

New tests (red then green):
- `Issue 08 AC2` (non-browser, `landing-page.test.ts`): red when the file failed to load because `validateExampleChips` did not exist, then green.
- `Issue 08 AC2` (Chromium, `landing-page-chromium.test.ts`): red with "Timeout waiting for #describe-stay" before the form existed, then green in the final run.
- `Issue 08 AC3` and `Issue 08 AC8` (non-browser): written with the rest of the file. They were not observed red on their own, because the whole file failed to load before the copy module changed. Both pass now.

Runs (final):
- `node --import tsx --test test/landing-page.test.ts test/landing-page-motion.test.ts`: 36 of 36 pass, exit 0.
- Chromium `test/landing-page-chromium.test.ts`: 31 of 31 pass (run 5, after `npm run build`).
- `npm run check`: exit 0. `npm run build`: exit 0.
- Earlier Chromium runs failed for two reasons, both fixed: a stale `dist/landing.js` (fixed by rebuilding) and the hero waiting for 35% of its window to be visible (fixed by the on-load rule). Some runs also failed with "Failed to connect to Chrome DevTools" while other Chrome processes were running; the final run had no such errors.

Open questions for the orchestrator:
1. Deposit lines in the hero window: the fixture change above. Accept it, or drop the lines and accept a gap against the direction doc row 3.
2. On a 390x800 phone the guest message is below the fold; only the window's top edge is in the first viewport. This matches "peeks up", but the earlier review check asked for the message itself. Confirm the peek is what is wanted.
3. `Describe your stay` is a copy slot I added in `LANDING_COPY.composerLabel`; it is in the direction doc but not in the issue 06 approval list. Confirm.
4. The window's result rows have no area line ("Old Ikoyi · 2 bedrooms") as on the board, to keep the snapshot text. Add it later if the owner wants the board's detail.
5. The nav links `#money` and `#questions` point at sections that sub-tasks B and C have not built yet.

**Orchestrator review fixes (sub-task A, same day):**
- Hero H1 colour: `.landing-hero h1` now sets `color: var(--landing-on-deep)`. The foundations colour every h1 with `--color-text`, which made it dark on the photo.
- Hero contrast: `--landing-scrim` alpha 0.64 changed to 0.73 in all three token sets (light, dark, system). Measured with `.scratch/landing-page/measure-hero-contrast.ts` (background = hero with text hidden, lightest pixel behind each box). Before (0.64): eyebrow 3.44:1, reassurance 3.88:1, H1 4.61:1. After (0.73): eyebrow 4.64:1, reassurance 5.23:1, lede 6.37:1, chips 6.29 to 6.47:1, composer label 6.28:1, H1 6.28:1, accent word 4.56:1 (large text, needs 3:1). Alpha 0.72 gave eyebrow 4.50:1, which is too close to the line, so 0.73 was chosen.
- App bar: the nav has `margin-inline-start: var(--space-8)` from 48rem, so it no longer touches the wordmark.
- Phone chips: below 48rem the chips are one horizontal row (`flex-wrap: nowrap`, `overflow-x: auto`, scroll snap, 44px chips). The rule sits last in the stylesheet so it wins over the wrapping rule.
- Test change: `test/landing-page-chromium.test.ts` Issue 08 AC2 (height test, named "AC2 — the page height does not change..."): it now waits for `document.fonts.ready` before recording the start height. The web fonts swap in and change the page height from 8063 to 8058px. Only the motion is compared now.
- Final runs: non-browser landing + motion 36/36; Chromium landing 31/31; `npm run build` and `npm run check` exit 0.

**Sub-task B (Haiku 5.5 implementer, 14 Oct 2026): how it works, money timeline, banner spacing (AC4, AC5, AC7, AC9). Not committed.**

- How it works: `<ol class="landing-steps">` of five `li.landing-beat`, each caption = eyebrow, H3, body, plain "Instead of …" line (no `<s>`, no icon, no status tag). H2 second sentence is the italic accent via `howHeadingParts()`; copy text unchanged. "Example booking · real app screens" label moved under the H2 (sub-task brief); the chat window no longer has a visible label (issue section 3 asked for one; flagged).
- Desktop: same two columns for every step (zig-zag removed). Below 64rem: one column, screen after each step. Progress line is a CSS marker per step; the motion script sets `data-state` only while pinned.
- Money: `#money` band (`landing-timeline` classes; `landing-money` is Issue 07's price font class and must not be reused), H2 accent in `<em>`, three cards as an ordered list. Tags are kit `statusHtml` text: neutral on cards 1 and 2, warning on card 3 (paper card, as on the board).
- Banners: heading `<b class="landing-banner__title">` is block-level on phones and followed by a real space. The phone-text fixture needed no change (its tag-to-space extraction already spaced the text).

Test changes: `Issue 05 AC3` (status tags per beat → money timeline tags, neutral, neutral, warning); `Issue 08 AC3` (example label under the window → under the How heading). New: `Issue 08 AC4`, `AC5` (non-browser); `AC7`, `AC9` (Chromium).

Runs: non-browser landing + motion 38/38 (exit 0); Chromium landing 33/33 (exit 0, no DevTools connection errors); `npm run build` and `npm run check` exit 0. Red runs recorded before implementation: non-browser 4 failing; Chromium AC7 and AC9 failing.

Screenshots: `.scratch/landing-page/screenshots/audit/08b-{how,money}-{light,dark}-1440.png`, `08b-{how,money}-light-390.png`. Observed: money band legible; card 3 near-black in dark mode (paper token); How markers aligned with eyebrows after top-alignment fix.

**Sub-task C (Haiku 5.5 implementer, 14 Oct 2026): apartments, questions, closing, footer, placeholder switch, shared edge (AC1, AC6, AC10). Not committed. Status stays `claimed`.**

ADR table (sub-task C):

| ADR | Constraint | Code path / AC |
| --- | --- | --- |
| 0008 Inspection | No inspection or property claim on the public page. Apartment cards show area, bedrooms and city only; no inspection date | `landing-units.ts` `LANDING_UNITS`; `apartmentCard()` |
| 0015 All-In Stay Total | Apartment cards show no price (no price without dates) | `apartmentCard()` |
| 0023 Fourteen nights | Example chips unchanged (1 to 14 nights) | `LANDING_COPY.exampleChips`, AC8 |
| 0077 Canonical wording | Closing and footer use `LANDING_COPY` only; no second source for guest wording | `closingSection()`, `footerSection()` |
| 0078 Accessible profile | Closing text paints on solid forest before the photo; FAQ summaries 44px; footer links 44px; Help column absent until configured | `.landing-closing`, `.landing-faq__item > summary`, `.landing-footer .landing-link` |

Implementation:
- `renderLandingHtml(theme = "system", options = {})`. `options.placeholders` (default false) and `options.helpLinks` (default none, https or site path only). The one caller (`guest-server.ts`) is unchanged.
- `apps/local-guest/src/landing-units.ts` (new): the typed unit list with `approved` on each entry; all three are false, so the apartments section is omitted on the public page.
- Questions: native `<details>`, first open; `LandingFaqItem.placeholder` flags the two bracketed answers (hidden unless placeholders on).
- Closing: photo, forest-deep under `--landing-scrim`, `composerHtml("describe-trip")`, S06 reassurance. The old `<a class="landing-composer">` is removed.
- Footer: deep green, mark recoloured via `.landing-footer .landing-mark__*` (accent and forest-deep), no new colour tokens.
- Shared edge: every section content uses `.landing-container` or `.landing-section` padding; the footer moved onto the container.

Dead CSS removed (`shortlet-landing.css`): `a.landing-composer`, `a.landing-composer:hover`, `.landing-composer__field`, `.landing-faq` 2-column grid (64rem), `.landing-faq__item > h3` and `> p` rules and the card-style `.landing-faq__item`, the old `.landing-closing { justify-items:start }`, `.landing-footer > span`, `.landing-footer__links` and `.landing-footer__links > *`. Replaced by the apartments, questions, closing and footer rules.

Test changes (file: test name, old to new):
- `test/landing-page.test.ts` AC5: form count 2 to 3; form actions 2 to 3; call-to-action `<a>` count >= 3 to >= 2 (the closing composer is a form).
- `test/landing-page.test.ts` Issue 05 AC1: FAQ slots exclude placeholder answers; S04 placeholder count 1 to 2; the old closing `<span class="landing-composer__field">` check becomes "no landing-composer__field".
- `test/landing-page.test.ts` Issue 05 AC2: Q1 markup `<h3>..</h3><p>..</p>` to `<details class="landing-faq__item" open><summary>..</summary><p>..</p></details>`; placeholder answers checked absent by default and present with placeholders on.
- `test/landing-page.test.ts` Issue 05 AC9 (name kept): bracketed answers asserted with `placeholders: true`; default page asserted without them.
- `test/landing-page-chromium.test.ts` Issue 04 AC6 size probe: `.landing-faq__item > h3` to `> summary`.

New tests (red then green):
- `Issue 08 AC1` (non-browser): red on `class="landing-chat-wrap"` marker and placeholder-free markers; my first marker was wrong (the chat wrapper also carries `landing-container`), fixed to `landing-chat-wrap"`; then green.
- `Issue 08 AC6` (non-browser): red with the bracketed text found on the default page (footer spans and FAQ answers); green after the switch.
- `Issue 08 AC10` (Chromium): red "1280 px: every section except apartments is rendered on the public page 6 !== 9" (questions, closing and footer were missing); green after the sections were built.

Runs (final):
- `npm run build`: exit 0.
- `node --import tsx --test test/landing-page.test.ts test/landing-page-motion.test.ts`: 40 of 40, exit 0.
- `node --import tsx --test test/landing-page-chromium.test.ts`: 34 of 34, exit 0, no DevTools connection errors.
- `npm run check`: exit 0.

Captures (`.scratch/landing-page/screenshots/08/` and `screenshots/audit/`):
- `capture-landing.ts 08`: exit 0. The script still targeted sub-task A's removed hero phone (`.landing-phone-composer`); selectors moved to `form.landing-composer` and `[data-landing-play="hero"]`.
- `capture-audit.ts`: exit 0.
- `capture-08c-regions.ts` (new, scratch): public and placeholder full pages at 1440 and 390, light and dark, with region boxes in `08c-regions.json`. The public audit page omits apartments, so the apartments crops come from the placeholder render.

Open items for the orchestrator:
1. Footer column headings "Cities", "Shortlet", "Help" and the Help labels "Support", "Privacy", "Terms" and "© 2026 Shortlet" come from the direction doc (row 10), not the issue 06 approvals. Confirm.
2. Hero and closing photos are still the Unsplash placeholders from issue 06 item 5; the closing photo is `ikoyi-bedroom.jpg`. They show on the public page; only the apartments cards are gated by `approved`.
3. The sub-task A chat window's ~1 chip row scrolls horizontally inside its own row on phones (by design); the findings count those as "past the viewport edge".
4. At 320 x 568 the guest message is not yet shown in the first viewport (`messageShown: false`); the composer is inside.

**14 Oct 2026, orchestrator summary (all three sub-tasks reviewed and accepted)**
- Built by agents in three sub-tasks:
  - A: copy module, app bar, hero, chat window, trust strip.
  - B: how it works, money band, banner spacing.
  - C: apartments, questions, closing, footer, placeholder switch, shared edge.
- Corrections made during review:
  - A: the hero H1 rendered dark on the dark photo (foundations' heading colour won). It now uses `--landing-on-deep`. Scrim alpha 0.64 → 0.73, so every hero text element measured over the lightest pixel reaches ≥ 4.6:1. The nav no longer touches the wordmark, and the phone chips sit in one scrolling row.
  - B: the money band was theme-dependent, and card 3 turned near-black in dark. Constant `--landing-band-*` tokens now keep it the same in both themes; the new pairs are in the Issue 07 AC4 contrast list. The example label is back under the chat window and also appears under the How heading.
  - C: the hero and closing placeholder photos are gated behind `approved` / `placeholders` (`landing-photos.ts`); without them the sections fall back to solid forest-deep. A phone overflow in the apartments grid (an 800px intrinsic track) is fixed with `minmax(0, 1fr)`, and the card images are 4:3.
- Decisions: the beat 5 CTA stays (S05, issue 05). "Describe your stay" is the composer label (direction doc).
- Runs at the end of C: build 0; non-browser landing + motion 40/40; Chromium landing 34/34; check 0.
- Captures in `screenshots/08/`: no document overflow, no control under 44px, no text under 12px, longest prose line ≤ 74 at every width, light and dark. The chips sit past the edge inside their own scroll row, by design.
- Open for the owner:
  - footer labels "Cities", "Shortlet", "© 2026 Shortlet" (plus Help/Support/Privacy/Terms, which render only once links are configured);
  - the app-layer example screens still use local test-data Units and photos. This is direction doc decision 5 (example Unit and prices), already a launch blocker.
- Known, not 08: at 320×568 the guest message is not in the first viewport on load (not a required size).
- The TDD record has gaps: Issue 08 AC3 and AC8 were never seen failing on their own (sub-task A).

Status stays `claimed` until issue 10's wave gate.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Ten-section page ("A + C · Lagos, in conversation"): photo hero with a real form, chat window, trust strip, apartments, steps, money band, questions, closing, footer; placeholder switch. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
