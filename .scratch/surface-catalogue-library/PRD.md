# PRD: Surface Catalogue Library, phase 1 (skeleton, pure refactor)

Status: ready-for-agent
Requested: 18 Nov 2026
Decision: ADR 0108 (accepted 18 Nov 2026). Analysis and the accepted decisions: `analysis.md`.

## Problem

Every domain catalogue is a hand-made clone of the Weaver Basic Catalog:
- `apps/web-agent/src/shortlet-catalogs.ts`
- `apps/web-agent/src/commerce-catalogs.ts`

Three further problems:
- **No shared definition.** There is no way to define a component once and use it in several catalogues.
- **Two registries.** The platform `CatalogueRegistry` and the Weaver runtime are fed separately, with different id schemes.
- **A hard-coded flag.** Commerce catalogues are switched on by a `{ commerce }` boolean in `createShortletWebRuntime`.

weaver-catalogues 04–07 are about to add the first typed components. Without the library, they will build them in a shape every later domain has to copy or undo.

## Goal

After phase 1:
- A Weaver-free library, `packages/surface-kit`, can define a Surface Component and a Catalogue Manifest, and compose a manifest into one self-contained A2UI v0.9.1 schema.
- Thin Weaver adapters turn a composed manifest into a `CatalogRegistration` and its renderer registrations.
- The shortlet discovery and booking catalogues are declared as manifests. Their composed schemas are **byte-identical** to today's.
- Both the Weaver runtime and the platform `CatalogueRegistry` take their catalogue set from the same list of composed catalogues. The `{ commerce }` flag is gone.
- A snapshot gate classifies every change to a composed catalogue as identical, additive or breaking, and fails a breaking change that keeps the same catalogue major.
- A test-only Surface Component (`ProbeCard`) proves the whole path:
  - an aliased custom component registers;
  - it validates strictly;
  - it renders through its kit markup helper;
  - it dispatches an action;
  - it falls back to text on a stale runtime.

**No guest-visible change.** No production manifest uses a custom component yet. The first ones arrive in phase 2 (weaver-catalogues 04–07, amended).

## Module layout (ADR 0081, ADR 0099)

| Module | Holds | May import |
| --- | --- | --- |
| `packages/surface-kit/src/` | `defineSurfaceComponent`, `defineCatalogueManifest`, `composeCatalogueSchema(manifest, baseSchema)`, `classifyCatalogueChange`, `catalogueIds(composed)`, types | nothing outside itself (no `domains/*`, `apps/*` or `@cylayo/weaver-*`) |
| `apps/web-agent/src/catalogues/weaver-catalogues.ts` | `composeWeaverCatalogue(manifest)`, which supplies the Basic schema from `createBasicCatalogV091Registration()` and returns a `CatalogRegistration` plus the component list. `basicEquivalentCatalogue(registration)` wraps an existing Basic-clone registration such as commerce's. | `@cylayo/weaver-core`, surface-kit. No DOM. |
| `apps/local-guest/src/catalogue-renderers.ts` | `rendererRegistrationsFor(composed, resourcePolicy)`: the Basic renderers under the catalogue id, plus one renderer per alias, which parses the component's `html(props)` through a `<template>` | `@cylayo/weaver-web`, surface-kit |
| `apps/web-agent/src/shortlet-catalogs.ts` | The shortlet manifests (namespace constant unchanged) and the derived `SHORTLET_DISCOVERY_CATALOG` / `SHORTLET_BOOKING_CATALOG` exports, so callers do not change | surface-kit, the adapter |
| `test/fixtures/surface-kit/` | `ProbeCard` (test-only Surface Component) and its fixtures | surface-kit |

The analysis placed the renderer adapter in `apps/web-agent/src/catalogues/`. It moves to `apps/local-guest` because renderers need the DOM, and `apps/web-agent` must stay safe on both server and client (weaver-catalogues 03).

## Decisions taken in this PRD (within ADR 0108)

| Topic | Decision |
| --- | --- |
| Props type | Written beside the schema; a type-level test keeps them equal (analysis decision 1). No schema-to-type generator dependency. |
| Slot narrowing | A manifest's slot choice is `required`, `optional` or `absent` per optional property. `absent` removes the property from `properties`, so `additionalProperties: false` rejects it. `required` adds it to `required`. Naming a property that is not optional in the component throws at definition time. |
| Names | Aliases are PascalCase. They must not be `Surface`, a Basic Catalog component name, or start with `a2ui` (A2UI reservations). Manifest ids match `urn:chat-marketplace:<namespace>/<name>/v<major>`. |
| Commerce | `commerce-catalogs.ts` is **not edited** (ADR 0104; no new commerce work). The runtime factory receives commerce catalogues only through `basicEquivalentCatalogue`, and only where a test passes them explicitly. |
| Legacy short ids | `APPROVED_CATALOGUES` in `packages/platform-core/src/surface.ts` stays as the no-argument default. It has no production caller (only tests construct `GenerativeSurfaceManager`). Phase 1 adds `catalogueIds(composed)` so a host can register URN ids; retiring the short ids is left for phase 3. |
| Snapshot updates | A test fails on drift. Snapshots are rewritten only when `UPDATE_CATALOGUE_SNAPSHOTS=1` is set, and a breaking classification can never be written under an unchanged id major. |

## Out of scope

- Any typed production component. That is phase 2: weaver-catalogues 04–07, built in this library format.
- Platform components and `platform-common/v1` (phase 3).
- The second-domain fixture pack with modes and cold restore (phase 4).
- Splitting `apps/web-agent/src` into per-domain folders, and the cross-pack import test that depends on it (phase 2).
- The glossary-leak lint over real Tier 1 and Tier 2 schemas. Phase 1 ships the lint and proves it on a fixture; it bites once components exist.
- Editing commerce code, A2UI v1.0, MCP Apps, and per-pack lazy renderers.

## ADR compliance

| ADR | Constraint | Applies to |
| --- | --- | --- |
| 0108 | One definition per component. Manifests compose at build time. One registration source. Strict versioning with a snapshot gate. | All issues |
| 0081 | No Weaver types in `domains/*`, `packages/platform-core` or `packages/surface-kit`. | 01 (boundary test), 02 |
| 0073 | Exact, owner-approved ids only. Compile-time schemas. No dynamic schema. Strict props. | 01, 03, 05 |
| 0102 | Shortlet ids live in one namespace constant (`shortlet-catalog-validation` AC1 source scan). The existing shortlet catalogue behaviour is unchanged. | 03 |
| 0103 / 0104 | Commerce catalogues exist only when commerce is enabled; commerce code is untouched. | 04 |
| 0074 | An unknown catalogue or component fails closed to text plus a conventional route. | 02 (ProbeCard stale runtime), 05 |
| 0075 | Props are validated and every value is escaped by the kit helper. | 02 |
| 0077 | Components hold no copy and compute nothing. | 01 (definition rules), 02 (ProbeCard) |
| 0079 | Pure refactor with byte-identical output, and replay of existing fixtures. Each issue is a revertible commit. | 03, 04, 05 |
| 0099 | Packs declare and the platform composes. No pack imports another. | 03, 04 |

## Test scope

Per issue, run `npm run check` plus the issue's own and affected tests (AGENTS.md "Test scope"), and record the commands and counts in the issue's `## Comments`.

- Issues that rebuild `apps/local-guest/dist/client.js` (02 and 04) also run `test/weaver-failure-chromium.test.ts` solo.
- The full `npm test` and `npm run test:workers` run once, after 05, before any merge to main.
