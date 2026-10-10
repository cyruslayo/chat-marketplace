# Discovery cards on `shortlet-discovery/v1`

Status: ready-for-agent
Type: task
Blocked by: 03
Requested: 6 Oct 2026

## Why

`discoveryArtifactToA2UI` and `unitComponents` (`apps/web-agent/src/discovery-a2ui.ts`) emit each stay as a Basic `Card` containing a Column of Texts:
- `Where: …`
- the facts line
- `Why it fits: …`
- `Photos: N`
- the price label and price
- the deposit

followed by the View and Compare Buttons.

`decorateDiscoveryCards` (`client.ts`, around line 787) then:
- recovers the unit ids by scanning the payload for `shortlet.discovery.view-unit` actions (`viewUnitIds`), matched to cards **by index**
- finds each fact by label or tag
- replaces the card with `stayCardInnerHtml`
- builds the `.ui-result-rows` phone list and the "See both side by side" link

## What to build

- **Components** in `SHORTLET_DISCOVERY_CATALOG`:
  - `StayCard { unitId, title, where, facts: [{ icon, text }], totalLabel, total, deposit?, fit?, photo?: { url, alt }, photoCount? }` mirrors `StayCardParts` in `guest-kit.ts`. Its children are `view` (a Basic Button, primary, with action `shortlet.discovery.view-unit`) and an optional `compare` (a Basic Button). The renderer:
    - builds `stayCardInnerHtml(parts)`
    - puts the Weaver `view` button where the kit's `.ui-stay-card__view` anchor is, with classes `ui-button ui-button--primary ui-button--block ui-stay-card__view`
    - makes the title link open the stay through that button
    - appends `compare` with `stay-card__compare ui-link`

    The `href` stays `/stays/<unitId>`, for no-JS and open-in-new-tab. The photo URL goes through the resource policy.
  - `StayResults { rows: [<StayCard parts>] }`. Its children are the StayCard list. It renders:
    - `div.ui-result-rows[role=list][aria-label="Stays for your search"]`, built from `resultRowPartsHtml`, where each row opens its stay through the card whose `unitId` matches (not by index or label)
    - the `.stay-grid[role=list][aria-label="Stay search results"]` of cards, each `role=listitem`
    - "See both side by side" (`button.ui-link.ui-result-rows__compare`) when there are exactly two rows, calling the existing `compareBoth()`. Expose it through a callback option on `createShortletWebRuntime`, not a global.
- **Builder.** `unitComponents` and `discoveryArtifactToA2UI` emit `StayResults` and `StayCard`, building parts with the guest-kit `stayCardParts` or an equivalent shared helper, so the search page and the chat share one source. They switch to `SHORTLET_DISCOVERY_CATALOG`. The empty-results surface ("No stays match…") stays Basic Text.
- **Client.** Delete `decorateDiscoveryCards`, `viewUnitIds` and the fact matching for `Where`, `Why it fits` and `Photos`, and rebuild `dist/client.js`. `compareBoth` keeps working off `.ui-stay-card .stay-card__compare`.

## Acceptance criteria

- **AC1:** The chat card's `.ui-stay-card__photo`, `__where`, `__title`, `__facts`, `__total`, view text and classes deep-equal the search page card's, `.stay-card__fit` exists, and the total label comes before the deposit. `guest-discovery-consistency-chromium` AC1 stays green **unchanged**.
- **AC2:** At 390px the result rows are visible and the grid hidden, and clicking a row opens the matching unit's detail. With two results in reversed order, the row still opens the right unit, which proves `unitId` matching.
- **AC3:** Exactly two results show "See both side by side" and it opens the comparison, including when one stay is already picked. Three or more results show no "both" link. The existing tests at lines 156 and 172 of `guest-discovery-consistency-chromium` stay green.
- **AC4:** The photo count shows only when the unit has two or more photos (`ui-stay-card__count`). Retarget the `discovery-a2ui` Photos AC to the `photoCount` prop.
- **AC5:** Discovery surfaces validate against `SHORTLET_DISCOVERY_CATALOG`, and a `StayCard` without `unitId` or `total` is rejected. Extend `test/shortlet-catalog-validation.test.ts`.
- **AC6:** The largest discovery result set still resolves within Weaver's default budgets. Retarget issue 01's AC4 fixture to the new components.
- **AC7:** `client.ts` no longer defines `decorateDiscoveryCards` or `viewUnitIds`.
- **AC8:** Discovery captures (chat and search page) at 320, 390, 768 and 1280 go in `screenshots/weaver-06/`, with no overflow and no target under 44px.

## Tests to update

`discovery-a2ui.test.ts`: the ACs asserting the Basic Catalog id or the `Where:` and `Photos:` Texts move to the props. `discovery-phase3-chromium`, `guest-discovery-reasons-chromium`, `guest-compare-chromium`, `guest-final-acceptance-chromium` and `discovery-interactions` stay green unchanged.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0073 / 0075 | Typed props; allow-listed actions only (the view and compare events unchanged); resource policy on photos. | AC5; Basic Button children keep the existing actions |
| 0077 | Totals formatted on the server; no client ranking or price logic. | `StayCard.total` |
| 0078 | 44px targets, 320px reflow. | AC8 |
| 0080 | Conventional `/stays/search` unchanged; cards keep a real `href`. | AC1 |

## Comments
