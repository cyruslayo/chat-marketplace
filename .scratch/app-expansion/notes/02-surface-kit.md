# Surface Catalogue Library Reconciliation (Issue 02)

Date: **26 Nov 2026**
Worktree: `C:\AI2026\chat-marketplace-ae-02` (branch `feat/app-expansion-02`, from `feat/app-expansion` at `c167137`)
Compared against: `feat/surface-kit-phase-1` (`5367de7`), merge-base `78135f7`
Weaver versions: `0.3.1` on `feat/app-expansion` (`d1d5955`) vs `0.2.1` on `feat/surface-kit-phase-1`

---

## Executive summary

1. **All 9 typed shortlet components on `feat/app-expansion` fit `defineSurfaceComponent` unchanged** and compose through `composeCatalogueSchema` to schemas **100% byte-identical** (`canonicalJson`) to the live wire schemas on `feat/app-expansion`.
2. **Weaver `0.3.1` vs `0.2.1` introduces zero Basic Catalog schema drift** (`Basic schema 0.3.1 === 0.2.1 snapshot? true`); `CatalogDefinition` in `0.3.1` extends `CatalogRegistration`.
3. **Transitioning from `feat/surface-kit-phase-1`'s empty-component snapshots to `feat/app-expansion`'s 9 typed components classifies as `additive`** (`classifyCatalogueChange`), never `breaking` — zero major version bump, zero new catalogue ID, and zero impact on stored or open chats.
4. **Three semantic/adapter gaps exist** beyond git's 14 direct conflicts:
   - `weaver-catalogues.ts` must return Weaver `0.3.1` `CatalogDefinition` (`defineCatalog(asCatalogSchema(...))`).
   - `catalogue-renderers.ts` (`renderAlias`) only wraps flat `html(props)` + `[data-surface-action]` and cannot yet express Weaver `input.relationships` (`ComponentId` / `ChildList`), `BasicResourcePolicy` image gating + `buildListingGallery`, or `onCompareBoth`.
   - `SHORTLET_DISCOVERY_MANIFEST` and `SHORTLET_BOOKING_MANIFEST` need the 9 components (as **Tier 3** on `v1`) and the 16 action event names actively emitted by the 8 shortlet builders.
5. **Recommended path:** **staged cherry-pick (skipping duplicate doc commit `69c9ac4`) + targeted reconciliation** across 5 revertible steps (grouped into Follow-ups A, B, C), keeping `feat/surface-kit-phase-1` unmerged/archived.
6. **Round-12 chat components:** Only `StayCard` (already on `shortlet-discovery/v1`) and future `ChatCard` (kit-only in `2b-06`, later Tier 3 on `shortlet-booking/v1`) belong to A2UI Surface Catalogues; `ChatMessage`, `Composer`, `CriteriaChip`, `ConciergeChooser`, `DomainTag`, and `SwitchDivider` are shell/platform chrome (ADR 0106/0107). Neither `2b-05` nor `2b-06` needs to wait for Follow-ups A–C to land in code.

---

## ADR compliance

| ADR | Constraint | Effect on reconciliation / round-12 mapping |
| --- | --- | --- |
| 0073 | Closed, versioned catalogues; exact owner-approved IDs; no new ID without approval; breaking changes require a new major | Keep `urn:chat-marketplace:shortlet/discovery/v1` and `urn:chat-marketplace:shortlet/booking/v1` byte-identical; no new catalogue ID for round-12 components |
| 0074 | Complete text fallback and fail-closed stale-client degradation | Every wrapped component supplies a complete `text(props)` fallback; `ChatCard` helper pairs `chatCardHtml` + `chatCardText` |
| 0075 | Escaped props; no executable markup; image URLs gated by `BasicResourcePolicy` | Adapter must forward `resourcePolicy` to image-bearing custom components (`UnitGallery`, `StayCard`, `StayResults`) |
| 0077 | No hardcoded copy or calculations in shared components | Shared helpers take formatted strings/copy via props from `guest-content.ts` |
| 0078 | WCAG 2.2 AA, 44px targets, 320px reflow | Ported CSS/kit helpers preserve targets and reflow; verified in `2b-04`/`2b-05`/`2b-06` captures |
| 0079 | Replayable, revertible steps | Staged cherry-pick keeps each step revertible and preserves replay fixture wire bytes |
| 0080 | Deterministic chat/page parity via shared kit helpers | `StayTicket`, `PriceBreakdown`, `StayCard`, `UnitDetailSheet`, `ChatCard` share `guest-kit.ts` helpers |
| 0081 | No Weaver types in `packages/surface-kit`, `domains/*`, `packages/platform-core` | Weaver 0.3.1 `defineCatalog` and DOM relationship/policy hooks stay strictly in the two adapter modules (`weaver-catalogues.ts`, `catalogue-renderers.ts`) |
| 0102 | Approved shortlet discovery/booking catalogue IDs and typed components | All 9 shipped typed components keep their exact `v1` wire names and schemas |
| 0106 | Cold restores keep fail-closed IDs; chip edits are structured guest input; no new state in library | `CriteriaChip` stays shell chrome feeding `assistantContext`; reconciliation adds no surface IDs or stored state |
| 0107 | Agent Mode controls are shell chrome driven by server `mode`/`modeChange`; `--mode-*` tokens only | `ConciergeChooser`, `DomainTag`, `SwitchDivider`, `ChatMessage`, `Composer` stay platform shell chrome, not Weaver components |
| 0108 | Four tiers (Tier 3→2 only on second real domain); manifest composition; one registration source; snapshot gate | All 9 existing components start as Tier 3 on `v1` (byte-identical); `ChatCard` starts kit-only in `2b-06` and Tier 3 when first emitted as A2UI |

---

## 1. Audit of all typed components on `feat/app-expansion` (AC1)

Note on component count: issue 02's problem statement named 6 top-level components, while `apps/web-agent/src/shortlet-catalogs.ts` defines **9** typed components (7 in `shortlet-discovery/v1`, 2 in `shortlet-booking/v1`). All 9 carry `id`, `component`, `accessibility` (`common_types.json#/$defs/AccessibilityAttributes`), `weight` (`number`), and `additionalProperties: false`.

