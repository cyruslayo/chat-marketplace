# Comparison on `shortlet-discovery/v1`

Status: resolved
Type: task
Blocked by: 06
Requested: 6 Oct 2026

## Why

`compareArtifactToA2UI` (`apps/web-agent/src/discovery-a2ui.ts`, around line 389) emits:
- an `H3` attribute label followed by a `Row` of per-stay Columns, repeated for each attribute
- a final `Row` of action buttons

`decorateComparison` (`client.ts`, around line 977) infers the table from DOM position:
- an attribute row is a `Row` whose previous sibling is an `H3`
- a column head is the first `small` in the first row's cells

It then rebuilds the result into `.ui-compare[role=table]`. This issue is blocked by 06 because both edit `discovery-a2ui.ts` and the discovery renderers.

## What to build

- **Component** in `SHORTLET_DISCOVERY_CATALOG`: `StayComparison { heads: [string], rows: [{ key, cells: [{ value, unit? }] }] }`. Its children are the per-stay action buttons: Basic Buttons with the existing view and pick actions.

  The renderer produces exactly today's structure:
  - `div.ui-compare[role=table][aria-label="Compare stays"]`
  - a head row `ui-compare__row compare-row ui-compare__row--head`, containing an empty `columnheader` and one `ui-compare__head[role=columnheader]` per stay
  - per attribute, a `ui-compare__row compare-row`, containing:
    - the key as `ui-compare__key[role=rowheader]`
    - one `ui-compare__cell compare-cell[role=cell]` per stay, with the unit in `small.compare-cell__unit`
  - an actions row `ui-compare__row--actions`, containing the button children in `ui-compare__cell`

  Build it with DOM APIs, or add a `compareTableHtml` helper to `guest-kit.ts` if the standalone compare page should share it. Check whether a standalone compare page exists first, and reuse its markup source if it does.
- **Builder and client.** `compareArtifactToA2UI` emits `StayComparison` on `SHORTLET_DISCOVERY_CATALOG`, with all values formatted on the server. Delete `decorateComparison` and its dispatch, and rebuild `dist/client.js`.

## Acceptance criteria

- **AC1:** The comparison renders as a table with the stays as columns and one row per attribute, and as a stacked list on narrow screens. `guest-discovery-consistency-chromium` AC4 and `guest-compare-chromium` stay green **unchanged**.
- **AC2:** The view and pick buttons in the actions row dispatch the same platform events as before. Record the emitted action names and contexts in a test.
- **AC3:** A comparison where one stay lacks a value for an attribute renders an empty cell in the right column; it never shifts later cells left.
- **AC4:** The surface validates against `SHORTLET_DISCOVERY_CATALOG`, and rows whose `cells` length differs from `heads` are rejected by the builder, which throws before emitting. Extend `test/shortlet-catalog-validation.test.ts`.
- **AC5:** `client.ts` no longer defines `decorateComparison`.
- **AC6:** Compare captures at 320, 390, 768 and 1280 go in `screenshots/weaver-07/`, with no overflow and no target under 44px.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0073 / 0075 | Typed props; allow-listed actions only. | AC2, AC4 |
| 0077 | Values formatted on the server. | `StayComparison.rows` |
| 0078 | Table semantics for assistive technology; 44px; 320px reflow. | AC1, AC6 |

## Comments

### Implementation (18 Nov 2026, branch `claude/wonderful-thompson-iicglk`, after 06 at `5738cb4`)

