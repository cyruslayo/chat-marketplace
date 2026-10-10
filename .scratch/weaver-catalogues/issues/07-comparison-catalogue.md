# Comparison on `shortlet-discovery/v1`

Status: ready-for-agent
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