| # | Component & Catalogue | Wire schema (required + optional props, `$ref`s, sub-objects) | Fits `defineSurfaceComponent` unchanged? | What `surface-kit` + `catalogue-renderers.ts` cannot express today | Glossary hits (`findGlossaryTerms`) & Tier on `v1` |
| --- | --- | --- | --- | --- | --- |
| 1 | `UnitDetail` (`shortlet-discovery/v1`) | **Required:** `gallery` (`ComponentId`), `sheet` (`ComponentId`), `amenities` (`ChildList`), `supporting` (`ChildList`), `actionBar` (`ComponentId`). **Optional:** `accessibility`, `weight`. | **Yes** (slots: `accessibility`, `weight`) | **Renderer gap:** consumes Weaver `input.relationships` (`single` + `children`) to compose `<div class="unit-detail-root">` around child Weaver components (`UnitGallery`, `UnitDetailSheet`, Basic amenities/supporting, `UnitActionBar`). `renderAlias` only passes `input.properties` to `html(props)`. | Hits: none. **Tier 3** (orchestrates shortlet `unit-detail-*` classes & relationships). |
| 2 | `UnitGallery` (`shortlet-discovery/v1`) | **Required:** `title` (`string minLength:1`), `photos` (`array` of inline `PHOTO { url, alt }`). **Optional:** `accessibility`, `weight`. | **Yes** (slots: `accessibility`, `weight`) | **Renderer gap:** filters every `photo.url` through host `BasicResourcePolicy` (`approvedImage`), constructs `<img>` elements, and delegates to `buildListingGallery(document, title, images)` (interactive DOM carousel), falling back to `.unit-gallery--fallback`. | Hits: none. **Tier 3** on `v1` (`v2` candidate for Tier 2 gallery if another domain needs it). |
| 3 | `UnitDetailSheet` (`shortlet-discovery/v1`) | **Required:** `where`, `title`, `tiles` (`minItems:1` of inline `TILE { icon: "bed"\|"bath"\|"users", text }`). **Optional:** `accessibility`, `weight`, `demo` (`boolean`), `breakdown` (inline `UNIT_BREAKDOWN { total, totalLabel, deposit? }`), `extended` (`string[]`), `about`. | **Yes** (slots: `accessibility`, `weight`, `demo`, `breakdown`, `extended`, `about`) | **None in renderer** (renders purely via `guest-kit.ts` helpers: `demoListingChipHtml`, `unitLocationHtml`, `unitTitleHtml`, `unitTilesHtml`, `breakdownHtml`, `unitAboutHtml`, plus `.unit-detail-extended`). Keep `TILE` and `UNIT_BREAKDOWN` inline in schema for `v1` byte-identity. | Hits: `enum:bed`, `enum:bath`, `property:deposit`, `property:extended`. **Tier 3** (domain terms in `v1` schema). |
| 4 | `UnitActionBar` (`shortlet-discovery/v1`) | **Required:** `child` (`ComponentId`). **Optional:** `accessibility`, `weight`, `total`, `totalLabel`. | **Yes** (slots: `accessibility`, `weight`, `total`, `totalLabel`) | **Renderer gap:** appends Weaver `single(relationships, "child")` (Basic `Row` of action `Button`s) and adds `.unit-actions` class onto that child element. | Hits: none. **Tier 3** on `v1` (`v2` candidate for Tier 1/2 sticky action bar once decoupled from `child` Weaver relationship or adapter supports relationships). |
| 5 | `StayCard` (`shortlet-discovery/v1`) | **Required:** `unitId`, `title`, `where`, `facts` (`minItems:1` of `TILE`), `total`, `totalLabel`. **Optional:** `accessibility`, `weight`, `demo`, `deposit`, `photoUrl`, `photoCount` (`int >=0`), `view` (`ComponentId`), `compare` (`ComponentId`), `fit` (`ComponentId`), `notes` (`ChildList`). | **Yes** (slots: `accessibility`, `weight`, `demo`, `deposit`, `photoUrl`, `photoCount`, `view`, `compare`, `fit`, `notes`) | **Renderer gap:** requires (a) `resourcePolicy` (`approvedImage`) for `photoUrl`, (b) `relationships` (`view`, `compare`, `fit`, `notes`) to replace `.ui-stay-card__view` and attach `.stay-card__fit`/`.stay-card__compare`, and (c) wiring title `<a href>` click to `view.click()` (`openStayFrom`). | Hits: `property:unitId`, `enum:bed`, `enum:bath`, `property:deposit`. **Tier 3** on `v1` (ADR 0108 phase 2 target: Tier 2 `ResultCard@1` on `v2` after commerce paper check). |
| 6 | `StayResults` (`shortlet-discovery/v1`) | **Required:** `rows` (`minItems:1` of inline `RESULT_ROW { unitId, title, total, totalLabel, photoUrl? }`), `cards` (`ChildList`). **Optional:** `accessibility`, `weight`. | **Yes** (slots: `accessibility`, `weight`) | **Renderer gap:** requires (a) `resourcePolicy` for row thumbs, (b) `relationships` (`cards` child `StayCard` DOM nodes) so each compact row binds `openStayFrom` to its matching `[data-unit-id]` card's `.ui-stay-card__view`, and (c) host `onCompareBoth` callback for the 2-result "See both side by side" button. | Hits: `property:unitId`. **Tier 3** (shortlet result list + `onCompareBoth` host hook). |
| 7 | `StayComparison` (`shortlet-discovery/v1`) | **Required:** `heads` (`string[] minItems:1`), `rows` (`minItems:1` of inline `COMPARE_ROW { key, cells: COMPARE_CELL[] }`). **Optional:** `accessibility`, `weight`, `actions` (`ChildList`). | **Yes** (slots: `accessibility`, `weight`, `actions`) | **Renderer gap:** reads `children(relationships, "actions")` (Weaver View buttons) to populate `.ui-compare__row--actions` and classes each button `.ui-compare__cell`. | Hits: `property:unit`. **Tier 3** on `v1` (Tier 2 `Comparison@1` candidate on `v2` if `unit` prop is generalized). |
| 8 | `StayTicket` (`shortlet-booking/v1`) | **Required:** `title`, `checkIn` (inline `TICKET_DATE { day, date, datetime? }`), `checkOut` (`TICKET_DATE`), `foot`. **Optional:** `accessibility`, `weight`. | **Yes** (slots: `accessibility`, `weight`) | **None in renderer** (renders purely via `ticketHtml(parts)` in `guest-kit.ts`, with zero relationships or `resourcePolicy`). | Hits: `property:checkIn` (`check`), `property:checkOut` (`check`). **Tier 3** on `v1` (ADR 0108 phase 2 target: Tier 2 `CommitmentSummary@1` on `v2`). |
| 9 | `PriceBreakdown` (`shortlet-booking/v1`) | **Required:** none (beyond `id`, `component`). **Optional:** `accessibility`, `weight`, `condition`, `total`, `totalLabel`, `deposit`, `depositCollected` (`boolean`), `due`, `thisPayment`, `paid`, `next`. | **Yes** (slots: `accessibility`, `weight`, `condition`, `total`, `totalLabel`, `deposit`, `depositCollected`, `due`, `thisPayment`, `paid`, `next`) | **None in renderer** (renders purely via `breakdownHtml(parts)` in `guest-kit.ts`, with zero relationships or `resourcePolicy`). | Hits: `property:deposit`, `property:depositCollected`. **Tier 3** on `v1` (ADR 0108 phase 2 target: Tier 1 `MoneyBreakdown@1` on `v2` once `deposit` becomes generic line items). |

