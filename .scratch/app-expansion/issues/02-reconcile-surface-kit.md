# Reconcile the shared component library with the typed components on main

Status: resolved
Type: research
Blocked by: none

## Why

ADR 0108 planned the library first and the typed components second. They landed the other way round. `main` has typed `StayCard`, `StayResults`, `StayTicket`, `PriceBreakdown`, `UnitDetail` and `StayComparison` (weaver-catalogues 04–08). Library phase 1 is complete but unmerged on `feat/surface-kit-phase-1` (7 code commits, base 78135f7). A trial merge conflicts in `shortlet-catalogs.ts`, `shortlet-runtime.ts`, `weaver-dependency-boundary.test.ts`, `dist/client.js` and four issue files.

Until this is settled, a new chat component has no format to land in.

## Question

How do the typed components on `main` become library components without changing what a stored or open chat renders?

## What to produce

A note `notes/02-surface-kit.md` in this effort, and no code:

1. For each typed component: its schema on `main`, whether it fits `defineSurfaceComponent` unchanged, and any prop the library cannot express.
2. Whether the composed catalogue can stay byte-identical to `main`'s. If not, the exact differences, and whether ADR 0108 decision 6 makes them minor or major.
3. The merge order with the smallest diff, and the tests that prove there is no wire change (`test/catalogue-snapshots.test.ts` on the branch).
4. One recommendation, with the decision the owner must make, if any. No new catalogue ID (ADR 0073).

## Acceptance criteria

- AC1: Every typed component on `main` has a row.
- AC2: Each claim of "unchanged" is shown by a command and its output, run in a scratch worktree. Nothing is merged or pushed.
- AC3: The note names the follow-up issues it implies.

## ADR compliance

0073 (no new ID), 0081, 0102, 0106 (old chats restore), 0108.

## Answer

Research completed 26 Nov 2026 in [notes/02-surface-kit.md](../notes/02-surface-kit.md) (no code changes, no merge, no push).

- **9 typed components audited (AC1):** `UnitDetail`, `UnitGallery`, `UnitDetailSheet`, `UnitActionBar`, `StayCard`, `StayResults`, `StayComparison` (`shortlet-discovery/v1`) and `StayTicket`, `PriceBreakdown` (`shortlet-booking/v1`). All 9 fit `defineSurfaceComponent` unchanged, and composing them via `composeCatalogueSchema` produces schemas **100% byte-identical** to `feat/app-expansion` (`canonicalJson` exact match) while Weaver `0.3.1` vs `0.2.1` keeps the Basic Catalog schema identical (`true`). Moving from `feat/surface-kit-phase-1`'s empty-manifest snapshots to `feat/app-expansion`'s 9 components classifies as `additive` (`classifyCatalogueChange`), with zero breaking change and zero wire impact on stored or open chats.
- **Conflicts:** 14 direct git conflicts (`git merge-tree`: `shortlet-catalogs.ts`, `shortlet-runtime.ts`, `test/weaver-dependency-boundary.test.ts`, `dist/client.js`, 6 `.scratch/surface-catalogue-library/` files, 4 `.scratch/weaver-catalogues/` files) plus 3 semantic/adapter conflicts (`weaver-catalogues.ts` returning Weaver `0.2.1` `CatalogRegistration` vs `0.3.1` `CatalogDefinition`; `catalogue-renderers.ts` `renderAlias` lacking `relationships`, `BasicResourcePolicy`, `buildListingGallery`, and `onCompareBoth` hooks needed by 6 of the 9 components; `SHORTLET_*_MANIFEST.actions` missing the 16 emitted events + stale Basic-only snapshots).
- **Recommended path:** **Staged cherry-pick (skipping duplicate doc commit `69c9ac4`) + targeted reconciliation** in 5 revertible steps across **3 implied follow-up issues (Follow-ups A, B, C)**, leaving `feat/surface-kit-phase-1` unmerged/archived.
- **Round-12 chat components:** `StayCard` (existing Tier 3 on `shortlet-discovery/v1`) and future `ChatCard` (kit-only in `2b-06`, later Tier 3 on `shortlet-booking/v1`) are A2UI Surface Components; `ChatMessage`, `Composer`, `CriteriaChip`, `ConciergeChooser`, `DomainTag`, and `SwitchDivider` are shell/platform chrome (`ADR 0106`, `ADR 0107`). Dated reconciliation notes were added to `issues/2b-05-chat-message-chips-composer.md` and `issues/2b-06-chat-card-action-bar-disclosure.md`.

## Comments

- **26 Nov 2026 (worktree `C:\AI2026\chat-marketplace-ae-02`, branch `feat/app-expansion-02`, base `c167137`, compared against `feat/surface-kit-phase-1` at `5367de7`):**
  - **AC1:** All 9 typed components on `feat/app-expansion` have a dedicated row in `notes/02-surface-kit.md` §1 (noting issue 02's prompt listed 6 top-level names while `shortlet-catalogs.ts` defines 9).
  - **AC2:** Verified read-only in `C:\AI2026\chat-marketplace-ae-02` with `Remove-Item Env:LLM_API_KEY`:
    - `git -C C:\AI2026\chat-marketplace-ae-02 merge-tree --write-tree --name-only --messages feat/app-expansion feat/surface-kit-phase-1` -> exit `1`, 14 conflicting files (6 `add/add` in `.scratch/surface-catalogue-library/`, 4 `content` in `.scratch/weaver-catalogues/issues/04-07`, 4 `content` in `shortlet-catalogs.ts`, `shortlet-runtime.ts`, `weaver-dependency-boundary.test.ts`, `dist/client.js`).
    - `node --import "file:///C:/AI2026/chat-marketplace-ae-02/node_modules/tsx/dist/loader.mjs" --input-type=module` comparing `SHORTLET_DISCOVERY_CATALOG` and `SHORTLET_BOOKING_CATALOG` against `packages/surface-kit/src/index.ts` (`5367de7`) -> `Basic schema 0.3.1 === 0.2.1 snapshot? true`; all 9 components pass `defineSurfaceComponent`; `composeCatalogueSchema byte-identical to feat/app-expansion? true` for both catalogues; `classifyCatalogueChange` returns `additive` (14 reasons on discovery, 4 on booking, 0 breaking).
  - **AC3:** Follow-ups A, B, C (and deferred Phase-2 promotion D) are named in `notes/02-surface-kit.md` §6 alongside 4 explicit owner decisions.
  - **ADR compliance:** Checked `0073`, `0074`, `0075`, `0077`, `0078`, `0079`, `0080`, `0081`, `0102`, `0106`, `0107`, `0108`.
  - **Scope:** Research/docs only (`write_file` / `edit_file` strictly under `.scratch/app-expansion/`). No code changes, no `npm run check` / test suite run needed beyond the read-only verification scripts above.
