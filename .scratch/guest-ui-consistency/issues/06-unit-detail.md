# Unit detail parity (chat and page)

Status: ready-for-agent
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

## Comments