### Key findings from the 9-component audit

1. **Schema fit (`defineSurfaceComponent` & `composeCatalogueSchema`):**
   - `define.ts` derives `slots` as every key in `schema.properties` not in `schema.required` and not in `STRUCTURAL_PROPERTIES` (`{"component", "id"}`). Thus `accessibility` and `weight` appear in `def.slots` on every component. Leaving them omitted in `manifest.components[alias].slots` keeps them optional and preserves them verbatim during `composeCatalogueSchema`.
   - Sub-schemas (`TILE`, `UNIT_BREAKDOWN`, `RESULT_ROW`, `COMPARE_CELL`, `COMPARE_ROW`, `PHOTO`, `TICKET_DATE`) are currently inline in each component schema on `feat/app-expansion`. Keeping them inline in `defineSurfaceComponent` (rather than hoisting to root `$defs`) guarantees `v1` schema byte-identity; `defineSurfaceComponent` rejects `$ref`s outside `common_types.json#/$defs/*` and `#/$defs/*`, and all existing `$ref`s (`ComponentId`, `ChildList`, `AccessibilityAttributes`) are in `common_types.json#/$defs/*`.
2. **Renderer adapter gaps (`apps/local-guest/src/catalogue-renderers.ts`):**
   - `renderAlias` today takes `(definition: AnySurfaceComponent, input: WebComponentRenderInput)` and only calls `definition.html(props)` inside `<template>` plus `[data-surface-action]` wiring.
   - Only **3 of 9** components (`StayTicket`, `PriceBreakdown`, `UnitDetailSheet`) fit `renderAlias` as written.
   - The other **6** (`UnitDetail`, `UnitGallery`, `UnitActionBar`, `StayCard`, `StayResults`, `StayComparison`) require Weaver DOM `relationships`, host `BasicResourcePolicy` (`approvedImage`), interactive DOM construction (`buildListingGallery`), or `onCompareBoth`.
   - Extending `catalogue-renderers.ts` (the Weaver adapter layer, NOT `packages/surface-kit`) with an optional per-alias custom renderer hook (`customRenderers?: Readonly<Record<string, (input: WebComponentRenderInput) => Node>>` or a context-aware builder receiving `{ resourcePolicy, onCompareBoth }`) resolves all 6 cleanly while preserving ADR 0081 (no Weaver types in `packages/surface-kit`).
3. **Manifest `actions` allow-list:**
   - `feat/surface-kit-phase-1` set `actions: []` because no builder emitted `SHORTLET_DISCOVERY_CATALOG_ID` or `SHORTLET_BOOKING_CATALOG_ID` yet.
   - On `feat/app-expansion`, 8 builders actively emit those IDs with **16 action event names** that must populate `manifest.actions` (and pass `test/shortlet-catalogue-manifests.test.ts` AC3):
     - **`SHORTLET_DISCOVERY_MANIFEST.actions` (6):** `VIEW_UNIT_EVENT`, `SEE_ALL_DISCOVERY_EVENT`, `COMPARE_UNIT_EVENT`, `COMPARE_BACK_EVENT`, `REQUEST_TO_BOOK_EVENT`, `BACK_TO_RESULTS_EVENT` (from `discovery-a2ui.ts`, `unit-detail-a2ui.ts`).
     - **`SHORTLET_BOOKING_MANIFEST.actions` (10):** `REQUEST_DRAFT_REVIEW_EVENT`, `REQUEST_DRAFT_SUBMIT_EVENT`, `BOOKING_REQUEST_CONFIRM_EVENT`, `BOOKING_REQUEST_DECLINE_EVENT`, `CONDITIONAL_OFFER_ACCEPT_EVENT`, `CARD_PAYMENT_INITIALIZE_CHECKOUT_EVENT`, `CARD_PAYMENT_VERIFY_RETURN_EVENT`, `BANK_TRANSFER_INITIALIZE_EVENT`, `NOTICE_OPEN_EVENT`, `EXTENSION_OPEN_EVENT` (from `request-draft-a2ui.ts`, `booking-request-a2ui.ts`, `conditional-offer-a2ui.ts`, `card-payment-a2ui.ts`, `bank-transfer-a2ui.ts`, `booking-contract-a2ui.ts`).
4. **Tier placement on `v1`:**
   - 6 of 9 components match shortlet glossary terms in wire property or enum names (`unitId`, `unit`, `bed`/`bath`, `deposit`/`depositCollected`, `extended`, `checkIn`/`checkOut`).
   - Under ADR 0108 decision 2, Tier 1 and Tier 2 components must hold no domain vocabulary. To keep `v1` byte-identical, all 9 wrap as **Tier 3** shortlet components now; promoting `StayCard`, `StayTicket`, `PriceBreakdown`, `UnitDetailSheet`, `StayComparison` to Tier 1/2 happens under a later `v2` catalogue after commerce paper checks and ADR 0073 review.

---

## 2. Byte-identity & ADR 0108 decision 6 classification (AC2)

**Claim:** Composing all 9 typed components through `packages/surface-kit` (`defineSurfaceComponent` + `defineCatalogueManifest` + `composeCatalogueSchema`) against Weaver `0.3.1` produces schemas **100% byte-identical** to `feat/app-expansion` (`SHORTLET_DISCOVERY_CATALOG.schema` and `SHORTLET_BOOKING_CATALOG.schema`), and classifies as **`additive`** relative to `feat/surface-kit-phase-1`'s snapshots (`test/fixtures/catalogues/*.json`). Open and stored chats see **zero wire change**.

### Verification commands & verbatim output (run in `C:\AI2026\chat-marketplace-ae-02`)

Command run (`env -u LLM_API_KEY` / `Remove-Item Env:LLM_API_KEY`):

