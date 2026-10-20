# 07 · Brand layer foundations: logomark, self-hosted fonts, landing tokens

Status: resolved
Type: task
Blocked by: 05, 06 (items 1 and 2)

## What to build

The brand layer that sits around the app on the landing page (direction doc, "Two layers" and "Visual system"). Nothing in this issue changes the app or the page structure; issue 08 uses it.

### A. Logomark
- An inline SVG helper in `apps/local-guest/src/` that returns the mark plus the wordmark.
  - The mark uses one fill colour plus a cut-out colour, both from tokens, so it works on light, dark and photo surfaces.
  - It is `aria-hidden`; the link around it carries the name "Shortlet".
  - Shape: as on the `Mix-Desktop` board (the house-shaped speech bubble with a keyhole), or whatever issue 06 approves.

### B. Fonts
- Self-host Newsreader (400, 500, 400 italic) and Hanken Grotesk (400, 600, 700) as WOFF2:
  - five files at most;
  - subset to Latin, `₦` (U+20A6), typographic quotes and dashes;
  - add the OFL licence files next to them and a `CREDITS.md` entry.
- Serve them from the local guest server the same way `/landing/photos` is served, with long-cache headers.
- `@font-face` with `font-display: swap`. Preload only the hero H1 weight.
- Check `₦` coverage in both families. Result: Newsreader has it and Hanken Grotesk does not (14 Oct 2026). Brand-layer amounts therefore use `--landing-font-money` / `.landing-money` (Newsreader); there is no `unicode-range` fallback (direction doc, "Type").
- No request to any third-party host.

### C. Landing tokens
- In `apps/web/src/shortlet-landing.css`, define the tokens in the direction doc's colour table:
  - map each onto an existing semantic token where the values match, and add the rest;
  - add a dark-mode set under the existing theme switch (`data-theme` and the system preference).
- Define the display and body font stacks and the type scale from the doc as tokens.
- `shortlet-foundations.css` is not touched.

## Acceptance criteria

1. The landing page shows the logomark beside the wordmark, and the logo link is named "Shortlet"
2. Headings use the self-hosted display face and body text the self-hosted body face, with no request to another host
3. Prices with `₦` render in one font from the first digit to the last
4. Every landing token has a light and a dark value, and every text/background token pair meets WCAG AA contrast
5. Total font payload on first load is at most 160 KB, and text paints before the fonts arrive

## Rules

- Follow the AGENTS.md protocol: one named `test()` per criterion, in `test/landing-page.test.ts` or the Chromium file.
  - AC2: assert on the network log in the Chromium test.
  - AC3: compare the glyph's computed font family against the digits'.
- Run the landing test files (one browser run at a time), `npm run build` and `npm run check`.
- Do not touch `shortlet-foundations.css`. Do not commit until the wave verifies.

## Comments

**14 Oct 2026, orchestrator:** Claimed. Issue 06 items 1 and 2 were approved today. Blocker 05 is implemented but still `claimed`, waiting for the wave gate. The owner asked to start 07 on top of it, so 07 builds on 05's uncommitted work. Work is split into three sub-tasks, run one after another because they touch the same files: A logomark → C tokens → B fonts.

**ADR table**

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 | WCAG 2.2 AA contrast, nothing under 12px, degraded Nigerian networks, text before nonessential media | AC4 contrast pairs and graphics check; AC5 font budget and `font-display: swap`; self-hosted fonts with no third-party request (AC2) |
| 0077 | Channels render the canonical artifact | App-layer phones keep the app's fonts (`.landing-phone`); the phone-text snapshot is unchanged |
| 0015 | All-In Stay Total everywhere in the funnel | `.landing-money` exists so brand-layer totals render in one face (AC3); no amounts were changed |

**Owner decisions taken during the issue (14 Oct 2026)**
- Brand colour literals are allowed only inside one marked block at the top of `shortlet-landing.css`. AC8's no-hex check now strips that block first.
- The `brotli` Python package was installed (`pip install --user brotli`) so WOFF2 files could be written. The font sources were downloaded from github.com/google/fonts (OFL).

**What landed (not committed)**
- A, logomark:
  - `apps/local-guest/src/landing-brand.ts` (`brandMarkSvg()`), placed in the app bar and the footer;
  - CSS fills come from `--landing-mark` / `--landing-mark-cut`: green in light and brass in dark; the header keyhole uses `--color-surface`.
- C, colour tokens:
  - a light, dark and system-dark token block;
  - `--landing-accent-ink` darkened from #8A6A2F to #856429 (4.38 → 4.76 on ground). The direction doc was updated to match.
  - Shared helper: `test/helpers/landing-tokens.ts`.
- B, fonts:
  - `apps/local-guest/assets/fonts/` holds the WOFF2 files (newsreader-500 24.7 KB, newsreader-italic-400 24.1 KB, hanken-grotesk-400-700 23.6 KB; 72.4 KB in total), both OFL files and CREDITS.md;
  - Newsreader is a static instance at opsz 72. The file's name table still says "16pt", which is cosmetic: CSS uses the `@font-face` family name;
  - served at `/landing/fonts/<name>` with an allow-list and `immutable` cache (`guest-server.ts`); the H1 face is preloaded;
  - brand-layer headings are weight 500 with `font-synthesis-weight: none`; FAQ questions stay in the body face;
  - Hanken has no ₦, so brand-layer amounts use `.landing-money` (Newsreader). There is no unicode-range fallback.
  - `test/helpers/chrome-devtools.ts` gained `getPlatformFonts()` (CDP `CSS.getPlatformFontsForNode`).

**Test changes to earlier issues**
- AC8: the hex check runs on the stylesheet with the token block removed, and the block markers must appear exactly once.
- Issue 04 AC7: brand-layer headings now expect `"Newsreader, " + display stack`.

**Verification**
- `test/landing-page.test.ts`: 26/26 (the orchestrator reran it; it passes).
- `test/landing-page-chromium.test.ts`: in the full run, AC2 and AC3 passed. Two tests failed at Chrome launch ("Failed to connect to Chrome DevTools"), before any assertion: Issue 04 AC4 and Issue 07 AC2. Both passed when rerun.
- Issue 04 AC9 failed once in an earlier run and passed in every later run. It is unexplained, and is passed to issue 10's full gate.
- `npm run check` and `npm run build` exit 0.
- Captures are in `screenshots/07/`:
  - overflow 0, controls under 44px 0, text under 12px 0, rail 0 at 320/390/768/1280 and at 200% zoom, light and dark; longest prose line 74;
  - first viewport inside at 390×800 and 360×640, but not at 320×568, which is unchanged since issue 05 and not a required size;
  - the orchestrator checked the light and dark app-bar crops (`screenshots/audit/07-header-check.png`).

Status stays `claimed` until issue 10's wave gate (Definition of Done, items 8 and 9).

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Brand layer: logomark (landing-brand.ts), self-hosted WOFF2 fonts in assets/fonts, landing colour token block, .landing-money. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
