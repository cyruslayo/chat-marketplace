# Unit detail parity (chat and page)

Status: resolved
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

48831b0 gave the full apartment page (`renderConventionalUnitDetailHtml`) a hero, an overlapping sheet and an action bar, and the chat's detail (`organizeUnitDetail`) was partly aligned. The design (`design/UnitDetail`) adds facility tiles and, when dates are known, the quoted price breakdown. Both surfaces should match it.

## What to build

- Keep the gallery (`listing-gallery.ts`) exactly as it is.
- **Sheet:** neighbourhood line ("exact address after payment"), serif title, `.ui-tiles` with icons (bedrooms, bathrooms, sleeps N), then the price:
  - **quoted** (the chat has dates and party): a `.ui-price-breakdown` with the All-In Stay Total for the dates and the deposit line
  - **not quoted** (the public page without dates): the indicative nightly rate, labelled "Price per night (indicative) · dates not yet quoted", as today (ADR 0015)
- Then "About this apartment" and the provider line ("Provided by …, your accommodation provider", only where the domain names one, ADR 0006).
- **Action bar:** the quoted total or indicative nightly rate, plus "Request to book" (the chat) or "Continue to Request to Book" (the page). Keep today's action and route.

## Acceptance criteria

- AC1: The chat's unit detail and the full page render the same sheet structure (tiles, price block, about, action bar) for the same apartment. Parity test.
- AC2: With a quote, the price block shows the All-In Stay Total for the dates before the deposit. Without one, it shows only the labelled indicative nightly rate. Both paths are tested.
- AC3: The tiles show bedrooms, bathrooms and capacity from the unit record. A missing bedroom count shows "Not provided", as today.
- AC4: The action bar stays visible at 320px and 390px without covering the last content, and its button is at least 44px (real Chromium).
- AC5: Without JavaScript, the page shows every photo and the action works (the existing gallery AC4 still passes).

## Tests to update

`unit-detail-old-ikoyi-chromium.test.ts`, `listing-gallery*.test.ts`, `listing-photos-mobile-chromium.test.ts`.

## ADR compliance

0015, 0066, 0006, 0075, 0078, 0080.

## Answer

Landed on `ui/guest-consistency`.

- **One sheet, both surfaces (AC1).** The page (`renderConventionalUnitDetailHtml`) and the chat (`organizeUnitDetail`) now build the same `.unit-detail-sheet`: the where line (`<neighbourhood>, <city> · exact address after payment`, pin icon), the serif title, the facility `.ui-tiles`, the price block, then "About this apartment" and the description. The page emits it server-side; the chat finds the Weaver pieces through the label table and rebuilds them with the same kit helpers (`unitTilesHtml`, `unitIndicativePriceHtml`/`breakdownHtml`, `unitAboutHtml`), keeping the gallery, amenities, supporting facts and action bar around it. `wrapDirectChildren` and the old `.unit-overview`/`.unit-facts--chips`/`.unit-price-*` rules are gone; the kit CSS (`.ui-tiles`, `.ui-price-breakdown`) does the styling. The chat is **quoted** (dates known) and the public `/stays/:id` is **indicative** (no dates), so the price block is present in both but differs by design — the tiles, about and action bar are HTML-identical (AC1 compares those three).
- **Quoted vs indicative (AC2).** In the chat, the builder labels the total with `unitStayTotalLabel(stayDates, nights)` → "All-In Stay Total · 10–13 Sept 2026 · 3 nights" and puts the deposit after it; there is no second amount line. On the page, `unitIndicativePriceHtml(nightlyKobo)` renders "Price per night (indicative)" with "per night · dates not yet quoted" and no all-in total. Both labellings come from existing copy (ADR 0015).
- **Tiles from the unit record (AC3).** `unitTiles(bedrooms, bathrooms, capacity)` returns bed/bath/users tiles; a missing bedroom count reads "Not provided" and its singular/plural (bathroom/bathrooms) comes from the record.
- **Action bar (AC4).** Unchanged behaviour: quoted total / indicative rate plus "Request to Book" (chat) or "Continue to Request to Book" (page). The chat's bar keeps `.ui-action-bar__sum`.
- **No JavaScript (AC5).** The page still shows every gallery photo and the request action is a working link; the gallery AC4 keeps passing.
- **Tests.** New `test/guest-unit-detail-consistency.test.ts` (AC2 quoted builder + indicative page; AC3 helper, builder fixture and page) and `test/guest-unit-detail-consistency-chromium.test.ts` (AC1 real-Chromium chat-vs-page sheet parity; AC4 action bar at 320/390, ≥44px, no covering, no sideways scroll; AC5 with JavaScript off). Updated for class/wording only: `discovery-phase3-chromium`, `listing-gallery`, `listing-photos-presentation`, `listing-photos-mobile-chromium`, `unit-detail-old-ikoyi-chromium`, and `local-guest-weaver-demo` (deposit label).
- **Verification.** `npm run check` clean. `npm test` with `NODE_ENV=test`: non-browser phase 1207/1207; real-Chromium phase 145 tests, 144 pass, 1 skipped (the pre-existing `SHORTLET_FOUNDATIONS_BROWSER` opt-in), 0 failures. The earlier full-suite hang was `local-guest-weaver-demo` reading the old "Refundable Security Deposit: " wording (now the shared "(separate)" label); the file passes alone and in the suite.

## Comments

- **Deviations, please review.** (1) The unit-detail sheet **omits the provider line**: ADR 0006 names the provider only where the contract can form, and the unit-detail sheet is before Request to Book (user decision for this issue). (2) The "About this apartment" heading is an `h2` in both surfaces, but the page's title is the `h1` and the chat's title is an `h2`, so the heading hierarchy differs slightly between the two. (3) The chat unit detail **dropped** the old `stay-dates`, `nightly-rate`, `fees` and `amount-due` Text lines — the new sheet shows one price block (total + separate deposit) as the design does.
- **Deposit label.** The unit detail now uses the shared `GUEST_FACT_LABELS.refundableSecurityDeposit` ("Refundable Security Deposit (separate)") on the chat, the page and the offer surface, so the wording is consistent with issue 04's contract and the design.
- **Updated tests.** The class/structure and wording assertions in `discovery-phase3-chromium`, `listing-gallery`, `listing-photos-presentation`, `listing-photos-mobile-chromium`, `unit-detail-old-ikoyi-chromium` and `local-guest-weaver-demo` changed only to match the new kit markup and the shared deposit label.
- **ADR compliance.** 0015 (All-In Stay Total leads, deposit separate and labelled; indicative rate qualified when dates are unknown), 0066 (where line is neighbourhood-level, "exact address after payment"; no rating/badge/map), 0006 (no provider line on the sheet), 0075 (gallery untouched, no identifiers in URLs or logs), 0078 (44px action button, 320px reflow, no sideways scroll — AC4), 0080 (no-JS parity — AC5).
- **Pre-flight.** PR #96 (`ui/editorial-refinement` → `main`) is still **OPEN, unmerged** (`mergeStateStatus: CLEAN`), so no rebase was done; work stayed on `ui/guest-consistency` (plan pre-flight step 1).
- **Screenshots.** `.scratch/guest-ui-consistency/screenshots/06/` — `unit-chat-*` (chat workspace) and `unit-page-*` (public `/stays/unit-lagos-ikoyi-001`) at 320/390/768/1280, light scheme, no horizontal overflow.