```powershell
Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue
@'
import { execFileSync } from "node:child_process";
import {
  SHORTLET_BOOKING_CATALOG,
  SHORTLET_DISCOVERY_CATALOG,
} from "file:///C:/AI2026/chat-marketplace-ae-02/apps/web-agent/src/shortlet-catalogs.ts";
import {
  canonicalJson,
  classifyCatalogueChange,
  composeCatalogueSchema,
  defineCatalogueManifest,
  defineSurfaceComponent,
  findGlossaryTerms,
} from "file:///C:/AI2026/chat-marketplace-surface-kit/packages/surface-kit/src/index.ts";
import { createBasicCatalogV091Registration } from "file:///C:/AI2026/chat-marketplace-ae-02/node_modules/@cylayo/weaver-core/dist/index.js";
...
'@ | node --import "file:///C:/AI2026/chat-marketplace-ae-02/node_modules/tsx/dist/loader.mjs" --input-type=module
```

Observed output:

```text
Basic schema 0.3.1 === 0.2.1 snapshot? true

=== shortlet-discovery/v1 (7 components: UnitDetail, UnitGallery, UnitDetailSheet, UnitActionBar, StayCard, StayResults, StayComparison) ===
  UnitDetail: defineSurfaceComponent OK | slots=[accessibility, weight] | glossaryHits=none
  UnitGallery: defineSurfaceComponent OK | slots=[accessibility, weight] | glossaryHits=none
  UnitDetailSheet: defineSurfaceComponent OK | slots=[accessibility, weight, demo, breakdown, extended, about] | glossaryHits=enum:bed(bed), enum:bath(bath), property:deposit(deposit), property:extended(extended)
  UnitActionBar: defineSurfaceComponent OK | slots=[accessibility, weight, total, totalLabel] | glossaryHits=none
  StayCard: defineSurfaceComponent OK | slots=[accessibility, weight, demo, deposit, photoUrl, photoCount, view, compare, fit, notes] | glossaryHits=property:unitId(unit), enum:bed(bed), enum:bath(bath), property:deposit(deposit)
  StayResults: defineSurfaceComponent OK | slots=[accessibility, weight] | glossaryHits=property:unitId(unit)
  StayComparison: defineSurfaceComponent OK | slots=[accessibility, weight, actions] | glossaryHits=property:unit(unit)
  composeCatalogueSchema byte-identical to feat/app-expansion? true
  classifyCatalogueChange(sk-snapshot -> ae-schema): kind=additive (14 reasons)
    - /$defs/anyComponent/oneOf/18: alternative appended
    - /$defs/anyComponent/oneOf/19: alternative appended
    - /$defs/anyComponent/oneOf/20: alternative appended
    - /$defs/anyComponent/oneOf/21: alternative appended
    - /$defs/anyComponent/oneOf/22: alternative appended
    - /$defs/anyComponent/oneOf/23: alternative appended
    - /$defs/anyComponent/oneOf/24: alternative appended
    - /components/UnitDetail: component added
    - /components/UnitGallery: component added
    - /components/UnitDetailSheet: component added
    - /components/UnitActionBar: component added
    - /components/StayCard: component added
    - /components/StayResults: component added
    - /components/StayComparison: component added

=== shortlet-booking/v1 (2 components: StayTicket, PriceBreakdown) ===
  StayTicket: defineSurfaceComponent OK | slots=[accessibility, weight] | glossaryHits=property:checkIn(check), property:checkOut(check)
  PriceBreakdown: defineSurfaceComponent OK | slots=[accessibility, weight, condition, total, totalLabel, deposit, depositCollected, due, thisPayment, paid, next] | glossaryHits=property:deposit(deposit), property:depositCollected(deposit)
  composeCatalogueSchema byte-identical to feat/app-expansion? true
  classifyCatalogueChange(sk-snapshot -> ae-schema): kind=additive (4 reasons)
    - /$defs/anyComponent/oneOf/18: alternative appended
    - /$defs/anyComponent/oneOf/19: alternative appended
    - /components/StayTicket: component added
    - /components/PriceBreakdown: component added
```

- **ADR 0108 decision 6 classification:** `additive` (only new components + appended `$defs/anyComponent/oneOf` entries). No existing property, `required` array, enum, bound, `$defs` entry, or `functions` entry is modified. No catalogue major version bump or new catalogue ID is needed.

---

## 3. Complete conflict list: `feat/surface-kit-phase-1` (`5367de7`) vs `feat/app-expansion` (`c167137`)

### Read-only `git merge-tree` verification command & output

```powershell
Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue
git -C C:\AI2026\chat-marketplace-ae-02 merge-tree --write-tree --name-only --messages feat/app-expansion feat/surface-kit-phase-1
```

Exit code: `1` (14 conflicting files out of 46 changed on `feat/surface-kit-phase-1`):

```text
CONFLICT (add/add): .scratch/surface-catalogue-library/issues/01-surface-kit-components-manifests-composition.md
CONFLICT (add/add): .scratch/surface-catalogue-library/issues/02-weaver-adapters-and-probe-card.md
CONFLICT (add/add): .scratch/surface-catalogue-library/issues/03-shortlet-catalogues-as-manifests.md
CONFLICT (add/add): .scratch/surface-catalogue-library/issues/04-one-registration-source.md
CONFLICT (add/add): .scratch/surface-catalogue-library/issues/05-catalogue-snapshot-gate.md
CONFLICT (add/add): .scratch/surface-catalogue-library/map.md
CONFLICT (content): .scratch/weaver-catalogues/issues/04-booking-catalogue.md
CONFLICT (content): .scratch/weaver-catalogues/issues/05-unit-detail-catalogue.md
CONFLICT (content): .scratch/weaver-catalogues/issues/06-discovery-cards-catalogue.md
CONFLICT (content): .scratch/weaver-catalogues/issues/07-comparison-catalogue.md
CONFLICT (content): apps/local-guest/dist/client.js
CONFLICT (content): apps/local-guest/src/shortlet-runtime.ts
CONFLICT (content): apps/web-agent/src/shortlet-catalogs.ts
CONFLICT (content): test/weaver-dependency-boundary.test.ts
```

### A. Direct git merge conflicts (14 files)

