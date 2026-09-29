# Kit foundations: CSS components, icons and server HTML helpers

Status: ready-for-agent
Type: task
Blocked by: 01
Requested: 29 Sept 2026

## Why

Every later issue draws screens from one kit. Today the parts are spread across `shortlet-foundations.css`, the chat shell's inline `<style>` in `renderGuestShellHtml`, page-level `style:` strings in each `renderConventional*` function (for example `GUEST_STAY_PAYMENT_STYLE`), and `client.ts`. This issue makes the kit exist once.

## What to build

**1. CSS.** In `apps/web/src/shortlet-foundations.css`, implement every component of `design/kit.css` as `ui-*` classes, following the mapping table in `PRD.md`.
- Use only existing tokens (`--color-*`, `--space-*`, `--radius-*` including `--radius-pill`, `--font-*`).
- Dark mode comes free through the tokens. Check each component under `:root[data-theme="dark"]` and `prefers-color-scheme: dark`.
- Components: app bar, rail (with `data-state` done/current/failed/upcoming), chips (plus `--add` dashed and pressed), fact chip, stay card, result row, tiles, ticket (labels, day numerals, arrow, foot), price breakdown (`__row`, `__due`, `__paid`, `__condition`), banners (add `--neutral`), status pills, steps, segmented radio group, stacked facts, upload field, link, action bar.
- Keep `:where()` for low-specificity defaults, as with `:where(.ui-page > .guest-editorial)`. Beware the bugs the design render already hit:
  - `.sl a` outranking `.btn` made button text invisible
  - `.facts dd` outranking `.money`
  - a `.empty` class-name collision

**2. Icons.** Add the design's icons to `ICON_PATHS` in `apps/web/src/ui-kit.ts`: pin, bed, bath, arrow-left, arrow-right, arrow-up, chevron-right, copy, plus, message-plus, photo, bank, upload, grid, doc. The SVG paths are in `design/kit.css` (the `.ic-*` data URIs, 24×24 stroke 2). `client.ts` can import `icon()` from `ui-kit.ts`; esbuild bundles it.

**3. Server helpers.** Create `apps/local-guest/src/guest-kit.ts`, pure functions returning HTML strings, every value passed through `escapeHtml`:
- `stayTicketHtml(facts)`, moved from `renderStayTicketHtml` in `guest-server.ts`. It adds the "Check-in"/"Check-out" labels, weekday dates via the existing `formatTicketDate`, and a foot line. Arrival and checkout times appear only when passed in from the policy projection (ADR 0031/0032).
- `priceBreakdownHtml(input)`, moved from `renderPriceBreakdownHtml`. It keeps its variants (condition tag, due, paid, next payment), with order total → deposit → amount line (ADR 0015).
- `deadlineBannerHtml({ label, deadlineIso, now })`: absolute WAT via `formatWAT`, plus time left. The minutes logic already exists in the transfer pages; move it here.
- `stepsHtml(items)`, `statusHtml(tone, text)`, `bankDetailsHtml(...)` (with the copy button from d2dfced), `resultRowHtml(...)`, `stayCardHtml(...)`, `appBarHtml(...)`, `railHtml(journey)`.
- Replace the inline copies in `guest-server.ts` with these helpers. `GUEST_STAY_PAYMENT_STYLE` and other page `style:` strings shrink to layout-only rules or disappear.

## Acceptance criteria

- AC1: `shortlet-foundations.css` defines every kit component listed above using only existing tokens, and no existing hex value changes.
- AC2: Each component's text and background pairs meet WCAG AA contrast in light and dark: 4.5:1, or 3:1 for text 24px and larger. Extend the contrast assertions in `test/shortlet-design-system.test.ts`.
- AC3: `ui-kit.ts` `icon()` renders each new icon name as a decorative, `aria-hidden` inline SVG.
- AC4: Every `guest-kit.ts` helper escapes its text. A test passes `<script>` in each string field and finds it escaped.
- AC5: The existing conventional pages render through the helpers with unchanged text content. The existing tests in `guest-conventional-booking-pages`, `guest-payment-choice` and `manual-transfer-with-receipt` pass unmodified, except for class-name updates.
- AC6: Pill components use `--radius-pill`, never `--radius-round` (keep the assertion added in d2dfced).

## ADR compliance

0015 (breakdown order), 0031/0032 (times only from the projection), 0078 (contrast, 44px, focus ring), 0075 (no URLs with secrets in helpers).

## Comments
