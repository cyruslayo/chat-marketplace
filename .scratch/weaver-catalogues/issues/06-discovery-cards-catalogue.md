# Discovery cards on `shortlet-discovery/v1`

Status: resolved
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

### Implementation (18 Nov 2026, branch `claude/wonderful-thompson-iicglk`, after 05 at `01054b4`)

- **Catalogue** (`shortlet-catalogs.ts`): `shortlet-discovery/v1` adds `StayCard` and `StayResults` (`additionalProperties: false`, listed in `anyComponent`).
  - `StayCard` props: `unitId`, `title`, `where`, `facts` (`{ icon: bed | bath | users, text }`, at least one), `total`, `totalLabel`, optional `deposit`, `photoUrl`, `photoCount`, `demo`. Required: `unitId`, `title`, `where`, `facts`, `total`, `totalLabel` (AC5).
  - `StayCard` child slots: `view` and `compare` (the existing Basic Buttons, so `shortlet.discovery.view-unit` and `shortlet.discovery.compare` are unchanged), `fit` and `notes` (Basic caption Texts).
  - `StayResults`: `rows` (`{ unitId, title, total, totalLabel, photoUrl? }`, at least one) and the `cards` ChildList.
- **Deviation from the spec, deliberately:** the spec lists `fit?` as a prop. The fit reason and the card's other server-worded lines (amenity highlights, Extended Stay monthly price and utilities, the ADR 0015/0016 budget note) are kept as Basic `Text` children in the `fit` and `notes` slots instead. Their wording stays on the server, their DOM is byte-identical to before, and the spec did not name the other lines at all (the decorator kept them as "extras"). `photo?: { url, alt }` became `photoUrl`, because the kit names the photo "Photo of <title>" itself and an `alt` prop would go unused.
- **Renderers** (`shortlet-renderers.ts`): `StayCard` builds `stayCardInnerHtml` in an `article.stay-card.ui-stay-card[role=listitem][data-unit-id]`, swaps the kit's View link for Weaver's View button (`ui-button ui-button--primary ui-button--block ui-stay-card__view`), makes the title link click it (the `href` stays `/stays/<unitId>`), puts `fit` (with `stay-card__fit`) and `notes` after the facts, and appends `compare` (`stay-card__compare ui-link`). `StayResults` renders `div.stay-results` (`display: contents`, so layout is unchanged) holding `.ui-result-rows` from `resultRowPartsHtml` (each row opens the card whose `data-unit-id` equals its `unitId`), "See both side by side" for exactly two rows, and `.stay-grid[role=list]`. Card and row photos pass the host resource policy.
- **"See both side by side"** is an `onCompareBoth` option on `createShortletWebRuntime` (and `createShortletRenderers`); `client.ts` passes `compareBoth`. A host without it gets no link, never a dead control.
- **Builder** (`discovery-a2ui.ts`): `unitComponents` emits `StayCard` and its Basic children and returns the result row; `discoveryArtifactToA2UI` emits `StayResults` on `SHORTLET_DISCOVERY_CATALOG_ID`. The empty search keeps a Basic Column and its "No stays match" guidance. The Divider, title, where, facts, photo, photo count, price, deposit and demo caption Texts are gone. `compareArtifactToA2UI` is unchanged (issue 07).
- **Client** (`client.ts`): `decorateDiscoveryCards`, `viewUnitIds`, `factIcon`, `openStayFrom` and the now-unused `isMoney` and `isPriceLabel` are deleted (about 210 lines). The generic presentation pass adds `guest-action` only to Weaver Basic Buttons (`button[data-a2ui-component="Button"]`). Before, the organizers added their kit buttons after that pass, so this keeps "See both side by side" and the gallery's "Show all" (issue 05) in their kit style.
- **Shell CSS** (`guest-server.ts`): `.stay-results { display: contents; }`, also in the `guest-shell-pre-agent-modes.html` snapshot.
- **Tests**: `test/helpers/chrome-devtools.ts` `clickButton` and the harnesses in `local-guest-weaver-demo` and `guest-cross-tab-concurrency` find a stay by `.ui-stay-card` as well as Basic `Card` (comparison still uses Card). `discovery-a2ui` AC1–AC13 run on the discovery catalogue and read the card facts from `StayCard` props; AC10 now asserts the shortlet ID. `guest-budget` AC9/AC10, `guest-discovery-consistency` "Photo count" (AC4, now `photoCount`), `listing-photos-presentation` AC13 (`photoUrl`), `local-guest-weaver-demo` AC5 and reset (StayCard titles) and `weaver-web-host` AC2 (the kit leads with the amount, then its label) read the props. All five assistant recordings re-recorded offline; the only diff is `Card`/`Divider` → `StayCard`/`StayResults` in the component types.

### Deliberate presentation differences (owner to confirm)

1. The chat card is now exactly the search page's card: it loses Weaver's inline Card styling (16px padding, 8px radius and drop shadow), which used to override the kit's `.ui-stay-card` padding and radius.
2. A stay with no photo shows only the kit's "Photos not available" box. The decorator also left Weaver's "No property photos are available yet." caption under the facts, and with the demo flag a "Demo listing" caption beside the kit chip; both duplicates are gone.

### Parity evidence