| File | Symbols / Sections | What `feat/app-expansion` (`c167137`) does | What `feat/surface-kit-phase-1` (`5367de7`) does |
| --- | --- | --- | --- |
| `apps/web-agent/src/shortlet-catalogs.ts` | `asCatalogSchema`, `defineCatalog`, `*_COMPONENT` (9 constants), `DISCOVERY_COMPONENTS`, `BOOKING_COMPONENTS`, `shortletCatalog`, `SHORTLET_DISCOVERY_CATALOG`, `SHORTLET_BOOKING_CATALOG`, `SHORTLET_*_MANIFEST`, `SHORTLET_COMPOSED_CATALOGUES` | Uses Weaver `0.3.1` `defineCatalog(asCatalogSchema(...))`; defines all 9 typed components inline (`withComponents`) and exports the 9 `*_COMPONENT` constants + `CatalogDefinition` registrations. | Uses `defineCatalogueManifest` (`components: {}`, `actions: []`) + `composeWeaverCatalogue`; removes `shortletCatalog`; exports `SHORTLET_*_MANIFEST`, `SHORTLET_COMPOSED_CATALOGUES`, and Weaver `0.2.1` `CatalogRegistration`s. |
| `apps/local-guest/src/shortlet-runtime.ts` | `ShortletWebRuntimeOptions`, `GuestWebRuntimeOptions`, `createShortletWebRuntime`, `createGuestWebRuntime` | Takes `{ onServerEvent, resourcePolicy, safety, commerce, onCompareBoth }`; calls `createShortletRenderers({ resourcePolicy, onCompareBoth })` and conditionally registers `COMMERCE_CATALOGS` when `commerce === true`. | Retires `{ commerce }` flag; introduces `createGuestWebRuntime({ catalogues })` driven by `catalogRegistrationFor` + `rendererRegistrationsFor`; `createShortletWebRuntime` delegates to `createGuestWebRuntime` with `SHORTLET_COMPOSED_CATALOGUES`; drops `createShortletRenderers` and `onCompareBoth`. |
| `test/weaver-dependency-boundary.test.ts` | `sourceFiles` helper, `AC1` dependency version check | Keeps inline `sourceFiles` walker; `AC1` asserts `@cylayo/weaver-core` & `@cylayo/weaver-web` are pinned to `"0.3.1"`. | Extracts `sourceFiles` to `test/helpers/source-files.ts`; `AC1` still asserts `"0.2.1"`. |
| `apps/local-guest/dist/client.js` | Built browser bundle | Built with typed shortlet renderers, `0.3.1` `defineCatalog`, `onCompareBoth`, and `Xenia` shell updates. | Built with `createGuestWebRuntime`, `catalogue-renderers.ts`, and `0.2.1`. (Never hand-merge; regenerate with `npm run build`.) |
| `.scratch/surface-catalogue-library/map.md`, `issues/01`–`05` (6 files) | `Status:`, `## Comments`, `## Answer`, `## Context pointers` | Copied from `69c9ac4` via issue 01 (`19cd946`) with `Status: ready-for-agent`. | Same files created in `69c9ac4` and updated to `Status: resolved` with `## Comments`, `## Answer`, and `map.md` context pointers. |
| `.scratch/weaver-catalogues/issues/04`–`07` (4 files) | `Status:`, `Blocked by:`, `## Comments` | `Status: resolved`, `Blocked by` unchanged, implementation comments + dated note noting typed components landed before surface-kit. | `Status: ready-for-agent`, `Blocked by: ..., surface-catalogue-library 05`, ADR 0108 amendment comment. |

### B. Clean-merging overlaps (7 files)

| File | What happened on both sides | Resolution note |
| --- | --- | --- |
| `packages/platform-core/src/surface.ts` | `ae` added `SURFACE_LIFECYCLE_STATUSES` + `SURFACE_LIFECYCLE_TRANSITIONS` (non-overlapping lines); `sk` added a 3-line comment on `APPROVED_CATALOGUES` noting URN registration. | Merges cleanly; keep both. |
| `packages/platform-core/CONTEXT.md`, `docs/adr/0108-*.md`, `.scratch/surface-catalogue-library/PRD.md`, `.scratch/surface-catalogue-library/analysis.md`, `reports/Surface catalogue library prior art.md` | Identical content (`ae` cherry-picked `69c9ac4` in `19cd946`). | Merges cleanly (`sk` commit `69c9ac4` is skipped during cherry-pick). |
| `test/commerce-agent-tools.test.ts` | `ae` updated `AC6` scope classifier setup; `sk` updated `AC3` runtime creation from `createShortletWebRuntime({ commerce: true })` to `createGuestWebRuntime(...)`. | Merges cleanly; keep both edits. |

### C. Silent semantic / runtime conflicts (not flagged by git)

1. **`apps/web-agent/src/catalogues/weaver-catalogues.ts` (Weaver `0.2.1` vs `0.3.1`):** On `sk`, `catalogRegistrationFor` returns plain `{ catalogId, schema }` (`CatalogRegistration`). On `ae`, Weaver `0.3.1` provides `defineCatalog(asCatalogSchema(...))` returning `CatalogDefinition` (tested by `d1d5955`). The adapter must adopt `defineCatalog(asCatalogSchema(...))` so `SHORTLET_*_CATALOG` remains a validated `CatalogDefinition`.
2. **`apps/local-guest/src/catalogue-renderers.ts` (missing relationship/policy/callback support):** `renderAlias` only supports self-contained `html(props)` components. Wrapping the 6 non-leaf components (`UnitDetail`, `UnitGallery`, `UnitActionBar`, `StayCard`, `StayResults`, `StayComparison`) fails at runtime unless `catalogue-renderers.ts` accepts host-bound custom renderer overrides (taking `resourcePolicy` and `onCompareBoth`, passing Weaver `WebComponentRenderInput` with `relationships`) or moves relationship-aware rendering into the Weaver adapter.
3. **`test/shortlet-catalogue-manifests.test.ts` & `test/fixtures/catalogues/*.json`:** Written for empty Basic-only manifests (`actions: []`, 0 custom components). Once the 9 typed components and 16 actions land on `feat/app-expansion`, `test/shortlet-catalogue-manifests.test.ts` must verify all 9 components + 16 actions, and both snapshot JSONs must be regenerated (`UPDATE_CATALOGUE_SNAPSHOTS=1`). Also note `test/shortlet-catalog-validation.test.ts` AC1 scans `apps/` for literal `SHORTLET_DISCOVERY_CATALOG_ID` / `SHORTLET_BOOKING_CATALOG_ID` construction outside `shortlet-catalogs.ts` — satisfied because manifests use the imported constants.

---

## 4. Recommended path & verification suite

### Options evaluated

