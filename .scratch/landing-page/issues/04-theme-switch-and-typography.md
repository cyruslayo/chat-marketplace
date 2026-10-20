# 04 · Light/dark switch and landing typography scale

Status: resolved
Type: task
Blocked by: 03

## Why

Measured on 11 Oct 2026 (browser, 499px and 1280px):
- There is no way to choose a theme. The page is `data-theme="system"`, so a dark-mode device only sees dark.
- The landing reuses the app's type tokens, so desktop is flat:
  - H1 is 32px sans (the comp is a ~68px serif), H2 is 24px and H3 is 19px at every width.
  - Prose lines run 736–768px wide (about 95–100 characters).
  - The FAQ question (15px) is smaller than its answer's body text.
  - The phone screens use 14px bubbles and 12px chips, smaller than the app (15px / 14px).
  - The rail labels are 10px, below the design system's 12px minimum.

## What to build

### A. Theme switch (user-approved)

- A two-option segmented control, "Light" and "Dark", in the landing app bar. Reuse the kit's
  segmented styles if they fit (`.ui-segmented`, see shortlet-foundations.css), otherwise landing CSS
  with tokens only.
  - It is a `<form method="post" action="/welcome/theme">` with two `<button name="theme" value="light|dark">`.
  - `aria-pressed` marks the saved choice; neither is pressed when no choice is saved (system).
  - Each target is at least 44×44, and the group has an accessible name ("Colour theme").
- `POST /welcome/theme` (public, like /welcome):
  - It accepts only `light` or `dark`; anything else → 400. It sets cookie `shortlet_theme=<value>;
    Path=/; Max-Age=31536000; SameSite=Lax` and redirects 303 to `/welcome`.
  - The cookie is a display preference only. It is never logged with session data and never used for
    anything else.
- `GET /welcome` reads `shortlet_theme` and renders `<html data-theme="light|dark">`, or `"system"`
  when it is absent or invalid, so the right theme paints first with no flash.
- With JavaScript (`landing-page.ts`): intercept the submit, set `data-theme` on `<html>`
  immediately, update `aria-pressed`, and persist with `fetch(POST /welcome/theme)`. If the fetch
  fails, keep the visual change silently. Without JS the form round-trip works.
- Only the landing page reads the cookie in this issue; the guest app (`/`) is unchanged.

### B. Landing typography scale (in `apps/web/src/shortlet-landing.css` only)

Define landing-only custom properties on `:root` in shortlet-landing.css (for example `--landing-size-h1`),
built with `clamp()` in **rem plus vw**, so text keeps growing at 200% zoom (ADR-0078). Never use px or
vw alone. Interpolate between a 320px and a 1280px viewport:

| Role | 320 → 1280 | Line height | Face / weight |
|---|---|---|---|
| Hero H1 | 2.25rem → 4.25rem | 1.05 | `var(--font-display)`, 600, letter-spacing -0.015em, `max-inline-size: 16ch` |
| Section H2 | 1.75rem → 2.75rem | 1.12 | display, 600, max 22ch |
| Beat H3 | 1.375rem → 2rem | 1.2 | display, 600 |
| Hero lede | 1.0625rem → 1.25rem | 1.5 | sans, max 46ch |
| Caption body | 1rem → 1.0625rem | 1.6 | sans, max 60ch |
| "Instead of" line | 0.9375rem | 1.45 | sans, muted token (check ≥ 4.5:1 in both themes, strikethrough legible) |
| FAQ question / answer | 1.0625rem → 1.125rem / 0.9375rem → 1rem | 1.35 / 1.55 | question 650 sans, larger than the answer |
| Eyebrow | 0.8125rem caps, letter-spacing 0.08em | — | sans 650 |
| Hint / meta | 0.875rem / ≥ 0.75rem | — | sans |

- Section spacing: about 2.5–3.5rem on phones and 4–6rem on desktop, via `clamp()` with the space tokens.
- **Inside `.landing-phone`, the text uses the app's own fixed sizes** and does not scale with the
  viewport:
  - bubbles 0.9375rem (15px);
  - chips 0.875rem (14px);
  - rail labels at least 0.6875rem (11px), with no mid-word breaks;
  - result titles, ticket and money as the kit renders them.

  To make "Confirmed" fit at 11px, widen the phone frames below 64rem: nearly edge to edge (page
  gutter only), smaller inner padding, and the rail spanning the full frame width. Keep the
  320px-reflow and 44px rules.
- Nothing on the page is smaller than 12px. Prose never runs longer than 75 characters per line.
- Do not touch `shortlet-foundations.css` and do not change any copy.

