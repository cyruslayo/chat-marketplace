# Unit detail on `shortlet-discovery/v1`

Status: resolved
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

### Implementation (18 Nov 2026, branch `claude/wonderful-thompson-iicglk`, based on `main` at `f241ada`)

- **Catalogue** (`apps/web-agent/src/shortlet-catalogs.ts`): `shortlet-discovery/v1` keeps every Basic component unchanged and adds `UnitDetail`, `UnitGallery`, `UnitDetailSheet` and `UnitActionBar`. Each has `additionalProperties: false` and is listed in `anyComponent`. `UnitDetail` is the root: `gallery`, `sheet` and `actionBar` are `ComponentId` slots, `amenities` and `supporting` are `ChildList` slots, so Weaver renders the Basic children and the root needs no DOM search (the "Root" option in What to build). `shortlet-booking/v1` is unchanged (issue 04).
- **Renderers** (`apps/local-guest/src/shortlet-renderers.ts`, `createShortletRenderers({ resourcePolicy })`, registered by `createShortletWebRuntime`): draw guest-kit markup only (`unitLocationHtml`, `unitTitleHtml`, `unitTilesHtml`, `breakdownHtml`, `unitAboutHtml`, `demoListingChipHtml`, `buildListingGallery`). Photo URLs pass the same host resource policy as Basic `Image`; a refused URL is dropped, and with no approved photo the labelled fallback group renders. The action bar adds `unit-actions` to the Basic Row node Weaver rendered, so the buttons keep their events.
- **Builder** (`apps/web-agent/src/unit-detail-a2ui.ts`): creates the surface on `SHORTLET_DISCOVERY_CATALOG_ID` and emits the typed components from `unitTiles`, `unitStayTotalLabel`, `formatNgnKobo` and `extendedStayUnitFacts`. Amenities, the inspection caption, the disclosure and the action Row stay Basic.
- **Kit** (`guest-kit.ts`): `unitLocationHtml` is now the one source for the where line; the standalone page calls it too (its HTML is byte-identical, checked below). `unitTitleHtml` is the chat sheet's `h2.unit-detail-title`.
- **Client** (`client.ts`): `organizeUnitDetail`, `UNIT_TILE_FACTS` and their dispatch are deleted (202 lines); `dist/client.js` rebuilt. The shell CSS in `guest-server.ts` targets `.unit-detail-title` and `.unit-detail-about-heading` instead of `h2[data-a2ui-component]`.
- **Test harnesses**: `local-guest-weaver-demo`, `shortlet-assistant-evals`, `guest-browser-restart` and `guest-cross-tab-concurrency` simulated the guest browser with a Basic-only `createBasicWebRuntime`. They now use `createShortletWebRuntime`, the runtime `client.ts` mounts, so they keep testing what the guest runs. A Basic-only client still rejects shortlet surfaces (AC5 of issue 03, unchanged).

### Deliberate presentation differences (owner to confirm)

1. The chat sheet's location line is a `p.unit-detail-location` like the standalone page, so it is no longer italic (Basic `small` styling). The title, tiles, breakdown, about, amenities, captions and action bar are byte-identical to the organizer output (diff below).
2. The demo listing chip leads the chat sheet, as on the standalone page. The organizer replaced the caption in place and then moved it, with the leftover captions, into `.unit-supporting-info` at the bottom.
3. With no photos, "No property photos are available yet." is a body-size `p.unit-photo-missing` instead of Weaver's 0.8em caption, so it reads slightly larger (compare `screenshots/weaver-05/chat-unit-light-1280.png` with the `f241ada` capture).

### Parity evidence

- `npx tsx .scratch/weaver-catalogues/dump-unit-detail.ts` (real Chromium, inspection stage) before and after: the only differences are the root, the no-photos text, the location and the title losing Weaver's Basic inline styles and `data-a2ui-component` hooks, and the thread id.
- `renderConventionalUnitDetailHtml` output for every fixture unit (with photos and the demo chip) is byte-identical to `f241ada`, and `dist/gallery.js` is unchanged (AC6).

