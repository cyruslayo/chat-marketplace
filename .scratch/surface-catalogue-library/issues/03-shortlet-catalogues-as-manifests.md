# Shortlet catalogues as manifests, byte-identical

Status: ready-for-agent
Type: task
Blocked by: 02
Requested: 18 Nov 2026

## Why

The two approved shortlet catalogues (ADR 0102) are built by `shortletCatalog()` in `apps/web-agent/src/shortlet-catalogs.ts`, a hand-written clone of the Basic schema. Declaring them as Catalogue Manifests is the first real use of the library. It must change nothing on the wire.

## What to build

- **Capture before changing.** Write the current `SHORTLET_DISCOVERY_CATALOG.schema` and `SHORTLET_BOOKING_CATALOG.schema` to `test/fixtures/catalogues/urn-chat-marketplace-shortlet-discovery-v1.json` and `...-booking-v1.json`, as canonical JSON (sorted keys, two-space indent, LF). Commit them with this issue. They are the byte-identity baseline and the first snapshots for issue 05.
- **Manifests.** In `shortlet-catalogs.ts`:
  - Keep `SHORTLET_CATALOG_NAMESPACE`, `SHORTLET_DISCOVERY_CATALOG_ID` and `SHORTLET_BOOKING_CATALOG_ID` exactly as they are. The ADR 0102 source scan (`shortlet-catalog-validation` AC1) must stay green.
  - Add `SHORTLET_DISCOVERY_MANIFEST` and `SHORTLET_BOOKING_MANIFEST` with `owner: "shortlet"`, `base: "basic/v0.9.1"`, `components: {}`.
  - For `actions`, list every action event name that the current builders emit on surfaces with these catalogue ids. Reference the existing exported constants (for example `VIEW_UNIT_EVENT`, `COMPARE_UNIT_EVENT`, `SEE_ALL_DISCOVERY_EVENT` and `COMPARE_BACK_EVENT` in `discovery-a2ui.ts`) rather than retyping strings.
  - Each name must be either a shortlet `ActionSpec` name (consequential, ADR 0072) or a presentation event that changes no domain state.
  - Do not invent any name. If a name is neither, record it in `## Comments` and ask the owner. Do not add a spec.
  - Today most builders emit the Basic Catalog id, not a shortlet id. Find which builders use the shortlet ids, and record the list in `## Comments`.
- **Derived exports.** Re-define `SHORTLET_DISCOVERY_CATALOG` and `SHORTLET_BOOKING_CATALOG` as `composeWeaverCatalogue(manifest).registration`. Export `SHORTLET_COMPOSED_CATALOGUES` (both composed catalogues, in that order). Remove `shortletCatalog()` and `defineShortletCatalog()` once nothing imports them. If a test imports `defineShortletCatalog`, keep it as a deprecated re-export and note that.
- `validate-shortlet-messages.ts` keeps its signature and uses the derived registrations.

## Acceptance criteria

- **AC1:** The composed discovery and booking schemas serialize byte-identically (canonical JSON) to the captured fixtures.
- **AC2:** `shortlet-catalog-validation.test.ts` AC1–AC5 pass with unchanged expectations. In particular, no other source file repeats the literal id strings.
- **AC3:** Every action event name emitted on a surface with a shortlet catalogue id (in the existing builder fixtures) is in that manifest's `actions`. Every name in `actions` is either a shortlet `ActionSpec` name or an exported presentation-event constant. A name that is neither fails the test.
- **AC4:** Every existing builder output that uses a shortlet catalogue id still validates (`validateShortletMessages`, fixtures unchanged).
- **AC5:** `shortletCatalog()` is gone. A source scan finds no `structuredClone(...basic...schema)` construction of a shortlet catalogue outside the library adapter.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0102 | Exact approved ids from one constant; behaviour unchanged | AC1, AC2 |
| 0108 | Catalogues are declared as manifests and composed | AC1, AC5 |
| 0072 / 0099 | Manifest actions ⊆ pack `ActionSpec` names ∪ pack presentation events | AC3 |
| 0079 | Byte-identical refactor; replay of existing fixtures | AC1, AC4 |

## Comments

- Affected tests: `test/shortlet-catalog-validation.test.ts`, `test/weaver-web-host.test.ts`, `test/local-guest-weaver-demo.test.ts`, the `test/render-*-weaver-a2ui.test.ts` files that use shortlet ids, and `test/surface-kit*.test.ts`.
