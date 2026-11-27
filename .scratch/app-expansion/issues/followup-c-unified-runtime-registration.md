# Follow-up C: Unified runtime registration, retire { commerce }, and the snapshot gate

Status: ready-for-agent
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
