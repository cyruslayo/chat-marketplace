# Unit detail on `shortlet-discovery/v1`

Status: ready-for-agent
Type: task
Blocked by: 03
Requested: 6 Oct 2026

## Why

`unitDetailArtifactToA2UI` (`apps/web-agent/src/unit-detail-a2ui.ts`) emits one flat Basic Column: photos, title, location, the `Bedrooms: …`, `Bathrooms: …` and `Sleeps: …` Texts, the price label and price, the deposit, "About this apartment" with its description, amenities, captions and an actions Row.

`organizeUnitDetail` (`client.ts`, around line 268) then rebuilds it into a gallery, a `.unit-detail-sheet`, `.unit-amenities`, `.unit-supporting-info` and `.ui-action-bar.unit-action-bar`. It finds the pieces by:
- label (`findFact`, `UNIT_TILE_FACTS`)
- tag (the first non-money `H2`, the money `H2`, the first `SMALL`)
- exact text (`"About this apartment"`, `"Amenities"`)

It also aborts silently if a tile fact is missing.

## What to build

- **Components** in `SHORTLET_DISCOVERY_CATALOG`:
  - `UnitGallery { title, photos: [{ url, alt }] }` renders through `buildListingGallery` (`apps/local-guest/src/listing-gallery.ts`). With no photos, it renders the existing `div.unit-gallery.unit-gallery--fallback[role=group][aria-label="Property photos"]` with the "No property photos are available yet." text. Photo URLs pass through the same `safeImageResourceUrl` resource policy as Basic `Image`, and an unsafe URL is dropped, never rendered.
  - `UnitDetailSheet { where, title, tiles: [{ icon: "bed" | "bath" | "users", text }], breakdown?: <PriceBreakdown props>, about? }` renders `section.unit-detail-sheet[aria-label="Stay details"]` through `unitTilesHtml`, `breakdownHtml` and `unitAboutHtml`, matching the standalone `/stays/:id` page exactly.
  - `UnitActionBar { total, totalLabel }`, with `child` set to the Basic actions Row, renders `div.ui-action-bar.unit-action-bar`: `p.ui-action-bar__sum`, then the Row with class `unit-actions`. The Row's Weaver buttons keep their events.
- **Root.** The surface's root Column gets `.unit-detail-root`, either from the builder through a root wrapper component or through the existing kind-based hook. Pick the one that needs no DOM search. Amenities and the supporting captions (inspection, disclosure) stay as Basic components, grouped into `.unit-amenities` and `.unit-supporting-info` containers that the builder emits.
- **Builder.** `unit-detail-a2ui.ts` emits these components, built from the same `unitTiles` and `unitStayTotalLabel` helpers the page uses (`booking-presentation.ts`). It switches to `SHORTLET_DISCOVERY_CATALOG`.
- **Client.** Delete `organizeUnitDetail`, `UNIT_TILE_FACTS` and their dispatch, and rebuild `dist/client.js`.

## Acceptance criteria

- **AC1:** In the chat, `.unit-detail-sheet .ui-tiles`, `.unit-detail-about-heading`, `.unit-detail-description`, `.unit-detail-sheet .ui-price-breakdown` and the action bar equal the standalone page's. `guest-unit-detail-consistency-chromium` AC1 stays green **without changing its expectations**.
- **AC2:** At 320 and 390px the action bar is visible and its buttons are at least 44px (`guest-unit-detail-consistency-chromium` AC4, unchanged).
- **AC3:** A unit with no photos renders the fallback gallery group with the no-photos text. A unit with an unsafe photo URL renders no `<img>` for it. Both are happy-dom tests.
- **AC4:** A unit missing a tile fact, such as no bathrooms, still renders every fact it has. The surface is never left half-organized, because the builder decides the tiles and the client does not.
- **AC5:** The surface validates against `SHORTLET_DISCOVERY_CATALOG`, and invalid `UnitDetailSheet` props are rejected. Extend `test/shortlet-catalog-validation.test.ts`.
- **AC6:** The no-JS unit page is unchanged: `guest-unit-detail-consistency-chromium` AC5 stays green.
- **AC7:** `client.ts` no longer defines `organizeUnitDetail` or `UNIT_TILE_FACTS`.
- **AC8:** Unit detail captures (chat and page) at 320, 390, 768 and 1280 go in `screenshots/weaver-05/`, with no overflow and no target under 44px.

## Tests to update

`guest-unit-detail-consistency.test.ts` asserts props instead of fact Texts. `unit-detail-old-ikoyi-chromium`, `guest-split-workspace-chromium` and `guest-final-acceptance-chromium` stay green unchanged.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0073 / 0075 | Typed props; compile-time schema; strict resource policy for images. | AC3, AC5 |
| 0074 | Never silently omit meaning. | AC4 |
| 0077 | Price strings formatted on the server. | `UnitDetailSheet.breakdown`, `UnitActionBar.total` |
| 0078 | 44px targets, 320px reflow. | AC2, AC8 |
| 0080 | The no-JS page is unchanged. | AC6 |

## Comments