### ADR compliance

| ADR | Constraint | Where it is met |
| --- | --- | --- |
| 0073 | Compile-time schemas; no agent HTML, executable renderers, hidden controls or automatic submission. | Schemas are static in `shortlet-catalogs.ts`; renderers escape every value; the only action is the existing Request to Book / Back to results Basic Buttons. |
| 0074 | Never silently omit meaning; stale clients fail closed. | The builder decides every section, so a missing fact cannot leave a half-built sheet (AC4). A client without these renderers rejects the surface and shows the server `textFallback` and conventional route, which are built from the unit record, not from A2UI. |
| 0075 | Validated typed properties only; never execute agent content; strict media policy. | `additionalProperties: false` everywhere (AC5); escaping test with an injected `<img onerror>`; refused photo URLs never reach the DOM (AC3). |
| 0077 | Channels never recalculate prices. | `total`, `totalLabel`, `deposit` and the Extended Stay lines are server-formatted strings. |
| 0078 | 44px targets, 320px reflow. | AC2 (`guest-unit-detail-consistency-chromium` AC4) and AC8 captures. |
| 0079 / 0081 | Renderer changes need replay, parity, safe rejection and rollback. | DOM diff and page byte-diff above; the whole change is one commit, so `git revert` restores the organizer path. |
| 0080 | No-JS page unchanged. | Byte-identical page HTML; AC6 green. |
| 0102 | Typed components on the approved discovery ID; kit markup only. | As above. |

### Other changes the new contract needed

- `test/fixtures/guest-shell-pre-agent-modes.html`: the two retargeted unit sheet selectors (the snapshot otherwise unchanged; `agent-mode-shell` and `agent-mode-follows-task` AC4).
- `test/fixtures/assistant-recordings/search-refinement-request-draft.json`: re-recorded offline (`node --import tsx scripts/record-assistant-journey.ts`, scripted model, no provider). The only diff is the unit detail turn's component types.
- `scripts/pilot-agent-smoke.ts` and `scripts/assistant-preflight.ts` mounted surfaces on a Basic-only runtime; both now use `createShortletWebRuntime`. The preflight makes live provider calls, so it was typechecked, not run.
- Updated tests that read the old Text facts: `guest-unit-detail-consistency` AC2/AC3 (props), `demo-monthly-prices-and-periods` AC1/AC6 (`UnitDetailSheet.extended` and `demo`), `listing-photos-presentation` AC16 (`UnitGallery.photos`), `shortlet-catalog-validation` AC2 (discovery is Basic plus the four typed components). The quoted Old Ikoyi fixture moved to `test/helpers/unit-detail-fixture.ts`.

### Validation (18 Nov 2026, Linux container, Chromium 1243 via `SHORTLET_CHROME_PATH`, `SHORTLET_CHROME_NO_SANDBOX=1`)