## Acceptance criteria

1. The landing page offers a Light and Dark choice that is saved and applied before the page paints
2. An invalid theme value is rejected and leaves the saved theme unchanged
3. Without JavaScript the theme choice still works through the form
4. With JavaScript the theme changes immediately without reloading the page
5. Headings step down in size from the hero to section to beat headings at both phone and desktop widths
6. Heading and body sizes grow between phone and desktop widths and keep growing at 200% zoom
7. Prose lines stay at or under 75 characters and headings use the display face
8. Text inside the phone screens matches the app sizes and the rail labels never break mid-word
9. No text on the landing page is smaller than 12 pixels in either theme

## Verification

Tests:
- one named `test()` per criterion;
- server and markup checks go in test/landing-page.test.ts (new tests, keep the existing ones);
- computed-style checks go in test/landing-page-chromium.test.ts (at 320, 390 and 1280; dark and light via the cookie).

Then rerun `.scratch/landing-page/capture-landing.ts` into `.scratch/landing-page/screenshots/04/`:
- light and dark at all four widths;
- the pinned view;
- one 1280 capture at 200% zoom (deviceScaleFactor or CSS zoom equivalent).

Write findings.txt there: overflow, controls under 44px, text under 12px, rail breaks, longest prose line
in characters. All must be zero or within limits.

`npm run check` must be clean. Run only the landing tests (one browser run at a time); do not run the
full suite. Do not commit.

## Comments

**Plan and ADR table (before code)**

| ADR | Constraint it imposes | Code path / acceptance criterion it affects |
|---|---|---|
| 0078 | 320 px reflow with no horizontal scroll; controls at least 44 x 44; text grows with the viewport and keeps growing at 200% zoom; light and dark from tokens; no text under 12 px (criterion 9) | Type scale as `clamp()` in rem plus vw (AC6); theme buttons `min-block-size: var(--control-min-target)` (AC1, AC3); phone widened below 64rem and rail labels at 12 px (AC8, AC9); captures at 640 CSS px (200% of 1280) |
| 0077 | One canonical copy and price source. Copy and money labels stay as they are; the theme labels are the only new UI strings (required by this issue) | `landing-page-html.ts` keeps `GUEST_*` helpers for all copy and money; the theme form is markup only (AC1, AC3) |
| 0075 | The theme cookie is a display preference only, never logged with session data or used otherwise; the POST carries one value and no message text, and nothing about it goes in a URL | `readLandingTheme` and the `/welcome/theme` handler in `guest-server.ts` ignore every other field and never log (AC1, AC2) |

Also: `/welcome/theme` must be listed in `PUBLIC_GUEST_PATHS`, or a stale guest session cookie returns 401 before the route (`guest-server.ts`, AC3). The existing "AC5: no form element" assertion in `test/landing-page.test.ts` is genuinely changed by this issue: the only allowed form is the theme form posting to `/welcome/theme`.

**Implementation (claimed, not committed)**

