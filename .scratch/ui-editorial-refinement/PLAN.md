# Guest UI refinement — "Warm Editorial" pass

## Context
The guest app (`apps/local-guest`) already has a design system: `apps/web/src/shortlet-foundations.css`, with direction set in `docs/design/shortlet-design-system-direction.md` ("Residential hospitality with editorial restraint": warm-paper canvas `#F6F5F0`, deep-green action `#0B5C46`, ink text, Iowan/Palatino display serif). The user shared five Pinterest references and chose the **Atlanta "warm editorial"** mood, scope **guest app only**. The goal is to refine the existing system toward those references. It is not a rebrand.

## Recommended design style: Warm Editorial Minimalism (soft-tactile flat)
- **Not glassmorphism.** Frosted text over photos fails WCAG 2.2 AA contrast unpredictably. `backdrop-filter` is also costly on low-end Android over degraded networks (ADR-0078). The direction doc explicitly bans glass, glow and gradients.
- **Not skeuomorphism.** It is heavy on assets and dated, and it fights the "text and critical facts before media" rule (ADR-0078).
- **What we do instead:** flat tonal surfaces, thin borders and a serif-led editorial hierarchy. Photography provides the emotion. One deep-green "inverse" panel acts as the booking ticket, as in Atlanta. Depth comes from overlap and a single restrained shadow, never blur. The current tokens already match Atlanta closely (cream plus deep teal-green plus serif), so this pass mainly **applies** the system more expressively.

## Approved visual decisions (from the in-chat mockups, 2026-09-28)
- **Pills:** filter/criteria chips, the full-width primary CTA and the Card/Bank transfer segmented control are pill-shaped. Cards stay at 16px, photos at 12px, and the detail sheet overlap uses a 24px top radius.
- **Serif:** used for page titles, workspace titles and stay titles. Money stays sans with tabular numerals.
- **Stay ticket:** light mode uses solid `#063A2C` with `#D5EBE0` secondary text. Dark mode uses a `#0E2A21` fill, a visible `#2F6B55` border and mint `#5CC49A` accents.
- **Chat shell:**
  - A 5-step journey rail drawn as top-border segments.
  - A criteria chip row where an empty criterion shows a dashed "+ Budget" chip.
  - A compact thumbnail result row inside the transcript.
  - A pill composer with a 48px round send button.
- **Payment:** an inverse-green "Amount due now" header, then a warning banner with the absolute WAT deadline plus a countdown, then the bank details card (monospace account number and a copy button), then a text status line.
- Grey blocks and bank details in the mockups are placeholders. Real pages use the existing photos and authoritative Paystack projection values.

## ADR constraint table
| ADR | Constraint | Affects |
|---|---|---|
| 0078 | WCAG 2.2 AA, 44px targets, 320px reflow, reduced motion, degraded networks, en-NG/₦/WAT, absolute deadlines | Every slice. No blur. Text renders before images. |
| 0015 | The All-In Stay Total leads. Nightly rate is secondary and labelled. Deposit is always shown separately. | Stay card, detail action bar, price breakdown. Reject "$187/night" as the lead price. |
| 0066 | No generic "Verified" badge. Reviews come only from verified stays. Map is neighbourhood-level (~750m obscured). | Reject ★4.2 ratings, "Hot Rent" badges and the precise price-pin map. |
| 0080 / 0081 | Conventional routes stay at parity. Weaver Basic Catalog is unchanged, so styling is CSS only. | Styles apply to both A2UI output and `renderConventional*` pages. No new A2UI components. |
| 0031 / 0032 | Arrival and checkout times come from the policy projection | The stay ticket shows times only from authoritative data and never hardcodes them. |
| 0075 | Photos load with no-referrer | Gallery and hero images |

## What we take from each reference / what we reject
- **Atlanta (primary):**
  - Take: serif display headings, cream canvas, a deep-green "Your booking" ticket with large check-in/check-out day numerals, a collapsible per-night breakdown (`<details>`), and a full-width pill-shaped primary CTA at the bottom.
  - Keep the order the direction doc requires: total first, then deposit, then Amount Due Now.
