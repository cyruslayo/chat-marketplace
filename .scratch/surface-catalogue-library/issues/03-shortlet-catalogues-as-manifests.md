# Shortlet catalogues as manifests, byte-identical

Status: resolved
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

- Commands run (worktree `chat-marketplace-surface-kit`, every command with `env -u LLM_API_KEY`):
  - `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/shortlet-catalogue-manifests.test.ts test/shortlet-catalog-validation.test.ts test/weaver-web-host.test.ts test/local-guest-weaver-demo.test.ts test/render-*-weaver-a2ui.test.ts test/commerce-switch-catalogues.test.ts test/weaver-dependency-boundary.test.ts test/apartment-commerce-free-closure.test.ts`: 95 tests, 95 pass, 0 fail. `test/shortlet-catalog-validation.test.ts` is unchanged (its AC1–AC5 pass with unchanged expectations).
  - `npm run check`: clean.
- **Baseline captured before the change.** `test/fixtures/catalogues/urn-chat-marketplace-shortlet-discovery-v1.json` and `...-booking-v1.json` were written from the previous `shortletCatalog()` output, using `canonicalJson` (new, in `packages/surface-kit/src/canonical.ts`, with `catalogueSnapshotSlug`), before `shortlet-catalogs.ts` was edited. Issue 05 reuses both helpers. The test strips CR when it reads a fixture, because this checkout has `core.autocrlf=true` and a Windows working copy may hold CRLF; the serialized schema is compared byte for byte after that.
- **Which builders use the shortlet ids: none.** Every `*-a2ui.ts` builder and `apps/local-guest/src/shortlet-app.ts:5124` create surfaces under `A2UI_V091_BASIC_CATALOG_ID` (only `commerce-presentation.ts` uses the commerce ids). The four files that reference the shortlet ids are `shortlet-catalogs.ts`, `shortlet-runtime.ts`, `validate-shortlet-messages.ts` and `index.ts`. So both manifests have `actions: []`: the issue allows only names emitted on surfaces with these ids, and no name may be invented. **Open for the owner:** if the intent was to allow-list the names builders emit under the Basic id, say so; that needs a decision on which names belong to which catalogue. AC3 is not vacuous: it walks the real guest stages, buckets every surface by its `createSurface.catalogId` and checks that any name emitted under a shortlet id is in that manifest's list, and it checks every manifest name against the `*_EVENT` constants the guest packages export (the ActionSpec names and presentation events). Today the buckets are empty; the test bites when a builder moves to these ids.
- `defineShortletCatalog` and `shortletCatalog()` are removed (no test or source imports them; `apps/local-guest/dist/client.js` still holds the old bundle text until issue 04 rebuilds it).
- `dist/client.js` was not rebuilt in this issue: the PRD lists only issues 02 and 04 for the client rebuild and the Chrome test, and the composed schemas are byte-identical, so the bundle's behaviour is unchanged. Issue 04 rebuilds it and runs `test/weaver-failure-chromium.test.ts`.
- `shortlet-catalogs.ts` imports the library and the schema adapter, not Weaver, so the AC7 pairing scan still finds only the two adapters.
- Definition of Done: AC1–AC5 each have a dedicated named test. The failure path in AC3 (a name outside the list fails) and AC4 (an unknown component still fails closed) are asserted. No invented policy string, copy or action name. ADR 0102, 0108, 0072/0099, 0079 are reflected.

## Answer

`shortlet-catalogs.ts` declares `SHORTLET_DISCOVERY_MANIFEST` and `SHORTLET_BOOKING_MANIFEST` and derives the two catalogue registrations and `SHORTLET_COMPOSED_CATALOGUES` from them. The composed schemas serialize byte-identically to the baselines captured before the change. Both manifests have an empty `actions` list because no builder emits under a shortlet id today (open question recorded above).