| Path | Verdict | Effort & Risk | Why |
| --- | --- | --- | --- |
| **Rebase** (`feat/surface-kit-phase-1` onto `feat/app-expansion`, or vice versa) | **Reject** | High conflict churn across 7 commits; rewrites `feat/surface-kit-phase-1` history (`96072c1` deletes typed components if replayed blindly, or `shortlet-catalogs.ts` conflicts on every commit). | Both branches already merged/advanced past `78135f7` (`feat/app-expansion` has Weaver `0.3.1`, typed catalogues, Xenia tokens, rules fixes). |
| **Redo from scratch** | **Reject** | Re-writes ~2,400 lines of tested `packages/surface-kit`, adapters, boundary tests, snapshot classifier, and `ProbeCard` fixtures already proven on `feat/surface-kit-phase-1`. | Unnecessary duplication; `packages/surface-kit` itself has **zero** conflicts with `feat/app-expansion`. |
| **Staged cherry-pick + targeted reconciliation** (skip `69c9ac4`) | **Recommend** | **5 small, revertible steps** grouped into 3 follow-up issues (`A`, `B`, `C`). Clean separation of pure library port vs typed-component wrapping vs runtime/snapshot cutover. | Imports `packages/surface-kit`, `ProbeCard`, `catalogue-snapshots`, and `createGuestWebRuntime` directly; updates only the 3 conflict/adapter seams against Weaver `0.3.1` and the 9 existing typed components. |

### Recommended sequence (5 revertible steps across 3 follow-up issues)