- **No standalone compare page exists** (`guest-server.ts` has no compare route and `guest-kit.ts` no `.ui-compare` markup), so the renderer builds the table with DOM APIs; the `.ui-compare` styles stay in the kit CSS.
- **Catalogue** (`shortlet-catalogs.ts`): `StayComparison { heads: [string], rows: [{ key, cells: [{ value, unit? }] }], actions? }` on `shortlet-discovery/v1`, `additionalProperties: false` at every level. A cell `value` may be empty (AC3); `actions` is the ChildList of Basic View Buttons.
- **Renderer** (`shortlet-renderers.ts`, `renderStayComparison`): `div.ui-compare[role=table][aria-label="Compare stays"]`; the head row (`ui-compare__row compare-row ui-compare__row--head`, an empty `columnheader`, one `ui-compare__head[role=columnheader]` per stay); per attribute a `ui-compare__row compare-row` with `h3.ui-compare__key[role=rowheader]` and one `compare-cell ui-compare__cell[role=cell]` per head, each with `small.compare-cell__unit` and the value `p`; then `ui-compare__row--actions` with the View Buttons as `ui-compare__cell`. The cell loop runs over the heads, so a short or missing cell is an empty cell in its own column.
- **Builder** (`discovery-a2ui.ts`): `stayComparisonProps(heads, rows)` (exported) throws when any row's cell count differs from the heads, before anything is emitted (AC4). `compareArtifactToA2UI` builds the props from `COMPARE_ATTRIBUTES` (server-formatted values, ADR 0077) and emits one `StayComparison` on `SHORTLET_DISCOVERY_CATALOG_ID`. The heading, context, disclosures and Back to results stay Basic.
- **Client**: `decorateComparison` and its dispatch deleted (about 75 lines); `dist/client.js` rebuilt.
- **Shell CSS** (`guest-server.ts` and the shell snapshot fixture): `.ui-compare__cell > p { margin: 0; }` and `.compare-cell__unit { color: var(--color-text-secondary); }`, which keep the cells as they looked when Weaver's `p` and `small` Text rules styled them.
- **Tests**: `guest-compare` AC2 reads the same facts (row order, one cell per stay, each cell's stay, ADR 0015 price and ADR 0016 deposit) from the `StayComparison` props instead of Basic component ids. `shortlet-catalog-validation` AC2 lists the new component. The assistant recordings re-recorded unchanged (no recorded journey opens a comparison).

### Deliberate presentation difference (owner to confirm)

The row keys ("All-In Stay Total", "Where", ...) were Weaver `h3` Texts, so the shell's `.weaver-mount h3[data-a2ui-component="Text"]` rule (`!important` h3 size and weight) overrode the kit's `.ui-compare__key` (muted metadata size in the 6rem key column). They are now plain `h3.ui-compare__key`, so they render as the kit intends: small and muted. Compare `screenshots/weaver-07/` with the `f241ada` capture.

### Parity evidence

`npx tsx .scratch/weaver-catalogues/dump-compare.ts` (real Chromium, 390px, the two Lagos stays): with Weaver's inline styles and `data-a2ui-component` hooks stripped from the `f241ada` output, the table (head row, row keys, every cell and its stay name, the actions row) is identical; the remaining differences are the still-Basic heading and buttons and the class order on the View buttons.

### Validation (18 Nov 2026, Linux container, Chromium 1243)

- `npm run check`: clean. `npm run build`: client bundle rebuilt.
- Focused (32 files: discovery, compare, budget, photos, catalogue, harness, recordings, adapters, shell snapshot): 308 passed, 0 failed. New: `test/weaver-comparison-catalogue.test.ts`, 6 tests, and "Weaver catalogues 07 AC4" in `shortlet-catalog-validation`.
- Real Chrome, one file at a time: `guest-compare-chromium` 2/2 and `guest-discovery-consistency-chromium` 9/9 (AC1, both unchanged), `guest-container-queries-chromium` 3/3, `guest-final-acceptance-chromium` 3/3, `discovery-phase3-chromium` 1/1, `guest-focused-phone-shell-chromium` 7/7, `guest-split-workspace-chromium` 4/4, `agent-mode-lane-cache-chromium` 3/3, `mobile-guest-journey-chromium` 42/43 in that run: AC15 (touch targets on the discovery results, measured as the results text appears) failed once, passed solo, and the whole file passed 43/43 in the full suite. AGENTS.md lists this file as a load flake.
- Full `npm test`: phase 1 3528 passed, 1 failed (the junction case, environment, fails at `f241ada`); phase 2 48 of 51 files passed (the accepted commerce files and `paystack-real-browser`, no network in the container).
- AC6: `capture-11.ts chat-compare`: no horizontal overflow and no control under 44px at 320, 390, 768 and 1280, light and dark; captures and findings in `screenshots/weaver-07/`. At `f241ada` the 1280px capture shows the keys at h3 size breaking mid-word ("Refunda ble", "Bedroo ms") with the table running past the viewport; after, the table and both View buttons fit, and at 390px the rows stack.

### ADR compliance

| ADR | Constraint | Where it is met |
| --- | --- | --- |
| 0073 / 0075 | Typed props; allow-listed actions only. | Schema with `additionalProperties: false` at every level (six invalid shapes rejected); the only actions are the unchanged Basic View Buttons (AC2 records `shortlet.discovery.view-unit` with `{ artifactId, unitId }`); titles are escaped (injection test). |
| 0074 | Never silently omit meaning. | One cell per head always; a missing value is an empty cell in its own column (AC3); the builder refuses a short row. The `compareFallbackText` text fallback is unchanged. |
| 0077 | Values formatted on the server. | `COMPARE_ATTRIBUTES` values, unchanged. |
| 0078 | Table semantics, 44px, 320px reflow. | `role=table/row/columnheader/rowheader/cell` as before; AC6 captures. |
| 0102 | Typed components on the approved discovery ID; kit styles. | As above. |

### Definition of Done

1. AC1: `guest-compare-chromium` and `guest-discovery-consistency-chromium` AC4 (unchanged) and "AC1: the comparison is a table…". AC2: "the View buttons in the actions row dispatch the same platform events as before". AC3: "a stay without a value…". AC4: "Weaver catalogues 07 AC4". AC5: the source test. AC6: the captures.
2. Failure paths: a short and a long row (builder throws), six invalid schema shapes, an empty value, injected markup.
3. ADRs 0073, 0074, 0075, 0077, 0078, 0081 and 0102 read; constraints above.
4. No new injected dependency.
5. No new policy string or identifier; labels and values come from `COMPARE_ATTRIBUTES`; "Compare stays" is the existing aria-label.
6. No logging added.
7. `npm run check` clean; remaining suite failures are the environment and accepted cases above.