- **Ref 1 (glass real estate):**
  - Take: the detail hero photo with a solid white summary sheet overlapping it by about 24px, facility tiles (bed/bath/guests), and a sticky two-action bar.
  - Reject: frosted text over photos.
- **Ref 2 (Eurostars):**
  - Take: a large photo-led stay card, a neighbourhood line with a pin icon, and a row of icon + text fact chips.
  - Reject: text over the photo, the star rating, the /night lead price and the lime accent.
- **Ref 3 (Surabaya list):**
  - Take: a horizontal filter chip row (maps to the existing criteria strip) and compact thumbnail rows for compare and "other stays".
  - Reject: the price-pin map (0066).
- **Ref 4 (Royal Malewane):**
  - Take: the check-in → check-out summary block and a bottom price bar reading "₦ total · Request to book".
  - Defer: the custom calendar (large a11y surface). Keep native date inputs.

## Slices (track as `.scratch/ui-editorial-refinement/` PRD + issues, per `docs/agents/issue-tracker.md`)
1. **Token and direction amendments.** Files: `apps/web/src/shortlet-foundations.css`, `docs/design/shortlet-design-system-direction.md`.
   - Add semantic roles: `--color-surface-inverse` (green-900 `#063A2C`), `--color-text-on-inverse` and `--color-text-on-inverse-muted` (verify ≥4.5:1). Add a dark-mode equivalent.
   - Add heading roles `--font-heading` → `--font-display` for H1–H3. Add `--radius-sheet` (reuse 1.5rem hero).
   - Amend the doc to allow fully-rounded **compact** chips and the primary sticky CTA. Record the "no glass/blur" rationale.
   - Add a `ui-ticket`, `ui-facts--chips` and `ui-action-bar` layer to foundations.
   - No existing hex values change.
2. **Stay card (discovery).** Style both Weaver stay-card output (the `.weaver-mount` scope in the `guest-server.ts` inline style) and `renderConventionalSearchHtml`:
   - 4:3 photo with a 12px radius, a serif title and a neighbourhood line.
   - Fact chips.
   - An all-in total block with a "for N nights, all-in" label and a separate deposit line.
3. **Unit detail.** In `renderConventionalUnitDetailHtml` + `organizeUnitDetail` (`client.ts`) + `listing-gallery.ts`:
   - Hero gallery, then an overlapping solid summary sheet.
   - Facility tiles.
   - Sticky bottom `ui-action-bar` (total + primary action, with `env(safe-area-inset-bottom)`).
   - Replace the hard-coded `rgb(10 12 10/.96)`/`#fff` in `LISTING_GALLERY_STYLE` with tokens.
4. **Stay ticket + price breakdown.** Add the Atlanta-style inverse-green ticket (dates, nights, party) and a refined PriceBreakdown. Apply to request review, offer, payment (card and transfer pages) and confirmed views, in both the Weaver-mounted and conventional booking/transfer pages.
5. **Shell polish.**
   - Header, journey rail, criteria strip as a horizontal chip row (Ref 3).
   - Chat bubbles and composer: calmer surfaces, with a serif workspace heading.
   - Dark-mode pass.

Reuse `ui-kit.ts` (`formatMoney`, `icon`, `statusBadge`) and the existing `ui-*` classes. Do not introduce new icon libraries, webfonts or image assets.

## Tests / verification
- Update `test/shortlet-ui-foundations.test.ts` and `test/shortlet-design-system.test.ts` for the new tokens.
  - Contrast assertions cover the inverse-surface text, including in dark mode.
  - Keep the rule "no hard-coded hex colours in `guest-server.ts`".
- Add one `test()` per acceptance criterion in each slice issue. Watch the layout-sensitive Chromium suites: `listing-gallery-chromium`, `guest-split-workspace-chromium`, `guest-criteria-strip`, `mobile-guest-journey-chromium`, `guest-compare-chromium` and `unit-detail-old-ikoyi-chromium`.
- `npm run check` and `npm test` must be clean after each slice.
- Visual check through the preview browser at 320/390/768/1280, light and dark, 200% zoom and reduced motion. Save before/after screenshots to `.scratch/ui-editorial-refinement/screenshots/`. Confirm no horizontal scroll, a focus ring on every control and 44px targets.
- No-JS check: each conventional route still renders the refined styles with JavaScript disabled.
