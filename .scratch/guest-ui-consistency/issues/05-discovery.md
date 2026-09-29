# Discovery: one stay card, compact result rows, compare

Status: ready-for-agent
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

The stay is drawn three ways today: the chat workspace card (`decorateDiscoveryCards` over Weaver `Card`s, `.stay-card*`), the search page card (`renderConventionalSearchHtml`, `.stay-result`), and the compare rows (`decorateComparison`). The design has one stay card, one compact result row, and one compare table.

## What to build

- **Stay card.** `.ui-stay-card` (from `stayCardHtml` in `guest-kit.ts`) on the search page and in the chat workspace (via the organizer):
  - photo 4:3 with the "1 / N" count, the neighbourhood line with a pin icon, the serif title link, fact chips with icons (bedrooms, bathrooms, sleeps)
  - then the price area: All-In Stay Total for N nights, "+ deposit (separate)" line, "View apartment"
  - keep the "Why it fits" caption (issue 11 of guest-chat-first-ux) and the Compare control (13b)
- **Compact result row** (`design/ChatResults`). On phones the transcript shows each result as a `.ui-result-row` (thumb, title, all-in total, chevron) that opens the stay.
  - Reconcile with how 4557ff1 already opens results from chat (see issue 01's Answer): **present** its behaviour in this layout; don't change it.
  - "See both side by side" opens compare when there are two or more results.
- **Search page** (`design/Search`):
  - title "N apartments in <area>" and the criteria chips (area, dates, guests, `--add` Budget). Each chip links to the search form, which stays available without JavaScript as a `<details>` or a separate section; keep the existing form fields and validation
  - the stay cards; "Back to your conversation"
- **Compare** (`design/Compare`): a table with the stays as columns and attribute rows (All-In Stay Total, deposit, where, bedrooms, bathrooms, sleeps), a "View" link per stay, and a readable stacked layout at 320px (issue 13b AC3).
- **Wide screens:** stay cards two per row in the workspace (`design/DesktopDiscovery`).

## Acceptance criteria

- AC1: The search page and the chat workspace render each stay with the same `.ui-stay-card` structure and text for the same search. Parity test.
- AC2: In the chat transcript, each discovery result appears as a compact result row with the title and All-In Stay Total, and activating it opens that stay. Real Chromium. Failure path: with no results, the existing empty state shows and no rows render.
- AC3: The All-In Stay Total precedes the deposit in every card and row. There's no rating, "Verified" badge or price-pin map, and the location is neighbourhood-level only (ADR 0015, 0066).
- AC4: Compare shows one column per stay with the listed rows, and stacks without sideways scroll at 320px.
- AC5: Without JavaScript, the search page's cards, chips and search form work, and "View apartment" opens the unit page.

## Tests to update

`guest-conventional-search.test.ts`, `discovery-phase3-chromium.test.ts`, `guest-discovery-reasons-chromium.test.ts`, `guest-compare-chromium.test.ts`, `guest-split-workspace-chromium.test.ts`, `guest-budget.test.ts`.

## ADR compliance

0015, 0066, 0075 (no-referrer photos), 0078, 0080, 0073/0081.

## Comments
