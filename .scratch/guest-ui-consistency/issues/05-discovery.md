# Discovery: one stay card, compact result rows, compare

Status: resolved
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

## Answer

Landed on `ui/guest-consistency`.

- **One stay card (AC1).** `guest-kit.ts` `stayCardInnerHtml` and `stayCardPartsHtml` draw the card per the design: photo (or "Photos not available"), place with a pin, serif title link, fact chips (bedrooms, bathrooms, Sleeps), the money figure with "All-In Stay Total for N nights", "+ ₦x Refundable Security Deposit (separate)", and View apartment. The search page uses it. In the chat, `decorateDiscoveryCards` puts the same inner markup inside Weaver's own Card element (so `.stay-card`, the card's Weaver buttons and events survive), then moves the fit reason, amenity line and budget note under the facts and the Compare button to the end. The discovery builder now says "Where: <neighbourhood>, <city>" (label added to `GUEST_FACT_LABELS`), drops the "Entire Place" chip and the "For N nights · all-in" line, and puts the nights in the price label, so chat and page share every string.
- **Compact rows (AC2).** Phones show one `.ui-result-row` per result (thumb, title, ₦ total, "All-In Stay Total for N nights", chevron) for the inline results; the cards open with "See all results" (focused surface). A row sends the card's existing view-unit event, so 4557ff1's behaviour (display-order ordinals, the "which one?" quick replies) is untouched and still points at the same results. Without JavaScript a row is a link to `/stays/<id>`. "See both side by side" (two or more results) picks the first two like the two Compare buttons, so the server opens the comparison. Wide screens hide the rows and show the cards two per row.
- **Search page.** Title "N apartments in <area>", criteria chips (area, dates and nights, guests, dashed Budget) linking to the form, which is now a section with `id="change-search"`. Same fields and validation; "Back to your conversation" is unchanged.
- **Compare (AC4).** A table with the stays as columns; rows All-In Stay Total, Refundable Security Deposit (separate), Where, Bedrooms, Bathrooms, Sleeps; a View button per stay (the server accepts the same view-unit event from the current comparison). It stacks, with each cell naming its stay, below 30rem. The old "Capacity" and "Amenities" rows are gone (they are on the stay card and the unit page).
- **Tests.** New `test/guest-discovery-consistency.test.ts` (AC3 on the page: order, no rating or badge or map, neighbourhood only, no-referrer photos; AC5: chips, form and plain View link without JS, 400 on an unknown area) and `test/guest-discovery-consistency-chromium.test.ts` (AC1 page vs workspace card, HTML-equal; AC2 rows open the stay, and the empty state shows no rows; AC4 columns, rows, View, no sideways scroll at 320px; AC5 with JavaScript off). Updated for the new wording or layout only: discovery-a2ui, guest-budget, guest-compare (rows), guest-conventional-search, guest-criteria-strip, weaver-web-host, discovery-phase3-chromium, guest-compare-chromium, guest-discovery-reasons-chromium (rows on phones, two-up on wide), listing-photos-mobile-chromium (opens the card via See all results; counts visible images), the shared `helpers/guest-browser.ts` and one wait in guest-new-conversation-chromium.
- **Verification.** `npm run check` clean. `npm test` phase 1 1202/1202; phase 2 (real Chrome) 133 pass; the only failure in the last full run was the known-flaky `guest-new-conversation-chromium` AC1, which passes alone (`pilot-local` was fixed and passes 44/44).

## Comments

- **Deviations, please review.** (1) The "1 / N" photo count on the card is not shown: the chat's discovery card carries only the primary photo, so the count would differ between chat and page. (2) The rows sit in the workspace under the transcript (where the inline results already live), not inside a transcript bubble. (3) The row price caption is "All-In Stay Total for N nights" (a glossary term) instead of the design's "all-in · N nights". (4) Guest-visible Compare on phones is only via "See both side by side" for the first two results; the per-card Compare button is reachable via "See all results".
- **Flaky under load.** `guest-new-conversation-chromium` AC1 failed in two full runs (line 35, waiting for the confirm) and passes alone; it failed the same way on the merged base in issue 01's first run.
- ADRs: 0015 (money figure and label precede the deposit everywhere), 0066 (no rating, badge or map; neighbourhood only), 0075 (photos keep `referrerpolicy="no-referrer"`), 0078, 0080 (rows and View are links without JS), 0073/0081 (Basic Catalog unchanged; organizer only rearranges).
- **Follow-up on deviations 1 and 4 (29 Sept 2026).** (1) The "1 / N" photo count now shows. The discovery builder adds a "Photos: N" caption (label `GUEST_FACT_LABELS.photos`) when a stay has two or more photos. The chat organizer turns it into the badge, and the search page passes `photoCount` from the same `photoUrls`. Both draw it through `stayCardInnerHtml` (`.ui-stay-card__media` / `.ui-stay-card__count`), so the parity holds. Screen readers hear "N photos". One photo or none: no badge. (4) "See both side by side" now shows only for exactly two results; with three or more, "See all results" leads to each stay's Compare. If one of the two stays is already picked, only the other is picked; before, the first was clicked again, which removed it and left the guest with nothing. If the comparison doesn't open within 10 s, the conversation says so and points to See all results. The Compare labels come from `GUEST_COMPARE_LABELS`. Tests: 3 in `guest-discovery-consistency.test.ts` and 3 in `guest-discovery-consistency-chromium.test.ts`. Deviations 2 and 3 are unchanged: 2 needs a follow-up check in a long conversation, and 3 needs a decision on the caption wording for issues 06 to 09.