`npx tsx .scratch/weaver-catalogues/dump-discovery.ts` (real Chromium, 390px, two-result Lagos search and one-result Ikoyi search) before and after: the differences are the `display: contents` wrapper, the grid and cards losing Weaver's Column/Card inline styles (`article` instead of `div`, plus `data-unit-id`), the removed duplicate caption, and class order on the Weaver buttons. Rows, the "both" link (same classes), the kit card markup, the fit and note captions and the Weaver buttons and their accessible names are unchanged.
- After the first full run, three more tests read the old shape and were updated: `demo-listing-chip` AC5 (the card's `demo` prop, which draws the kit chip), and `weaver-web-agent-adapter` AC2/AC10 and `web-agent-default-adapter` AC4, which validated on a Basic-only Weaver Core and now register `SHORTLET_DISCOVERY_CATALOG`. `weaver-web-host` AC4 (issue 01's largest-fixture budget check, this issue's AC6) now also asserts the surface uses `StayResults` and `StayCard`.

### Validation (18 Nov 2026, Linux container, Chromium 1243)

- `npm run check`: clean. `npm run build`: client bundle rebuilt.
- Focused (28 files: every discovery, budget, compare, photo, catalogue, harness, recording and shell-snapshot test): 279 passed, 0 failed. New: `test/weaver-discovery-cards-catalogue.test.ts`, 10 tests.
- Real Chrome, one file at a time: `guest-discovery-consistency-chromium` 9/9 (unchanged; AC1, AC2, AC3 including the "both" link with one stay already picked), `discovery-phase3-chromium` 1/1, `guest-discovery-reasons-chromium` 1/1, `guest-compare-chromium` 2/2, `guest-final-acceptance-chromium` 3/3 (all four unchanged, as required), `agent-mode-lane-cache-chromium` 3/3, `guest-confirmation-system-chromium` 3/3, `guest-container-queries-chromium` 3/3, `guest-focused-phone-shell-chromium` 7/7, `guest-journey-rail-chromium` 1/1, `guest-new-conversation-chromium` 2/2, `guest-split-workspace-chromium` 4/4, `guest-task-rail-chromium` 1/1, `landing-page-chromium` 43/43, `listing-photos-mobile-chromium` 3/3, `unit-detail-old-ikoyi-chromium` 1/1, `guest-unit-detail-consistency-chromium` 3/3, `guest-real-browser-cross-tab` 14/14, `mobile-guest-journey-chromium` 43/43.
- Full `npm test`: phase 2 48 of 51 files passed; the three failures are the AGENTS.md accepted commerce files and `paystack-real-browser` (no network in the container; it fails identically at `f241ada`). Phase 1 had the junction case (environment, fails at `f241ada`) plus the three tests above, fixed; then `npm run test:non-browser`: 3521 passed, 1 failed (the junction case).
- AC8: `capture-11.ts chat-results` and `search-page`: no horizontal overflow and no control under 44px at 320, 390, 768 and 1280, light and dark; captures and findings in `screenshots/weaver-06/`. Compared with the `f241ada` capture, the desktop card has the kit's radius and padding and no duplicate no-photos caption; at 390px the result row shows and the grid is hidden.

### ADR compliance

| ADR | Constraint | Where it is met |
| --- | --- | --- |
| 0073 / 0075 | Typed props, allow-listed actions only, resource policy on photos. | Schemas with `additionalProperties: false` (AC5 test rejects a missing `unitId` or `total`, an extra `href`, a negative count and malformed rows); the view and compare events are the unchanged Basic Buttons; card and row photos pass the host policy and a refused URL appears nowhere (AC4 test); titles are escaped (injection test). |
| 0074 | Never silently omit meaning. | Every server caption line is kept in the `fit` and `notes` slots; the removed lines duplicated the kit's photo box and demo chip. A stale client rejects the typed surface and shows the server text fallback and route. |
| 0077 | Totals formatted on the server; no client ranking or price logic. | `total`, `totalLabel` and `deposit` are server strings; order is the artifact's. |
| 0078 | 44px targets, 320px reflow. | AC8 captures. |
| 0080 | Conventional `/stays/search` unchanged; cards keep a real `href`. | The search page is not touched; card titles and rows link to `/stays/<unitId>`. |
| 0102 | Typed components on the approved discovery ID; kit markup only. | As above. |

### Definition of Done

1. AC1: `guest-discovery-consistency-chromium` AC1 (unchanged) and two tests in `weaver-discovery-cards-catalogue`. AC2: "each result row opens the matching unit's detail, also with the results in reversed order". AC3: three tests (two results and the handler, three results or no handler, Compare's event). AC4: the photo-count and policy test plus `guest-discovery-consistency` "Photo count" (now `photoCount`). AC5: "Weaver catalogues 06 AC5" in `shortlet-catalog-validation`. AC6: `weaver-web-host` AC4. AC7: the source test. AC8: the captures.
2. Failure paths: refused photos, three results, no handler, an empty search, eight invalid component shapes, injected markup.
3. ADRs 0066, 0073, 0074, 0075, 0077, 0078, 0080, 0081 and 0102 read; constraints above.
4. `onCompareBoth` is used by the renderer; no other new dependency.
5. No new policy string, amount or identifier: the component names are the spec's, all copy comes from existing helpers, and "See both side by side" is the existing label.
6. No logging added; no credential or identity material.
7. `npm run check` clean; remaining suite failures are the environment and accepted cases above.
- 18 Nov 2026 (owner decision, ADR 0108): amended. Build this issue's components in the Surface Catalogue Library format, after phase 1 of `.scratch/surface-catalogue-library/` (blocked by its issue 05). Each component is a Surface Component in `packages/surface-kit` (Tier 1 or Tier 2), or a stays-only Tier 3 component if the commerce paper check fails. It is exposed in the shortlet manifest under the name this issue and ADR 0102 approved (alias). Its renderer comes from `rendererRegistrationsFor`, not a hand-written `SHORTLET_RENDERERS` entry. Acceptance criteria are otherwise unchanged; the issue is re-scoped when phase 1 lands.
- 25 Nov 2026: this issue is resolved on main. The comment above arrived with ADR 0108 (app-expansion D1) and describes the planned order; the typed components landed first. Reconciliation: `.scratch/app-expansion/issues/02-reconcile-surface-kit.md`.