- `npm run check`: clean. `npm run build`: client bundle rebuilt.
- Focused: `npx tsx --test test/weaver-unit-detail-catalogue.test.ts test/shortlet-catalog-validation.test.ts test/guest-unit-detail-consistency.test.ts test/demo-monthly-prices-and-periods.test.ts test/listing-photos-presentation.test.ts test/unit-detail-artifact.test.ts test/weaver-dependency-boundary.test.ts test/weaver-web-host.test.ts test/local-guest-weaver-demo.test.ts test/shortlet-assistant-evals.test.ts test/guest-browser-restart.test.ts test/guest-cross-tab-concurrency.test.ts`: 134 passed, 0 failed.
- Real Chrome, one file at a time: `guest-unit-detail-consistency-chromium` 3/3 (unchanged; AC1, AC2, AC6), `unit-detail-old-ikoyi-chromium` 1/1, `guest-split-workspace-chromium` 4/4, `guest-final-acceptance-chromium` 3/3, `guest-focused-phone-shell-chromium` 7/7, `guest-discovery-consistency-chromium` 9/9, `guest-image-layout-chromium` 2/2, `discovery-phase3-chromium` 1/1, `guest-compare-chromium` 2/2, `guest-journey-rail-chromium` 1/1, `guest-real-browser-cross-tab` 14/14, `mobile-guest-journey-chromium` 43/43, `listing-gallery-chromium` 5/6.
- The `listing-gallery-chromium` failure is "AC3 (keyboard)" on the standalone page, whose HTML and `gallery.js` are byte-identical to `f241ada`. It is a smooth-scroll timing flake: at `f241ada` it failed 1 of 7 solo runs, and on this branch 1 of 2.
- Full `npm test`: phase 1 3510 passed, 1 failed; phase 2 47 of 51 files passed. Every failure was triaged solo against `f241ada`:
  - environment, fails identically at `f241ada`: `assistant-recording-clients` (Windows junction case, `ENOTDIR` on Linux) and `paystack-real-browser` (`ERR_TUNNEL_CONNECTION_FAILED`, no network in the container);
  - known accepted (AGENTS.md): `commerce-store-pages.real-browser`, `commerce-surfaces-chromium`;
  - load flake, passes solo here and at `f241ada`: `guest-new-conversation-chromium`;
  - caused by this issue and fixed before the commit (re-run green): `agent-mode-shell` / `agent-mode-follows-task` AC4 (shell snapshot), `assistant-recorded-journeys` (recording), `pilot-agent-smoke-reference` (Basic-only smoke runtime). After the fixes, `npm run test:non-browser`: 3510 passed, 1 failed (the junction case above).
- AC8: `npx tsx .scratch/guest-ui-consistency/capture-11.ts chat-unit` and `unit-page`: no horizontal overflow and no control under 44px at 320, 390, 768 and 1280, light and dark. Captures and findings in `screenshots/weaver-05/`.

### Definition of Done

1. AC1, AC2 and AC6: `guest-unit-detail-consistency-chromium` AC1, AC4 and AC5, unchanged. AC3: three tests in `weaver-unit-detail-catalogue.test.ts` (no photos, an unsafe URL, every URL refused). AC4: "a unit missing a tile fact still renders every fact it has". AC5: "Weaver catalogues 05 AC5" in `shortlet-catalog-validation.test.ts`. AC7: "client.ts no longer defines organizeUnitDetail or UNIT_TILE_FACTS". AC8: the captures above.
2. Failure paths: refused and missing photos, a missing bedroom count, seven invalid `UnitDetailSheet` shapes, and injected markup.
3. ADRs 0066, 0073, 0074, 0075, 0077, 0078, 0079, 0080, 0081 and 0102 read; constraints in the table above.
4. No new class or injected dependency; `createShortletRenderers` uses its only option.
5. No new policy string, amount or identifier. The component names are the ones this issue specifies, and all copy comes from existing helpers.
6. No credential or identity material in logs or telemetry; no logging added.
7. `npm run check` clean; the full suite's remaining failures are the environment, accepted and flake cases above, none caused by this issue.
- 18 Nov 2026 (owner decision, ADR 0108): amended. Build this issue's components in the Surface Catalogue Library format, after phase 1 of `.scratch/surface-catalogue-library/` (blocked by its issue 05). Each component is a Surface Component in `packages/surface-kit` (Tier 1 or Tier 2), or a stays-only Tier 3 component if the commerce paper check fails. It is exposed in the shortlet manifest under the name this issue and ADR 0102 approved (alias). Its renderer comes from `rendererRegistrationsFor`, not a hand-written `SHORTLET_RENDERERS` entry. Acceptance criteria are otherwise unchanged; the issue is re-scoped when phase 1 lands.
- 25 Nov 2026: this issue is resolved on main. The comment above arrived with ADR 0108 (app-expansion D1) and describes the planned order; the typed components landed first. Reconciliation: `.scratch/app-expansion/issues/02-reconcile-surface-kit.md`.
