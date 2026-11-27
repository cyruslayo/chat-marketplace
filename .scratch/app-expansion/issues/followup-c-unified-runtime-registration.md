# Follow-up C: Unified runtime registration, retire { commerce }, and the snapshot gate

Status: resolved on feat/app-expansion-02c (8388d4b)
Type: task
Blocked by: Follow-up B (D33, D36)

## Why

Completes the issue 02 recommendations the owner accepted: one runtime registration path for all 9 shortlet renderers, the `{ commerce }` option retired from `shortlet-runtime.ts`, and a baseline snapshot gate so future record, wire, or action changes are classified before they land (D33; D36 supersedes `feat/surface-kit-phase-1`, which stays unmerged).

## What to build

- Adapt `c50649f` + `f67f5ec` + `5367de7` from `feat/surface-kit-phase-1` (read blobs with `MSYS_NO_PATHCONV=1 git cat-file -p`, resolve against the current code, never merge that branch):
  - Adopt `createGuestWebRuntime`.
  - Retire `{ commerce }` in `apps/local-guest/src/shortlet-runtime.ts`, keeping `onCompareBoth`.
  - Route all 9 shortlet renderers through `rendererRegistrationsFor`.
  - Rebuild `apps/local-guest/dist/client.js` (`npm run build`) and commit it.
  - Commit the baseline `v1` snapshots under `test/fixtures/catalogues/` with `classifyCatalogueChange`.
- Prove wire byte-identity of both catalogues against the pre-change output on this branch (recorded dumps in the Comments).
- Keep every fail-closed guard (`STALE_SURFACE` / `ARTIFACT_MISMATCH`) intact. No behaviour or copy change.

## Acceptance criteria

- AC1: The emitted `v1` wire bytes are identical before and after, for both catalogues.
- AC2: `{ commerce }` is gone from `shortlet-runtime.ts` and `onCompareBoth` still works; every record, wire, or action change is classified before it lands (`classifyCatalogueChange` baseline committed).

## ADR compliance

0073, 0081, 0108, 0106, 0102.

## Tests

`npm run check`, the catalogue byte-identity check, `test/assistant-cold-journey.test.ts` (cold restore before every event), `test/weaver-failure-chromium.test.ts`. Record exact commands and counts in `## Comments`.

## Comments

2026-11-26, branch `feat/app-expansion-02c` (from `feat/app-expansion-02b`), cherry-picked and resolved:

- `c50649f` → `6a70a28` — conflicts resolved by hand in `apps/local-guest/src/shortlet-runtime.ts` and `dist/client.js` (ours, rebuilt):
  - `createGuestWebRuntime({ catalogues })` adopted; `{ commerce }` retired from the options (AC2); `onCompareBoth` kept and now reaches the trusted `StayResults` renderer through the host-renderer overlay.
  - All 9 shortlet renderers are routed through `rendererRegistrationsFor` (`catalogue-renderers.ts` gained an optional third parameter, `hostRenderers`: an alias with a trusted host renderer uses it — the host image policy of ADR 0102 plus `onCompareBoth` — and any other alias falls back to its component's kit `html`; decision 3 of the owner's issue 02 answer, recorded as D35). `packages/surface-kit` stays Weaver-free.
  - Two extra repairs the pick surfaced, both no-behaviour-change:
    1. `test/weaver-unit-detail-catalogue.test.ts` AC4 still expected the pre-2b-06 class list `ui-action-bar unit-action-bar`; updated to `ui-action-bar ui-action-bar--sticky unit-action-bar` (the class 2b-06 added).
    2. A Follow-up B defect: the catalogue manifests imported the three payment event constants from `apps/web/src/{bank-transfer,card-payment,conditional-offer}-actions.ts`, whose value imports of `platform-core` and `domains/shortlet` (node:crypto, node:fs) cannot enter the browser bundle. The constants moved to client-safe leaf modules `apps/web/src/{bank-transfer,card-payment,conditional-offer}-events.ts`; the heavy action modules re-export them, so every existing importer (a2ui builders, tests, `shortlet-app.ts`) is unchanged. Same values, no behaviour change; surfaced only on the first `npm run build` after B, so it is fixed with C.
- `f67f5ec` → `9723e66`, `5367de7` → `8388d4b`: snapshot gate + `classifyCatalogueChange` applied; baseline `v1` snapshots are the ones committed with Follow-up B.
- Wire byte-identity (AC1), `npx tsx dump-catalogues.mts` (uncommitted scratch script) before Follow-up B, after B, and after C — identical:
  - `shortlet-discovery/v1` SHA-256 `a2bcc2f865e7509a40f861618f6c1df5226d2896766cdf1ec73bcc7de11361d4`
  - `shortlet-booking/v1` SHA-256 `44e35c3e38995d661fea1b9096f983152ae24025763f1229461feefd9335e295`
- Rebuild: `npm run build` at repo root; regenerated `apps/local-guest/dist/client.js` committed with the pick.

Commands and counts (all with `NODE_ENV=test`, no `LLM_API_KEY` export):
- `npm run check` — exit 0 (after the runtime resolution, and again after the leaf-event extraction).
- `npx tsx --test test/guest-web-runtime.test.ts test/commerce-switch-catalogues.test.ts test/commerce-agent-tools.test.ts test/surface-kit-weaver.test.ts test/surface-kit-boundary.test.ts test/weaver-unit-detail-catalogue.test.ts test/weaver-discovery-cards-catalogue.test.ts test/weaver-comparison-catalogue.test.ts test/weaver-booking-catalogue.test.ts test/shortlet-catalog-validation.test.ts` — first run 68 pass / 1 fail in `weaver-unit-detail-catalogue` (the stale class list above); after the fix, 69 pass / 0 fail.
- `npx tsx --test test/assistant-cold-journey.test.ts test/shortlet-assistant-evals.test.ts test/local-guest-weaver-demo.test.ts test/shortlet-catalog-validation.test.ts` — 74 pass / 0 fail (cold restore before every event, 2026-10-27 clock, unseeded guest).
- `npx tsx --test test/weaver-failure-chromium.test.ts` (real Chrome, one at a time) — 1 pass / 0 fail, run before and after the rebuild.
- `npx tsx --test test/guest-web-runtime.test.ts test/commerce-switch-catalogues.test.ts test/commerce-agent-tools.test.ts test/shortlet-catalogue-manifests.test.ts test/surface-kit-weaver.test.ts` after the rebuild — 33 pass / 0 fail.
- `npx tsx --test test/assistant-cold-journey.test.ts` after the rebuild — 4 pass / 0 fail.
- `npx tsx --test test/catalogue-snapshots.test.ts` — 7 pass / 0 fail (baseline + classifier).
- Fail-closed guards untouched: `STALE_SURFACE` / `ARTIFACT_MISMATCH` paths asserted unchanged by `shortlet-catalog-validation.test.ts`, the `weaver-*-catalogue.test.ts` files and `weaver-failure-chromium.test.ts` above.

Held back for Phase 3 (no owner decision recorded here): retiring the short `APPROVED_CATALOGUES` ids in `platform-core` is ADR 0108 phase 3; only the pointer comment from the pick landed.