Skip `69c9ac4` (already landed via `19cd946` on `feat/app-expansion`) and keep `.scratch/weaver-catalogues/issues/04`–`07` as `Status: resolved` (keeping `ae`'s text). Update `.scratch/surface-catalogue-library/map.md` and `issues/01`–`05` only to preserve historical phase-1 provenance (`sk` resolution notes) alongside `ae`'s follow-up linkage.

1. **Step 1 — Follow-up A (part 1): Cherry-pick `dbc13d2` (`packages/surface-kit` core + boundary test)**
   - **Size:** ~1,100 lines added (`packages/surface-kit/src/{types,define,compose,glossary,json,index}.ts`, `README.md`, `test/surface-kit.test.ts`, `test/surface-kit-boundary.test.ts`, `test/helpers/{source-files,surface-kit-props}.ts`, `test/fixtures/surface-kit/probe-card.ts`).
   - **Conflicts to resolve:** `test/weaver-dependency-boundary.test.ts` (keep `"0.3.1"` pin from `ae`, adopt shared `sourceFiles` import from `sk`); `.scratch/surface-catalogue-library/issues/01*` (keep resolved note from `sk`).
2. **Step 2 — Follow-up A (part 2): Cherry-pick `b629535` (Weaver adapters + ProbeCard proof)**
   - **Size:** ~420 lines added (`apps/web-agent/src/catalogues/weaver-catalogues.ts`, `apps/local-guest/src/catalogue-renderers.ts`, `test/fixtures/surface-kit/probe-manifest.ts`, `test/surface-kit-weaver.test.ts`), plus ~30-line adaptation.
   - **Reconciliation edits:**
     - In `weaver-catalogues.ts`: wrap `catalogRegistrationFor` with Weaver `0.3.1` `defineCatalog(asCatalogSchema(...))` so `CatalogDefinition` is returned (ADR 0081 keeps `defineCatalog` inside the adapter).
     - In `catalogue-renderers.ts`: add optional custom-renderer override support in `rendererRegistrationsFor(composed, resourcePolicy, customRenderers?)` (or pass `options: { resourcePolicy, onCompareBoth }`) so relationship/policy/callback-bearing aliases work without forcing `packages/surface-kit` to know Weaver `relationships` or `BasicResourcePolicy`.
   - **Conflicts to resolve:** `.scratch/surface-catalogue-library/issues/02*` (keep resolved note from `sk`).
3. **Step 3 — Follow-up B: Adapt `96072c1` + `e97d11f` (wrap the 9 typed shortlet components as Tier 3 `SurfaceComponentDefinition`s + manifest composition)**
   - **Size:** ~550 lines changed/added (`apps/web-agent/src/shortlet-components/` [or `shortlet-catalogs.ts`], `apps/web-agent/src/shortlet-catalogs.ts`, `packages/surface-kit/src/canonical.ts`, `test/shortlet-catalogue-manifests.test.ts`).
   - **Reconciliation edits:**
     - Define all 9 existing components (`UnitDetail`, `UnitGallery`, `UnitDetailSheet`, `UnitActionBar`, `StayCard`, `StayResults`, `StayComparison`, `StayTicket`, `PriceBreakdown`) as **Tier 3** `SurfaceComponentDefinition`s (`1.0.0`) with complete `text(props)` fallbacks (ADR 0074), `html(props)` delegating to `guest-kit.ts` where pure (`StayTicket`, `PriceBreakdown`, `UnitDetailSheet`), and valid/invalid fixtures.
     - Keep sub-schemas inline so composed schemas remain **100% byte-identical** to `feat/app-expansion`.
     - Populate `SHORTLET_DISCOVERY_MANIFEST` (`components`: 7 aliases, `actions`: the 6 discovery events) and `SHORTLET_BOOKING_MANIFEST` (`components`: 2 aliases, `actions`: the 10 booking events).
     - Assert `canonicalJson(composed.schema)` equals the pre-refactor `feat/app-expansion` schemas.
4. **Step 4 — Follow-up C (part 1): Adapt `c50649f` (one registration source + retire `{ commerce }` flag)**
   - **Size:** ~150 lines changed (`apps/local-guest/src/shortlet-runtime.ts`, `packages/platform-core/src/surface.ts`, `test/commerce-agent-tools.test.ts`, `test/commerce-switch-catalogues.test.ts`, `test/guest-web-runtime.test.ts`), plus rebuilt `apps/local-guest/dist/client.js`.
   - **Reconciliation edits:**
     - Adopt `createGuestWebRuntime({ catalogues })` and flag-free `createShortletWebRuntime`.
     - Keep `onCompareBoth?: () => void` on `ShortletWebRuntimeOptions` / `GuestWebRuntimeOptions` (or pass via `shortlet-renderers.ts` adapter hook into `rendererRegistrationsFor`) so `StayResults` keeps "See both side by side" working in `client.ts`.
     - Retire `createShortletRenderers` as a top-level runtime bypass; route all 9 shortlet component renderers through `rendererRegistrationsFor`.
     - Rebuild `apps/local-guest/dist/client.js` with `npm run build`.
5. **Step 5 — Follow-up C (part 2): Cherry-pick `f67f5ec` + `5367de7` (snapshot gate + `classifyCatalogueChange`)**
   - **Size:** ~450 lines (`packages/surface-kit/src/classify.ts`, `test/helpers/catalogue-snapshots.ts`, `test/catalogue-snapshots.test.ts`), plus regenerated `test/fixtures/catalogues/urn-chat-marketplace-shortlet-{discovery,booking}-v1.json`.
   - **Reconciliation edits:** Run `UPDATE_CATALOGUE_SNAPSHOTS=1` once to record the `feat/app-expansion` 9-component `v1` schemas as the baseline snapshots; prove `classifyCatalogueChange` flags any later breaking drift under `v1`.

### Tests that prove zero wire change

Run per follow-up issue (all commands with `env -u LLM_API_KEY`):

- Type & bundle gate: `npm run check`
- Surface-kit & manifest suites:
  `npx tsx --test test/surface-kit.test.ts test/surface-kit-boundary.test.ts test/surface-kit-weaver.test.ts test/shortlet-catalogue-manifests.test.ts test/guest-web-runtime.test.ts test/catalogue-snapshots.test.ts`
- Existing shortlet catalogue, parity, boundary, and cold-restore suites (unchanged wire contract):
  `npx tsx --test test/shortlet-catalog-validation.test.ts test/weaver-booking-catalogue.test.ts test/weaver-unit-detail-catalogue.test.ts test/weaver-discovery-cards-catalogue.test.ts test/weaver-comparison-catalogue.test.ts test/weaver-dependency-boundary.test.ts test/commerce-switch-catalogues.test.ts test/commerce-agent-tools.test.ts test/assistant-cold-journey.test.ts`
- Real Chrome (run solo after `dist/client.js` rebuild in Step 4):
  `npx tsx --test test/weaver-failure-chromium.test.ts`

---

## 5. Round-12 chat components: ADR 0108 tier, catalogue & impact on `2b-05` and `2b-06`

### Classification of every round-12 component in scope

| Round-12 Component | CSS classes (`class-map.md`) | Where it lives (ADR 0108 / 0106 / 0107) | Catalogue & Alias | ADR 0108 Tier & Promotion path |
| --- | --- | --- | --- | --- |
| **`ChatMessage`** | `.ui-conversation`, `.ui-message`, `.ui-message--guest`, `.ui-persona` (`__mark`, `__mode`, `--human`) | **Shell / platform chrome** (client transcript + `/conversation` no-JS page). Not an A2UI surface component; the concierge turn *contains* A2UI surfaces rather than being one. | **None** | N/A — shared shell helper in `guest-kit.ts` + `shortlet-foundations.css` (ADR 0080 parity). |
| **`Composer`** | `.ui-composer`, `__input`, `__send`, `--link` (Ask bar) | **Shell / platform chrome** (`composerHtml` in `guest-kit.ts`, `client.ts`, `/conversation`, landing page). | **None** | N/A — shared shell helper driven by `ModePresentation` (ADR 0107). |
| **`CriteriaChip`** | `.ui-chips`, `.ui-chip`, `--add`, `--demo` | **Shell / platform chrome** (`client.ts` criteria strip + `assistantContext` per ADR 0106). Exception: `.ui-chip--demo` (`demoListingChipHtml`) is also embedded inside `StayCard` and `UnitDetailSheet`. | **None** (`--demo` rendered inside `StayCard` / `UnitDetailSheet` via `demo: boolean` prop) | N/A — shell chip bar; `demo` prop stays boolean on `v1` schemas. |
| **`ConciergeChooser`** | `.ui-chooser` (`--dialog`, `__options`, `__option`, `__text`, `__line`), `.ui-mode-label--control`, `.ui-agent-mark` | **Shell / platform chrome** (multi-domain strip/dialog driven by `GUEST_MODE_CHOOSER` and `platform.task.start`/`switch`, ADR 0107). | **None** | N/A — platform mode switcher (`guest-kit.ts` + `client.ts`). |
| **`DomainTag`** | `.ui-domain-tag` (maps from `.ui-domain-chip`) | **Shell / platform chrome** (cross-domain row badge rendered only when >=2 packs are registered, e.g. `/plans` list rows). | **None** | N/A — kit helper in `guest-kit.ts` reading `--mode-accent`. |
| **`SwitchDivider`** | `.ui-switch-divider`, `__text` | **Shell / platform chrome** (conversation lane-switch row inside `role="log"`, ADR 0107 decision 11). | **None** | N/A — kit helper / client transcript row reading `guestModeSwitchAnnouncement`. |
| **`StayCard`** | `.ui-stay-card` (`__media`, `__photo`, `__photo--empty`, `__count`, `__label`, `__body`, `__where`, `__title`, `__facts`, `__total`) | **Existing A2UI Surface Component** + shared `guest-kit.ts` (`stayCardInnerHtml` / `stayCardPartsHtml`). Ported in **`2b-04`** (already in `shortlet-catalogs.ts` + `shortlet-renderers.ts`). | `urn:chat-marketplace:shortlet/discovery/v1`, alias **`StayCard`** | **Tier 3 on `v1`** today (because `unitId`, `deposit`, `bed`/`bath` are domain terms). **Tier 2 (`ResultCard@1`) candidate on `v2`** after commerce paper check. |
| **`ChatCard`** | `.ui-chat-card` (`__head`, `__title`, `__aside`, `__rows`, `__row`) | **Kit HTML/CSS contract in `2b-06`** -> **future A2UI Surface Component** when Phase 3/4 emits in-chat Your-stays / period-payment summary cards. **No new catalogue ID** (ADR 0073). | None in `2b-06`; later additive on **`shortlet-booking/v1`** (or `shortlet-discovery/v1` if discovery-scoped), alias **`ChatCard`** (or domain-specific alias) | **Tier correction:** `ChatCard/README.md` calls it a Tier 2 candidate from "Your stays" + "period payment", but **both are inside Stays**. Under ADR 0108 decision 2, it lands as **Tier 3** first, promoting to Tier 2 only when a second real domain (e.g. commerce order summary or events) uses it — or Tier 1 only if platform-owned for `/plans` with zero domain vocabulary. |
| **`ActionBar`** (`2b-06`) | `.ui-action-bar` (`__sum`, `--sticky`) | **Existing A2UI `UnitActionBar`** on `shortlet-discovery/v1` + kit HTML on standalone/booking screens. | `shortlet-discovery/v1`, alias **`UnitActionBar`** (unchanged props) | **Tier 3 on `v1`** (`.ui-action-bar--sticky` is pure CSS + markup in `renderUnitActionBar` / `guest-kit.ts`; no schema change). |
| **`Confirm` / `Panel`** (`2b-06`) | `.ui-confirm` (`__body`, `.ui-effect*`), `.ui-panel` (`--commit`, `__title`) | **Kit HTML/CSS helpers** in `guest-kit.ts` + booking screen organizers in `client.ts` until Phase 3 retires the 4 booking organizers. | **None in `2b-06`** | Kit helpers in `2b-06`; Phase 3 platform tier (`Steps`, `StatusBanner`, `Deadline`, etc.) evaluates A2UI promotion later. |

### What `2b-05` must do differently

1. **No A2UI catalogue or `packages/surface-kit` work:** All 6 `2b-05` component families (`ChatMessage`/`Persona`, `CriteriaChip`, `Composer`, `ConciergeChooser`, `DomainTag`, `SwitchDivider`) are shell/platform chrome, not A2UI Surface Components. Do **not** touch `apps/web-agent/src/shortlet-catalogs.ts`, `apps/local-guest/src/shortlet-renderers.ts`, or `packages/surface-kit`.
2. **Keep AC3 grounded:** Interpret AC3 as preserving the shared `guest-kit.ts` / `ui-kit.ts` helper exports and ADR 0102/0107 runtime validations (`shortlet-catalog-validation.test.ts`, `assistant-cold-journey.test.ts`) without adding new A2UI schemas or catalogue IDs.
3. **Coordinate `.ui-chip--demo` with `2b-04`:** `demoListingChipHtml()` in `guest-kit.ts` renders `.ui-chip--demo` inside `StayCard` (`StayCard`) and `UnitDetailSheet` (`shortlet-renderers.ts`); keep `.ui-chip--demo` backwards-compatible if `2b-04` introduces `.ui-stay-card__label`.
4. **Unblocked by Follow-ups A–C:** Because `2b-05` makes zero A2UI schema changes, it only depends on `07` and `2b-01` (not on landing Follow-ups A–C first).

### What `2b-06` must do differently

1. **Zero schema / catalogue ID changes:** Do **not** mint a new catalogue ID (ADR 0073) and do **not** add a `ChatCard` A2UI component schema to `shortlet-catalogs.ts` in `2b-06`. `UnitActionBar` (`shortlet-discovery/v1`) keeps its exact `v1` schema (`total`, `totalLabel`, `child`); `.ui-action-bar--sticky` is ported purely in `shortlet-foundations.css`, `guest-kit.ts`, `renderUnitActionBar` (`shortlet-renderers.ts`), and the 4 booking screen organizers in `client.ts`.
2. **Write `chatCardHtml` ADR-0108-ready in `guest-kit.ts`:** Any new `chatCardHtml(props)` helper added for `.ui-chat-card` must take strict JSON-serialisable props, hold **no hardcoded domain copy** (all labels/copy passed in from `guest-content.ts`, ADR 0077), escape every value (ADR 0075), and have a matching plain-text `chatCardText(props)` helper (ADR 0074) so Phase 3/4 can wrap it in `defineSurfaceComponent` cleanly.
3. **Apply the Tier 3 rule for `ChatCard`:** Treat `ChatCard` as **Tier 3** (stays-only) until a second real domain uses it (correcting `ChatCard/README.md`'s reading of ADR 0108 decision 2).
4. **Keep `Confirm` and `Panel` as kit helpers:** Until Phase 3 retires `organizeRequestScreen`, `organizeOfferScreen`, `organizePaymentScreen`, and `organizeConfirmation`, `.ui-confirm` / `.ui-effect` / `.ui-panel--commit` remain kit HTML + organizer DOM work.
5. **Unblocked by Follow-ups A–C:** Because `2b-06` makes zero A2UI schema changes, it only depends on `07` and `2b-01` (not on landing Follow-ups A–C first).

---

## 6. Implied follow-up issues (AC3) & Owner decisions

### Implied follow-up issues

1. **Follow-up A — Port `packages/surface-kit` + Weaver `0.3.1` adapters (cherry-pick `dbc13d2` + `b629535`):**
   - Lands `packages/surface-kit`, `ProbeCard`, `test/surface-kit*.test.ts`, `apps/web-agent/src/catalogues/weaver-catalogues.ts` (updated to Weaver `0.3.1` `defineCatalog(asCatalogSchema(...))`), and `apps/local-guest/src/catalogue-renderers.ts` (extended with optional custom-renderer override support for relationship/policy/callback components).
2. **Follow-up B — Wrap the 9 typed shortlet components as Tier 3 manifests (`shortlet-discovery/v1`, `shortlet-booking/v1`):**
   - Adapts `96072c1` + `e97d11f`: converts the 9 schemas in `shortlet-catalogs.ts` into Tier 3 `SurfaceComponentDefinition`s with `text()` fallbacks and fixtures, populates `manifest.actions` with all 16 emitted events, composes both catalogues via `composeWeaverCatalogue`, and verifies byte-identity against `feat/app-expansion`.
3. **Follow-up C — Unified runtime registration, retire `{ commerce }`, and snapshot gate (`c50649f` + `f67f5ec` + `5367de7`):**
   - Adopts `createGuestWebRuntime`, retires `{ commerce }` in `shortlet-runtime.ts` while keeping `onCompareBoth`, routes all 9 shortlet renderers through `rendererRegistrationsFor`, rebuilds `dist/client.js`, runs `test/weaver-failure-chromium.test.ts`, and commits the baseline `v1` snapshots under `test/fixtures/catalogues/` with `classifyCatalogueChange`.
4. **Later (ADR 0108 phase 2, unscheduled until Phase 3/4):** Paper-check Tier 1/2 promotions (`PriceBreakdown` → `MoneyBreakdown`, `StayTicket` → `CommitmentSummary`, `StayCard` → `ResultCard`, `UnitDetailSheet` → `DetailView`, `StayComparison` → `Comparison`, plus `ChatCard`) against commerce and ship under `v2` only when reviewed under ADR 0073.

### Decisions the owner must make

1. **Sequencing of Follow-ups A–C vs Phase 2b:** Land Follow-ups A–C now in parallel with Phase 2b (serializing carefully on `shortlet-runtime.ts` / `dist/client.js` against `2b-06` and `feat/submit-diagnostic`), or right after Phase 2b finishes before Phase 3 introduces the first new A2UI component (`ChatCard`)?
2. **Tier 3 on `v1` now vs immediate `v2`:** Confirm wrapping the 9 existing components as **Tier 3** under `v1` (preserving 100% wire byte-identity and zero open-chat breakage) and deferring glossary-clean Tier 1/2 renaming to `v2`.
3. **Adapter hook for the 6 relationship/policy/callback components:** Confirm extending `apps/local-guest/src/catalogue-renderers.ts` (`rendererRegistrationsFor`) to accept per-alias host-aware renderers (keeping `packages/surface-kit` Weaver-free per ADR 0081) rather than redesigning `UnitDetail`, `StayCard`, `StayResults`, `StayComparison`, `UnitGallery`, and `UnitActionBar` to remove Weaver relationships now.
4. **Lifecycle of `feat/surface-kit-phase-1`:** Confirm superseding `feat/surface-kit-phase-1` via Follow-ups A–C and leaving `feat/surface-kit-phase-1` unmerged/archived.