Files changed:
- `apps/local-guest/src/landing-page-html.ts`: `LandingTheme` type; `renderLandingHtml(theme)` sets `<html data-theme>`; `themeSwitch()` renders the form (`form.ui-segmented.landing-theme`, two `button[name=theme]` with `aria-pressed`, group label "Colour theme"); `landing-lede` and `landing-caption__body` class hooks. Copy unchanged.
- `apps/local-guest/src/guest-server.ts`: `LANDING_THEME_COOKIE`, `readLandingTheme()` (exactly `light` or `dark`, else `system`); `/welcome` sends the saved theme and `Vary: Cookie`; `POST /welcome/theme` (origin check, exactly one `theme` value, 400 otherwise, `303` to `/welcome` with `Set-Cookie: shortlet_theme=<value>; Path=/; Max-Age=31536000; SameSite=Lax`); `/welcome/theme` added to `PUBLIC_GUEST_PATHS` so a stale guest session cannot 401 it. `/` and the guest app are untouched.
- `apps/local-guest/src/landing-page.ts`: `enhanceThemeSwitch()` runs first in `start()`, before the reduced-motion return. Click sets `data-theme` and `aria-pressed` at once, then `fetch POST /welcome/theme` (failure ignored).
- `apps/web/src/shortlet-landing.css`: `--landing-size-*` clamp tokens on `:root` (rem intercept + vw slope, fitted to the 320 and 1280 sizes); H1/H2/H3, lede, caption, FAQ, eyebrow; theme switch styles (kit `ui-segmented` track, buttons styled here because the kit's selectors target labels and radios); phone bubbles 15px, chips 14px; phone below 64rem spans the frame to the page gutters; rail labels 12px, rail spans the full frame width; section spacing via `clamp()`.
- `test/landing-page.test.ts`: AC5 updated (see deviations); new `Issue 04 AC1`..`AC9` tests.
- `test/landing-page-chromium.test.ts`: `openLanding()` takes optional cookie headers; new `Issue 04 AC1`..`AC9` (+ `AC4b`, save-fails path); AC3 and AC9 (existing) scroll the hero into view first (see deviations).
- `.scratch/landing-page/capture-landing.ts`: default output `screenshots/04`; theme via the cookie; 200% zoom capture (640 CSS px); text-under-12px audit; longest prose line; size table; hero position.
- `apps/local-guest/dist/landing.js`: rebuilt by `npm run build`.
- `shortlet-foundations.css`: not touched (AC8 `git diff --quiet` passes).

Measured sizes (px, from `screenshots/04/findings.txt`, final capture; theme light and dark are identical):

| Role | 320 | 390 | 1280 | 640 CSS (1280 at 200%) |
|---|---|---|---|---|
| H1 (hero) | 36 | 38.3 | 68 | 46.7 |
| H2 (section) | 28.0 | 29.2 | 44 | 33.3 |
| H3 (beat) | 22.0 | 22.7 | 32 | 25.3 |
| Lede | 17 | 17.2 | 20 | 18 |
| Caption body | 16.0 | 16.1 | 17 | 16.3 |
| Eyebrow | 13 | 13 | 13 | 13 |
| "Instead of" line | 15 | 15 | 15 | 15 |
| FAQ question / answer | 17.0 / 15.0 | 17.1 / 15.1 | 18 / 16 | 17.3 / 15.3 |
| Phone bubble | 15 | 15 | 15 | 15 |
| Phone chip | 14 | 14 | 14 | 14 |
| Rail label | 12 | 12 | 12 | 12 |

Longest prose line (characters, limit 75): 43 at 320, 49 at 390, 71 at 768, 1280 and 640 CSS px.

Findings (`screenshots/04/findings.txt`, all of 320, 390, 768, 1280, 640 CSS px, light and dark): horizontal overflow 0 (document and body); elements past the edge 0; visible controls under 44x44: 0 (14 checked per width); text nodes under 12px: 0 (168 checked per width); journey rail labels broken mid-word or overflowing: 0. Caveat: the capture's rail audit uses device-emulated viewports and did NOT catch the overflow that the Chromium test caught (the bold current "Confirmed" label, fixed below). The Chromium test is the rail gate.

Visual check (PNGs read): 390 light full page (header wraps to two rows; rail labels on one line; hierarchy steps down; photos and kit ticket intact); 1280 dark full page (switch in the app bar; sections, beats and phones in dark tokens; FAQ grid). Not re-viewed at full resolution after the last rail change; the Chromium rail test passes at 320, 390 and 1280.

Verification:
- `npm run build`: exit 0. `npm run check`: exit 0.
- `test/landing-page.test.ts`: 18/18 pass (AC1–AC9 existing, the updated AC5, and Issue 04 AC1–AC9).
- `test/landing-page-motion.test.ts`: 7/7 pass.
- `test/landing-page-chromium.test.ts`: 22/22 pass in the final full run (12 existing, Issue 04 AC1, AC2, AC3, AC4, AC4b, AC5, AC6, AC7, AC8, AC9).
- Not run: the full `npm test` (per instructions).

Findings and fixes along the way:
- "Confirmed" (rail) overflowed at 390 twice: first at 52px column, then the bold current label (650) was 2px too wide. Fixed with the rail spanning the frame (negative margin, no inline padding), letter-spacing -0.03em, and weight 500 for the current step only (colour keeps the emphasis). The margin is small (about 2px on this machine) and depends on the system font; flagged below.
- Hero autoplay: see deviations.
- Cookie-header race in the Chromium helper: extra headers set in `openLanding` were not always applied to the first navigation. The affected tests now set the cookie header right before navigating.

Deviations and why:
1. Rail labels are 12px, not 11px (Part B said "at least 11px"; criterion 9 and the PRD say nothing under 12px). At 11px the conflict is resolved in favour of the acceptance criterion. Recorded as an open question below.
2. The existing AC5 test ("no form element", "no form action") is changed to "exactly one form: the theme switch, posting to /welcome/theme". This issue genuinely adds that form.
3. AC3 and AC9 (existing Chromium tests) now scroll the hero into view first. At 390 x 800 the hero phone starts at about 611 to 636px, so only about 23 to 26% is visible and the hero's 35% trigger is not met on load. The header now wraps (117px tall) and the H1 is larger, both required by this issue. The hero still plays once it is scrolled into view; it no longer plays on load on a 390 x 800 first view.
4. FAQ questions are sans (per the Part B table), though criterion 7 says "headings use the display face". Read as: the beat and section headings are display; the FAQ questions follow the table.
5. The theme buttons use the kit's `ui-segmented` track only: the kit's segmented selectors target `label` and radio inputs, so the button options are styled in `shortlet-landing.css` with tokens.
6. `POST /welcome/theme` also applies the existing `browserOriginAccepted` check (403 otherwise). Not in the spec; it matches the other POST routes.
7. Section spacing: `clamp(var(--space-10), calc(var(--space-8) + 2vw), 3.5rem)` on phones, `clamp(var(--space-16), calc(var(--space-12) + 2vw), 6rem)` from 64rem.

Open problems (for the user or the next issue):
- Hero autoplay on a 390 x 800 first view (deviation 3). Options: a compact one-row header on phones (not possible with the current four items), or lower the hero's visibility threshold. Neither was changed here, since the threshold is motion design (landing-motion.ts).
- "Confirmed" fits the 390 rail with about 2px of slack in this environment. A different system font could overflow; the test would catch it, but the layout would need a fix (for example a 3-column rail at that width).
- Dark-mode text at full resolution was checked only in the 1280 dark capture; a 390 dark capture was not viewed at full size.

Status: left `claimed`. Nothing committed or pushed.

**Review corrections (coordinator review of issue 04)**

1. Style leak fixed. The kit ticket title is an `h2` (`.ui-ticket__name`), so the bare `.landing-section h2` rule set it to the section heading size. The rule is now `.landing-section > h2, .landing-section__intro h2`. Chromium `Issue 04 review 1` asserts the ticket title inside the beat 3 phone is 19px (kit `--font-size-h3`, h2) and the result titles are 16px (kit `1rem`), at 390 and 1280.
2. Phone hero. DOM order is now: intro group (eyebrow, H1, lede), phone, then CTA group (composer, hint). At 64rem+ grid areas keep both copy groups in the left column and the phone on the right. Below 48rem only the lede's second sentence shows (first sentence in `span.landing-lede__first`, hidden by CSS; no copy change). The hero's top padding is reduced on phones; the hero phone drops its brand bar, and its transcript has a fixed 15rem height with the newest messages at the bottom. The app bar's own CTA is hidden below 48rem (the hero composer remains) so the bar stays one row. The AC3 and AC9 scroll-into-view lines are removed. `Issue 04 review 2` asserts the phone message box is inside 0..800 at 390x800, `scrollY` stays 0, and the guest message shows on load.
3. Phone header on one row. Below 48rem the header is `flex-wrap: nowrap` with a shrinking spacer; only one 44x44 icon button is shown: the one that would switch to the other theme (`:root[data-theme="dark"]` hides dark, `light` hides light, `system` uses `prefers-color-scheme`). Both buttons stay in the DOM with `aria-label="Switch to light theme"` / `"Switch to dark theme"`; the desktop segmented control is kept at 48rem+. `Issue 04 review 3` asserts the header children share one row at 320 and 390 (the empty spacer is excluded: it is centred on the row axis, so its top is not a wrap), exactly one visible 44x44 button named for the switch, and both buttons at 1280.

First-viewport check (`screenshots/04/findings.txt`, motion allowed, no scrolling):
- 390x800: message box 716..764px, inside the viewport; scrollY 0; guest message shown on load: yes.
- 360x640: message box 761..809px, NOT inside the viewport (below the fold by 169px). The phone is too tall for 640 high at 360 wide; the CTA is further below. Not fixed here.

Verification (after the corrections):
- `npm run build` 0; `npm run check` 0.
- `test/landing-page.test.ts`: 18/18.
- `test/landing-page-motion.test.ts`: 7/7.
- `test/landing-page-chromium.test.ts`: full run 24/25 with only Issue 04 AC3 failing on its old button-markup regex; the regex was updated and AC3 re-run alone passes. The full file was not re-run after that one-line regex change (the other 24 are from the full run, which includes the review tests and the un-scrolled AC3/AC9).
- Captures: `screenshots/04/` overwritten; new `landing-first-390x800.png` and `landing-first-360x640.png`. Viewed: first 390x800 (H1, phone with message box, CTA below the fold, one-row header with the moon button) and the 1280 light full page (copy left, phone right, segmented Light|Dark).

Not committed. Status left `claimed`.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Light/dark switch (no-JS form post /welcome/theme) and the type scale; the switch became a single icon button in 08. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
